"""리포트 레이더 — 네이버 산업·시황 리포트 수집 (data/industry/YYYY-MM.json).

종목 리포트와 같은 모바일 증권 JSON API(/api/research/industry, /api/research/market)를
최신순으로 넘기며 새 건만 모은다. 목록에 PDF가 없어 새 건마다 상세를 한 번 받는다.
애널리스트는 목록·상세 어디에도 없다.

- 처음(industry/ 파일이 없을 때): 종목 리포트 보관분의 가장 이른 날짜까지 백필.
- 평소: 이미 가진 id가 나오는 페이지에서 멈춘다(보통 1페이지).
"""

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

from parsers import RESEARCH_KINDS, parse_naver_research_list, parse_naver_research_pdf

LIST_API = "https://m.stock.naver.com/api/research/%s"
DETAIL_API = "https://m.stock.naver.com/api/research/%s/%s"
PAGE_SIZE = 100
MAX_PAGES = 60
# 평소 실행에서 넘길 페이지 상한(아는 id가 안 나와도 여기서 멈춘다).
INCREMENTAL_MAX_PAGES = 5
GAP = 0.4
WORKERS = 4
# PDF를 못 받은 건은 작성일이 이 일수 안일 때만 다시 시도한다.
PDF_RETRY_DAYS = 2
PDF_RETRY_MAX = 20


def collect_kind(session, fetch_json, kind, known_ids, until=None, log=print, gap=GAP):
    """kind('industry'|'market') 목록에서 known_ids에 없는 새 건. 한 페이지도 못 받으면 None.

    until이 있으면 백필: 페이지의 가장 이른 날짜가 until보다 과거가 될 때까지 넘기고
    until 이후 건만 돌려준다. 없으면 아는 id가 나온 페이지에서 멈춘다.
    """
    out = []
    seen = set()
    any_ok = False
    max_pages = MAX_PAGES if until else INCREMENTAL_MAX_PAGES
    for page in range(1, max_pages + 1):
        items = fetch_json(session, LIST_API % kind, params={"page": page, "pageSize": PAGE_SIZE})
        if items is None:
            break
        any_ok = True
        if not isinstance(items, list) or not items:
            break
        rows = parse_naver_research_list(items, kind)
        hit_known = False
        for rec in rows:
            if rec["id"] in known_ids:
                hit_known = True
                continue
            if rec["id"] in seen or (until and rec["date"] < until):
                continue
            seen.add(rec["id"])
            out.append(rec)
        dates = [r["date"] for r in rows]
        if until and (page == 1 or page % 10 == 0):
            log("  %s p%d: 누적 %d건" % (kind, page, len(out)))
        if until:
            if not dates or min(dates) < until:
                break
        elif hit_known or not rows:
            break
        time.sleep(gap)
    return out if any_ok else None


def fill_pdfs(session, fetch_json, rows, log=print, workers=WORKERS, gap=GAP):
    """상세에서 PDF 주소를 채운다. 건수가 많으면(백필) 스레드 workers개로 나눈다. 채운 건수."""
    if not rows:
        return 0
    lock = threading.Lock()
    state = [0, 0]  # 처리, 성공

    def one(rec):
        kind, rid = rec["id"].split(":", 1)
        obj = fetch_json(session, DETAIL_API % (kind, rid))
        pdf = parse_naver_research_pdf(obj) if obj is not None else None
        with lock:
            state[0] += 1
            if pdf:
                rec["pdf"] = pdf
                state[1] += 1
            if state[0] % 200 == 0:
                log("  산업·시황 상세 %d/%d" % (state[0], len(rows)))
        time.sleep(gap)

    n = max(1, min(workers, 4)) if len(rows) > 30 else 1
    with ThreadPoolExecutor(max_workers=n) as pool:
        list(pool.map(one, rows))
    return state[1]


def pdf_retry_targets(stored, today):
    """PDF가 비어 있고 작성일이 PDF_RETRY_DAYS 안인 저장분 (최대 PDF_RETRY_MAX건)."""
    since = (today - timedelta(days=PDF_RETRY_DAYS)).isoformat()
    cands = [r for r in stored if not r.get("pdf") and (r.get("date") or "") >= since]
    return cands[:PDF_RETRY_MAX]


def collect_industry(session, fetch_json, stored, until, today, log=print):
    """산업·시황 새 건을 모아 stored에 더한 전체 목록을 돌려준다. (전체, 새 건수, 실패한 kind 목록).

    until: 백필 시작일(처음 실행) 또는 None(평소).
    """
    known = {r.get("id") for r in stored}
    new_rows = []
    failed = []
    for kind in RESEARCH_KINDS:
        rows = collect_kind(session, fetch_json, kind, known, until=until, log=log)
        if rows is None:
            failed.append(kind)
            continue
        new_rows.extend(rows)
    retry = pdf_retry_targets(stored, today)
    got = fill_pdfs(session, fetch_json, new_rows + retry, log=log)
    log("산업·시황 리포트 새 %d건 (PDF 재시도 %d건, PDF 확보 %d건)%s"
        % (len(new_rows), len(retry), got,
           " — 실패: %s" % ",".join(failed) if failed else ""))
    return stored + new_rows, len(new_rows), failed

