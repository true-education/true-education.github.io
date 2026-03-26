#!/usr/bin/env python3
"""
DART 전자공시 기반 spac 데이터 자동 업데이트 스크립트

감지 대상:
- 기업인수목적회사의 예치·신탁계약 내용 변경 (금리 변경)
- 합병 결의 (MERGE_REVIEW)
- 합병 승인 (MERGE_APPROVED)
"""

import os
import re
import json
import zipfile
import tempfile
import subprocess
from datetime import datetime, date, timedelta
from pathlib import Path

import urllib.request
import urllib.parse

# ── 설정 ──────────────────────────────────────────────────────────────────────
DART_API_KEY = "cebe93589e687856da2d84703fbad8ac87f0a98f"
DART_BASE    = "https://opendart.fss.or.kr/api"
REPO_DIR     = Path(__file__).parent.parent  # ~/build/true-data
V1_PATH      = REPO_DIR / "data" / "v1.txt"
MERGE_PATH   = REPO_DIR / "data" / "merge.txt"
DART_PATH    = REPO_DIR / "data" / "dart.txt"
STATE_PATH   = REPO_DIR / "scripts" / ".last_processed.json"

# 공시 보고서명 키워드
INTEREST_KEYWORDS = ["예치·신탁계약", "예치ㆍ신탁계약", "예치.신탁계약", "예치ㆍ신탁"]
MERGE_REVIEW_KEYWORDS = [
    "합병결의", "합병 결의",
    "주요사항보고서(회사합병결정)", "주요사항보고서(회사합병 결정)",
    "주요사항보고서(합병결정)", "주요사항보고서(합병 결정)",
    "회사합병결정", "회사합병 결정",
]
MERGE_APPROVED_KEYWORDS = [
    "합병승인", "합병 승인",
    "주주총회결과(합병승인)", "주주총회결과(합병 승인)",
    "주주총회결의(합병승인)", "주주총회결의(합병 승인)",
    "주권매매거래정지해제",   # 상장예비심사 승인 시 발생
]

# 합병 취소 → NORMAL 복귀
MERGE_CANCEL_KEYWORDS = [
    "합병취소", "합병 취소",
    "기업인수목적회사관련합병취소",
    "합병계약해제", "합병 계약 해제",
]


# ── DART API 호출 ──────────────────────────────────────────────────────────────
def dart_get(endpoint, params):
    params["crtfc_key"] = DART_API_KEY
    url = f"{DART_BASE}/{endpoint}?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=10) as r:
        return json.loads(r.read().decode("utf-8"))


def dart_download_doc(rcept_no):
    """공시 원문 XML 다운로드 후 텍스트 반환"""
    url = f"{DART_BASE}/document.xml?crtfc_key={DART_API_KEY}&rcept_no={rcept_no}"
    with tempfile.TemporaryDirectory() as tmpdir:
        zip_path = os.path.join(tmpdir, "doc.zip")
        urllib.request.urlretrieve(url, zip_path)
        with zipfile.ZipFile(zip_path) as zf:
            for name in zf.namelist():
                if name.endswith(".xml"):
                    with zf.open(name) as f:
                        content = f.read().decode("utf-8", errors="ignore")
                        # HTML 태그 제거
                        return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', content)).strip()
    return ""


