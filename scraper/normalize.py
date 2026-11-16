"""리포트 레이더 — 저장 전 정규화 패스.

네트워크를 타지 않는 순수 함수만 둔다. 수집기(collect.py)가 매 실행마다 전체 레코드에
돌리고, 테스트(test_parsers.py)가 픽스처로 검증한다. 같은 입력에 몇 번을 돌려도
결과가 같아야 한다(멱등).

- drop_or_flag_name_is_broker: 종목명이 증권사 자신인 건 (한경은 버리고, 나머지는 suspect)
- dedupe_records: 같은 (code, date, 증권사) 중복 병합
- infer_ratings: 목표가는 있는데 의견이 NR인 건에 직전 의견 승계
- evaluate_target_range: 목표가가 기준가의 0.3~3.5배 밖이면 suspect (건당 한 번만 판정)
- reparse_nh_targets: NH 요약에서 목표가를 다시 읽기 (v1 → v2 이전 때 한 번)
- absorb_wise: 상위 소스에 이미 있는 와이즈 건을 지우고 빈 칸(애널리스트 등)만 채움
- absorb_direct: 직접 수집 2차(iM·BNK·상상인) 건을 같은 리포트의 네이버·와이즈·한경 레코드에 붙임
- reevaluate_target_range_with_closes: 발간일 종가로 목표가 범위 재판정 (성과 단계)
"""

import difflib
import re
from datetime import date, timedelta

from parsers import (
    extract_opinion_from_text,
    name_is_broker,
    normalize_broker,
    normalize_rating,
)

# 소스 우선순위. 숫자가 작을수록 위다. 중복을 합칠 때 위쪽 레코드를 남긴다.
SOURCE_PRIORITY = {"naver": 0, "kb": 1, "nh": 1, "kis": 1, "im": 1, "bnk": 1, "sangsangin": 1,
                   "wise": 2, "hankyung": 3}
# 증권사 사이트 직접 수집 2차(direct.py). 같은 리포트가 네이버·와이즈·한경에 있으면 그쪽에 붙는다.
DIRECT_SOURCES = ("im", "bnk", "sangsangin")
DIRECT_ATTACH_SOURCES = ("naver", "wise", "hankyung")
# 와이즈·한경 목표가를 직접 수집 값으로 바꾸는 상한. 두 값이 이 배수 넘게 다르면 PDF를 잘못 읽었을
# 가능성이 커서 바꾸지 않고 로그만 남긴다.
DIRECT_OVERRIDE_FACTOR = 2.0
# 와이즈 레코드가 같은 리포트를 찾았을 때 남는 쪽의 빈 칸을 채우는 필드.
WISE_FILL_FIELDS = ("analyst", "target", "rating_raw", "summary")
# 와이즈 작성일이 다른 소스와 하루이틀 어긋나는 일이 있다(실측 500건 중 11건).
WISE_DATE_WINDOW_DAYS = 3
# 제목 유사도(공백·문장부호를 뗀 문자열의 difflib 비율) 하한.
WISE_TITLE_RATIO = 0.8
# 발간일 종가와 네이버 price_at_write가 이 배수 넘게 다르면 종가를 믿는다.
PAW_TRUST_FACTOR = 2.0
# 병합할 때 남기는 쪽이 비어 있으면 다른 쪽에서 채우는 필드.
FILL_FIELDS = ("analyst", "target", "rating_raw", "summary", "pdf", "price_at_write")

SUSPECT_NAME_IS_BROKER = "name_is_broker"
SUSPECT_TARGET_RANGE = "target_range"
TARGET_RATIO_MIN = 0.3
TARGET_RATIO_MAX = 3.5
# 기준가: 본인 price_at_write → 같은 종목 다른 리포트의 price_at_write(이 일수 안) → 현재가.
REF_PRICE_WINDOW_DAYS = 7

_ELLIPSIS = re.compile(r"(?:\.{2,}|…)\s*$")
_NON_WORD = re.compile(r"[\W_]+", re.UNICODE)


def _priority(rec):
    return SOURCE_PRIORITY.get(rec.get("source"), 3)


def title_key(title):
    """공백·문장부호를 걷어 낸 비교용 제목."""
    return _NON_WORD.sub("", str(title or "")).lower()


