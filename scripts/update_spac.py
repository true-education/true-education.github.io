#!/usr/bin/env python3
"""
DART 전자공시 기반 spac 데이터 자동 업데이트 스크립트

감지 대상:
- 기업인수목적회사의 예치·신탁계약 내용 변경 (금리 변경)
- 합병 결의 (MERGE_REVIEW)
- 합병 승인 (MERGE_APPROVED)
- 주요주주 변동 → founders.json 업데이트
"""

import os
import re
import sys
import json
import zipfile
import tempfile
import subprocess
from datetime import datetime, date, timedelta
from pathlib import Path

import urllib.request
import urllib.parse


def log(*args, **kwargs):
    """진행 로그는 stderr 로 보낸다.

    stdout 은 슬랙 레포트 전용이라, 아래처럼 파이프로 바로 넘길 수 있다.
        python3 update_spac.py | python3 slack_post.py <채널ID>
    """
    kwargs.setdefault("file", sys.stderr)
    print(*args, **kwargs)


# ── 설정 ──────────────────────────────────────────────────────────────────────
from dart_key import load_dart_api_key

DART_API_KEY   = load_dart_api_key()
DART_BASE      = "https://opendart.fss.or.kr/api"
REPO_DIR       = Path(__file__).parent.parent  # ~/build/true-data
V1_PATH        = REPO_DIR / "data" / "v1.txt"
MERGE_PATH     = REPO_DIR / "data" / "merge.txt"
DART_PATH      = REPO_DIR / "data" / "dart.txt"
FOUNDERS_PATH  = REPO_DIR / "data" / "founders.json"
STATE_PATH     = REPO_DIR / "scripts" / ".last_processed.json"

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

