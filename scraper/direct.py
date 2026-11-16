"""리포트 레이더 — 증권사 사이트 직접 수집 2차 (iM증권·BNK투자증권·상상인증권).

와이즈리포트가 의견·목표가는 주지만 PDF 원문 링크가 없어서, 공개 PDF가 있는 증권사 사이트를
직접 읽는다. 목적은 (1) 원문 PDF 링크, (2) 증권사가 직접 밝힌 의견·목표가.

2026-11-16 실측으로 고른 세 곳(docs/PLAN-2026-09-coverage.md 3-C 표 1~3순위 중 삼성·현대차는 제외):
- 삼성증권: 기업리포트 메뉴가 로그인 화면(error_auth)으로 넘어간다 → 제외.
- 현대차증권: Report&Note 메뉴가 로그인 화면을 띄운다. 목록 URL을 직접 부르면 열리지만
  사이트가 메뉴에서 막은 것을 돌아가는 셈이라 쓰지 않는다 → 제외.
- 대신 iM증권(2순위), BNK투자증권(5순위), 상상인증권(7순위).

비용 규칙(평소 실행):
- 목록은 첫 페이지만 받는다. 이미 본 id(보관 레코드의 id, 또는 다른 레코드에 붙은 direct 값)는 건너뛴다.
- 새 건만 상세(iM 첨부 조회·상상인 상세)를 한 번 받는다. BNK는 목록에 PDF가 있어 상세가 없다.
- 의견·목표가·종목코드가 비면 PDF 1쪽을 읽는다. 한 실행에 PDF_CAP개까지, TIME_BUDGET초 안에서만.
  예산을 넘긴 새 건은 이번에 넣지 않고(아직 안 본 것으로 남겨) 다음 실행에서 처리한다.
- 같은 리포트가 네이버에 이미 의견·목표가와 함께 있으면 PDF를 받지 않는다(네이버를 내리지 않으므로).
- 요청 사이 REQUEST_GAP초. 브라우저 UA(collect.make_session).
모든 실패는 안에서 삼키고 빈 결과를 돌려준다.
"""

import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import normalize as norm  # noqa: E402
import pdftext  # noqa: E402
from parsers import (  # noqa: E402
    BNK_LIST_URL,
    IM_LIST_URL,
    IM_SITE,
    SSI_LIST_URL,
    SSI_SITE,
    bnk_last_page,
    bnk_list_dates,
    build_name_map,
    extract_code_from_text,
    extract_pdf_opinion,
    im_list_dates,
    im_list_total,
    lookup_code,
    parse_bnk_list,
    parse_im_attach,
    parse_im_list,
    parse_sangsangin_detail,
    parse_sangsangin_list,
    sangsangin_list_dates,
    sangsangin_total,
)

DIRECT_SOURCES = norm.DIRECT_SOURCES
BROKER_LABEL = {"im": "iM증권", "bnk": "BNK투자증권", "sangsangin": "상상인증권"}

REQUEST_GAP = 1.0
TIMEOUT = 15
RETRIES = 2
PDF_CAP = 15          # 평소 실행에서 세 곳을 합친 PDF 다운로드 상한
TIME_BUDGET = 30.0    # 평소 실행에서 상세·PDF에 쓰는 시간 상한(초). 목록 요청은 따로.
MAX_TRIES = 3         # 레코드별 PDF 재시도 상한 (detail_tries)

IM_JSON = IM_SITE + "/_json/source.jsp"
IM_PAGE_FIRST = 20
IM_PAGE_BACKFILL = 50
IM_MAX_PAGES = 40
BNK_MAX_PAGES = 60     # 한 페이지 10건 고정
SSI_LIST_API = SSI_SITE + "/notice/getNoticeList"
SSI_DETAIL_API = SSI_SITE + "/notice/getNoticeDetail"
SSI_CMS = "CM0079"
SSI_PAGE_FIRST = 20
SSI_PAGE_BACKFILL = 50
SSI_MAX_PAGES = 40

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UNIVERSE_PATH = os.path.join(ROOT, "app", "universe.json")


def _log(msg):
    print(msg, flush=True)


