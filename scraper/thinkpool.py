"""리포트 레이더 — 씽크풀(api.thinkpool.com) 종목 리포트 수집.

로그인 없이 열리는 전 증권사 리포트 목록 API(allReport?pno=N, 한 페이지 20건, 최신순)를 받는다.
작성일(연도 없음 'MM/DD')·증권사·종목·제목·의견·목표가·요약이 있고 PDF·애널리스트·공개 리포트 주소는
없다. 와이즈리포트가 2026-11-17 닫힌 뒤의 대체 소스다. 비공식 공개 API라 언제든 막힐 수 있으므로
아주 가볍게 쓴다: 요청 사이 THINKPOOL_GAP초, 병렬·반복 재시도 없음, 막히면 바로 멈춘다.

- 평소: THINKPOOL_INTERVAL_HOURS 시간에 한 번, 이미 본 행(source_status.thinkpool.fetched_last_id
  = 지난번에 본 가장 큰 rcpNo)에 닿을 때까지만 페이지를 넘긴다(최대 THINKPOOL_NORMAL_PAGES).
  실패하면 tried_at·error를 남기고 THINKPOOL_RETRY_HOURS 시간 뒤에 다시 시도한다.
- 백필(--thinkpool-backfill [DAYS]): 최근 DAYS일(기본 30, 최대 60)까지 넘긴다. 페이지 상한 있음.
"""

import socket
import threading
import time

from parsers import infer_year_date, parse_thinkpool_list, thinkpool_today
from wise import wise_due

THINKPOOL_API = "https://api.thinkpool.com/analysis/report/allReport"
THINKPOOL_INTERVAL_HOURS = 3
THINKPOOL_RETRY_HOURS = 1
# 페이지 사이 간격(초). 2초 이상.
THINKPOOL_GAP = 2.0
# (연결, 읽기) 초 x (THINKPOOL_RETRIES+1)회. 막혔을 때 최악 약 2 x 20 + 0.8 = 41초.
THINKPOOL_TIMEOUT = (5, 15)
THINKPOOL_RETRIES = 1
# 평소 실행 페이지 상한(20건 x 5 = 100건, 3시간 발간량보다 넉넉하다).
THINKPOOL_NORMAL_PAGES = 5
THINKPOOL_BACKFILL_DAYS = 30
THINKPOOL_BACKFILL_MAX_DAYS = 60
# 백필 페이지 상한. 2026-09 실측 30일 약 1,300건 = 65페이지.
THINKPOOL_MAX_PAGES = 150
THINKPOOL_HOST = "api.thinkpool.com"
# 이름 조회(DNS)는 requests 의 제한 시간이 닿지 않는다. 2026-11-18 실측: 조회 실패 한 번에 710초.
# 그래서 요청 전에 따로 확인하고 이 시간(초) 안에 안 풀리면 그만둔다.
THINKPOOL_DNS_TIMEOUT = 5.0


def host_resolves(host=THINKPOOL_HOST, timeout=THINKPOOL_DNS_TIMEOUT):
    """host 이름이 timeout 초 안에 풀리면 True. 조회는 데몬 스레드에서 해서 멈춰도 실행을 붙잡지 않는다."""
    ok = []

    def work():
        try:
            socket.getaddrinfo(host, 443)
            ok.append(True)
        except OSError:
            pass

    th = threading.Thread(target=work, daemon=True)
    th.start()
    th.join(timeout)
    return bool(ok)


def thinkpool_due(fetched_at, now, tried_at=None):
    """받을 차례면 True. 성공 후 3시간, 실패 후 1시간 (wise_due와 같은 규칙)."""
    return wise_due(fetched_at, now, interval_hours=THINKPOOL_INTERVAL_HOURS,
                    tried_at=tried_at, retry_hours=THINKPOOL_RETRY_HOURS)


def backfill_days(value):
    """--thinkpool-backfill 값을 1~THINKPOOL_BACKFILL_MAX_DAYS 로 자른다."""
    try:
        days = int(value)
    except (TypeError, ValueError):
        days = THINKPOOL_BACKFILL_DAYS
    return max(1, min(days, THINKPOOL_BACKFILL_MAX_DAYS))


