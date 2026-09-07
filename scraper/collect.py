"""리포트 레이더 수집기.

네이버 금융 리서치(종목분석)를 1차 소스로 리포트를 모으고,
네이버 실시간 시세로 현재가를, 한경 컨센서스로 애널리스트명을 보강한다.
결과는 data/reports.json (최근 180일 누적), data/meta.json 으로 저장한다.

사용 예:
    python scraper/collect.py                 # 최근 3일 + 가격 갱신
    python scraper/collect.py --days 45       # 초기 백필
    python scraper/collect.py --from 2026-08-01 --to 2026-08-31
    python scraper/collect.py --dry-run --no-hankyung
"""

import argparse
import json
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone

import requests

# 윈도우 기본 콘솔(cp949)에서 한글/기호가 깨지지 않게.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from parsers import (  # noqa: E402
    apply_target_changes,
    compute_gap,
    normalize_broker,
    normalize_rating,
    parse_detail,
    parse_hankyung_list,
    parse_list_last_page,
    parse_list_page,
    parse_price_payload,
)

KST = timezone(timedelta(hours=9))
RETENTION_DAYS = 180
REQUEST_GAP = 0.4
TIMEOUT = 15
RETRIES = 2

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
REPORTS_PATH = os.path.join(DATA_DIR, "reports.json")
META_PATH = os.path.join(DATA_DIR, "meta.json")

BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)

NAVER_LIST = "https://finance.naver.com/research/company_list.naver"
NAVER_READ = "https://finance.naver.com/research/company_read.naver"
PRICE_API = "https://polling.finance.naver.com/api/realtime"
HANKYUNG_LIST = "https://consensus.hankyung.com/analysis/list"


def log(msg):
    print(msg, flush=True)


def make_session():
    s = requests.Session()
    s.headers.update({
        "User-Agent": BROWSER_UA,
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
    })
    return s


def fetch(session, url, params=None, encoding=None, referer=None):
    """실패 시 RETRIES회 재시도. 끝내 실패하면 None."""
    headers = {"Referer": referer} if referer else None
    last = None
    for attempt in range(RETRIES + 1):
        try:
            resp = session.get(url, params=params, timeout=TIMEOUT, headers=headers)
            resp.raise_for_status()
            if encoding:
                # 네이버 리서치는 메타가 utf-8이라 거짓말을 한다. 강제로 디코딩한다.
                return resp.content.decode(encoding, errors="replace")
            return resp.text
        except Exception as exc:  # 네트워크/HTTP 모두 동일 취급
            last = exc
            if attempt < RETRIES:
                time.sleep(0.8 * (attempt + 1))
    log("  ! 요청 실패: %s (%s)" % (url, last))
    return None


# ------------------------------------------------------------ 저장 / 불러오기

