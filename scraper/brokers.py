"""리포트 레이더 — 증권사 사이트 직접 수집.

네이버 리서치에 리포트를 거의 올리지 않는 KB증권·NH투자증권·한국투자증권을
각 사 사이트에서 직접 긁어 같은 스키마로 돌려준다.

세 수집 함수는 실패를 안에서 삼키고 빈 목록을 돌려준다. 어느 한 곳이 막혀도
전체 수집은 멈추지 않는다. 요청 간격·타임아웃·재시도는 collect.py와 같은 값을 쓰고,
세션은 collect.py의 make_session()이 만든 것(브라우저 UA 포함)을 받아 쓴다.
한국투자증권은 브라우저 UA가 아니면 에러 페이지를 돌려주므로 세션 UA가 중요하다.
"""

import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from parsers import (  # noqa: E402
    compact_date,
    parse_kb_list,
    parse_kis_detail,
    parse_kis_list,
    parse_kis_total,
    parse_nh_list,
    parse_nh_summary,
)

REQUEST_GAP = 0.4
TIMEOUT = 15
RETRIES = 2

KB_LIST_API = "https://rc.kbsec.com/ajax/categoryReportList.json"
KB_FOLDERS = ("37", "38")  # 37=산업/기업, 38=스몰캡(Not Rated)
KB_PAGE_SIZE = 100
KB_MAX_PAGE = 20

NH_AJAX = "https://www.nhsec.com/research/boardCommonTrAjax.action"
NH_PAGE_SIZE = 50  # 요청값일 뿐 실제로는 한 번에 20건씩 온다
NH_MAX_PAGE = 40

KIS_LIST = "https://securities.koreainvestment.com/main/research/research/Strategy.jsp"
KIS_DETAIL = "https://securities.koreainvestment.com/main/research/research/StrategyDetail.jsp"
KIS_PAGE_SIZE = 50
KIS_MAX_PAGE = 20


def log(msg):
    print(msg, flush=True)


def request(session, method, url, **kwargs):
    """실패 시 RETRIES회 재시도. 끝내 실패하면 None. (응답 객체를 그대로 돌려준다)"""
    last = None
    for attempt in range(RETRIES + 1):
        try:
            resp = session.request(method, url, timeout=TIMEOUT, **kwargs)
            resp.raise_for_status()
            return resp
        except Exception as exc:  # 네트워크/HTTP 모두 동일 취급
            last = exc
            if attempt < RETRIES:
                time.sleep(0.8 * (attempt + 1))
    log("  ! 요청 실패: %s (%s)" % (url, last))
    return None


def _compact(date_str):
    """'2026-09-01' -> '20260901'."""
    return re.sub(r"\D", "", str(date_str or ""))[:8]


def _dotted(date_str):
    """'2026-09-01' -> '2026.09.01'."""
    return str(date_str or "").replace("-", ".")


def _in_range(rec, date_from, date_to):
    return date_from <= (rec.get("date") or "") <= date_to


# ------------------------------------------------------------------ KB증권

def collect_kb(session, date_from, date_to):
    """KB증권 리서치. 폴더(산업/기업·스몰캡)별로 목록이 빌 때까지 훑는다.

    의견·목표가·요약이 목록 JSON에 다 들어 있어 상세 요청이 필요 없다.
    """
    out = []
    seen = set()
    try:
        for folder in KB_FOLDERS:
            for page in range(1, KB_MAX_PAGE + 1):
                # form 바디로 보내면 500이 난다. 반드시 JSON 바디.
                resp = request(session, "POST", KB_LIST_API, json={
                    "pageNo": page,
                    "pageSize": KB_PAGE_SIZE,
                    "registdateFrom": _compact(date_from),
                    "registdateTo": _compact(date_to),
                    "folderid": folder,
                    "callGbn": "RCLIST",
                })
                if resp is None:
                    break
                try:
                    payload = resp.json()
                except ValueError:
                    log("  ! KB 응답이 JSON이 아닙니다 (folder %s, p%d)" % (folder, page))
                    break
                items = ((payload.get("response") or {}).get("reportList")) or []
                # totalCount가 늘 0으로 온다. 목록이 빌 때까지 페이지를 넘긴다.
                if not items:
                    break
                for rec in parse_kb_list(payload):
                    if rec["id"] in seen or not _in_range(rec, date_from, date_to):
                        continue
                    seen.add(rec["id"])
                    out.append(rec)
                if len(items) < KB_PAGE_SIZE:
                    break
                time.sleep(REQUEST_GAP)
            time.sleep(REQUEST_GAP)
    except Exception as exc:
        log("  ! KB증권 수집 실패 (무시하고 진행): %s" % exc)
    return out


