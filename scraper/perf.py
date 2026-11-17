"""리포트 레이더 — 발간 후 성과 (data/perf.json, docs/DATA-FORMAT-v2.md).

하루 한 번, 리포트에 나온 종목마다 네이버 일봉(siseJson)을 한 번씩 받아
리포트별 발간일 종가(paw), 발간 다음 거래일 이후 최고가(max)·최저가(min),
고가가 목표가에 처음 닿은 날(hit)을 계산한다.

계산 함수(close_on, compute_item, compute_perf, perf_due)는 네트워크를 타지 않아
test_parsers.py가 픽스처로 검증한다. fetch_histories만 네트워크를 쓴다.
"""

import bisect
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta

from normalize import trusted_paw
from parsers import parse_sise_json

SISE_URL = "https://api.finance.naver.com/siseJson.naver"
# 휴장일에 낸 리포트는 직전 거래일 종가를 쓰므로 가장 이른 발간일보다 이만큼 앞부터 받는다.
LEAD_DAYS = 14
WORKERS = 4
# 스레드마다 요청 사이에 쉬는 시간(초). 4스레드면 초당 많아야 8건 남짓.
GAP = 0.4
# 하루 한 번: 16:00 KST(장 마감 뒤) 이후 첫 실행, 또는 파일이 없거나 이 시간보다 오래됐을 때.
REFRESH_HOUR = 16
MAX_AGE_HOURS = 20


def perf_due(updated_at, now, force=False):
    """perf.json을 다시 계산할 때면 True.

    updated_at: 기존 perf.json의 updated_at(ISO 문자열) 또는 None. now: KST aware datetime.
    """
    if force or not updated_at:
        return True
    try:
        last = datetime.fromisoformat(str(updated_at))
    except ValueError:
        return True
    if last.tzinfo is None:
        last = last.replace(tzinfo=now.tzinfo)
    if now - last >= timedelta(hours=MAX_AGE_HOURS):
        return True
    cut = now.replace(hour=REFRESH_HOUR, minute=0, second=0, microsecond=0)
    return now >= cut and last < cut


def _compact(day):
    return str(day).replace("-", "")


def history_window(records, today):
    """{code: 받을 시작일 'YYYY-MM-DD'} — 종목별 가장 이른 발간일 - LEAD_DAYS."""
    need = {}
    for rec in records:
        code, d = rec.get("code"), rec.get("date")
        if not code or not d:
            continue
        if code not in need or d < need[code]:
            need[code] = d
    out = {}
    for code, d in need.items():
        try:
            start = date.fromisoformat(d) - timedelta(days=LEAD_DAYS)
        except ValueError:
            continue
        out[code] = min(start, today).isoformat()
    return out


def fetch_histories(session, windows, today, fetch_text, log=print,
                    workers=WORKERS, gap=GAP):
    """종목마다 일봉을 한 번씩 받는다. {code: [(날짜, 시, 고, 저, 종), ...]}.

    fetch_text(session, url, params) -> 응답 텍스트 또는 None (collect.fetch).
    실패한 종목은 결과에서 빠진다(다른 종목은 계속). requests.Session은 스레드 간 공유해도
    읽기 요청에는 문제가 없지만, 안전하게 스레드마다 요청 간격을 따로 둔다.
    """
    end = _compact(today.isoformat())
    codes = sorted(windows)
    out = {}
    lock = threading.Lock()
    done = [0, 0]  # 처리, 실패

    def one(code):
        text = fetch_text(session, SISE_URL, params={
            "symbol": code, "requestType": 1, "startTime": _compact(windows[code]),
            "endTime": end, "timeframe": "day"})
        rows = parse_sise_json(text) if text else []
        with lock:
            done[0] += 1
            if rows:
                out[code] = rows
            else:
                done[1] += 1
            if done[0] % 200 == 0 or done[0] == len(codes):
                log("  일봉 %d/%d (실패 %d)" % (done[0], len(codes), done[1]))
        time.sleep(gap)

    with ThreadPoolExecutor(max_workers=max(1, min(workers, 4))) as pool:
        list(pool.map(one, codes))
    return out


def close_on(rows, day):
    """day(휴장이면 직전 거래일)의 종가. rows는 날짜 오름차순. 없으면 None."""
    if not rows or not day:
        return None
    i = bisect.bisect_right([r[0] for r in rows], day) - 1
    return rows[i][4] if i >= 0 else None


class CloseLookup(object):
    """close_lookup(code, date) 호출 꼴. 종목별 날짜 목록을 한 번만 만든다."""

    def __init__(self, histories):
        self.histories = histories
        self._dates = {code: [r[0] for r in rows] for code, rows in histories.items()}

    def __call__(self, code, day):
        rows = self.histories.get(code)
        if not rows or not day:
            return None
        i = bisect.bisect_right(self._dates[code], day) - 1
        return rows[i][4] if i >= 0 else None


def compute_item(rec, rows, close=None):
    """레코드 하나의 성과 {paw, max, min, hit}. 계산할 수 없으면 None.

    paw: trusted_paw(price_at_write가 종가와 2배 넘게 다르면 종가). max/min: 발간일 다음
    거래일부터 마지막 날까지 고가 최댓값·저가 최솟값(그런 날이 없으면 None).
    hit: 그 구간에서 고가가 목표가 이상이 된 첫 날짜 또는 None.
    """
    target = rec.get("target")
    day = rec.get("date")
    if not target or not day or not rows:
        return None
    if close is None:
        close = close_on(rows, day)
    paw, _ = trusted_paw(rec, close)
    if not paw:
        return None
    after = rows[bisect.bisect_right([r[0] for r in rows], day):]
    hi = max((r[2] for r in after), default=None)
    lo = min((r[3] for r in after), default=None)
    hit = None
    for r in after:
        if r[2] >= target:
            hit = r[0]
            break
    return {"paw": paw, "max": hi, "min": lo, "hit": hit}


def compute_perf(records, histories):
    """{id: {paw, max, min, hit}} — 목표가가 있고 suspect가 아닌 레코드만."""
    items = {}
    for rec in records:
        if rec.get("suspect") or not rec.get("target") or not rec.get("id"):
            continue
        item = compute_item(rec, histories.get(rec.get("code")))
        if item is not None:
            items[rec["id"]] = item
    return items