def titles_match(a, b):
    """공백·문장부호를 빼고 같으면 True.

    목록에서 잘린 제목('… 다시 내일을 논하..')은 말줄임을 떼고 앞부분이 같으면 같다고 본다.
    """
    ka, kb = title_key(a), title_key(b)
    if not ka or not kb:
        return False
    if ka == kb:
        return True
    cut_a = bool(_ELLIPSIS.search(str(a or "")))
    cut_b = bool(_ELLIPSIS.search(str(b or "")))
    if cut_a and len(ka) >= 4 and kb.startswith(ka):
        return True
    if cut_b and len(kb) >= 4 and ka.startswith(kb):
        return True
    return False


def _completeness(rec):
    return sum(1 for f in FILL_FIELDS if rec.get(f))


def _fill(keep, other):
    for field in FILL_FIELDS:
        if not keep.get(field) and other.get(field):
            keep[field] = other[field]


def dedupe_records(records):
    """같은 (code, date, 정규화한 broker)를 한 건으로 합친다. (남은 레코드, 합쳐 없앤 건수).

    - 제목이 같으면(공백·문장부호 무시) 한 리포트로 보고 합친다.
    - 같은 소스에서 제목이 다르면 둘 다 남긴다 (하루에 두 편 내는 경우: 리뷰 + 컨콜 요약).
    - 다른 소스끼리 제목이 다르면, 한쪽이 한경일 때만 같은 리포트로 본다
      (한경은 제목을 손봐서 올리는 일이 잦다). 한경 한 건은 가장 비슷한 제목 하나에만 붙는다.
    남기는 쪽은 소스 우선순위(naver > kb/nh/kis > wise > hankyung), 같으면 빈 칸이 적은 쪽,
    그래도 같으면 id가 작은 쪽이다. 남는 쪽의 빈 필드는 합쳐지는 쪽에서 채운다.
    """
    groups = {}
    order = []
    for rec in records:
        key = (rec.get("code"), rec.get("date"), normalize_broker(rec.get("broker")))
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(rec)

    out = []
    merged = 0
    for key in order:
        items = groups[key]
        if len(items) == 1:
            out.append(items[0])
            continue
        items = sorted(items, key=lambda r: (_priority(r), -_completeness(r),
                                             str(r.get("id") or "")))
        clusters = []  # [{"keep": rec, "members": [rec...], "hk_fuzzy": bool}]
        pending_hk = []
        for rec in items:
            home = None
            for cl in clusters:
                if titles_match(cl["keep"].get("title"), rec.get("title")):
                    home = cl
                    break
            if home is None and rec.get("source") == "hankyung":
                pending_hk.append(rec)
                continue
            if home is None:
                clusters.append({"keep": rec, "members": [rec], "hk_fuzzy": False})
            else:
                home["members"].append(rec)
        # 제목이 안 맞는 한경 건: 한경 아닌 묶음 중 가장 비슷한 제목에 붙인다.
        for rec in pending_hk:
            cands = [cl for cl in clusters
                     if cl["keep"].get("source") != "hankyung" and not cl["hk_fuzzy"]
                     and not any(m.get("source") == "hankyung" for m in cl["members"])]
            if cands:
                tk = title_key(rec.get("title"))
                best = max(cands, key=lambda cl: difflib.SequenceMatcher(
                    None, title_key(cl["keep"].get("title")), tk).ratio())
                best["members"].append(rec)
                best["hk_fuzzy"] = True
            else:
                home = None
                for cl in clusters:
                    if titles_match(cl["keep"].get("title"), rec.get("title")):
                        home = cl
                        break
                if home is None:
                    clusters.append({"keep": rec, "members": [rec], "hk_fuzzy": False})
                else:
                    home["members"].append(rec)
        for cl in clusters:
            keep = cl["keep"]
            for other in cl["members"]:
                if other is keep:
                    continue
                _fill(keep, other)
                merged += 1
            out.append(keep)
    return out, merged