# ── v1.txt 파싱/저장 ───────────────────────────────────────────────────────────
def load_v1():
    """v1.txt → list of dict"""
    rows = []
    with open(V1_PATH, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            parts = line.split("\t")
            if len(parts) != 8:
                continue
            rows.append({
                "listing_date": parts[0],
                "code":         parts[1],
                "name":         parts[2],
                "rate1":        parts[3],
                "rate2":        parts[4],
                "rate3":        parts[5],
                "expire_date":  parts[6],
                "status":       parts[7],
            })
    return rows


def save_v1(rows):
    with open(V1_PATH, "w", encoding="utf-8") as f:
        for r in rows:
            f.write("\t".join([
                r["listing_date"], r["code"], r["name"],
                r["rate1"], r["rate2"], r["rate3"],
                r["expire_date"], r["status"]
            ]) + "\n")


# ── 년차 계산 ─────────────────────────────────────────────────────────────────
def get_year_index(listing_date_str, change_date_str):
    """
    상장일과 변경일을 기준으로 1/2/3년차 반환 (1, 2, 3)
    1년차: 0~12개월, 2년차: 12~24개월, 3년차: 24~36개월
    """
    listing = datetime.strptime(listing_date_str, "%Y-%m-%d").date()
    change  = datetime.strptime(change_date_str, "%Y-%m-%d").date()
    months  = (change.year - listing.year) * 12 + (change.month - listing.month)
    if months < 12:
        return 1
    elif months < 24:
        return 2
    else:
        return 3


# ── 금리 변경 처리 ─────────────────────────────────────────────────────────────
def process_interest_change(rcept_no, corp_name, rcept_dt):
    """예치이율 변경 공시 처리"""
    text = dart_download_doc(rcept_no)
    if not text:
        print(f"  [SKIP] 문서 파싱 실패: {rcept_no}")
        return False

    # 변경 후 금리 파싱 (예: 변경 후: 2.55%, 변경후 : 2.55%)
    match = re.search(r'변경\s*후[^\d]*?([\d.]+)\s*%', text)
    if not match:
        print(f"  [SKIP] 변경 후 금리 파싱 실패: {text[:200]}")
        return False

    new_rate = float(match.group(1)) / 100

    # 변경 일자 파싱 (공시 내 명시된 날짜 우선, 없으면 rcept_dt 사용)
    date_match = re.search(r'변경\s*일\s*자[^\d]*(\d{4}[-\.\s]\d{2}[-\.\s]\d{2})', text)
    if date_match:
        change_date = re.sub(r'[.\s]', '-', date_match.group(1))
    else:
        change_date = f"{rcept_dt[:4]}-{rcept_dt[4:6]}-{rcept_dt[6:8]}"

    print(f"  → 금리 변경: {corp_name}, 변경일: {change_date}, 새 금리: {new_rate:.4f}")

    rows = load_v1()
    updated = False
    for row in rows:
        if corp_name in row["name"] or row["name"] in corp_name:
            year_idx = get_year_index(row["listing_date"], change_date)
            rate_key = f"rate{year_idx}"
            old_rate = row[rate_key]
            row[rate_key] = f"{new_rate:.4f}"
            print(f"  ✓ {row['name']} ({row['code']}) {year_idx}년차: {old_rate} → {row[rate_key]}")
            updated = True
            break

    if updated:
        save_v1(rows)
    else:
        print(f"  [SKIP] v1.txt에서 종목 찾지 못함: {corp_name}")

    return updated


# ── 합병 상태 처리 ─────────────────────────────────────────────────────────────
def process_merge_status(corp_code, corp_name, new_status):
    """합병 결의/승인 상태 업데이트. MERGE_APPROVED이면 merge.txt도 업데이트 시도"""
    rows = load_v1()
    updated = False
    target_row = None
    for row in rows:
        if corp_name in row["name"] or row["name"] in corp_name:
            old = row["status"]
            if old != new_status:
                row["status"] = new_status
                print(f"  ✓ {row['name']} ({row['code']}) 상태: {old} → {new_status}")
                updated = True
                target_row = row
            break

    if updated:
        save_v1(rows)

    # MERGE_APPROVED이면 merge.txt 업데이트
    if new_status == "MERGE_APPROVED" and target_row:
        update_merge_txt(corp_code, target_row)

    return updated


def update_merge_txt(corp_code, v1_row):
    """합병 일정 공시에서 날짜 파싱해 merge.txt 업데이트"""
    print(f"  → merge.txt 업데이트 시도: {v1_row['name']}")

    # 최근 1년 이내 합병결정 공시 찾기
    bgn = (date.today() - timedelta(days=365)).strftime("%Y%m%d")
    end = date.today().strftime("%Y%m%d")
    try:
        result = dart_get("list.json", {
            "corp_code": corp_code,
            "bgn_de": bgn,
            "end_de": end,
            "page_count": 50,
        })
    except Exception as e:
        print(f"  [ERROR] 공시 목록 조회 실패: {e}")
        return

    merge_rcept_no = None
    for item in result.get("list", []):
        nm = item.get("report_nm", "")
        if any(kw in nm for kw in MERGE_REVIEW_KEYWORDS):
            # 가장 최근 것 사용 (기재정정 포함)
            merge_rcept_no = item["rcept_no"]
            break  # list는 최신순이므로 첫 번째가 최신

    if not merge_rcept_no:
        print(f"  [SKIP] 합병결정 공시를 찾지 못함")
        return

    text = dart_download_doc(merge_rcept_no)
    if not text:
        return

    # 기재정정이 있는 경우 '정정 후' 이후 텍스트를 기준으로 파싱
    after_correction = text
    if '정정 후' in text:
        idx = text.rfind('정정 후')  # 마지막 '정정 후' 기준
        after_correction = text[idx:]

    def parse_date_str(s):
        """'2026년 03월 09일' or '2026-03-09' or '2026.03.09' → 'YYYYMMDD'"""
        s = re.sub(r'년\s*', '-', s)
        s = re.sub(r'월\s*', '-', s)
        s = re.sub(r'일', '', s)
        s = re.sub(r'[.\s]', '-', s.strip())
        s = re.sub(r'-+', '-', s).strip('-')
        parts = s.split('-')
        if len(parts) == 3:
            return ''.join(p.zfill(2) for p in parts)
        return ''

    def find_schedule_date(keyword, text):
        """키워드 근처의 날짜 1개 파싱"""
        pattern = rf'{keyword}[^0-9]*((?:\d{{4}}년\s*)?\d{{1,2}}월\s*\d{{1,2}}일|\d{{4}}[-\.]\d{{2}}[-\.]\d{{2}})'
        m = re.search(pattern, text)
        if m:
            return parse_date_str(m.group(1))
        return ''

    def find_schedule_range(keyword, text):
        """키워드 근처의 시작일/종료일 파싱"""
        # '시작일 2026년 03월 09일 종료일 2026년 03월 23일' 패턴
        d = r'(?:\d{4}년\s*)?\d{1,2}월\s*\d{1,2}일|\d{4}[-\.]\d{2}[-\.]\d{2}'
        pattern = rf'{keyword}.*?시작일\s*({d}).*?종료일\s*({d})'
        m = re.search(pattern, text, re.DOTALL)
        if m:
            return parse_date_str(m.group(1)), parse_date_str(m.group(2))
        return '', ''

    # 각 일정 파싱 (정정 후 기준)
    dissent_start, dissent_end   = find_schedule_range(r'합병반대의사통지\s*접수기간', after_correction)
    appraisal_start, appraisal_end = find_schedule_range(r'주식매수청구권\s*행사기간', after_correction)
    halt_start, halt_end         = find_schedule_range(r'매매거래\s*정지예정기간', after_correction)
    listing_date                 = find_schedule_date(r'신주의?\s*상장\s*예정일', after_correction)

    # disclosure URL
    disclosure_url = f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={merge_rcept_no}"

    # 기존 merge.txt 로드
    with open(MERGE_PATH, encoding="utf-8") as f:
        try:
            entries = json.load(f)
        except:
            entries = []

    # 해당 종목 찾기
    code = v1_row["code"]
    name = v1_row["name"]
    existing = next((e for e in entries if e.get("code") == code), None)

    def pick(new_val, old_entry, field):
        return new_val if new_val else (old_entry.get(field, "") if old_entry else "")

    # 합병 대상사 파싱 (공시 본문에서)
    target_match = re.search(r'합병상대회사\s+회사명\s+([^\s]+(?:\s+[^\s]+)*?)\s+주요사업', text)
    if not target_match:
        target_match = re.search(r'(?:피합병법인|합병대상회사|합병상대방)\s+([가-힣a-zA-Z0-9]+(?:주식회사|㈜)?)', text)
    target_name = target_match.group(1).replace('주식회사', '').replace('㈜', '').strip() if target_match else (existing.get("target", "") if existing else "")

    new_entry = {
        "nameKr": name,
        "code": code,
        "target": target_name,
        "dissentNoticeStartDate":  pick(dissent_start,   existing, "dissentNoticeStartDate"),
        "dissentNoticeEndDate":    pick(dissent_end,     existing, "dissentNoticeEndDate"),
        "appraisalRightStartDate": pick(appraisal_start, existing, "appraisalRightStartDate"),
        "appraisalRightEndDate":   pick(appraisal_end,   existing, "appraisalRightEndDate"),
        "tradingHaltStartDate":    pick(halt_start,      existing, "tradingHaltStartDate"),
        "tradingHaltEndDate":      pick(halt_end,        existing, "tradingHaltEndDate"),
        "newShareListingDate":     pick(listing_date,    existing, "newShareListingDate"),
        "disclosureUrl": disclosure_url,
    }

    if existing:
        entries = [new_entry if e.get("code") == code else e for e in entries]
        print(f"  ✓ merge.txt 업데이트: {name}")
    else:
        entries.append(new_entry)
        print(f"  ✓ merge.txt 추가: {name}")

    with open(MERGE_PATH, "w", encoding="utf-8") as f:
        json.dump(entries, f, ensure_ascii=False, indent=2)
        f.write("\n")


# ── 공시 목록 조회 ─────────────────────────────────────────────────────────────
def load_dart_codes():
    """dart.txt → {corp_code: (name, stock_code)} 매핑"""
    mapping = {}
    with open(DART_PATH, encoding="utf-8") as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) >= 3:
                mapping[parts[0]] = {"name": parts[1], "stock_code": parts[2]}
    return mapping