# ------------------------------------------------------------- NH투자증권

def _nh_post(session, params):
    resp = request(session, "POST", NH_AJAX, data=params)
    if resp is None:
        return None
    try:
        # 응답 헤더는 x-www-form-urlencoded(EUC-KR)라고 하지만 본문은 JSON이다.
        return json.loads(resp.content.decode("euc-kr", errors="replace"))
    except ValueError:
        log("  ! NH 응답을 JSON으로 읽지 못했습니다.")
        return None


def _nh_rows(payload):
    resp = ((payload or {}).get("DATA") or {}).get("RESPONSE") or {}
    return (resp.get("H3211OutBlock2") or {}).get("ROW") or []


def _nh_list(session, date_from, date_to):
    """커서 방식 페이징. 마지막 행의 번호·날짜·시각을 다음 요청에 넣는다.

    rmt_cnt를 얼마로 주든 한 번에 20건씩만 돌려주므로 행 수로는 끝을 알 수 없다.
    새 건이 없거나 마지막 행이 시작일보다 과거로 넘어가면 멈춘다.
    """
    out = []
    seen = set()
    seen_raw = set()
    params = {
        "trName": "H3211", "output": "json", "isNext": "false",
        "rsh_ppr_dit_cd": "01", "rsh_ppr_ser_cd": "0101",
        "rmt_cnt": str(NH_PAGE_SIZE), "rsh_ppr_no": "",
        # 날짜 파라미터가 뒤집혀 있다. _dt_st가 최신일(종료일), _dt_ed가 시작일이다.
        "rsh_ppr_dru_dt_st": _compact(date_to), "rsh_ppr_dru_tm_st": "",
        "rsh_ppr_dru_dt_ed": _compact(date_from), "sch_hdn_ipt_cts": "",
    }
    for _ in range(NH_MAX_PAGE):
        payload = _nh_post(session, params)
        if payload is None:
            break
        raw = _nh_rows(payload)
        if not raw:
            break
        # 커서로 이어붙이면 첫 행이 겹친다. 번호로 걸러낸다.
        advanced = False
        for row in raw:
            no = str(row.get("rsh_ppr_no") or "")
            if no not in seen_raw:
                seen_raw.add(no)
                advanced = True
        for rec in parse_nh_list(payload):
            if rec["id"] in seen or not _in_range(rec, date_from, date_to):
                continue
            seen.add(rec["id"])
            out.append(rec)
        last = raw[-1]
        last_date = compact_date(last.get("rsh_ppr_dru_dt")) or ""
        if not advanced or last_date < date_from:
            break
        params = dict(params, isNext="true",
                      rsh_ppr_no=str(last.get("rsh_ppr_no") or ""),
                      rsh_ppr_dru_dt_st=str(last.get("rsh_ppr_dru_dt") or ""),
                      rsh_ppr_dru_tm_st=str(last.get("rsh_ppr_dru_tm") or ""))
        time.sleep(REQUEST_GAP)
    return out


def enrich_nh(session, records):
    """NH 요약(H3212)에서 종목명·요약·의견·목표가를 채운다. (성공, 실패) 건수."""
    ok = 0
    fail = 0
    total = len(records)
    for i, rec in enumerate(records, 1):
        no = rec.get("nh_no") or str(rec.get("id") or "").split(":", 1)[-1]
        payload = _nh_post(session, {"trName": "H3212", "output": "json",
                                     "rsh_ppr_no": no})
        if payload is None:
            fail += 1
        else:
            detail = parse_nh_summary(payload)
            if detail.get("name"):
                rec["name"] = detail["name"]
            rec["summary"] = detail["summary"] or rec.get("summary")
            # 재시도로 들어온 건의 기존 값을 None으로 덮지 않는다
            rec["rating_raw"] = detail["rating_raw"] or rec.get("rating_raw")
            rec["target"] = detail["target"] or rec.get("target")
            ok += 1
        if i % 50 == 0 or i == total:
            log("  NH 요약 %d/%d (성공 %d, 실패 %d)" % (i, total, ok, fail))
        time.sleep(REQUEST_GAP)
    return ok, fail