def drop_or_flag_name_is_broker(records):
    """종목명이 증권사 자신인 건. 한경 소스는 버리고, 나머지는 suspect로 표시한다.

    (남은 레코드, 버린 건수, 표시한 건수). suspect가 이 사유였는데 더 이상 해당하지 않으면 지운다.
    """
    out = []
    dropped = 0
    flagged = 0
    for rec in records:
        hit = name_is_broker(rec.get("name"), rec.get("broker"), rec.get("title"))
        if hit and rec.get("source") == "hankyung":
            dropped += 1
            continue
        if hit:
            rec["suspect"] = SUSPECT_NAME_IS_BROKER
            flagged += 1
        elif rec.get("suspect") == SUSPECT_NAME_IS_BROKER:
            rec.pop("suspect", None)
        out.append(rec)
    return out, dropped, flagged


def infer_ratings(records):
    """목표가는 있는데 의견이 NR인 건에 같은 (code, broker)의 직전 의견을 잇는다.

    rating을 rating_raw에서 다시 계산한 뒤에 돌린다. 직전 = 작성일이 더 이른 건 중 가장 최근,
    원문 의견이 NR이 아닌 것. 이어받으면 rating_inferred=True. 승계한 건수를 돌려준다.
    """
    for rec in records:
        rec.pop("rating_inferred", None)
    groups = {}
    for rec in records:
        key = (rec.get("code"), normalize_broker(rec.get("broker")))
        groups.setdefault(key, []).append(rec)

    count = 0
    for items in groups.values():
        items.sort(key=lambda r: ((r.get("date") or ""), str(r.get("id") or "")))
        last = None  # (date, rating) — 원문 의견이 있는 가장 최근 건
        pending = []
        for rec in items:
            d = rec.get("date") or ""
            # 같은 날짜 건은 '직전'이 아니므로, 날짜가 바뀔 때 last를 확정한다.
            if pending and pending[0][0] != d:
                last = pending[-1]
                pending = []
            if rec.get("target") and rec.get("rating") == "NR" and last is not None:
                rec["rating"] = last[1]
                rec["rating_inferred"] = True
                count += 1
            if rec.get("rating") and rec.get("rating") != "NR" and not rec.get("rating_inferred"):
                pending.append((d, rec["rating"]))
    return count


def _parse_day(value):
    try:
        y, m, d = str(value).split("-")
        return date(int(y), int(m), int(d))
    except (ValueError, TypeError):
        return None


def reference_price(rec, paw_by_code, current_price):
    """목표가 범위 판정에 쓰는 기준가와 그 출처.

    1) 본인 price_at_write, 2) 같은 종목 다른 리포트의 price_at_write 중 작성일이
    REF_PRICE_WINDOW_DAYS 안에서 가장 가까운 것, 3) 판정 시점의 현재가.
    """
    if rec.get("price_at_write"):
        return rec["price_at_write"], "own"
    day = _parse_day(rec.get("date"))
    best = None
    if day is not None:
        for other_day, paw in paw_by_code.get(rec.get("code"), ()):
            gap = abs((other_day - day).days)
            if gap <= REF_PRICE_WINDOW_DAYS and (best is None or gap < best[0]):
                best = (gap, paw)
    if best is not None:
        return best[1], "near"
    if current_price:
        return current_price, "current"
    return None, None


def build_paw_index(records):
    """{code: [(date, price_at_write), ...]} — reference_price의 2단계용."""
    idx = {}
    for rec in records:
        paw = rec.get("price_at_write")
        day = _parse_day(rec.get("date"))
        if paw and day is not None:
            idx.setdefault(rec.get("code"), []).append((day, paw))
    return idx


def evaluate_target_range(records, ids, current_prices):
    """ids에 든 레코드만 목표가 범위를 판정해 suspect를 붙이거나 뗀다.

    판정은 레코드마다 한 번(처음 모았을 때, 목표가가 바뀌었을 때, v2 이전 때)만 하고
    결과는 레코드에 남긴다. 나중 실행에서 주가가 움직여도 다시 판정하지 않는다.
    name_is_broker가 이미 붙은 건은 건드리지 않는다.
    current_prices: {code: 가격}. 돌려주는 값: {"own": n, "near": n, "current": n,
    "none": n, "flagged": n}
    """
    stats = {"own": 0, "near": 0, "current": 0, "none": 0, "flagged": 0}
    paw_idx = build_paw_index(records)
    for rec in records:
        if rec.get("id") not in ids:
            continue
        if rec.get("suspect") == SUSPECT_NAME_IS_BROKER:
            continue
        if rec.get("suspect") == SUSPECT_TARGET_RANGE:
            rec.pop("suspect", None)
        target = rec.get("target")
        if not target:
            continue
        ref, how = reference_price(rec, paw_idx, current_prices.get(rec.get("code")))
        if not ref:
            stats["none"] += 1
            continue
        stats[how] += 1
        ratio = float(target) / float(ref)
        if ratio < TARGET_RATIO_MIN or ratio > TARGET_RATIO_MAX:
            rec["suspect"] = SUSPECT_TARGET_RANGE
            stats["flagged"] += 1
    return stats