def get_recent_spac_disclosures(bgn_de, end_de):
    """
    dart.txt의 각 종목 corp_code로 직접 공시 조회
    bgn_de, end_de: 'YYYYMMDD'
    """
    dart_codes = load_dart_codes()
    items = []

    for corp_code, info in dart_codes.items():
        try:
            result = dart_get("list.json", {
                "corp_code": corp_code,
                "bgn_de": bgn_de,
                "end_de": end_de,
                "page_count": 10,
            })
            for item in result.get("list", []):
                report_nm = item.get("report_nm", "")
                if any(kw in report_nm for kw in
                       INTEREST_KEYWORDS + MERGE_REVIEW_KEYWORDS + MERGE_APPROVED_KEYWORDS + MERGE_CANCEL_KEYWORDS):
                    items.append(item)
        except Exception as e:
            print(f"  [WARN] {info['name']} 조회 실패: {e}")

    return items


# ── 상태 관리 ─────────────────────────────────────────────────────────────────
def load_state():
    if STATE_PATH.exists():
        with open(STATE_PATH) as f:
            return json.load(f)
    return {"last_rcept_no": [], "last_run": ""}


def save_state(state):
    with open(STATE_PATH, "w") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


# ── Git 커밋/푸시 ─────────────────────────────────────────────────────────────
def git_commit_push(message):
    os.chdir(REPO_DIR)
    subprocess.run(["git", "add", "data/v1.txt", "data/merge.txt"], check=True)
    result = subprocess.run(["git", "diff", "--cached", "--quiet"])
    if result.returncode == 0:
        print("  변경사항 없음, 커밋 스킵")
        return
    subprocess.run(["git", "commit", "-m", message], check=True)
    subprocess.run(["git", "push", "origin", "main"], check=True)
    print(f"  ✓ 커밋/푸시 완료: {message}")


