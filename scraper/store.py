"""리포트 레이더 — 데이터 파일 읽기/쓰기 (형식 v2, docs/DATA-FORMAT-v2.md).

    data/reports/YYYY-MM.json    그 달 리포트 레코드 (요약·현재가 제외)
    data/summaries/YYYY-MM.json  {id: 요약}
    data/prices.json             {updated_at, prices: {code: {p, d}}}
    data/meta.json               updated_at·count·… + data_version·months·prices_v

v1(data/reports.json 한 파일)은 load_v1로 읽고, 처음 v2로 저장한 뒤 지운다.
내용이 바뀐 파일만 다시 쓴다(바이트 비교). 키 순서·레코드 순서를 고정해
같은 데이터면 늘 같은 바이트가 나오게 한다.

    data/industry/YYYY-MM.json   산업·시황 리포트 (meta.industry_months)
    data/perf.json               {updated_at, items: {id: {paw, max, min, hit}}} (meta.perf_v)
"""

import hashlib
import json
import os
import re

DATA_VERSION = 2

# 레코드 필드 순서 (docs/DATA-FORMAT-v2.md). summary·price·price_date·gap은 v2에서 뺐다.
RECORD_FIELDS = (
    "id", "source", "date", "code", "name", "industry", "sector", "title",
    "broker", "analyst", "rating_raw", "rating", "target", "prev_target",
    "target_change", "naver_prev_target", "price_at_write", "pdf", "url", "views",
)
# 값이 있을 때만 쓰는 필드. detail_tries는 수집기 내부용(상세 재시도 횟수)이다.
# direct는 이 레코드에 붙은 증권사 직접 수집 2차 건의 id(예 "im:15078")다.
OPTIONAL_FIELDS = ("suspect", "rating_inferred", "has_summary", "detail_tries", "direct")

_MONTH_FILE = re.compile(r"^(\d{4}-\d{2})\.json$")


class Layout(object):
    """data 디렉터리 안의 경로 모음. 테스트에서 임시 디렉터리를 넘길 수 있게 묶었다."""

    def __init__(self, data_dir):
        self.data_dir = data_dir
        self.reports_dir = os.path.join(data_dir, "reports")
        self.summaries_dir = os.path.join(data_dir, "summaries")
        self.prices_path = os.path.join(data_dir, "prices.json")
        self.meta_path = os.path.join(data_dir, "meta.json")
        self.v1_path = os.path.join(data_dir, "reports.json")
        self.industry_dir = os.path.join(data_dir, "industry")
        self.perf_path = os.path.join(data_dir, "perf.json")

    def month_path(self, month):
        return os.path.join(self.reports_dir, "%s.json" % month)

    def industry_path(self, month):
        return os.path.join(self.industry_dir, "%s.json" % month)

    def summary_path(self, month):
        return os.path.join(self.summaries_dir, "%s.json" % month)

    def is_v2(self):
        return bool(list_months(self.reports_dir))


# ------------------------------------------------------------------ 직렬화

def _dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def sort_records(records):
    """날짜 내림차순, 같은 날이면 id 내림차순 (v1과 같은 순서)."""
    records.sort(key=lambda r: ((r.get("date") or ""), str(r.get("id") or "")),
                 reverse=True)
    return records


def record_for_file(rec, has_summary):
    out = {}
    for key in RECORD_FIELDS:
        out[key] = rec.get(key)
    for key in OPTIONAL_FIELDS:
        if key == "has_summary":
            if has_summary:
                out["has_summary"] = True
            continue
        value = rec.get(key)
        if value not in (None, False, 0, ""):
            out[key] = value
    return out


def encode_month(records):
    """(리포트 파일 바이트, 요약 파일 바이트). records는 이미 정렬돼 있어야 한다.

    한 줄에 한 레코드. 사람이 diff를 읽기 쉽고 들여쓰기보다 작다.
    """
    lines = []
    summaries = []
    for rec in records:
        summary = rec.get("summary")
        lines.append(_dumps(record_for_file(rec, bool(summary))))
        if summary:
            summaries.append("%s:%s" % (_dumps(str(rec.get("id"))), _dumps(summary)))
    reports = "[\n" + ",\n".join(lines) + "\n]\n" if lines else "[]\n"
    sums = "{\n" + ",\n".join(summaries) + "\n}\n" if summaries else "{}\n"
    return reports.encode("utf-8"), sums.encode("utf-8")


