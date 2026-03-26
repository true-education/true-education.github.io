#!/usr/bin/env python3
"""
SPAC 발기인 정보 수집 스크립트

각 SPAC의 증권신고서(IPO 시점)에서 발기인(공모 전 주주) 정보를 파싱해
data/founders.json으로 저장합니다.

파싱 우선순위:
  1. 증권신고서(지분증권) - 공모 전 주주현황 테이블
  2. 투자설명서 - 동일 테이블
  3. 사업보고서 - 최대주주 섹션 (폴백)

실행:
    python3 scripts/fetch_founders.py [--force] [--code 457630]

출력 형식 (data/founders.json):
[
  {
    "code": "457630",
    "nameKr": "대신밸런스제16호스팩",
    "founders": [
      { "name": "(주)키베스트", "shares": 800000, "pct": 88.89, "note": "발기인, 최대주주" },
      { "name": "대신증권(주)", "shares": 10000, "pct": 1.11, "note": "발기인, 투자매매업자" }
    ]
  },
  ...
]
"""

import os
import re
import json
import zipfile
import tempfile
import time
from pathlib import Path
import urllib.request
import urllib.parse

# ── 설정 ──────────────────────────────────────────────────────────────────────
DART_API_KEY = "cebe93589e687856da2d84703fbad8ac87f0a98f"
DART_BASE    = "https://opendart.fss.or.kr/api"
REPO_DIR     = Path(__file__).parent.parent
DART_PATH    = REPO_DIR / "data" / "dart.txt"
OUTPUT_PATH  = REPO_DIR / "data" / "founders.json"

SLEEP_BETWEEN = 0.5


# ── DART API ──────────────────────────────────────────────────────────────────
def dart_get(endpoint, params):
    params["crtfc_key"] = DART_API_KEY
    url = f"{DART_BASE}/{endpoint}?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=15) as r:
        return json.loads(r.read().decode("utf-8"))


def dart_download_xml_text(rcept_no):
    """공시 원문 zip 다운로드 → (메인XML 텍스트, 전체텍스트) 반환"""
    url = f"{DART_BASE}/document.xml?crtfc_key={DART_API_KEY}&rcept_no={rcept_no}"
    with tempfile.TemporaryDirectory() as tmpdir:
        zip_path = os.path.join(tmpdir, "doc.zip")
        urllib.request.urlretrieve(url, zip_path)
        with zipfile.ZipFile(zip_path) as zf:
            # 메인 XML 우선 (rcept_no.xml)
            main_name = f"{rcept_no}.xml"
            names_to_try = [main_name] + [n for n in zf.namelist() if n.endswith(".xml") and n != main_name]
            for name in names_to_try:
                if name in zf.namelist():
                    with zf.open(name) as f:
                        raw = f.read().decode("utf-8", errors="ignore")
                        text = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', raw)).strip()
                        return text
    return ""


# ── 공시 목록 조회 ─────────────────────────────────────────────────────────────
def get_ipo_report_rcept_no(corp_code):
    """
    증권신고서(지분증권) 또는 투자설명서 rcept_no 반환.
    최초 공모시 작성된 문서이므로 가장 오래된 것을 우선.
    없으면 (None, None) 반환.
    """
    try:
        # 전체 공시 목록 (여러 페이지)
        all_items = []
        for page_no in range(1, 6):
            result = dart_get("list.json", {
                "corp_code": corp_code,
                "bgn_de": "20200101",
                "page_count": 40,
                "page_no": page_no,
            })
            items = result.get("list", [])
            if not items:
                break
            all_items.extend(items)
            # 더 이상 페이지 없으면 중단
            total = int(result.get("total_count") or 0)
            if len(all_items) >= total:
                break

        # 증권신고서(지분증권) 먼저, 그 다음 발행조건확정, 투자설명서
        ipo_items = []
        for item in all_items:
            nm = item.get("report_nm", "")
            if "증권신고서(지분증권)" in nm and "[" not in nm:
                ipo_items.insert(0, (item["rcept_no"], nm))
            elif "[발행조건확정]증권신고서" in nm:
                ipo_items.append((item["rcept_no"], nm))
            elif "투자설명서" in nm and "[기재정정]" not in nm:
                ipo_items.append((item["rcept_no"], nm))

        if ipo_items:
            # 가장 오래된 것 (list는 최신순이므로 마지막)
            return ipo_items[-1]
    except Exception as e:
        print(f"    [ERROR] IPO 공시 조회 실패: {e}")
    return None, None


