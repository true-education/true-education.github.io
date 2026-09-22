#!/usr/bin/env python3
"""
한국증권금융 기업인수목적회사예수금 고시금리 스냅샷

스팩이 공모자금을 예치하는 상품의 고시금리를 매일 받아
data/ksfc_rate.json 에 기준일자별로 쌓는다. 신규 상장 종목의 초기
예치이율을 정할 때 참고할 기준선을 만드는 게 목적이다.

실행:
    python3 scripts/fetch_ksfc_rate.py            # 받아서 저장
    python3 scripts/fetch_ksfc_rate.py --dry-run  # 받아서 출력만
    python3 scripts/fetch_ksfc_rate.py --show     # 저장된 최근 스냅샷 출력

주의할 점 몇 가지.

1. www.ksfc.co.kr 443 포트는 인증서가 ebank.ksfc.co.kr 용이라 검증이 깨진다.
   사이트 본체가 http → https://www.ksfc.co.kr:4443 으로 리다이렉트하므로
   :4443 을 직접 호출하면서 인증서 검증을 끈다. 받아오는 값이 공개 고시금리라
   가로채기 위험이 실질적으로 없어서 이 정도로 타협했다.

2. fixed(거치식) 응답의 기간코드는 그 구간의 상한이다. 사이트 JS
   (common.js 의 setDepositRate)는 라벨을 직전 행의 코드로, 이율을 현재 행에서
   가져와 [직전코드, 현재코드-1] 개월 구간으로 표시한다. 즉 코드 18 의 이율이
   화면상 "12개월"이다. 코드를 개월수로 그대로 읽는 해석과 갈리는데, 스팩이
   실제로 거는 3년 거치는 두 해석 모두 코드 36/999999 의 2.55%로 같아서
   초기 이율 용도에는 영향이 없다. 해석을 하나로 고정하지 않으려고 표를
   가공 없이 그대로 저장한다.

3. 고시금리는 하한이다. 기관고객 조회 화면은 "N% + a" 로 표시하고 우대금리
   가산 가능이라고 안내한다. 실제 약정이율은 종목별로 이보다 높을 수 있다.
"""

import json
import ssl
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

BASE        = "https://www.ksfc.co.kr:4443"
RATE_PAGE   = f"{BASE}/product/rate/popup/deposit.do"
RATE_API    = f"{BASE}/product/rate/ajax/getDepositExpireAndRate.do"
PRD_MCLCD   = "114"   # 기업인수목적회사예수금
PRCD_FIXED  = "168"   # 거치식(만기지급식)
PRCD_DEMAND = "145"   # 수시입출식

REPO_DIR    = Path(__file__).parent.parent
OUTPUT_PATH = REPO_DIR / "data" / "ksfc_rate.json"

KST = timezone(timedelta(hours=9))
UA  = "Mozilla/5.0"

# 인증서 도메인이 맞지 않는다. 위 1번 참고.
SSL_CTX = ssl._create_unverified_context()


def http(url, data=None):
    body = urllib.parse.urlencode(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20, context=SSL_CTX) as r:
        return r.read().decode("utf-8", errors="ignore")


def fetch_base_date():
    """조회 화면에 찍히는 기준일자(YYYY-MM-DD). 휴일 등으로 갱신이 밀리면
    오늘 날짜와 달라지므로 로컬 날짜 대신 이 값을 키로 쓴다."""
    import re
    html = http(RATE_PAGE)
    m = re.search(r"기준일자\s*:\s*(\d{4})\.(\d{2})\.(\d{2})", html)
    if not m:
        raise RuntimeError("기준일자를 찾지 못했습니다. 페이지 구조가 바뀐 듯합니다.")
    return "-".join(m.groups())


def fetch_rates(prcd):
    """{기간코드: 이율} 반환. 빈 응답이면 예외."""
    raw = http(RATE_API, {"prdMclcd": PRD_MCLCD, "prcd": prcd})
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise RuntimeError(f"prcd={prcd} 응답이 JSON 이 아닙니다: {raw[:200]}")

    if data.get("result") != "SUCCESS":
        raise RuntimeError(f"prcd={prcd} 조회 실패: {data.get('result')}")

    rows = data.get("list") or []
    if not rows:
        raise RuntimeError(f"prcd={prcd} 결과가 비어 있습니다.")

    return {str(r["INRT_TRM_DST_CD_VL"]): float(r["APL_INRT"]) for r in rows}


def load_existing():
    if not OUTPUT_PATH.exists():
        return {}
    with open(OUTPUT_PATH, encoding="utf-8") as f:
        return json.load(f)


def save(snapshots):
    ordered = {k: snapshots[k] for k in sorted(snapshots)}
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(ordered, f, ensure_ascii=False, indent=4)
        f.write("\n")


def summarize(base_date, snap):
    fixed = snap["fixed"]
    terms = ", ".join(f"{k}:{v}" for k, v in fixed.items())
    print(f"기준일자 {base_date}")
    print(f"  거치식(만기지급식) {terms}")
    print(f"  수시입출식 {snap['demand']}%")
    if "36" in fixed:
        print(f"  → 36개월(스팩 3년 거치) {fixed['36']}%")


def main():
    import argparse
    parser = argparse.ArgumentParser(description="한국증권금융 기업인수목적회사예수금 고시금리 스냅샷")
    parser.add_argument("--dry-run", action="store_true", help="받아서 출력만 하고 저장하지 않음")
    parser.add_argument("--show", action="store_true", help="네트워크 없이 저장된 최근 스냅샷 출력")
    args = parser.parse_args()

    snapshots = load_existing()

    if args.show:
        if not snapshots:
            print(f"{OUTPUT_PATH} 에 저장된 스냅샷이 없습니다.")
            return
        latest = max(snapshots)
        summarize(latest, snapshots[latest])
        print(f"(총 {len(snapshots)}일치)")
        return

    base_date = fetch_base_date()
    snap = {
        "fetchedAt": datetime.now(KST).isoformat(timespec="seconds"),
        "fixed":     fetch_rates(PRCD_FIXED),
        "demand":    next(iter(fetch_rates(PRCD_DEMAND).values())),
    }

    summarize(base_date, snap)

    if args.dry_run:
        print("--dry-run 이라 저장하지 않았습니다.")
        return

    before = snapshots.get(base_date)
    snapshots[base_date] = snap
    save(snapshots)

    if before is None:
        print(f"→ {base_date} 신규 저장 (총 {len(snapshots)}일치)")
    elif before.get("fixed") == snap["fixed"] and before.get("demand") == snap["demand"]:
        print(f"→ {base_date} 기존 값과 동일 (총 {len(snapshots)}일치)")
    else:
        print(f"→ {base_date} 갱신 (총 {len(snapshots)}일치)")


if __name__ == "__main__":
    main()