def encode_prices(updated_at, prices):
    """prices: {code: {"p": int, "d": "YYYY-MM-DD"}}. 종목코드 순으로 한 줄씩."""
    lines = ["%s:%s" % (_dumps(code), _dumps({"p": prices[code].get("p"),
                                              "d": prices[code].get("d")}))
             for code in sorted(prices)]
    body = "{\n" + ",\n".join(lines) + "\n}" if lines else "{}"
    text = '{\n"updated_at":%s,\n"prices":%s\n}\n' % (_dumps(updated_at), body)
    return text.encode("utf-8")


def encode_meta(meta):
    return (json.dumps(meta, ensure_ascii=False, indent=0) + "\n").encode("utf-8")


def content_version(data):
    """파일 내용의 sha1 앞 10자. 앱이 ?v= 캐시 키로 쓴다."""
    return hashlib.sha1(data).hexdigest()[:10]


def write_bytes_if_changed(path, data):
    """내용이 같으면 건드리지 않는다. 바뀌었으면 임시파일에 쓰고 rename. 썼으면 True."""
    try:
        with open(path, "rb") as f:
            if f.read() == data:
                return False
    except OSError:
        pass
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)
    return True


# ------------------------------------------------------------------ 읽기

def list_months(directory):
    """디렉터리 안의 'YYYY-MM' 목록(오름차순). 없으면 빈 목록."""
    if not os.path.isdir(directory):
        return []
    return sorted(m.group(1) for m in (_MONTH_FILE.match(n) for n in os.listdir(directory))
                  if m)


def _read_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def load_v1(layout):
    """v1 reports.json -> (레코드 리스트, {code: {"p", "d"}}). 없거나 깨졌으면 ([], {})."""
    data = _read_json(layout.v1_path, [])
    if not isinstance(data, list):
        return [], {}
    records = []
    prices = {}
    for rec in data:
        if not isinstance(rec, dict) or not rec.get("id"):
            continue
        code = rec.get("code")
        if code and rec.get("price"):
            prev = prices.get(code)
            if prev is None or (rec.get("price_date") or "") >= (prev.get("d") or ""):
                prices[code] = {"p": rec["price"], "d": rec.get("price_date")}
        for key in ("price", "price_date", "gap"):
            rec.pop(key, None)
        records.append(rec)
    return records, prices


def load_v2(layout):
    """월별 파일 전부 -> 레코드 리스트. 요약은 summary 키로 붙여 돌려준다."""
    records = []
    for month in list_months(layout.reports_dir):
        rows = _read_json(layout.month_path(month), [])
        sums = _read_json(layout.summary_path(month), {})
        if not isinstance(sums, dict):
            sums = {}
        for rec in rows if isinstance(rows, list) else []:
            if not isinstance(rec, dict) or not rec.get("id"):
                continue
            rec.pop("has_summary", None)
            rec["summary"] = sums.get(rec["id"])
            records.append(rec)
    return records


def load_prices(layout):
    data = _read_json(layout.prices_path, {})
    prices = data.get("prices") if isinstance(data, dict) else None
    return prices if isinstance(prices, dict) else {}


# ------------------------------------------------------------------ 쓰기

def load_meta(layout):
    """이전 실행의 meta.json. 없거나 깨졌으면 {}."""
    data = _read_json(layout.meta_path, {})
    return data if isinstance(data, dict) else {}


# ------------------------------------------------------------ 산업·시황 리포트

# 산업·시황 레코드 필드 순서 (docs/DATA-FORMAT-v2.md)
INDUSTRY_FIELDS = ("id", "kind", "date", "title", "broker", "analyst", "category",
                   "pdf", "url", "views")


def load_industry(layout):
    """data/industry/ 월별 파일 전부 -> 레코드 리스트."""
    rows = []
    for month in list_months(layout.industry_dir):
        data = _read_json(layout.industry_path(month), [])
        for rec in data if isinstance(data, list) else []:
            if isinstance(rec, dict) and rec.get("id"):
                rows.append(rec)
    return rows


def encode_industry_month(rows):
    lines = [_dumps({k: rec.get(k) for k in INDUSTRY_FIELDS}) for rec in rows]
    return ("[\n" + ",\n".join(lines) + "\n]\n" if lines else "[]\n").encode("utf-8")