# ── 메인 ──────────────────────────────────────────────────────────────────────
def main():
    today = date.today()
    bgn_de = (today - timedelta(days=3)).strftime("%Y%m%d")
    end_de = today.strftime("%Y%m%d")

    print(f"[{today}] DART 공시 조회: {bgn_de} ~ {end_de}")

    state = load_state()
    processed = set(state.get("last_rcept_no", []))

    disclosures = get_recent_spac_disclosures(bgn_de, end_de)
    print(f"  스팩 관련 공시 {len(disclosures)}건 발견")

    new_processed = []
    changed = False

    for item in disclosures:
        rcept_no   = item.get("rcept_no", "")
        corp_name  = item.get("corp_name", "")
        report_nm  = item.get("report_nm", "")
        rcept_dt   = item.get("rcept_dt", "")

        if rcept_no in processed:
            continue

        print(f"\n공시: [{rcept_no}] {corp_name} - {report_nm}")

        # 예치 금리 변경
        if any(kw in report_nm for kw in INTEREST_KEYWORDS):
            if process_interest_change(rcept_no, corp_name, rcept_dt):
                changed = True

        # 합병 결의
        elif any(kw in report_nm for kw in MERGE_REVIEW_KEYWORDS):
            corp_code = item.get("corp_code", "")
            if process_merge_status(corp_code, corp_name, "MERGE_REVIEW"):
                changed = True

        # 합병 승인
        elif any(kw in report_nm for kw in MERGE_APPROVED_KEYWORDS):
            corp_code = item.get("corp_code", "")
            if process_merge_status(corp_code, corp_name, "MERGE_APPROVED"):
                changed = True

        # 합병 취소 → NORMAL 복귀
        elif any(kw in report_nm for kw in MERGE_CANCEL_KEYWORDS):
            corp_code = item.get("corp_code", "")
            if process_merge_status(corp_code, corp_name, "NORMAL"):
                changed = True

        new_processed.append(rcept_no)

    if changed:
        git_commit_push(f"[auto] DART 공시 반영 ({today})")

    state["last_rcept_no"] = list(processed) + new_processed
    state["last_run"] = str(today)
    save_state(state)
    print("\n완료")


if __name__ == "__main__":
    main()