def collect_nh(session, date_from, date_to, known_ids=None):
    """NH투자증권 기업 리포트. 이미 저장된 id는 요약을 다시 받지 않는다."""
    out = []
    try:
        out = _nh_list(session, date_from, date_to)
        known = set(known_ids or ())
        fresh = [r for r in out if r["id"] not in known]
        if fresh:
            enrich_nh(session, fresh)
    except Exception as exc:
        log("  ! NH투자증권 수집 실패 (무시하고 진행): %s" % exc)
    for rec in out:  # 페이징용 임시 키는 저장하지 않는다
        for key in ("nh_no", "nh_dt", "nh_tm"):
            rec.pop(key, None)
    return out


# ---------------------------------------------------------- 한국투자증권

def enrich_kis(session, records):
    """상세 페이지 본문에서 의견·목표가를 캔다. (성공, 실패) 건수."""
    ok = 0
    fail = 0
    total = len(records)
    for i, rec in enumerate(records, 1):
        rid = rec.get("kis_id") or str(rec.get("id") or "").split(":", 1)[-1]
        resp = request(session, "GET", KIS_DETAIL,
                       params={"jkGubun": "10", "id": rid})
        if resp is None:
            fail += 1
        else:
            detail = parse_kis_detail(resp.text)
            # 재시도로 들어온 건의 기존 값을 None으로 덮지 않는다
            rec["rating_raw"] = detail["rating_raw"] or rec.get("rating_raw")
            rec["target"] = detail["target"] or rec.get("target")
            # 목록의 body_sub가 우선이고, 비었을 때만 본문으로 채운다.
            if not rec.get("summary"):
                rec["summary"] = detail["summary"]
            ok += 1
        if i % 50 == 0 or i == total:
            log("  한투 상세 %d/%d (성공 %d, 실패 %d)" % (i, total, ok, fail))
        time.sleep(REQUEST_GAP)
    return ok, fail


def collect_kis(session, date_from, date_to, known_ids=None):
    """한국투자증권 기업Note·AIR 스몰캡. 이미 저장된 id는 상세를 다시 받지 않는다."""
    out = []
    seen = set()
    try:
        pages = KIS_MAX_PAGE
        for page in range(1, KIS_MAX_PAGE + 1):
            resp = request(session, "GET", KIS_LIST, params={
                "jkGubun": "10", "category1": "05", "category2": "01",
                "searchDate": "custom",
                "fromDate": _dotted(date_from), "toDate": _dotted(date_to),
                "searchColumn": "all", "searchValue": "",
                "rowsPerPages": str(KIS_PAGE_SIZE), "currentPage": str(page),
            })
            if resp is None:
                break
            html = resp.text
            if page == 1:
                # 분류 필터로 걸러낸 뒤라 행 수로는 끝을 알 수 없다. 전체건수로 센다.
                total = parse_kis_total(html)
                if total is not None:
                    pages = min(KIS_MAX_PAGE,
                                max(1, (total + KIS_PAGE_SIZE - 1) // KIS_PAGE_SIZE))
            batch = parse_kis_list(html)
            fresh = [r for r in batch
                     if r["id"] not in seen and _in_range(r, date_from, date_to)]
            for rec in fresh:
                seen.add(rec["id"])
                out.append(rec)
            if page >= pages:
                break
            time.sleep(REQUEST_GAP)

        known = set(known_ids or ())
        targets = [r for r in out if r["id"] not in known]
        if targets:
            enrich_kis(session, targets)
    except Exception as exc:
        log("  ! 한국투자증권 수집 실패 (무시하고 진행): %s" % exc)
    for rec in out:  # 상세 요청용 임시 키는 저장하지 않는다
        rec.pop("kis_id", None)
    return out