def get_annual_report_rcept_no(corp_code):
    """사업보고서 rcept_no 반환 (폴백용)"""
    try:
        result = dart_get("list.json", {
            "corp_code": corp_code,
            "pblntf_ty": "A",
            "bgn_de": "20220101",
            "page_count": 20,
        })
        for item in result.get("list", []):
            if item.get("report_nm", "").startswith("사업보고서"):
                return item["rcept_no"], item["report_nm"]
    except Exception as e:
        print(f"    [ERROR] 사업보고서 조회 실패: {e}")
    return None, None


# ── 발기인 파싱 ───────────────────────────────────────────────────────────────
def parse_founders_from_ipo(text):
    """
    증권신고서/투자설명서 텍스트에서 공모 전 주주(발기인) 정보 파싱.

    두 가지 패턴 지원:
    A) 발기인 명시 타입:
       ㈜링크인베스트먼트 보통주 200,000 86.96 발기인, 최대주주
    B) 주주명 테이블 타입 (발기인 키워드 없음):
       ㈜메디치인베스트먼트 200,000 83.32% - - 200,000 10.00%
    """
    founders = []

    # 공모 전 주주현황 섹션 찾기
    section = ""
    section_start = -1
    for kw in ["공모 전 주주현황", "공모전 주주현황", "증권신고서 제출일 현재 주주현황",
               "주주현황은 다음과 같습니다", "공모 이전 주주현황"]:
        idx = text.find(kw)
        if idx != -1:
            section_start = idx
            section = text[idx:idx + 2000]
            break

    if not section:
        return founders

    # 합계 행 위치로 섹션 자르기
    end_idx = section.find(" 합계 ")
    if end_idx != -1:
        section = section[:end_idx + 50]

    # ── 패턴 B: 법인명 숫자 지분율% 구조 (보통주 키워드 없거나 헤더에만 있음) ──
    # 예: ㈜메디치인베스트먼트 200,000 83.32% - - 200,000 10.00%
    if "보통주" not in section or section.count("보통주") <= 2:
        NAME_B = r'(?:[㈜\(\)（）]?[가-힣a-zA-Z&·\.][가-힣a-zA-Z&·\.\(\)㈜]{1,28})'
        SKIP_B = {"주주명", "법인명", "성명", "합계", "소계", "주식수", "지분율", "비고",
                  "보통주", "우선주", "종류", "단위", "주식의", "합 계", "소 계", "전환가능주식수"}
        pat_b = re.compile(rf'({NAME_B})\s+([\d,]+)\s+([\d.]+)%?', re.UNICODE)
        seen_b: set = set()
        for m in pat_b.finditer(section):
            name = m.group(1).strip().replace("㈜", "(주)")
            if name in SKIP_B or len(name) < 2:
                continue
            shares_str = m.group(2).replace(",", "")
            pct_str    = m.group(3)
            try:
                shares = int(shares_str)
                pct    = float(pct_str)
            except ValueError:
                continue
            if shares < 1000 or pct <= 0 or shares > 50_000_000 or pct > 100:
                continue
            if name in seen_b:
                continue
            seen_b.add(name)
            founders.append({"name": name, "shares": shares, "pct": pct, "note": "발기인"})
        if founders:
            return founders

    # ── '보통주' 기준 분리 파싱 ──────────────────────────────────────────────
    # 텍스트 구조: "법인명 보통주 주식수 지분율% 비고 법인명 보통주 ..."
    # '보통주'로 split해서 앞은 법인명, 뒤는 숫자+비고
    SKIP_NAMES = {"주주명", "법인명", "성명", "합계", "소계", "주식수", "지분율", "비고",
                  "보통주", "우선주", "종류", "단위", "주식의", "합 계", "소 계"}

    parts = section.split("보통주")
    seen = set()

    for i in range(len(parts) - 1):
        before = parts[i].strip()
        after  = parts[i + 1].strip()

        # 법인명: before에서 마지막 단어 (또는 괄호포함 법인명)
        name_match = re.search(
            r'([㈜\(\)（）]?[가-힣a-zA-Z&·\.][가-힣a-zA-Z&·\.\(\)㈜]{1,30})$',
            before, re.UNICODE
        )
        if not name_match:
            continue
        name = name_match.group(1).strip().replace("㈜", "(주)")

        if name in SKIP_NAMES or len(name) < 2:
            continue

        # 숫자(주식수) + 숫자(지분율) 파싱
        num_match = re.match(r'\s*([\d,]+)\s+([\d.]+)%?\s*(.*)', after)
        if not num_match:
            continue
        shares_str = num_match.group(1).replace(",", "")
        pct_str    = num_match.group(2)
        rest       = num_match.group(3).strip()  # 비고 + 다음 법인명

        try:
            shares = int(shares_str)
            pct    = float(pct_str)
        except ValueError:
            continue

        if shares < 1000 or pct <= 0 or shares > 50_000_000 or pct > 100:
            continue
        if name in seen:
            continue
        seen.add(name)

        # 비고 정규화 (rest에서 다음 법인명 전까지)
        # 법인명 패턴으로 자르기
        note_cut = re.split(r'[㈜\(\)（）]?[가-힣]{2,}(?:증권|투자|자산|인베스트|벤처|파트너|홀딩|캐피탈)', rest)
        note_raw = note_cut[0].strip() if note_cut else rest.strip()
        note_raw = re.sub(r'[-\s]+$', '', note_raw).strip()

        if "투자매매업자" in note_raw:
            note = "투자매매업자"
        elif "최대주주" in note_raw and "투자매매업자" not in note_raw:
            note = "최대주주"
        elif "발기인" in note_raw:
            note = "발기인"
        else:
            note = "발기인"  # 비고 없어도 공모전 주주는 발기인

        founders.append({"name": name, "shares": shares, "pct": pct, "note": note})

    return founders