_HANGUL = re.compile(r"[가-힣]")


def wise_title_score(wise_title, other_title):
    """와이즈 제목과 다른 소스 제목이 같은 리포트로 보이는 정도 (0이면 다름).

    1.0  titles_match (공백·문장부호 무시 일치, 말줄임 앞부분 일치)
    0.95 한쪽이 다른 쪽을 품음 ('[AI 실적속보] X' ↔ 'X', '3Q26 Review: X' ↔ 'X'), 6자 이상
    r    difflib 비율 r >= WISE_TITLE_RATIO (오탈자·따옴표 차이)
    """
    if titles_match(wise_title, other_title):
        return 1.0
    ka, kb = title_key(wise_title), title_key(other_title)
    if not ka or not kb:
        return 0.0
    short, long_ = sorted((ka, kb), key=len)
    if len(short) >= 6 and short in long_:
        return 0.95
    ratio = difflib.SequenceMatcher(None, ka, kb).ratio()
    return ratio if ratio >= WISE_TITLE_RATIO else 0.0


def _wise_match(wise, cands):
    """같은 (종목, 증권사)의 상위 소스 후보 중 같은 리포트를 고른다. 없으면 None.

    - 제목 점수(wise_title_score)가 있으면 점수 → 날짜 차이 → 소스 우선순위 순.
    - 제목이 안 맞아도 와이즈 제목에 한글이 없으면(영문판) 번역본으로 본다:
      같은 날 한글 제목 리포트, 또는 WISE_DATE_WINDOW_DAYS 안에서 목표가가 같은 한글 제목 리포트.
    """
    wday = _parse_day(wise.get("date"))
    if wday is None:
        return None
    english = not _HANGUL.search(str(wise.get("title") or ""))
    best = None
    for rec in cands:
        rday = _parse_day(rec.get("date"))
        if rday is None:
            continue
        gap = abs((rday - wday).days)
        if gap > WISE_DATE_WINDOW_DAYS:
            continue
        score = wise_title_score(wise.get("title"), rec.get("title"))
        if not score and english and _HANGUL.search(str(rec.get("title") or "")):
            if gap == 0:
                score = 0.5
            elif wise.get("target") and wise.get("target") == rec.get("target"):
                score = 0.4
        if not score:
            continue
        key = (score, -gap, -_priority(rec), str(rec.get("id") or ""))
        if best is None or key > best[0]:
            best = (key, rec)
    return best[1] if best else None


def absorb_wise(records):
    """와이즈 레코드 중 상위 소스(naver·kb·nh·kis)에 이미 있는 리포트는 지우고 빈 칸만 채운다.

    같은 (종목코드, 정규화한 증권사)에서 작성일이 WISE_DATE_WINDOW_DAYS 안이고 제목이 같은
    리포트로 보이면(_wise_match) 같은 리포트다. 남는 쪽의 비어 있는 analyst·target·rating_raw·
    summary를 와이즈 값으로 채운다. 한경은 와이즈보다 아래라 여기서 건드리지 않는다(dedupe_records가 처리).
    매 실행 전체에 돌려도 결과가 같다(와이즈 건은 흡수되면 사라지고, 빈 칸만 채운다).

    돌려주는 값: (남은 레코드, {"absorbed": n, "filled_records": n, "filled": {필드: n}})
    """
    stats = {"absorbed": 0, "filled_records": 0, "filled": {f: 0 for f in WISE_FILL_FIELDS}}
    upper = {}
    for rec in records:
        if _priority(rec) < SOURCE_PRIORITY["wise"]:
            key = (rec.get("code"), normalize_broker(rec.get("broker")))
            upper.setdefault(key, []).append(rec)
    out = []
    for rec in records:
        if rec.get("source") != "wise":
            out.append(rec)
            continue
        cands = upper.get((rec.get("code"), normalize_broker(rec.get("broker"))))
        keep = _wise_match(rec, cands) if cands else None
        if keep is None:
            out.append(rec)
            continue
        stats["absorbed"] += 1
        any_fill = False
        for field in WISE_FILL_FIELDS:
            if not keep.get(field) and rec.get(field):
                keep[field] = rec[field]
                stats["filled"][field] += 1
                any_fill = True
        if any_fill:
            stats["filled_records"] += 1
    return out, stats