class Budget:
    """PDF 개수·시간 예산. pdf_cap/time_budget이 None이면 무제한(백필)."""

    def __init__(self, pdf_cap=PDF_CAP, time_budget=TIME_BUDGET):
        self.pdf_left = pdf_cap
        self.deadline = None if time_budget is None else time.time() + time_budget
        self.pdf_used = 0

    def time_ok(self):
        return self.deadline is None or time.time() < self.deadline

    def pdf_ok(self):
        return self.time_ok() and (self.pdf_left is None or self.pdf_left > 0)

    def take_pdf(self):
        self.pdf_used += 1
        if self.pdf_left is not None:
            self.pdf_left -= 1


def _request(session, method, url, **kwargs):
    last = None
    for attempt in range(RETRIES + 1):
        try:
            resp = session.request(method, url, timeout=TIMEOUT, **kwargs)
            resp.raise_for_status()
            return resp
        except Exception as exc:
            last = exc
            if attempt < RETRIES:
                time.sleep(REQUEST_GAP * (attempt + 1))
    _log("  ! 요청 실패: %s (%s)" % (url, last))
    return None


def _json(resp, encoding="utf-8"):
    if resp is None:
        return None
    try:
        return json.loads(resp.content.decode(encoding, errors="replace"))
    except ValueError:
        return None


def load_name_map(records, path=UNIVERSE_PATH):
    """유니버스(app/universe.json)와 보관 레코드로 이름→코드 표를 만든다."""
    rows = []
    try:
        with open(path, "r", encoding="utf-8") as f:
            rows = json.load(f)
    except Exception as exc:
        _log("  ! 종목 유니버스를 읽지 못했습니다 (%s). 보관 레코드 이름만 씁니다." % exc)
    return build_name_map(rows if isinstance(rows, list) else [], records)


# ------------------------------------------------------------- 목록

def _pages(fetch_page, dates_of, until, max_pages):
    """fetch_page(page) -> (rows, payload). until이 없으면 1페이지만, 있으면 그 날짜 이전까지."""
    out = []
    seen = set()
    newest = None
    for page in range(1, max_pages + 1):
        got = fetch_page(page)
        if got is None:
            break
        rows, payload = got
        dates = dates_of(payload)
        for d in dates:
            if newest is None or d > newest:
                newest = d
        for rec in rows:
            if rec["id"] not in seen:
                seen.add(rec["id"])
                out.append(rec)
        if until is None or not dates or min(dates) < until:
            break
        time.sleep(REQUEST_GAP)
    if until:
        out = [r for r in out if (r.get("date") or "") >= until]
    return out, newest


def list_im(session, until=None):
    size = IM_PAGE_BACKFILL if until else IM_PAGE_FIRST
    state = {"pages": None}

    def fetch_page(page):
        if state["pages"] is not None and page > state["pages"]:
            return None
        payload = _json(_request(session, "POST", IM_JSON, data={
            "tr_cd": "db/board/TWBBACL/board_list", "aid": "", "bid": "R_E08",
            "cur_page": str(page), "num_page": str(size), "condition": "",
            "keyOption": "ALL", "iKey": "%25%25", "sdate": "20050630", "edate": "",
            "dnURL": "/upload/", "iKey_view": ""}, headers={"Referer": IM_LIST_URL}))
        if not isinstance(payload, list):
            return None
        total = im_list_total(payload)
        if total:
            state["pages"] = (total + size - 1) // size
        return parse_im_list(payload), payload

    return _pages(fetch_page, im_list_dates, until, IM_MAX_PAGES)


def list_bnk(session, until=None):
    state = {"last": None}

    def fetch_page(page):
        if state["last"] is not None and page > state["last"]:
            return None
        resp = _request(session, "GET", BNK_LIST_URL, params={
            "bbsId": "analysingCompany", "cmd": "list", "curPage": str(page)})
        if resp is None:
            return None
        html = resp.content.decode("utf-8", errors="replace")
        last = bnk_last_page(html)
        if last:
            state["last"] = last
        return parse_bnk_list(html), html

    return _pages(fetch_page, bnk_list_dates, until, BNK_MAX_PAGES)


