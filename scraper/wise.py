"""리포트 레이더 — 와이즈리포트(comp.wisereport.co.kr) 종목 리포트 수집.

로그인 없이 열리는 기업 리포트 목록 AJAX(c1080001_data.aspx, cmp_cd를 비우면 전 종목)에서
전 증권사 종목 리포트를 받는다. 작성일·증권사·종목·제목·의견·목표가·애널리스트·요약 3줄이 있고
PDF는 로그인 뷰어라 없다. 비공식 내부 AJAX라 언제든 막힐 수 있다(check_sources.py가 감시).

- 평소: 1페이지(500건)를 WISE_INTERVAL_HOURS 시간에 한 번만 받는다
  (마지막 수집 시각은 meta.json source_status.wise.fetched_at).
- 백필(--wise-backfill): 보관 중인 가장 이른 날짜까지 페이지를 넘긴다. 페이지 사이 WISE_GAP초.
"""

import time
from datetime import datetime, timedelta

from parsers import normalize_date, parse_wise_list, wise_page_info

WISE_API = "https://comp.wisereport.co.kr/company/ajax/c1080001_data.aspx"
WISE_REFERER = "https://comp.wisereport.co.kr/company/c1080001.aspx"
WISE_PAGE_SIZE = 500
WISE_INTERVAL_HOURS = 3
WISE_GAP = 1.5
# 2026-11-16 실측 전체 33,452건 = 67페이지. 백필 상한.
WISE_MAX_PAGES = 80


def wise_due(fetched_at, now, interval_hours=WISE_INTERVAL_HOURS):
    """마지막 수집 후 interval_hours가 지났거나 기록이 없으면 True."""
    if not fetched_at:
        return True
    try:
        last = datetime.fromisoformat(str(fetched_at))
    except ValueError:
        return True
    if last.tzinfo is None:
        last = last.replace(tzinfo=now.tzinfo)
    return now - last >= timedelta(hours=interval_hours)


def collect_wise(session, fetch_json, log=print, until=None, gap=WISE_GAP):
    """와이즈 목록을 받는다. (레코드 리스트, 응답에서 본 가장 최근 작성일) 또는 (None, None).

    until이 없으면 1페이지만, 있으면('YYYY-MM-DD') 한 페이지의 가장 이른 작성일이 until보다
    과거가 될 때까지 넘긴다. 첫 페이지부터 못 받거나 응답 모양이 다르면 (None, None).
    """
    rows = []
    seen = set()
    newest = None
    for page in range(1, WISE_MAX_PAGES + 1):
        payload = fetch_json(session, WISE_API, params={
            "cmp_cd": "", "perPage": WISE_PAGE_SIZE, "curPage": page},
            referer=WISE_REFERER)
        items = payload.get("lists") if isinstance(payload, dict) else None
        if not isinstance(items, list):
            if page == 1:
                log("  ! 와이즈리포트 응답이 없거나 모양이 다릅니다.")
                return None, None
            break
        if not items:
            break
        for rec in parse_wise_list(payload):
            if newest is None or rec["date"] > newest:
                newest = rec["date"]  # 회사 IR 자료 등 버린 행은 세지 않는다
            if rec["id"] in seen:
                continue
            seen.add(rec["id"])
            rows.append(rec)
        dates = [d for d in (normalize_date(it.get("ANL_DT")) for it in items
                             if isinstance(it, dict)) if d]
        _, total_pages, _ = wise_page_info(payload)
        if until is None:
            break
        oldest = min(dates) if dates else None
        if page == 1 or page % 5 == 0:
            log("  와이즈 p%d/%s: 누적 %d건 (이 페이지 가장 이른 날 %s)"
                % (page, total_pages or "?", len(rows), oldest))
        if oldest is None or oldest < until or (total_pages and page >= total_pages):
            break
        time.sleep(gap)
    if until:
        rows = [r for r in rows if r["date"] >= until]
    return rows, newest