def direct_match_index(records):
    """{(code, 정규화 broker): [naver·wise·한경 레코드]} — match_direct의 후보 색인."""
    idx = {}
    for rec in records:
        if rec.get("source") in DIRECT_ATTACH_SOURCES:
            key = (rec.get("code"), normalize_broker(rec.get("broker")))
            idx.setdefault(key, []).append(rec)
    return idx


def match_direct(rec, index):
    """직접 수집 레코드와 같은 리포트인 네이버·와이즈·한경 레코드. 없으면 None.

    와이즈 매칭 규칙(_wise_match: 같은 종목+증권사, 작성일 ±3일, 제목 유사)을 그대로 쓴다.
    이미 다른 직접 수집 건이 붙은 레코드는 후보에서 뺀다.
    """
    cands = [c for c in index.get((rec.get("code"), normalize_broker(rec.get("broker"))), ())
             if not c.get("direct") or c.get("direct") == rec.get("id")]
    return _wise_match(rec, cands) if cands else None


def _targets_close(a, b, factor=DIRECT_OVERRIDE_FACTOR):
    lo, hi = sorted((float(a), float(b)))
    return lo > 0 and hi / lo <= factor


def absorb_direct(records):
    """직접 수집(im·bnk·sangsangin) 레코드를 같은 리포트의 네이버·와이즈·한경 레코드에 붙이고 지운다.

    - 네이버: 내리지 않는다. 비어 있는 pdf·analyst·target·rating_raw만 채운다.
    - 와이즈·한경: 직접 수집의 pdf·url을 붙이고, 의견·목표가는 직접 수집 값을 우선한다
      (목표가가 DIRECT_OVERRIDE_FACTOR배 넘게 다르면 바꾸지 않는다). 빈 analyst·summary도 채운다.
    붙은 레코드에는 direct=<직접 수집 id>를 남긴다. 수집기는 이 값을 이미 본 id로 쳐서 다시 받지 않는다.
    목표가가 양쪽에 있는데 다르면 disagree에 남긴다(로그용). 같은 입력에 몇 번 돌려도 결과가 같다.

    돌려주는 값: (남은 레코드, {"attached": {소스: n}, "pdf_gained": n, "compared": n,
    "agree": n, "disagree": [(남는 id, 직접 id, 기존 목표가, 직접 목표가, 바꿨는지)]})
    """
    stats = {"attached": {}, "pdf_gained": 0, "compared": 0, "agree": 0, "disagree": []}
    index = direct_match_index(records)
    drop = set()
    for rec in sorted((r for r in records if r.get("source") in DIRECT_SOURCES),
                      key=lambda r: str(r.get("id") or "")):
        keep = match_direct(rec, index)
        if keep is None:
            continue
        drop.add(id(rec))
        src = keep.get("source")
        stats["attached"][src] = stats["attached"].get(src, 0) + 1
        had_pdf = bool(keep.get("pdf"))
        old_t, new_t = keep.get("target"), rec.get("target")
        if old_t and new_t:
            stats["compared"] += 1
            if old_t == new_t:
                stats["agree"] += 1
        if src == "naver":
            for field in ("pdf", "analyst", "target", "rating_raw"):
                if not keep.get(field) and rec.get(field):
                    keep[field] = rec[field]
            if old_t and new_t and old_t != new_t:
                stats["disagree"].append((keep.get("id"), rec.get("id"), old_t, new_t, False))
        else:
            if rec.get("pdf"):
                keep["pdf"] = rec["pdf"]
                keep["url"] = rec["pdf"]
            elif rec.get("url"):
                keep["url"] = rec["url"]
            if new_t and old_t != new_t:
                swap = not old_t or _targets_close(old_t, new_t)
                if old_t:
                    stats["disagree"].append((keep.get("id"), rec.get("id"), old_t, new_t, swap))
                if swap:
                    keep["target"] = new_t
            if rec.get("rating_raw"):
                keep["rating_raw"] = rec["rating_raw"]
            for field in ("analyst", "summary"):
                if not keep.get(field) and rec.get(field):
                    keep[field] = rec[field]
        keep["direct"] = rec.get("id")
        if not had_pdf and keep.get("pdf"):
            stats["pdf_gained"] += 1
    return [r for r in records if id(r) not in drop], stats