def parse_founders_from_annual(text):
    """
    사업보고서 텍스트에서 발기인 정보 파싱 (폴백).
    사업보고서에는 발기인 명시가 없어 최대주주만 추출.
    """
    founders = []

    idx = text.find("최대주주 및 특수관계인의 주식소유 현황")
    if idx == -1:
        idx = text.find("주주에 관한 사항")
    if idx == -1:
        return founders

    section = text[idx:idx + 800]

    # 최대주주 이름과 주식수 추출
    # 예: ㈜링크인베스트먼트 본인 보통주 200,000 4.73 200,000 4.73
    pattern = re.compile(
        r'\b([㈜\(\)（）가-힣a-zA-Z&·\.]{2,30})\s+본인\s+보통주\s+([\d,]+)',
        re.UNICODE
    )
    for m in pattern.finditer(section):
        name = m.group(1).strip().replace("㈜", "(주)")
        shares_str = m.group(2).replace(",", "")
        try:
            shares = int(shares_str)
        except ValueError:
            continue
        if shares < 1000:
            continue
        founders.append({
            "name": name,
            "shares": shares,
            "pct": None,
            "note": "최대주주",
        })
        break  # 최대주주 1명만

    return founders


# ── dart.txt 로드 ─────────────────────────────────────────────────────────────
def load_dart_codes():
    entries = []
    with open(DART_PATH, encoding="utf-8") as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) >= 3:
                entries.append((parts[0], parts[1], parts[2]))
    return entries