# 주요주주 변동 공시
MAJORSTOCK_KEYWORDS = [
    "주요주주특정증권등소유상황보고서",
    "임원ㆍ주요주주특정증권등소유상황보고서",
    "임원·주요주주특정증권등소유상황보고서",
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
    예치이율 변경 공시의 대상 년차 반환 (1, 2, 3)

    예치이율 변경 공시는 현재 진행 중인 년차가 끝나기 전에
    다음 년차에 적용될 금리를 미리 공시하는 방식으로 이루어진다.
    따라서 변경일 기준 현재 년차 + 1을 반환한다.

    예) 상장일 2024-05-07, 변경일 2026-04-29 → 경과 23개월(2년차 중)
        → 다음 3년차 금리를 변경하는 공시 → return 3

    단, 이미 3년차인 경우(경과 24개월 이상)는 3년차를 반환한다.

    경과 개월수는 일자까지 본다. 상장 2025-08-14 / 변경 2026-08-11 이면
    아직 1년이 안 찼으므로 12개월이 아니라 11개월로 센다.
    """
    listing = datetime.strptime(listing_date_str, "%Y-%m-%d").date()
    change  = datetime.strptime(change_date_str, "%Y-%m-%d").date()
    months  = (change.year - listing.year) * 12 + (change.month - listing.month)
    if change.day < listing.day:
        months -= 1
    if months < 12:
        # 1년차 중 공시 → 2년차 금리 변경
        return 2
    elif months < 24:
        # 2년차 중 공시 → 3년차 금리 변경
        return 3
    else:
        # 3년차 중 공시 → 3년차 금리 변경 (마지막)
        return 3


# ── 금리 변경 처리 ─────────────────────────────────────────────────────────────
def process_interest_change(rcept_no, corp_name, rcept_dt, issues):
    """예치이율 변경 공시 처리. 반영했으면 변경 내역 dict, 아니면 None."""
    text = dart_download_doc(rcept_no)
    if not text:
        log(f"  [SKIP] 문서 파싱 실패: {rcept_no}")
        issues.append(f"{corp_name}: 공시 원문을 읽지 못함")
        return None

    # 변경 후 금리 파싱 (예: 변경 후: 2.55%, 변경후 : 2.55%)
    match = re.search(r'변경\s*후[^\d]*?([\d.]+)\s*%', text)
    if not match:
        log(f"  [SKIP] 변경 후 금리 파싱 실패: {text[:200]}")
        issues.append(f"{corp_name}: 변경 후 금리를 파싱하지 못함")
        return None

    new_rate = float(match.group(1)) / 100

    # 변경 일자 파싱 (공시 내 명시된 날짜 우선, 없으면 rcept_dt 사용)
    date_match = re.search(r'변경\s*일\s*자[^\d]*(\d{4}[-\.\s]\d{2}[-\.\s]\d{2})', text)
    if date_match:
        change_date = re.sub(r'[.\s]', '-', date_match.group(1))
    else:
        change_date = f"{rcept_dt[:4]}-{rcept_dt[4:6]}-{rcept_dt[6:8]}"

    log(f"  → 금리 변경: {corp_name}, 변경일: {change_date}, 새 금리: {new_rate:.4f}")

    rows = load_v1()
    change = None
    for row in rows:
        if corp_name in row["name"] or row["name"] in corp_name:
            year_idx = get_year_index(row["listing_date"], change_date)
            rate_key = f"rate{year_idx}"
            old_rate = row[rate_key]
            row[rate_key] = f"{new_rate:.4f}"
            log(f"  ✓ {row['name']} ({row['code']}) {year_idx}년차: {old_rate} → {row[rate_key]}")
            change = {
                "name": row["name"], "code": row["code"],
                "year": year_idx, "old": old_rate, "new": row[rate_key],
            }
            break

    if change:
        save_v1(rows)
    else:
        log(f"  [SKIP] v1.txt에서 종목 찾지 못함: {corp_name}")
        issues.append(f"{corp_name}: v1.txt 에서 종목을 찾지 못함")

    return change


# ── 합병 상태 처리 ─────────────────────────────────────────────────────────────
def process_merge_status(corp_code, corp_name, new_status, issues):
    """합병 결의/승인 상태 업데이트. 반영했으면 변경 내역 dict, 아니면 None.

    MERGE_APPROVED 이면 merge.txt 도 갱신하고 파싱된 일정을 함께 담는다.
    """
    rows = load_v1()
    change = None
    target_row = None
    for row in rows:
        if corp_name in row["name"] or row["name"] in corp_name:
            old = row["status"]
            if old != new_status:
                row["status"] = new_status
                log(f"  ✓ {row['name']} ({row['code']}) 상태: {old} → {new_status}")
                change = {
                    "name": row["name"], "code": row["code"],
                    "old": old, "new": new_status, "schedule": None,
                }
                target_row = row
            break

    if change:
        save_v1(rows)
    else:
        log(f"  [SKIP] 상태 변경 없음: {corp_name}")

    # MERGE_APPROVED이면 merge.txt 업데이트
    if new_status == "MERGE_APPROVED" and target_row:
        schedule = update_merge_txt(corp_code, target_row, issues)
        if change:
            change["schedule"] = schedule

    return change


def update_merge_txt(corp_code, v1_row, issues):
    """합병 일정 공시에서 날짜 파싱해 merge.txt 업데이트. 파싱된 일정 dict 또는 None."""
    log(f"  → merge.txt 업데이트 시도: {v1_row['name']}")

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
        log(f"  [ERROR] 공시 목록 조회 실패: {e}")
        issues.append(f"{v1_row['name']}: 합병 일정 조회 실패 ({e})")
        return None

    merge_rcept_no = None
    for item in result.get("list", []):
        nm = item.get("report_nm", "")
        if any(kw in nm for kw in MERGE_REVIEW_KEYWORDS):
            # 가장 최근 것 사용 (기재정정 포함)
            merge_rcept_no = item["rcept_no"]
            break  # list는 최신순이므로 첫 번째가 최신

    if not merge_rcept_no:
        log(f"  [SKIP] 합병결정 공시를 찾지 못함")
        issues.append(f"{v1_row['name']}: 합병결정 공시를 찾지 못해 일정 미반영")
        return None

    text = dart_download_doc(merge_rcept_no)
    if not text:
        issues.append(f"{v1_row['name']}: 합병결정 공시 원문을 읽지 못함")
        return None

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
        log(f"  ✓ merge.txt 업데이트: {name}")
    else:
        entries.append(new_entry)
        log(f"  ✓ merge.txt 추가: {name}")

    with open(MERGE_PATH, "w", encoding="utf-8") as f:
        json.dump(entries, f, ensure_ascii=False, indent=2)
        f.write("\n")

    return {
        "target": target_name,
        "halt_start": new_entry["tradingHaltStartDate"],
        "halt_end": new_entry["tradingHaltEndDate"],
        "listing": new_entry["newShareListingDate"],
        "appraisal_start": new_entry["appraisalRightStartDate"],
        "appraisal_end": new_entry["appraisalRightEndDate"],
    }


# ── founders.json 파싱/저장 ───────────────────────────────────────────────────
def load_founders():
    """founders.json → list of dict"""
    if not FOUNDERS_PATH.exists():
        return []
    with open(FOUNDERS_PATH, encoding="utf-8") as f:
        return json.load(f)


def save_founders(data):
    with open(FOUNDERS_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ── 주요주주 변동 처리 ─────────────────────────────────────────────────────────
def process_majorstock_change(corp_code, corp_name, stock_code, issues):
    """
    주요주주특정증권등소유상황보고서 감지 시 DART majorstock API로
    최신 주요주주 현황을 조회해 founders.json을 갱신한다.
    반영했으면 변경 내역 dict, 아니면 None.

    DART majorstock API (list.json):
      corp_code  : DART 고유번호
    반환 필드 예시:
      rcept_no, corp_code, corp_name, stock_code,
      repror_nm(보고자), stkqy(보유주식수), stkqy_irds(증감),
      report_resn(보고사유)
    """
    log(f"  → 주요주주 변동 감지: {corp_name} ({stock_code})")

    try:
        result = dart_get("majorstock.json", {"corp_code": corp_code})
    except Exception as e:
        log(f"  [ERROR] majorstock 조회 실패: {e}")
        issues.append(f"{corp_name}: 주요주주 조회 실패 ({e})")
        return None

    if result.get("status") != "000":
        log(f"  [SKIP] majorstock API 오류: {result.get('message')}")
        issues.append(f"{corp_name}: 주요주주 API 오류 ({result.get('message')})")
        return None

    items = result.get("list", [])
    if not items:
        log(f"  [SKIP] 주요주주 목록 없음")
        return None

    # 보고자별 최신 보유주식수 집계 (동일 보고자의 최신 보고 기준)
    latest: dict[str, dict] = {}
    for item in items:
        name = item.get("repror_nm", "").strip()
        if not name:
            continue
        # rcept_no는 접수번호로 숫자가 클수록 최신
        if name not in latest or item.get("rcept_no", "") > latest[name].get("rcept_no", ""):
            latest[name] = item

    # founders 엔트리 구성
    new_founders = []
    total_issued = None  # 발행주식 총수는 majorstock API에 없으므로 비율은 None 유지

    for name, item in latest.items():
        try:
            shares = int(str(item.get("stkqy", "0")).replace(",", ""))
        except ValueError:
            shares = 0
        if shares <= 0:
            continue

        # 보고사유로 note 추정
        resn = item.get("report_resn", "")
        if "최대주주" in resn:
            note = "최대주주"
        elif "임원" in resn:
            note = "임원"
        else:
            note = "주요주주"

        new_founders.append({
            "name": name,
            "shares": shares,
            "pct": None,   # 비율은 majorstock API에서 제공하지 않음
            "note": note,
        })

    if not new_founders:
        log(f"  [SKIP] 유효한 주주 데이터 없음")
        issues.append(f"{corp_name}: 유효한 주주 데이터가 없어 미반영")
        return None

    # founders.json 업데이트
    data = load_founders()
    existing_idx = next((i for i, e in enumerate(data) if e.get("code") == stock_code), None)

    entry = {
        "code": stock_code,
        "nameKr": corp_name,
        "founders": new_founders,
        "source": "majorstock",
    }

    if existing_idx is not None:
        old_founders = data[existing_idx].get("founders", [])
        data[existing_idx] = entry
        log(f"  ✓ founders.json 갱신: {corp_name} ({len(old_founders)}명 → {len(new_founders)}명)")
        change = {"name": corp_name, "code": stock_code,
                  "old_count": len(old_founders), "new_count": len(new_founders)}
    else:
        data.append(entry)
        log(f"  ✓ founders.json 신규 추가: {corp_name} ({len(new_founders)}명)")
        change = {"name": corp_name, "code": stock_code,
                  "old_count": None, "new_count": len(new_founders)}

    save_founders(data)
    return change


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
                       INTEREST_KEYWORDS + MERGE_REVIEW_KEYWORDS + MERGE_APPROVED_KEYWORDS +
                       MERGE_CANCEL_KEYWORDS + MAJORSTOCK_KEYWORDS):
                    items.append(item)
        except Exception as e:
            log(f"  [WARN] {info['name']} 조회 실패: {e}")

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
def git(*args, **kwargs):
    return subprocess.run(["git", *args], cwd=REPO_DIR,
                          capture_output=True, text=True, **kwargs)


def unpushed_count():
    """origin/main 보다 앞서 있는 로컬 커밋 수. 알 수 없으면 0."""
    r = git("rev-list", "--count", "origin/main..HEAD")
    try:
        return int(r.stdout.strip())
    except ValueError:
        return 0


def git_sync():
    """처리 전에 원격을 반영한다. ('ok'|'aborted', 상세)

    데이터 파일이 원격보다 낡은 상태로 값을 덮어쓰면, 다른 경로로 올린
    수정이 그대로 날아간다. fast-forward 로 따라잡을 수 있으면 따라잡고,
    갈라져 있으면 손대지 않고 중단한다.
    """
    r = git("fetch", "origin", "main")
    if r.returncode != 0:
        return "aborted", f"fetch 실패: {r.stderr.strip()}"

    behind = git("rev-list", "--count", "HEAD..origin/main").stdout.strip()
    try:
        behind = int(behind)
    except ValueError:
        behind = 0
    if not behind:
        return "ok", ""

    r = git("merge", "--ff-only", "origin/main")
    if r.returncode != 0:
        ahead = unpushed_count()
        return "aborted", (f"로컬이 원격과 갈라져 있어 중단했습니다 "
                           f"(behind {behind}, ahead {ahead}). 수동으로 정리해 주세요.")

    log(f"  원격 {behind}커밋 반영")
    return "ok", f"원격 {behind}커밋 반영"


def git_commit_push(message):
    """커밋 후 푸시. 결과를 ('ok'|'nothing'|'error', 상세) 로 돌려준다.

    푸시만 실패한 이전 실행이 있으면 로컬에 커밋이 남는데, 그 상태에서는
    다음 실행이 'add 했지만 staged 변경 없음' 으로 판정해 푸시를 아예
    시도하지 않는다. 그래서 커밋 여부와 무관하게 미푸시 커밋을 먼저 확인한다.
    """
    git("add", "data/v1.txt", "data/merge.txt", "data/founders.json")
    staged = git("diff", "--cached", "--quiet").returncode != 0

    if staged:
        r = git("commit", "-m", message)
        if r.returncode != 0:
            log(f"  [ERROR] 커밋 실패: {r.stderr.strip()}")
            return "error", f"커밋 실패: {r.stderr.strip()}"
    else:
        log("  변경사항 없음, 커밋 스킵")

    pending = unpushed_count()
    if not pending:
        return ("nothing" if not staged else "ok"), "푸시할 커밋 없음"

    r = git("push", "origin", "main")
    if r.returncode != 0:
        log(f"  [ERROR] 푸시 실패: {r.stderr.strip()}")
        return "error", f"미푸시 커밋 {pending}건 — 푸시 실패: {r.stderr.strip()}"

    log(f"  ✓ 커밋/푸시 완료: {message}")
    return "ok", f"커밋 {pending}건 푸시 완료"


# ── 슬랙 레포트 ───────────────────────────────────────────────────────────────
STATUS_LABEL = {
    "NORMAL": "정상",
    "MERGE_REVIEW": "합병 결의",
    "MERGE_APPROVED": "합병 승인",
}


def fmt_date(yyyymmdd):
    """'20260309' → '2026-03-09'. 비어 있으면 빈 문자열."""
    if not yyyymmdd or len(yyyymmdd) != 8:
        return ""
    return f"{yyyymmdd[:4]}-{yyyymmdd[4:6]}-{yyyymmdd[6:]}"


def build_report(today, seen_count, new_count, rates, merges, founders, issues, git_status):
    """슬랙에 그대로 붙일 수 있는 텍스트를 만든다 (마크다운 없이 이모지 + 텍스트)."""
    L = [f"📄 [{today:%m/%d}] DART 스팩 공시 업데이트", ""]

    total = len(rates) + len(merges) + len(founders)
    if not total:
        L.append(f"변경 사항 없음 (공시 {seen_count}건 확인, 신규 {new_count}건)")
    else:
        L.append(f"공시 {seen_count}건 확인 · 신규 {new_count}건 · 반영 {total}건")

    if rates:
        L += ["", "💰 예치이율 변경"]
        for c in rates:
            L.append(f"· {c['name']} ({c['code']}) {c['year']}년차: {c['old']} → {c['new']}")

    if merges:
        L += ["", "🤝 합병 상태 변경"]
        for c in merges:
            old = STATUS_LABEL.get(c["old"], c["old"])
            new = STATUS_LABEL.get(c["new"], c["new"])
            L.append(f"· {c['name']} ({c['code']}) {old} → {new}")
            s = c.get("schedule")
            if s:
                if s.get("target"):
                    L.append(f"   합병 상대: {s['target']}")
                halt = fmt_date(s.get("halt_start"))
                if halt:
                    L.append(f"   매매거래 정지: {halt} ~ {fmt_date(s.get('halt_end'))}")
                appraisal = fmt_date(s.get("appraisal_start"))
                if appraisal:
                    L.append(f"   주식매수청구권: {appraisal} ~ {fmt_date(s.get('appraisal_end'))}")
                listing = fmt_date(s.get("listing"))
                if listing:
                    L.append(f"   신주 상장 예정: {listing}")

    if founders:
        L += ["", "👥 주요주주 변동"]
        for c in founders:
            if c["old_count"] is None:
                L.append(f"· {c['name']} ({c['code']}) 신규 등록 {c['new_count']}명")
            else:
                L.append(f"· {c['name']} ({c['code']}) {c['old_count']}명 → {c['new_count']}명")

    if issues:
        L += ["", "⚠️ 확인 필요"]
        for msg in issues:
            L.append(f"· {msg}")

    state, detail = git_status
    if state == "ok":
        L += ["", f"✅ {detail}"]
    elif state == "error":
        L += ["", f"❌ {detail}"]

    return "\n".join(L)


# ── 메인 ──────────────────────────────────────────────────────────────────────
def main():
    today = date.today()
    bgn_de = (today - timedelta(days=3)).strftime("%Y%m%d")
    end_de = today.strftime("%Y%m%d")

    log(f"[{today}] DART 공시 조회: {bgn_de} ~ {end_de}")

    sync_state, sync_detail = git_sync()
    if sync_state == "aborted":
        log(f"  [ABORT] {sync_detail}")
        print(f"📄 [{today:%m/%d}] DART 스팩 공시 업데이트\n\n❌ {sync_detail}")
        sys.exit(1)

    state = load_state()
    processed = set(state.get("last_rcept_no", []))

    disclosures = get_recent_spac_disclosures(bgn_de, end_de)
    log(f"  스팩 관련 공시 {len(disclosures)}건 발견")

    new_processed = []
    rates, merges, founders, issues = [], [], [], []

    for item in disclosures:
        rcept_no   = item.get("rcept_no", "")
        corp_name  = item.get("corp_name", "")
        report_nm  = item.get("report_nm", "")
        rcept_dt   = item.get("rcept_dt", "")

        if rcept_no in processed:
            continue

        log(f"\n공시: [{rcept_no}] {corp_name} - {report_nm}")
        corp_code  = item.get("corp_code", "")

        # 예치 금리 변경
        if any(kw in report_nm for kw in INTEREST_KEYWORDS):
            c = process_interest_change(rcept_no, corp_name, rcept_dt, issues)
            if c:
                rates.append(c)

        # 합병 결의
        elif any(kw in report_nm for kw in MERGE_REVIEW_KEYWORDS):
            c = process_merge_status(corp_code, corp_name, "MERGE_REVIEW", issues)
            if c:
                merges.append(c)

        # 합병 승인
        elif any(kw in report_nm for kw in MERGE_APPROVED_KEYWORDS):
            c = process_merge_status(corp_code, corp_name, "MERGE_APPROVED", issues)
            if c:
                merges.append(c)

        # 합병 취소 → NORMAL 복귀
        elif any(kw in report_nm for kw in MERGE_CANCEL_KEYWORDS):
            c = process_merge_status(corp_code, corp_name, "NORMAL", issues)
            if c:
                merges.append(c)

        # 주요주주 변동 → founders.json 갱신
        elif any(kw in report_nm for kw in MAJORSTOCK_KEYWORDS):
            c = process_majorstock_change(corp_code, corp_name,
                                          item.get("stock_code", ""), issues)
            if c:
                founders.append(c)

        new_processed.append(rcept_no)

    # 데이터 변경이 없어도 호출한다. 이전 실행에서 푸시만 실패해 로컬에
    # 남아 있는 커밋이 있으면 여기서 밀어 올린다.
    git_status = git_commit_push(f"[auto] DART 공시 반영 ({today})")

    state["last_rcept_no"] = list(processed) + new_processed
    state["last_run"] = str(today)
    save_state(state)
    log("\n완료")

    print(build_report(today, len(disclosures), len(new_processed),
                       rates, merges, founders, issues, git_status))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        # 실패해도 슬랙에는 알려야 하므로 stdout 으로 에러 레포트를 낸다.
        log(f"\n[FATAL] {type(e).__name__}: {e}")
        print(f"📄 [{date.today():%m/%d}] DART 스팩 공시 업데이트\n\n"
              f"❌ 실행 실패: {type(e).__name__}: {e}")
        sys.exit(1)