def list_sangsangin(session, until=None):
    size = SSI_PAGE_BACKFILL if until else SSI_PAGE_FIRST
    state = {"pages": None}

    def fetch_page(page):
        if state["pages"] is not None and page > state["pages"]:
            return None
        # JSON 바디로 보내면 오류 페이지가 온다. 폼 바디.
        payload = _json(_request(session, "POST", SSI_LIST_API, data={
            "pageNum": page, "src": "all", "cmsCd": SSI_CMS, "rowNum": size,
            "startRow": (page - 1) * size, "sdt": "", "edt": ""},
            headers={"Referer": SSI_LIST_URL}))
        if not isinstance(payload, list):
            return None
        total = sangsangin_total(payload)
        if total:
            state["pages"] = (total + size - 1) // size
        return parse_sangsangin_list(payload), payload

    return _pages(fetch_page, sangsangin_list_dates, until, SSI_MAX_PAGES)


LISTERS = {"im": list_im, "bnk": list_bnk, "sangsangin": list_sangsangin}


# ------------------------------------------------------------- 상세

def enrich_im(session, rec):
    """첨부 조회 -> pdf, 종목코드(파일명). 성공 여부."""
    payload = _json(_request(session, "POST", IM_JSON, data={
        "bid": rec.get("im_bid") or "R_E081", "aid": rec["id"].split(":", 1)[1],
        "tr_cd": "db/research/twbbacl_attach"}, headers={"Referer": IM_LIST_URL}))
    if payload is None:
        return False
    pdf, code = parse_im_attach(payload)
    if pdf:
        rec["pdf"] = pdf
        rec["url"] = pdf
    if code and not rec.get("code"):
        rec["code"] = code
    return True


def enrich_sangsangin(session, rec):
    """상세 -> 의견·목표가·애널리스트·요약·pdf. 성공 여부."""
    no = rec["id"].split(":", 1)[1]
    payload = _json(_request(session, "POST", SSI_DETAIL_API, data={
        "ntNo": no, "cmsCd": SSI_CMS, "pageNum": 1, "src": "all", "startRow": 0,
        "rowNum": 10, "sdt": "", "edt": ""}, headers={"Referer": SSI_LIST_URL}))
    if not isinstance(payload, dict):
        return False
    d = parse_sangsangin_detail(payload)
    for field in ("rating_raw", "target", "analyst", "summary"):
        if d[field] and not rec.get(field):
            rec[field] = d[field]
    if d["pdf"]:
        rec["pdf"] = d["pdf"]
        rec["url"] = d["pdf"]
    return True


ENRICHERS = {"im": enrich_im, "sangsangin": enrich_sangsangin}


def pdf_fill(session, rec, budget, stats):
    """PDF 1쪽에서 빈 의견·목표가·종목코드를 채운다. 다운로드를 시도했으면 True."""
    if not rec.get("pdf") or not budget.pdf_ok():
        return False
    budget.take_pdf()
    rec["_pdf_this_run"] = True  # 저장 필드가 아니라 파일에는 남지 않는다
    text = pdftext.fetch_first_page_text(session, rec["pdf"])
    time.sleep(REQUEST_GAP)
    if text is None:
        stats["pdf_fail"] += 1
        return True
    stats["pdf_ok"] += 1
    rating_raw, target = extract_pdf_opinion(text)
    if target and not rec.get("target"):
        rec["target"] = target
        stats["pdf_target"] += 1
    if rating_raw and not rec.get("rating_raw"):
        rec["rating_raw"] = rating_raw
    if not rec.get("code"):
        rec["code"] = extract_code_from_text(text, rec.get("name"))
    return True


def _note_tries(rec):
    """목표가를 끝내 못 얻은 직접 수집 건의 재시도 횟수. 얻었으면 지운다."""
    if rec.get("target") is None:
        rec["detail_tries"] = int(rec.get("detail_tries") or 0) + 1
    else:
        rec.pop("detail_tries", None)


def _new_stats():
    return {"listed": 0, "new": 0, "added": 0, "deferred": 0, "no_code": 0,
            "pdf_ok": 0, "pdf_fail": 0, "pdf_target": 0, "naver_skip_pdf": 0}