# ── 기존 결과 로드 ─────────────────────────────────────────────────────────────
def load_existing():
    if OUTPUT_PATH.exists():
        with open(OUTPUT_PATH, encoding="utf-8") as f:
            try:
                data = json.load(f)
                return {entry["code"]: entry for entry in data}
            except Exception:
                pass
    return {}


# ── 저장 ─────────────────────────────────────────────────────────────────────
def save_results(results):
    output = sorted(results.values(), key=lambda x: x["code"])
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"  → {len(output)}개 저장됨")


# ── 메인 ──────────────────────────────────────────────────────────────────────
def main():
    import argparse
    parser = argparse.ArgumentParser(description="SPAC 발기인 정보 수집")
    parser.add_argument("--force", action="store_true", help="기존 데이터 무시하고 전체 재수집")
    parser.add_argument("--code", help="특정 종목코드만 처리 (예: 457630)")
    args = parser.parse_args()

    entries = load_dart_codes()
    existing = {} if args.force else load_existing()

    if args.code:
        entries = [(cc, nm, sc) for cc, nm, sc in entries if sc == args.code]
        if not entries:
            print(f"종목코드 {args.code}를 dart.txt에서 찾지 못했습니다.")
            return

    print(f"총 {len(entries)}개 SPAC 처리 시작 (기존 {len(existing)}개 캐시됨)")

    results = dict(existing)
    new_count = 0
    fail_count = 0

    for i, (corp_code, name, stock_code) in enumerate(entries, 1):
        if stock_code in existing and not args.force:
            cached = existing[stock_code]
            n = len(cached.get("founders", []))
            status = f"{n}명" if n > 0 else "파싱실패(캐시)"
            print(f"[{i:3d}/{len(entries)}] {name} ({stock_code}) — 캐시({status})")
            continue

        print(f"[{i:3d}/{len(entries)}] {name} ({stock_code})")

        founders = []
        source = ""

        # 1차: 증권신고서/투자설명서
        rcept_no, report_nm = get_ipo_report_rcept_no(corp_code)
        time.sleep(SLEEP_BETWEEN)

        if rcept_no:
            print(f"  IPO 공시: {report_nm} ({rcept_no})")
            try:
                text = dart_download_xml_text(rcept_no)
                time.sleep(SLEEP_BETWEEN)
                founders = parse_founders_from_ipo(text)
                if founders:
                    source = "ipo"
            except Exception as e:
                print(f"  [ERROR] 다운로드 실패: {e}")
        else:
            print(f"  IPO 공시 없음")

        # 2차: 사업보고서 (폴백)
        if not founders:
            ar_rcept_no, ar_nm = get_annual_report_rcept_no(corp_code)
            time.sleep(SLEEP_BETWEEN)
            if ar_rcept_no:
                print(f"  폴백 → 사업보고서: {ar_nm} ({ar_rcept_no})")
                try:
                    text = dart_download_xml_text(ar_rcept_no)
                    time.sleep(SLEEP_BETWEEN)
                    founders = parse_founders_from_annual(text)
                    if founders:
                        source = "annual"
                except Exception as e:
                    print(f"  [ERROR] 다운로드 실패: {e}")

        if founders:
            print(f"  ✓ 발기인 {len(founders)}명 ({source}):")
            for f in founders:
                pct_str = f"{f['pct']:.2f}%" if f['pct'] is not None else "?"
                print(f"    · {f['name']}  {f['shares']:,}주  {pct_str}  {f['note']}")
        else:
            print(f"  [WARN] 발기인 파싱 실패")
            fail_count += 1

        results[stock_code] = {
            "code": stock_code,
            "nameKr": name,
            "founders": founders,
            "source": source,
        }
        new_count += 1

        if new_count % 10 == 0:
            save_results(results)

    save_results(results)
    print(f"\n완료: 신규/갱신 {new_count}개, 발기인 파싱 실패 {fail_count}개")


if __name__ == "__main__":
    main()
