"""소스 정지 경보. data/meta.json 의 source_status 를 보고 멈춘 소스를 찾는다.

2026-09-14 네이버가 페이지를 옮겨 1차 소스가 3일간 0건이었는데 Actions 는 계속
success 였다. 수집이 "성공"해도 알맹이가 없을 수 있으므로 따로 확인한다.

실행:  python scraper/check_sources.py [--data-dir <data 디렉터리>]
       정상이면 exit 0, 멈춘 소스가 있으면 ::error:: 를 찍고 exit 1.
       (GitHub Actions 에서 잡이 실패하면 메일 알림이 온다)
       날짜를 한 번도 얻은 적 없는 소스는 어느 소스든 ::warning:: 만 남긴다(alert_level).
"""

import argparse
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
# 와이즈는 3시간에 한 번만 받지만 영업일 단위로는 다른 소스와 같은 기준을 둔다.
# 직접 수집 2차(iM·BNK·상상인)는 발간이 드물어(BNK는 주 2~3건) 5영업일까지 둔다.
# 씽크풀은 3시간에 한 번 받는 비공식 API라 와이즈와 같은 2영업일을 둔다.
LIMITS = {"naver": 2, "hankyung": 3, "kb": 2, "nh": 2, "kis": 2, "wise": 2,
          "im": 5, "bnk": 5, "sangsangin": 5, "thinkpool": 2}
SOURCES = ("naver", "hankyung", "kb", "nh", "kis", "thinkpool", "wise",
           "im", "bnk", "sangsangin")
# 보조 소스: 멈춰도 잡을 실패시키지 않고 ::warning:: 만 남긴다.
# 직접 수집은 기존 리포트에 PDF 를 붙이는 보강 용도라 없어도 본 기능이 돈다.
# 씽크풀은 빈 칸을 채우고 빠진 리포트를 더하는 보조 소스다(언제든 막힐 수 있는 비공식 API).
# (해외 러너에서 접속이 막히면 매 실행 실패 메일이 오는 것을 막는다)
OPTIONAL = ("im", "bnk", "sangsangin", "thinkpool", "wise")
# 닫힌 소스(와이즈, 2026-11-17 종료·--wise 로만 켬): 날짜를 한 번도 얻지 못했으면 점검하지 않는다.
RETIRED = ("wise",)


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
        # 상위 소스에 흡수돼 자기 이름으로 보관된 건이 없어도, 목록에서 본 최신일이 있으면 그걸 쓴다
        dates = [d for d in (parse_date(st.get("last_date")),
                             parse_date(st.get("fetched_last_date"))) if d]
        last = max(dates) if dates else None
        if last is None and src in RETIRED:
            continue
        if last is None:
            out.append({"source": src, "last_date": None, "limit": limit, "days": None})
            continue
        days = business_days_since(last, today)
        if days >= limit:
            out.append({"source": src, "last_date": last.isoformat(),
                        "limit": limit, "days": days})
    return out


def alert_level(item):
    """'error'(잡 실패) 또는 'warning'.

    - 날짜를 한 번도 얻은 적 없는 소스(last_date·fetched_last_date 모두 없음): 모든 소스 warning.
      새로 붙인 소스가 해외 러너에서 처음부터 막히면 매 실행 실패 메일이 오는 것을 막는다.
    - 날짜를 얻다가 멈춘 소스: 필수 소스는 error, OPTIONAL 은 warning.
    """
    if item.get("last_date") is None:
        return "warning"
    return "warning" if item["source"] in OPTIONAL else "error"


def alert_lines(bad, status=None):
    """(출력할 ::error::/::warning:: 줄 목록, 잡을 실패시킬지)."""
    status = status or {}
    lines = []
    failed = False
    for item in bad:
        level = alert_level(item)
        failed = failed or level == "error"
        st = status.get(item["source"])
        err = st.get("error") if isinstance(st, dict) else None
        why = " (마지막 시도 실패: %s)" % err if err else ""
        if item["last_date"]:
            lines.append("::%s::소스 %s: 최근 리포트 %s, %d영업일 이상 신규 없음%s"
                         % (level, item["source"], item["last_date"], item["limit"], why))
        else:
            lines.append("::%s::소스 %s: 수집된 리포트가 아직 없음%s"
                         % (level, item["source"], why))
    return lines, failed


def main(argv=None):
    p = argparse.ArgumentParser(description="소스 정지 경보")
    p.add_argument("--data-dir", default=None, help="data 디렉터리 (기본: 저장소의 data/)")
    args = p.parse_args(argv)
    meta_path = (os.path.join(os.path.abspath(args.data_dir), "meta.json")
                 if args.data_dir else META_PATH)
    try:
        with open(meta_path, encoding="utf-8") as f:
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
        print("  %-8s 최신 %s | 보관 %s건%s"
              % (src, st.get("last_date") or "-", st.get("total", 0),
                 " | 마지막 시도 %s 실패: %s" % (st.get("tried_at") or "-", st["error"])
                 if st.get("error") else ""))

    lines, failed = alert_lines(bad, status)
    for line in lines:
        print(line)
    if failed:
        return 1
    print("소스 점검 통과 (%s 기준)%s"
          % (today.isoformat(), " — 경고 있음" if bad else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