def load_reports():
    if not os.path.exists(REPORTS_PATH):
        return []
    try:
        with open(REPORTS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception as exc:
        log("  ! 기존 reports.json을 읽지 못했습니다 (%s). 빈 목록으로 시작합니다." % exc)
        return []


def write_json_atomic(path, payload):
    """임시파일에 쓰고 rename. 중간에 죽어도 반쪽짜리 파일이 남지 않는다."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=0)
    os.replace(tmp, path)


# ------------------------------------------------------------- 네이버 목록

def collect_naver(session, date_from, date_to):
    """기간 내 목록을 페이지 끝까지 훑는다. 목록 요청이 전부 실패하면 None."""
    records = []
    seen = set()
    page = 1
    last_page = None
    any_ok = False

    while page <= 200:
        html = fetch(session, NAVER_LIST, params={
            "searchType": "writeDate",
            "writeFromDate": date_from,
            "writeToDate": date_to,
            "page": page,
        }, encoding="euc-kr")
        if html is None:
            break
        any_ok = True
        rows = parse_list_page(html)
        if not rows:
            break
        # 페이지네이션('맨뒤' 링크 포함)이 알려주는 마지막 페이지를 매번 갱신한다.
        # 한 페이지에 파싱되는 행 수는 30보다 적을 수 있으므로(코드 없는 행 등)
        # 행 수로 마지막 페이지를 판단하면 중간에서 멈춘다.
        seen_last = parse_list_last_page(html)
        if seen_last is not None:
            last_page = seen_last if last_page is None else max(last_page, seen_last)

        fresh = [r for r in rows if r["id"] not in seen]
        if not fresh:
            # 범위를 넘기면 네이버가 같은 페이지를 되돌려준다. 여기서 멈춘다.
            break
        for r in fresh:
            seen.add(r["id"])
        records.extend(fresh)
        if page % 10 == 0 or page == 1:
            log("  목록 p%d/%s: 누적 %d건" % (page, last_page or "?", len(records)))

        if last_page is not None and page >= last_page:
            break
        page += 1
        time.sleep(REQUEST_GAP)

    if not any_ok:
        return None
    return records


def enrich_detail(session, records):
    """상세에서 목표가·투자의견·요약을 채운다. 실패해도 목록 정보는 남긴다."""
    ok = 0
    fail = 0
    total = len(records)
    for i, rec in enumerate(records, 1):
        html = fetch(session, NAVER_READ, params={"nid": rec["nid"], "page": 1},
                     encoding="euc-kr", referer=NAVER_LIST)
        if html is None:
            fail += 1
            rec.setdefault("target", None)
            rec.setdefault("rating_raw", None)
            rec.setdefault("summary", None)
        else:
            detail = parse_detail(html)
            rec["target"] = detail["target"]
            rec["rating_raw"] = detail["rating_raw"]
            rec["summary"] = detail["summary"]
            ok += 1
        if i % 50 == 0 or i == total:
            log("  상세 %d/%d (성공 %d, 실패 %d)" % (i, total, ok, fail))
        time.sleep(REQUEST_GAP)
    return ok, fail


# --------------------------------------------------------------- 한경 보강

def collect_hankyung(session, date_from, date_to):
    """한경 컨센서스 목록. 실패는 경고만 남기고 빈 목록을 돌려준다."""
    out = []
    seen = set()
    for page in range(1, 21):
        html = fetch(session, HANKYUNG_LIST, params={
            "sdate": date_from,
            "edate": date_to,
            "report_type": "CO",
            "pagenum": 80,
            "now_page": page,
        }, referer="https://consensus.hankyung.com/")
        if html is None:
            break
        if "Block access" in html:
            log("  ! 한경 접근이 차단되었습니다 (Block access). 보강을 건너뜁니다.")
            break
        rows = parse_hankyung_list(html)
        # 한 페이지에 80건을 요청해도 종목코드가 없는 행은 걸러지므로 80건보다 적게 잡힌다.
        # 행 수로 끝을 판단하지 말고, 아예 비거나 새 건이 없을 때까지 넘긴다.
        if not rows:
            break
        fresh = [r for r in rows if r["id"] not in seen]
        if not fresh:
            break
        for r in fresh:
            seen.add(r["id"])
        out.extend(fresh)
        time.sleep(REQUEST_GAP)
    return out


def merge_hankyung(naver_records, hk_records):
    """(종목코드, 날짜, 증권사 정규화명)으로 매칭해 analyst만 채운다.

    매칭 안 된 한경 단독 건은 source='hankyung'으로 추가한다.
    돌려주는 값: (보강된 건수, 추가된 레코드 리스트)
    """
    index = {}
    for rec in naver_records:
        key = (rec.get("code"), rec.get("date"), normalize_broker(rec.get("broker")))
        index.setdefault(key, []).append(rec)

    matched = 0
    extras = []
    for hk in hk_records:
        key = (hk["code"], hk["date"], normalize_broker(hk["broker"]))
        targets = index.get(key)
        if targets:
            for rec in targets:
                if not rec.get("analyst") and hk.get("analyst"):
                    rec["analyst"] = hk["analyst"]
            matched += 1
        else:
            extras.append(hk)
    return matched, extras


# ------------------------------------------------------------------ 현재가

def fetch_prices(session, codes):
    prices = {}
    codes = [c for c in codes if c]
    for i in range(0, len(codes), 100):
        chunk = codes[i:i + 100]
        text = fetch(session, PRICE_API,
                     params={"query": "SERVICE_ITEM:" + ",".join(chunk)})
        if text is None:
            continue
        try:
            payload = json.loads(text)
        except ValueError:
            log("  ! 시세 응답이 JSON이 아닙니다. 해당 묶음을 건너뜁니다.")
            continue
        prices.update(parse_price_payload(payload))
        time.sleep(REQUEST_GAP)
    return prices


# --------------------------------------------------------------------- main

def parse_args(argv=None):
    p = argparse.ArgumentParser(description="국내 증권사 종목 리포트 수집기")
    p.add_argument("--days", type=int, default=None,
                   help="오늘 포함 최근 N일 범위를 수집 (기본 3일)")
    p.add_argument("--from", dest="date_from", default=None, help="시작일 YYYY-MM-DD")
    p.add_argument("--to", dest="date_to", default=None, help="종료일 YYYY-MM-DD")
    p.add_argument("--no-hankyung", action="store_true", help="한경 컨센서스 보강 생략")
    p.add_argument("--no-price", action="store_true", help="현재가 갱신 생략")
    p.add_argument("--dry-run", action="store_true", help="저장하지 않고 요약만 출력")
    return p.parse_args(argv)


def resolve_range(args, today):
    if args.date_from or args.date_to:
        d_to = args.date_to or today.isoformat()
        d_from = args.date_from or d_to
        return d_from, d_to
    days = args.days if args.days else 3
    d_to = today
    d_from = today - timedelta(days=max(days, 1) - 1)
    return d_from.isoformat(), d_to.isoformat()


def main(argv=None):
    args = parse_args(argv)
    now = datetime.now(KST)
    today = now.date()
    date_from, date_to = resolve_range(args, today)

    log("리포트 레이더 수집 시작 — 범위 %s ~ %s (KST %s)"
        % (date_from, date_to, now.strftime("%Y-%m-%d %H:%M")))

    session = make_session()

    fetched = collect_naver(session, date_from, date_to)
    if fetched is None:
        log("네이버 목록을 한 건도 받지 못했습니다. 중단합니다.")
        return 1
    log("네이버 목록 %d건" % len(fetched))

    existing = load_reports()
    existing_ids = {r.get("id") for r in existing}
    new_records = [r for r in fetched if r["id"] not in existing_ids]

    # 이전 실행에서 상세를 못 받은 네이버 건(rating_raw가 없음)은 이번 범위 안이면 다시 시도한다.
    retry_records = []
    for rec in existing:
        if rec.get("source") != "naver" or rec.get("rating_raw") is not None:
            continue
        if not (date_from <= (rec.get("date") or "") <= date_to):
            continue
        nid = str(rec.get("id") or "").split(":", 1)[-1]
        if not nid.isdigit():
            continue
        rec["nid"] = nid  # enrich_detail이 쓰는 임시 키. 끝나면 지운다.
        retry_records.append(rec)

    log("신규 %d건, 재시도 %d건 (기존 보관 %d건)"
        % (len(new_records), len(retry_records), len(existing)))

    detail_fail = 0
    detail_targets = new_records + retry_records
    if detail_targets:
        log("상세 수집 중...")
        _, detail_fail = enrich_detail(session, detail_targets)
    for rec in retry_records:
        rec.pop("nid", None)

    # 병합: id 기준 중복 제거, 기존 레코드가 있으면 유지
    merged = {}
    for rec in existing:
        if rec.get("id"):
            merged[rec["id"]] = rec
    for rec in new_records:
        rec.pop("nid", None)
        merged.setdefault(rec["id"], rec)

    records = list(merged.values())

    # 한경 보강. 이번 수집 범위에 해당하는 레코드에만 애널리스트명을 채운다.
    if not args.no_hankyung:
        try:
            hk_records = collect_hankyung(session, date_from, date_to)
            log("한경 컨센서스 %d건" % len(hk_records))
            if hk_records:
                in_range = [r for r in records
                            if date_from <= (r.get("date") or "") <= date_to]
                hk_matched, hk_extras = merge_hankyung(in_range, hk_records)
                hk_extras = [e for e in hk_extras if e["id"] not in merged]
                for extra in hk_extras:
                    merged[extra["id"]] = extra
                    records.append(extra)
                log("한경 매칭 %d건, 단독 추가 %d건" % (hk_matched, len(hk_extras)))
        except Exception as exc:
            log("  ! 한경 보강 실패 (무시하고 진행): %s" % exc)

    # 보관 기간 정리
    cutoff = (today - timedelta(days=RETENTION_DAYS)).isoformat()
    before = len(records)
    records = [r for r in records if (r.get("date") or "") >= cutoff]
    dropped = before - len(records)
    if dropped:
        log("보관 기간(%d일) 지난 %d건 제거" % (RETENTION_DAYS, dropped))

    # 레이팅 정규화 (기존 건도 규칙이 바뀌었을 수 있으니 매번 다시)
    for rec in records:
        rec["rating"] = normalize_rating(rec.get("rating_raw"))
        rec.setdefault("analyst", None)
        rec.setdefault("summary", None)
        rec.setdefault("views", None)
        rec.setdefault("target", None)

    # 현재가 갱신
    if args.no_price:
        log("현재가 갱신 생략")
        for rec in records:
            rec.setdefault("price", None)
            rec.setdefault("price_date", None)
            rec["gap"] = compute_gap(rec.get("target"), rec.get("price"))
    else:
        codes = sorted({r.get("code") for r in records if r.get("code")})
        log("현재가 조회 %d종목..." % len(codes))
        prices = fetch_prices(session, codes)
        log("현재가 %d종목 수신" % len(prices))
        price_date = today.isoformat()
        for rec in records:
            info = prices.get(rec.get("code"))
            if info:
                rec["price"] = info["price"]
                rec["price_date"] = price_date
                if not rec.get("name") and info.get("name"):
                    rec["name"] = info["name"]
            else:
                rec.setdefault("price", None)
                rec.setdefault("price_date", None)
            rec["gap"] = compute_gap(rec.get("target"), rec.get("price"))

    # 목표가 변동은 전체 이력을 놓고 매번 다시 계산한다.
    apply_target_changes(records)

    records.sort(key=lambda r: ((r.get("date") or ""), str(r.get("id") or "")), reverse=True)

    # 필드 순서를 스키마대로 정리
    ordered = []
    for r in records:
        ordered.append({
            "id": r.get("id"), "source": r.get("source"), "date": r.get("date"),
            "code": r.get("code"), "name": r.get("name"), "title": r.get("title"),
            "broker": r.get("broker"), "analyst": r.get("analyst"),
            "rating_raw": r.get("rating_raw"), "rating": r.get("rating"),
            "target": r.get("target"), "prev_target": r.get("prev_target"),
            "target_change": r.get("target_change"),
            "pdf": r.get("pdf"), "url": r.get("url"),
            "summary": r.get("summary"), "views": r.get("views"),
            "price": r.get("price"), "price_date": r.get("price_date"),
            "gap": r.get("gap"),
        })
    records = ordered

    brokers = sorted({r["broker"] for r in records if r.get("broker")})
    dates = [r["date"] for r in records if r.get("date")]
    meta = {
        "updated_at": now.isoformat(timespec="seconds"),
        "count": len(records),
        "latest_date": max(dates) if dates else None,
        "brokers": brokers,
    }

    rating_dist = {}
    for r in records:
        rating_dist[r["rating"]] = rating_dist.get(r["rating"], 0) + 1
    log("총 %d건 | 레이팅 %s | 증권사 %d곳 | 상세 실패 %d건"
        % (len(records), rating_dist, len(brokers), detail_fail))

    if args.dry_run:
        log("--dry-run: 저장하지 않았습니다.")
        return 0

    write_json_atomic(REPORTS_PATH, records)
    write_json_atomic(META_PATH, meta)
    log("저장 완료: %s (%d건), %s" % (REPORTS_PATH, len(records), META_PATH))
    return 0


if __name__ == "__main__":
    sys.exit(main())
