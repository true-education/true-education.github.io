#!/usr/bin/env python3
"""
Firebase Realtime Database → 로컬 data/ JSON 파일 내보내기

출력:
  data/stocks.json  - SPAC 종목의 전일종가/거래정지/관리종목 정보
  data/refund.json  - spac/refund (합병 예정 종목 정산 예상가)

실행:
  python3 scripts/export_firebase.py
"""

import json
import urllib.request
from pathlib import Path

DB_URL  = "https://true-project-9bd97-default-rtdb.asia-southeast1.firebasedatabase.app"
REPO_DIR = Path(__file__).parent.parent
DATA_DIR = REPO_DIR / "data"


def fetch(path: str):
    url = f"{DB_URL}/{path}.json"
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read().decode())


def export_stocks():
    """stocks/kosdaq 중 spac=true인 종목만 추출 → data/stocks.json"""
    print("stocks/kosdaq 조회 중...")
    kosdaq = fetch("stocks/kosdaq")
    if not kosdaq:
        print("  [ERROR] 데이터 없음")
        return

    spac_stocks = {}
    for code, info in kosdaq.items():
        if not isinstance(info, dict):
            continue
        if not info.get("spac"):
            continue
        # 필요한 필드만
        prev_price_raw = info.get("prevPrice", "0")
        try:
            prev_price = int(str(prev_price_raw).lstrip("0") or "0")
        except ValueError:
            prev_price = 0

        spac_stocks[code] = {
            "code":       code,
            "nameKr":     info.get("nameKr", ""),
            "prevPrice":  prev_price,
            "halt":       bool(info.get("halt", False)),
            "designated": bool(info.get("designated", False)),
        }

    out_path = DATA_DIR / "stocks.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(spac_stocks, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"  ✓ {len(spac_stocks)}개 SPAC 종목 → {out_path}")


def export_refund():
    """spac/refund → data/refund.json"""
    print("spac/refund 조회 중...")
    refund = fetch("spac/refund")
    if not refund:
        print("  [ERROR] 데이터 없음")
        return

    # 배열이면 그대로, dict이면 values로
    if isinstance(refund, dict):
        items = list(refund.values())
    else:
        items = refund

    # code 기준 dict으로 변환
    out = {}
    for item in items:
        if isinstance(item, dict) and "code" in item:
            out[item["code"]] = {
                "code":         item["code"],
                "nameKr":       item.get("nameKr", ""),
                "refundAmount": item.get("refundAmount", 0),
                "date":         item.get("date", ""),
                "fixed":        item.get("fixed", False),
            }

    out_path = DATA_DIR / "refund.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"  ✓ {len(out)}개 항목 → {out_path}")


def main():
    DATA_DIR.mkdir(exist_ok=True)
    export_stocks()
    export_refund()
    print("\n완료. git add data/stocks.json data/refund.json 후 커밋하세요.")


if __name__ == "__main__":
    main()
