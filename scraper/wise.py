"""리포트 레이더 — 와이즈리포트(comp.wisereport.co.kr) 종목 리포트 수집.

로그인 없이 열리는 기업 리포트 목록 AJAX(c1080001_data.aspx, cmp_cd를 비우면 전 종목)에서
전 증권사 종목 리포트를 받는다. 작성일·증권사·종목·제목·의견·목표가·애널리스트·요약 3줄이 있고
PDF는 로그인 뷰어라 없다. 비공식 내부 AJAX라 언제든 막힐 수 있다(check_sources.py가 감시).

- 평소: 1페이지(500건)를 WISE_INTERVAL_HOURS 시간에 한 번만 받는다
  (마지막 수집 시각은 meta.json source_status.wise.fetched_at).
  실패하면 tried_at·error를 남기고 WISE_RETRY_HOURS 시간 뒤에 다시 시도한다.
- 백필(--wise-backfill): 보관 중인 가장 이른 날짜까지 페이지를 넘긴다. 페이지 사이 WISE_GAP초.
"""

import time
from datetime import datetime, timedelta

from parsers import normalize_date, parse_wise_list, wise_page_info

WISE_API = "https://comp.wisereport.co.kr/company/ajax/c1080001_data.aspx"
WISE_REFERER = "https://comp.wisereport.co.kr/company/c1080001.aspx"
WISE_PAGE_SIZE = 500
WISE_INTERVAL_HOURS = 3
# 실패한 뒤 다시 시도하기까지(시간). 실패 시각은 source_status.wise.tried_at.
WISE_RETRY_HOURS = 1
WISE_GAP = 1.5
# (연결, 읽기) 초. 평소 실행은 WISE_RETRIES+1회까지라 막혔을 때 최악 약 2 x 20 + 0.8 = 41초.
# 백필은 재시도 횟수만 collect.RETRIES 기본값을 쓴다.
WISE_TIMEOUT = (5, 15)
WISE_RETRIES = 1
# 2026-11-16 실측 전체 33,452건 = 67페이지. 백필 상한.
WISE_MAX_PAGES = 80


def _elapsed_at_least(stamp, now, hours):
    """stamp(ISO) 후 hours가 지났거나 stamp가 없거나 깨졌으면 True."""
    if not stamp:
        return True
    try:
        last = datetime.fromisoformat(str(stamp))
    except ValueError:
        return True
    if last.tzinfo is None:
        last = last.replace(tzinfo=now.tzinfo)
    return now - last >= timedelta(hours=hours)


def wise_due(fetched_at, now, interval_hours=WISE_INTERVAL_HOURS, tried_at=None,
             retry_hours=WISE_RETRY_HOURS):
    """받을 차례면 True.

    마지막 성공(fetched_at) 후 interval_hours가 지났거나 성공 기록이 없고, 동시에 마지막
    시도(tried_at) 후 retry_hours가 지났어야 한다. 실패가 이어져도 시간당 한 번만 다시
    시도해서 매 실행이 타임아웃을 물지 않게 한다.
    """
    return (_elapsed_at_least(fetched_at, now, interval_hours)
            and _elapsed_at_least(tried_at, now, retry_hours))


def collect_wise(session, fetch_json, log=print, until=None, gap=WISE_GAP, diag=None):
    """와이즈 목록을 받는다. (레코드 리스트, 응답에서 본 가장 최근 작성일) 또는 (None, None).

    until이 없으면 1페이지만, 있으면('YYYY-MM-DD') 한 페이지의 가장 이른 작성일이 until보다
    과거가 될 때까지 넘긴다. 첫 페이지부터 못 받거나 응답 모양이 다르거나 비었으면 (None, None)
    이고 바로 멈춘다(다음 페이지로 가지 않는다). diag(dict)를 주면 그때 사유를 diag['error']에
    적는다('ConnectTimeout', 'HTTP 403', 'HTTP 200 non-JSON (text/html, 1532 bytes)', 'empty list' 등).
    평소 실행(until 없음)은 요청을 WISE_TIMEOUT x (WISE_RETRIES+1)회로 짧게 묶는다.
    """
    diag = {} if diag is None else diag
    rows = []
    seen = set()
    newest = None
    for page in range(1, WISE_MAX_PAGES + 1):
        page_diag = diag if page == 1 else {}
        payload = fetch_json(session, WISE_API, params={
            "cmp_cd": "", "perPage": WISE_PAGE_SIZE, "curPage": page},
            referer=WISE_REFERER, timeout=WISE_TIMEOUT,
            retries=WISE_RETRIES if until is None else None, diag=page_diag)
        items = payload.get("lists") if isinstance(payload, dict) else None
        if page == 1 and not items:
            if "error" not in diag:
                if payload is None:
                    diag["error"] = "no response"
                elif not isinstance(items, list):
                    diag["error"] = "unexpected JSON (no lists)"
                else:
                    diag["error"] = "empty list"
            log("  ! 와이즈리포트 응답이 없거나 모양이 다릅니다: %s" % diag["error"])
            return None, None
        if not isinstance(items, list) or not items:
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