def trusted_paw(rec, close):
    """발간 시점 기준가. price_at_write가 발간일 종가와 PAW_TRUST_FACTOR배 넘게 다르면 종가.

    (값, 출처) — 출처는 "own"(price_at_write), "close"(종가로 대체), "paw_wrong"(price_at_write를
    버리고 종가), 못 정하면 (None, None).
    """
    paw = rec.get("price_at_write")
    if paw and close:
        ratio = float(paw) / float(close)
        if 1.0 / PAW_TRUST_FACTOR <= ratio <= PAW_TRUST_FACTOR:
            return paw, "own"
        return close, "paw_wrong"
    if paw:
        return paw, "own"
    if close:
        return close, "close"
    return None, None


def reevaluate_target_range_with_closes(records, close_lookup):
    """발간일 종가로 목표가 범위를 다시 판정한다 (성과 단계에서, 종가를 받은 종목만).

    close_lookup(code, date) -> 그 날(휴장이면 직전 거래일) 종가 또는 None.
    기준가는 trusted_paw: price_at_write가 종가와 맞으면 그 값, 없거나 2배 넘게 틀리면 종가.
    기준가가 과거의 고정값이라 몇 번을 돌려도 같은 결과가 나온다(현재가처럼 흔들리지 않는다).
    종가를 못 받은 건은 이전 판정을 그대로 둔다. name_is_broker 건은 건드리지 않는다.

    돌려주는 값: {"checked", "paw_wrong", "flagged", "cleared", "newly_flagged"}
    """
    stats = {"checked": 0, "paw_wrong": 0, "flagged": 0, "cleared": 0, "newly_flagged": 0}
    for rec in records:
        if rec.get("suspect") == SUSPECT_NAME_IS_BROKER:
            continue
        target = rec.get("target")
        if not target:
            continue
        close = close_lookup(rec.get("code"), rec.get("date"))
        if not close:
            continue
        ref, how = trusted_paw(rec, close)
        stats["checked"] += 1
        if how == "paw_wrong":
            stats["paw_wrong"] += 1
        was = rec.get("suspect") == SUSPECT_TARGET_RANGE
        ratio = float(target) / float(ref)
        if ratio < TARGET_RATIO_MIN or ratio > TARGET_RATIO_MAX:
            rec["suspect"] = SUSPECT_TARGET_RANGE
            stats["flagged"] += 1
            if not was:
                stats["newly_flagged"] += 1
        elif was:
            rec.pop("suspect", None)
            stats["cleared"] += 1
    return stats


def reparse_nh_targets(records):
    """NH 레코드의 목표가를 저장된 요약에서 다시 읽는다. 바로잡은 건수를 돌려준다.

    예전 추출 규칙이 '16만5,000원'을 5,000원으로 읽었다. 요약은 600자로 잘려 있어
    새로 읽은 값이 있을 때만 바꾸고, 못 읽으면 기존 값을 둔다.
    """
    fixed = 0
    for rec in records:
        if rec.get("source") != "nh" or not rec.get("summary"):
            continue
        rating_raw, target = extract_opinion_from_text(rec["summary"])
        if target and target != rec.get("target"):
            rec["target"] = target
            fixed += 1
        if rating_raw and not rec.get("rating_raw"):
            rec["rating_raw"] = rating_raw
    return fixed


def renormalize_ratings(records):
    """rating을 rating_raw에서 다시 계산한다 (규칙이 바뀌었을 수 있으니 매번)."""
    for rec in records:
        rec["rating"] = normalize_rating(rec.get("rating_raw"))


def month_cutoff(today, retention_days):
    """보관 기간 시작 달 'YYYY-MM'. 이 달보다 이전 달은 통째로 지운다."""
    return (today - timedelta(days=retention_days)).strftime("%Y-%m")