def save_industry(layout, rows):
    """산업·시황 레코드를 달별로 저장한다. (바뀐 파일 경로 목록, industry_months).

    rows에 없는 달의 파일은 지운다(보관 기간 정리). industry_months는 최신 달이 먼저.
    """
    by_month = {}
    for rec in rows:
        month = (rec.get("date") or "")[:7]
        if re.fullmatch(r"\d{4}-\d{2}", month):
            by_month.setdefault(month, []).append(rec)
    changed = []
    months_meta = []
    for month in sorted(by_month, reverse=True):
        items = sort_records(by_month[month])
        data = encode_industry_month(items)
        if write_bytes_if_changed(layout.industry_path(month), data):
            changed.append(layout.industry_path(month))
        months_meta.append({"month": month, "count": len(items), "v": content_version(data)})
    for month in list_months(layout.industry_dir):
        if month not in by_month:
            path = layout.industry_path(month)
            os.remove(path)
            changed.append(path)
    return changed, months_meta


# ------------------------------------------------------------------ 성과

def encode_perf(updated_at, items):
    """items: {id: {"paw", "max", "min", "hit"}}. id 순으로 한 줄씩."""
    lines = ["%s:%s" % (_dumps(rid), _dumps({"paw": items[rid].get("paw"),
                                             "max": items[rid].get("max"),
                                             "min": items[rid].get("min"),
                                             "hit": items[rid].get("hit")}))
             for rid in sorted(items)]
    body = "{\n" + ",\n".join(lines) + "\n}" if lines else "{}"
    text = '{\n"updated_at":%s,\n"items":%s\n}\n' % (_dumps(updated_at), body)
    return text.encode("utf-8")


def load_perf(layout):
    """perf.json -> (updated_at 문자열 또는 None, 파일 바이트 또는 None)."""
    try:
        with open(layout.perf_path, "rb") as f:
            raw = f.read()
    except OSError:
        return None, None
    try:
        data = json.loads(raw.decode("utf-8"))
    except ValueError:
        return None, raw
    return (data.get("updated_at") if isinstance(data, dict) else None), raw


def save_perf(layout, updated_at, items):
    """perf.json을 쓴다. (썼으면 True, perf_v)."""
    data = encode_perf(updated_at, items)
    return write_bytes_if_changed(layout.perf_path, data), content_version(data)


# ------------------------------------------------------------------ 저장

def save_v2(layout, records, prices, meta_base, prices_updated_at, meta_extra=None):
    """레코드·가격·메타를 v2로 저장한다. 바뀐 파일 경로 목록과 meta를 돌려준다.

    records에 없는 달의 파일은 지운다(보관 기간 정리). v1 reports.json이 있으면 지운다.
    meta_base: updated_at·count·latest_date·brokers·source_status 등 기존 필드.
    meta_extra: prices_v 뒤에 붙일 필드(perf_v·industry_months). 값이 None이면 뺀다.
    """
    by_month = {}
    for rec in records:
        month = (rec.get("date") or "")[:7]
        if not re.fullmatch(r"\d{4}-\d{2}", month):
            continue
        by_month.setdefault(month, []).append(rec)

    changed = []
    months_meta = []
    for month in sorted(by_month, reverse=True):
        rows = sort_records(by_month[month])
        rep_bytes, sum_bytes = encode_month(rows)
        if write_bytes_if_changed(layout.month_path(month), rep_bytes):
            changed.append(layout.month_path(month))
        if write_bytes_if_changed(layout.summary_path(month), sum_bytes):
            changed.append(layout.summary_path(month))
        months_meta.append({"month": month, "count": len(rows),
                            "v": content_version(rep_bytes),
                            "sv": content_version(sum_bytes)})

    keep = set(by_month)
    for directory in (layout.reports_dir, layout.summaries_dir):
        for month in list_months(directory):
            if month not in keep:
                path = os.path.join(directory, "%s.json" % month)
                os.remove(path)
                changed.append(path)

    price_bytes = encode_prices(prices_updated_at, prices)
    if write_bytes_if_changed(layout.prices_path, price_bytes):
        changed.append(layout.prices_path)

    meta = dict(meta_base)
    meta["data_version"] = DATA_VERSION
    meta["months"] = months_meta
    meta["prices_v"] = content_version(price_bytes)
    for key, value in (meta_extra or {}).items():
        if value is not None:
            meta[key] = value
    if write_bytes_if_changed(layout.meta_path, encode_meta(meta)):
        changed.append(layout.meta_path)

    if os.path.exists(layout.v1_path):
        os.remove(layout.v1_path)
        changed.append(layout.v1_path)
    return changed, meta
