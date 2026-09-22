#!/usr/bin/env python3
"""
예치이율 공시 전 종목의 v1.txt 이율을 한국증권금융 고시금리로 재동기화

스팩은 공모자금을 12개월 약정으로 걸고 해마다 재예치한다. 그래서 예치이율
변경 공시가 1년에 한 번씩 나오고, v1.txt 에 1~3년차 칸이 따로 있다.
공시가 아직 없는 종목은 세 칸이 전부 추정치일 수밖에 없는데, 그 추정치를
data/ksfc_rate.json 최신 스냅샷의 12개월 약정 이율로 맞춘다.

대상은 아래 둘을 모두 만족하는 종목이다.
  - 상장 1년 미만
  - DART 에 예치·신탁계약 관련 공시가 상장 이후 한 건도 없음

두 번째 조건을 매번 DART 로 확인하는 게 핵심이다. 상장 1년이 다가오면
첫 변경 공시가 나오는데, 그걸 놓치고 덮어쓰면 update_spac.py 가 반영해 둔
실제 이율이 추정치로 되돌아간다. 상장일만 보고 거르면 그 사고가 난다.

실행:
    python3 scripts/sync_spac_rate.py              # 동기화 + 커밋/푸시
    python3 scripts/sync_spac_rate.py --no-git     # 파일만 수정
    python3 scripts/sync_spac_rate.py --dry-run    # 변경 내역만 출력
"""

import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from dart_key import load_dart_api_key
from fetch_ksfc_rate import TERM_MONTHS, rate_for_term
# git 동기화 규칙(ff-only, 미푸시 커밋 처리)은 update_spac.py 것을 그대로 쓴다.
from update_spac import INTEREST_KEYWORDS, git, git_sync, unpushed_count

DART_API_KEY = load_dart_api_key()
DART_BASE    = "https://opendart.fss.or.kr/api"

REPO_DIR   = Path(__file__).parent.parent
V1_PATH    = REPO_DIR / "data" / "v1.txt"
DART_PATH  = REPO_DIR / "data" / "dart.txt"
SNAP_PATH  = REPO_DIR / "data" / "ksfc_rate.json"

SLEEP_BETWEEN = 0.25
STALE_DAYS    = 7


def log(*args):
    print(*args, file=sys.stderr)


def years_ago(d, n=1):
    """n년 전 같은 날짜. 2월 29일은 28일로 내린다."""
    try:
        return d.replace(year=d.year - n)
    except ValueError:
        return d.replace(year=d.year - n, day=28)


def load_snapshot():
    """(기준일자, 12개월 약정 이율) 반환."""
    if not SNAP_PATH.exists():
        raise RuntimeError(f"{SNAP_PATH} 가 없습니다. fetch_ksfc_rate.py 를 먼저 실행하세요.")
    with open(SNAP_PATH, encoding="utf-8") as f:
        snapshots = json.load(f)
    if not snapshots:
        raise RuntimeError(f"{SNAP_PATH} 에 스냅샷이 없습니다.")

    base_date = max(snapshots)
    rate = rate_for_term(snapshots[base_date]["fixed"])

    age = (date.today() - datetime.strptime(base_date, "%Y-%m-%d").date()).days
    if age > STALE_DAYS:
        log(f"[WARN] 최신 스냅샷이 {age}일 전({base_date})입니다. "
            f"fetch_ksfc_rate.py 가 도는지 확인하세요.")
    return base_date, rate


def load_corp_codes():
    """단축코드 → DART corp_code"""
    codes = {}
    with open(DART_PATH, encoding="utf-8") as f:
        for line in f:
            parts = line.split()
            if len(parts) == 3:
                codes[parts[2]] = parts[0]
    return codes