def _rcp_nos(items):
    out = []
    for it in items:
        try:
            out.append(int(it.get("rcpNo")))
        except (TypeError, ValueError, AttributeError):
            pass
    return out


def collect_thinkpool(session, fetch_json, log=print, until=None, stop_id=None, today=None,
                      gap=THINKPOOL_GAP, diag=None, sleep=time.sleep, resolve=None):
    """씽크풀 목록을 받는다. (레코드, 응답에서 본 가장 최근 작성일, 가장 큰 rcpNo, 받은 페이지 수).

    until('YYYY-MM-DD')이 있으면 백필: 한 페이지의 가장 이른 작성일이 until보다 과거가 될 때까지
    (최대 THINKPOOL_MAX_PAGES) 넘기고 until 이전 행은 버린다. 없으면 평소: stop_id(이미 본 가장 큰
    rcpNo) 이하인 행이 나온 페이지에서 멈춘다(stop_id가 없으면 1페이지만, 최대 THINKPOOL_NORMAL_PAGES).
    첫 페이지를 못 받거나 모양이 다르거나 비었으면 (None, None, None, 1)이고 바로 멈춘다.
    diag(dict)에 그 사유를 적는다. 둘째 페이지부터의 실패는 그때까지 받은 것을 돌려준다.
    today(date)는 응답에 todayDate가 없을 때 연도 추정 기준일이다.
    """
    diag = {} if diag is None else diag
    rows = []
    seen = set()
    newest = None
    max_id = None
    max_pages = THINKPOOL_MAX_PAGES if until else THINKPOOL_NORMAL_PAGES
    pages = 0
    for page in range(1, max_pages + 1):
        if page > 1:
            sleep(gap)
        page_diag = diag if page == 1 else {}
        # resolve 가 주어지면(실제 수집) 요청 전에 이름 조회부터 확인한다. 안 풀리면 요청하지 않는다.
        if resolve is not None and not resolve():
            if page == 1:
                diag["error"] = "DNS timeout"
                log("  ! 씽크풀 이름 조회 실패 — 이번 실행은 건너뜁니다")
                return None, None, None, 0
            log("  ! 씽크풀 p%d 이름 조회 실패 — 여기까지 받은 것만 씁니다" % page)
            break
        payload = fetch_json(session, THINKPOOL_API, params={"pno": page},
                             timeout=THINKPOOL_TIMEOUT, retries=THINKPOOL_RETRIES,
                             diag=page_diag)
        pages = page
        items = payload.get("list") if isinstance(payload, dict) else None
        if page == 1 and not items:
            if "error" not in diag:
                if payload is None:
                    diag["error"] = "no response"
                elif not isinstance(items, list):
                    diag["error"] = "unexpected JSON (no list)"
                else:
                    diag["error"] = "empty list"
            log("  ! 씽크풀 응답이 없거나 모양이 다릅니다: %s" % diag["error"])
            return None, None, None, pages
        if not isinstance(items, list) or not items:
            if page_diag.get("error"):
                log("  ! 씽크풀 p%d 실패(%s) — 여기까지 받은 것만 씁니다" % (page, page_diag["error"]))
            break
        anchor = thinkpool_today(payload) or today
        for rec in parse_thinkpool_list(payload, today=today):
            if newest is None or rec["date"] > newest:
                newest = rec["date"]
            if rec["id"] in seen:
                continue
            seen.add(rec["id"])
            rows.append(rec)
        ids = _rcp_nos(it for it in items if isinstance(it, dict))
        if ids and (max_id is None or max(ids) > max_id):
            max_id = max(ids)
        if until is None:
            if stop_id is None or not ids or min(ids) <= stop_id:
                break
            continue
        dates = [d for d in (infer_year_date(it.get("date"), anchor) for it in items
                             if isinstance(it, dict)) if d]
        oldest = min(dates) if dates else None
        if page == 1 or page % 10 == 0:
            log("  씽크풀 p%d: 누적 %d건 (이 페이지 가장 이른 날 %s)" % (page, len(rows), oldest))
        if oldest is None or oldest < until:
            break
    else:
        log("  씽크풀: 페이지 상한 %d에 닿아 멈춥니다" % max_pages)
    if until:
        rows = [r for r in rows if r["date"] >= until]
    return rows, newest, max_id, pages