def collect_direct(session, known_ids, name_map, records, log=_log, until=None,
                   budget=None, sources=DIRECT_SOURCES):
    """세 증권사의 새 리포트. (새 레코드 리스트, {소스: {"fetched_last_date"}}, {소스: 통계}).

    known_ids: 이미 본 id(보관 레코드 id + 다른 레코드의 direct 값). until: 백필 시작일(없으면 첫 페이지만).
    records: 보관 레코드(네이버에 같은 리포트가 있는지 보고 PDF를 아끼는 데 쓴다).
    """
    budget = budget or Budget()
    index = norm.direct_match_index(records or [])
    out = []
    info = {}
    all_stats = {}
    known = set(known_ids or ())
    for src in sources:
        stats = all_stats[src] = _new_stats()
        try:
            rows, newest = LISTERS[src](session, until=until)
        except Exception as exc:
            log("  ! %s 목록 실패 (무시하고 진행): %s" % (BROKER_LABEL[src], exc))
            continue
        time.sleep(REQUEST_GAP)
        stats["listed"] = len(rows)
        if newest:
            info[src] = {"fetched_last_date": newest}
        fresh = sorted((r for r in rows if r["id"] not in known),
                       key=lambda r: (r.get("date") or "", r["id"]), reverse=True)
        stats["new"] = len(fresh)
        enrich = ENRICHERS.get(src)
        for rec in fresh:
            try:
                if enrich is not None:
                    if not budget.time_ok():
                        stats["deferred"] += 1
                        continue
                    ok = enrich(session, rec)
                    time.sleep(REQUEST_GAP)
                    if not ok:
                        stats["deferred"] += 1
                        continue
                if not rec.get("code"):
                    rec["code"] = lookup_code(rec.get("name"), name_map)
                need_pdf = rec.get("pdf") and (rec.get("target") is None
                                              or not rec.get("rating_raw")
                                              or not rec.get("code"))
                if need_pdf and rec.get("code"):
                    m = norm.match_direct(rec, index)
                    if m is not None and m.get("source") == "naver" and m.get("target") \
                            and m.get("rating_raw"):
                        need_pdf = False
                        stats["naver_skip_pdf"] += 1
                if need_pdf:
                    if not pdf_fill(session, rec, budget, stats):
                        stats["deferred"] += 1  # 예산 소진: 다음 실행에서 처리
                        continue
                    _note_tries(rec)
                if not rec.get("code"):
                    stats["no_code"] += 1
                    log("  %s 종목코드를 찾지 못해 버림: %s %s"
                        % (BROKER_LABEL[src], rec.get("name"), rec.get("date")))
                    continue
            except Exception as exc:
                log("  ! %s %s 처리 실패 (건너뜀): %s" % (BROKER_LABEL[src], rec.get("id"), exc))
                stats["deferred"] += 1
                continue
            rec.pop("im_bid", None)
            out.append(rec)
            stats["added"] += 1
        log("%s 목록 %d건 (새 %d, 추가 %d, 미룸 %d, 코드 없음 %d) | PDF 성공 %d·실패 %d, "
            "PDF 목표가 %d, 네이버에 있어 PDF 생략 %d"
            % (BROKER_LABEL[src], stats["listed"], stats["new"], stats["added"],
               stats["deferred"], stats["no_code"], stats["pdf_ok"], stats["pdf_fail"],
               stats["pdf_target"], stats["naver_skip_pdf"]))
    return out, info, all_stats


def retry_pdf(session, records, budget, log=_log):
    """보관 중인 직접 수집 단독 건 중 목표가가 빈 것을 PDF로 다시 읽는다(MAX_TRIES까지)."""
    stats = _new_stats()
    targets = [r for r in records
               if r.get("source") in DIRECT_SOURCES and r.get("target") is None
               and r.get("pdf") and int(r.get("detail_tries") or 0) < MAX_TRIES
               and not r.get("_pdf_this_run")]
    targets.sort(key=lambda r: (r.get("date") or "", r.get("id")), reverse=True)
    for rec in targets:
        if not pdf_fill(session, rec, budget, stats):
            break
        _note_tries(rec)
    if targets:
        log("직접 수집 PDF 재시도 %d건 중 %d건 시도 (목표가 얻음 %d)"
            % (len(targets), stats["pdf_ok"] + stats["pdf_fail"], stats["pdf_target"]))
    return stats
