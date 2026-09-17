"""소스 정지 경보. data/meta.json 의 source_status 를 보고 멈춘 소스를 찾는다.

2026-09-14 네이버가 페이지를 옮겨 1차 소스가 3일간 0건이었는데 Actions 는 계속
success 였다. 수집이 "성공"해도 알맹이가 없을 수 있으므로 따로 확인한다.

실행:  python scraper/check_sources.py
       정상이면 exit 0, 멈춘 소스가 있으면 ::error:: 를 찍고 exit 1.
       (GitHub Actions 에서 잡이 실패하면 메일 알림이 온다)
"""

import json
import os
import sys
from datetime import datetime, timedelta, timezone

# 윈도우 기본 콘솔(cp949)에서 한글이 깨지지 않게.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

KST = timezone(timedelta(hours=9))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
META_PATH = os.path.join(ROOT, "data", "meta.json")

# 소스별 허용 공백(영업일). 한경은 갱신이 하루 늦게 붙는 날이 있어 하루 더 준다.
LIMITS = {"naver": 2, "hankyung": 3, "kb": 2, "nh": 2, "kis": 2}
SOURCES = ("naver", "hankyung", "kb", "nh", "kis")


def parse_date(s):
    try:
        return datetime.strptime(str(s), "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


def business_days_since(last, today):
    """last 다음날부터 today 까지의 영업일 수(주말 제외). last >= today 면 0."""
    n = 0
    d = last + timedelta(days=1)
    while d <= today:
        if d.weekday() < 5:
            n += 1
        d += timedelta(days=1)
    return n


def stale_sources(status, today):
    """멈춘 소스 목록. [{"source", "last_date", "limit", "days"}, ...]

    오늘이 주말이면 늘 빈 목록이다 (주말엔 리포트가 안 나온다).
    """
    if today.weekday() >= 5:
        return []
    status = status or {}
    out = []
    for src in SOURCES:
        st = status.get(src)
        if not isinstance(st, dict):
            continue
        limit = LIMITS.get(src, 2)
        last = parse_date(st.get("last_date"))
        if last is None:
            out.append({"source": src, "last_date": None, "limit": limit, "days": None})
            continue
        days = business_days_since(last, today)
        if days >= limit:
            out.append({"source": src, "last_date": st.get("last_date"),
                        "limit": limit, "days": days})
    return out


def main(argv=None):
    try:
        with open(META_PATH, encoding="utf-8") as f:
            meta = json.load(f)
    except (OSError, ValueError) as exc:
        print("::error::meta.json 을 읽지 못했습니다: %s" % exc)
        return 1

    status = meta.get("source_status")
    if not isinstance(status, dict) or not status:
        print("::error::meta.json 에 source_status 가 없습니다 — "
              "scraper/collect.py 를 먼저 실행하세요")
        return 1

    today = datetime.now(KST).date()
    if today.weekday() >= 5:
        print("주말(%s) — 소스 점검 생략" % today.isoformat())
        return 0

    bad = stale_sources(status, today)
    for src in SOURCES:
        st = status.get(src)
        if not isinstance(st, dict):
            continue
        print("  %-8s 최신 %s | 보관 %s건"
              % (src, st.get("last_date") or "-", st.get("total", 0)))

    if not bad:
        print("소스 점검 통과 (%s 기준)" % today.isoformat())
        return 0

    for item in bad:
        if item["last_date"]:
            print("::error::소스 %s: 최근 리포트 %s, %d영업일 이상 신규 없음"
                  % (item["source"], item["last_date"], item["limit"]))
        else:
            print("::error::소스 %s: 보관된 리포트가 없음" % item["source"])
    return 1


if __name__ == "__main__":
    sys.exit(main())
