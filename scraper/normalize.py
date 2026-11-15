"""리포트 레이더 — 저장 전 정규화 패스.

네트워크를 타지 않는 순수 함수만 둔다. 수집기(collect.py)가 매 실행마다 전체 레코드에
돌리고, 테스트(test_parsers.py)가 픽스처로 검증한다. 같은 입력에 몇 번을 돌려도
결과가 같아야 한다(멱등).

- drop_or_flag_name_is_broker: 종목명이 증권사 자신인 건 (한경은 버리고, 나머지는 suspect)
- dedupe_records: 같은 (code, date, 증권사) 중복 병합
- infer_ratings: 목표가는 있는데 의견이 NR인 건에 직전 의견 승계
- evaluate_target_range: 목표가가 기준가의 0.3~3배 밖이면 suspect (건당 한 번만 판정)
- reparse_nh_targets: NH 요약에서 목표가를 다시 읽기 (v1 → v2 이전 때 한 번)
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
SOURCE_PRIORITY = {"naver": 0, "kb": 1, "nh": 1, "kis": 1, "hankyung": 2}
# 병합할 때 남기는 쪽이 비어 있으면 다른 쪽에서 채우는 필드.
FILL_FIELDS = ("analyst", "target", "rating_raw", "summary", "pdf", "price_at_write")

SUSPECT_NAME_IS_BROKER = "name_is_broker"
SUSPECT_TARGET_RANGE = "target_range"
TARGET_RATIO_MIN = 0.3
TARGET_RATIO_MAX = 3.0
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
    남기는 쪽은 소스 우선순위(naver > kb/nh/kis > hankyung), 같으면 빈 칸이 적은 쪽,
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