def load_v1():
    """(원본 줄, 8필드 리스트 or None) 목록. 형식 이상한 줄도 보존한다."""
    rows = []
    with open(V1_PATH, encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            parts = line.split("\t")
            rows.append((line, parts if len(parts) == 8 else None))
    return rows


def has_interest_disclosure(corp_code, since):
    """상장 이후 예치·신탁계약 관련 공시가 있었는지."""
    params = {
        "crtfc_key": DART_API_KEY,
        "corp_code": corp_code,
        "bgn_de":    since.replace("-", ""),
        "end_de":    date.today().strftime("%Y%m%d"),
        "page_count": 100,
    }
    url = f"{DART_BASE}/list.json?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=20) as r:
        data = json.loads(r.read().decode("utf-8"))

    # 013 = 조회된 데이터 없음. 그 외 오류는 '공시 없음' 으로 뭉개면 안 된다.
    status = data.get("status")
    if status == "013":
        return False
    if status != "000":
        raise RuntimeError(f"corp_code={corp_code} 공시 조회 실패: {status} {data.get('message')}")

    return any(any(w in it["report_nm"] for w in INTEREST_KEYWORDS)
               for it in data.get("list", []))


def commit_push(message):
    git("add", "data/v1.txt", "data/ksfc_rate.json")
    staged = git("diff", "--cached", "--quiet").returncode != 0
    if staged:
        r = git("commit", "-m", message)
        if r.returncode != 0:
            return "error", f"커밋 실패: {r.stderr.strip()}"

    pending = unpushed_count()
    if not pending:
        return ("nothing" if not staged else "ok"), "푸시할 커밋 없음"

    r = git("push", "origin", "main")
    if r.returncode != 0:
        return "error", f"미푸시 커밋 {pending}건 — 푸시 실패: {r.stderr.strip()}"
    return "ok", f"커밋 {pending}건 푸시 완료"


def main():
    import argparse
    parser = argparse.ArgumentParser(description="공시 전 종목 예치이율 재동기화")
    parser.add_argument("--dry-run", action="store_true", help="변경 내역만 출력, 저장/커밋 안 함")
    parser.add_argument("--no-git", action="store_true", help="파일만 수정하고 커밋/푸시 안 함")
    args = parser.parse_args()

    if not (args.dry_run or args.no_git):
        state, detail = git_sync()
        if state != "ok":
            print(f"git 동기화 중단: {detail}")
            sys.exit(1)

    base_date, rate_pct = load_snapshot()
    rate = f"{rate_pct / 100:.4f}"
    log(f"기준 {base_date} / {TERM_MONTHS}개월 약정 {rate_pct}% → {rate}")

    corp_codes = load_corp_codes()
    rows = load_v1()
    cutoff = years_ago(date.today())

    changed, skipped, problems = [], [], []

    for i, (line, parts) in enumerate(rows):
        if parts is None:
            continue
        listed = datetime.strptime(parts[0], "%Y-%m-%d").date()
        if listed <= cutoff:
            continue

        code, name = parts[1], parts[2]
        corp_code = corp_codes.get(code)
        if not corp_code:
            problems.append(f"{name}({code}): dart.txt 에 corp_code 없음")
            continue

        try:
            disclosed = has_interest_disclosure(corp_code, parts[0])
        except Exception as e:
            problems.append(f"{name}({code}): 공시 조회 실패 — {e}")
            continue
        time.sleep(SLEEP_BETWEEN)

        if disclosed:
            skipped.append(f"{name}({code})")
            continue

        before = (parts[3], parts[4], parts[5])
        if before == (rate, rate, rate):
            continue
        parts[3] = parts[4] = parts[5] = rate
        rows[i] = ("\t".join(parts), parts)
        changed.append((parts[0], code, name, before))

    for listed, code, name, before in changed:
        print(f"{listed} {code} {name} {'/'.join(before)} → {rate}")
    if skipped:
        print(f"공시 있어 제외: {', '.join(skipped)}")
    for p in problems:
        print(f"[WARN] {p}")

    if not changed:
        print(f"변경할 종목 없음 (기준 {base_date}, {rate_pct}%)")
        return 1 if problems else 0

    if args.dry_run:
        print(f"{len(changed)}건 — --dry-run 이라 저장하지 않았습니다.")
        return 1 if problems else 0

    with open(V1_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(line for line, _ in rows) + "\n")
    print(f"{len(changed)}건 변경 저장")

    if args.no_git:
        return 1 if problems else 0

    state, detail = commit_push(
        f"[auto] 공시 전 {len(changed)}종목 예치이율 {rate_pct}% 반영 ({base_date})")
    print(f"git: {detail}")
    return 1 if (problems or state == "error") else 0


if __name__ == "__main__":
    sys.exit(main())
