"""리포트 레이더 — 순수 파싱/계산 함수 모음.

네트워크를 타지 않는 함수만 둔다. 수집기(collect.py)는 여기서 가져다 쓰고,
테스트(test_parsers.py)는 픽스처 문자열만으로 이 파일을 검증한다.
"""

import re
from bs4 import BeautifulSoup

# ---------------------------------------------------------------- 공통 유틸

_WS = re.compile(r"\s+")


def _text(node):
    """노드 텍스트에서 &nbsp; 포함 공백을 한 칸으로 정리한다."""
    if node is None:
        return ""
    return _WS.sub(" ", node.get_text(" ", strip=True).replace("\xa0", " ")).strip()


def _soup(html):
    # lxml이 없는 환경에서도 죽지 않게 한 번 물러선다.
    try:
        return BeautifulSoup(html, "lxml")
    except Exception:
        return BeautifulSoup(html, "html.parser")


def to_int(value):
    """'200,000' -> 200000, '없음'/''/None -> None."""
    if value is None:
        return None
    s = str(value).replace(",", "").strip()
    m = re.search(r"-?\d+", s)
    if not m:
        return None
    try:
        return int(m.group(0))
    except ValueError:
        return None


def normalize_date(value):
    """'26.09.07' 또는 '2026-09-07' / '2026.09.07' -> '2026-09-07'."""
    if not value:
        return None
    s = str(value).strip()
    m = re.search(r"(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})", s)
    if m:
        y, mo, d = m.group(1), int(m.group(2)), int(m.group(3))
        return "%s-%02d-%02d" % (y, mo, d)
    m = re.search(r"(\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})", s)
    if m:
        y, mo, d = 2000 + int(m.group(1)), int(m.group(2)), int(m.group(3))
        return "%04d-%02d-%02d" % (y, mo, d)
    return None


# ------------------------------------------------------------ 투자의견 정규화

# 소문자·공백·마침표를 걷어낸 키로 찾는다.
_RATING_MAP = {
    # BUY 계열
    "매수": "BUY", "적극매수": "BUY", "강력매수": "BUY", "적극매수strongbuy": "BUY",
    "buy": "BUY", "strongbuy": "BUY", "outperform": "BUY", "overweight": "BUY",
    "비중확대": "BUY", "accumulate": "BUY", "매수유지": "BUY", "적극매수유지": "BUY",
    "trading buy": "BUY", "tradingbuy": "BUY", "add": "BUY",
    # HOLD 계열
    "중립": "HOLD", "hold": "HOLD", "neutral": "HOLD", "marketperform": "HOLD",
    "market perform": "HOLD", "보유": "HOLD", "유지": "HOLD", "시장수익률": "HOLD",
    "marketweight": "HOLD", "중립유지": "HOLD",
    # SELL 계열
    "매도": "SELL", "sell": "SELL", "reduce": "SELL", "underperform": "SELL",
    "underweight": "SELL", "비중축소": "SELL",
    # NR 계열
    "없음": "NR", "not rated": "NR", "notrated": "NR", "n/a": "NR", "na": "NR",
    "nr": "NR", "투자의견없음": "NR", "": "NR", "-": "NR", "의견없음": "NR",
}


def _rating_key(raw):
    s = str(raw or "").strip().lower()
    s = s.replace("\xa0", " ")
    s = re.sub(r"[()\[\]]", " ", s)
    s = _WS.sub(" ", s).strip()
    return s


def normalize_rating(raw):
    """투자의견 원문을 BUY/HOLD/SELL/NR 중 하나로 정규화한다.

    표에 없으면 NR로 두되 rating_raw는 호출부에서 그대로 보존한다.
    """
    key = _rating_key(raw)
    if key in _RATING_MAP:
        return _RATING_MAP[key]
    # 공백을 완전히 없앤 형태로 한 번 더
    tight = key.replace(" ", "").replace(".", "")
    if tight in _RATING_MAP:
        return _RATING_MAP[tight]
    # '매수(유지)', 'BUY(상향)' 같은 꼬리표가 붙은 경우 앞머리로 판단
    for token, value in (
        ("적극매수", "BUY"), ("비중확대", "BUY"), ("strongbuy", "BUY"),
        ("outperform", "BUY"), ("overweight", "BUY"), ("매수", "BUY"), ("buy", "BUY"),
        ("비중축소", "SELL"), ("underperform", "SELL"), ("underweight", "SELL"),
        ("매도", "SELL"), ("sell", "SELL"), ("reduce", "SELL"),
        ("시장수익률", "HOLD"), ("marketperform", "HOLD"), ("중립", "HOLD"),
        ("hold", "HOLD"), ("neutral", "HOLD"), ("보유", "HOLD"),
        ("notrated", "NR"), ("없음", "NR"),
    ):
        if tight.startswith(token):
            return value
    return "NR"


# ------------------------------------------------------------- 증권사 정규화

def normalize_broker(name):
    """매칭용 증권사 키. 공백/괄호/'증권'·'투자증권' 꼬리를 걷어낸다."""
    s = str(name or "").strip().lower()
    s = re.sub(r"\(.*?\)", "", s)
    s = re.sub(r"[\s.·\-_]", "", s)
    s = re.sub(r"(주식회사|㈜)", "", s)
    for suffix in ("리서치센터", "투자증권", "금융투자", "증권"):
        if s.endswith(suffix) and len(s) > len(suffix):
            s = s[: -len(suffix)]
            break
    return s


# ------------------------------------------------- 네이버 리서치 목록 파서

def parse_list_page(html):
    """네이버 금융 리서치 종목분석 목록 HTML -> 레코드 리스트.

    종목코드(a.stock_item)와 상세 링크(nid)가 모두 있는 행만 취한다.
    """
    soup = _soup(html)
    table = soup.select_one("table.type_1") or soup.find("table")
    if table is None:
        return []

    rows = []
    for tr in table.find_all("tr"):
        stock_a = tr.select_one("a.stock_item")
        if stock_a is None:
            continue
        m_code = re.search(r"code=(\d{6})", stock_a.get("href", "") or "")
        if not m_code:
            continue
        code = m_code.group(1)
        name = (stock_a.get("title") or _text(stock_a)).strip()

        read_a = None
        for a in tr.find_all("a", href=True):
            if "company_read" in a["href"]:
                read_a = a
                break
        if read_a is None:
            continue
        m_nid = re.search(r"nid=(\d+)", read_a["href"])
        if not m_nid:
            continue
        nid = m_nid.group(1)
        title = _text(read_a)

        cells = tr.find_all("td")
        cell_text = [_text(td) for td in cells]

        # 날짜: YY.MM.DD 또는 YYYY-MM-DD 꼴이 들어있는 칸
        date = None
        date_idx = None
        for i, t in enumerate(cell_text):
            d = normalize_date(t)
            if d and re.search(r"\d{2}[.\-]\d{1,2}[.\-]\d{1,2}", t):
                date = d
                date_idx = i
                break

        # 조회수: 날짜 칸 뒤쪽에 오는 순수 숫자 칸
        views = None
        for i, t in enumerate(cell_text):
            if date_idx is not None and i <= date_idx:
                continue
            if re.fullmatch(r"[\d,]+", t or ""):
                views = to_int(t)
                break

        # 증권사: 링크가 없는 칸 중 날짜/조회수가 아닌 첫 칸 (기본 배치는 3번째)
        broker = ""
        if len(cells) > 2 and not cells[2].find("a"):
            broker = cell_text[2]
        if not broker:
            for i, td in enumerate(cells):
                if i == date_idx or td.find("a") is not None:
                    continue
                t = cell_text[i]
                if not t or re.fullmatch(r"[\d,]+", t):
                    continue
                broker = t
                break

        pdf = None
        file_td = tr.select_one("td.file a[href]")
        if file_td is None:
            for a in tr.find_all("a", href=True):
                if a["href"].lower().endswith(".pdf"):
                    file_td = a
                    break
        if file_td is not None:
            pdf = file_td["href"].strip() or None

        rows.append({
            "id": "naver:%s" % nid,
            "source": "naver",
            "nid": nid,
            "code": code,
            "name": name,
            "title": title,
            "broker": broker,
            "analyst": None,
            "date": date,
            "views": views,
            "pdf": pdf,
            "url": "https://finance.naver.com/research/company_read.naver?nid=%s" % nid,
        })
    return rows


def parse_list_last_page(html):
    """페이지네이션(table.Nnavi)에서 확인 가능한 마지막 페이지 번호. 없으면 None."""
    soup = _soup(html)
    nav = soup.select_one("table.Nnavi")
    if nav is None:
        return None
    pages = []
    for a in nav.find_all("a", href=True):
        m = re.search(r"page=(\d+)", a["href"])
        if m:
            pages.append(int(m.group(1)))
    for td in nav.select("td.on"):
        m = re.search(r"\d+", _text(td))
        if m:
            pages.append(int(m.group(0)))
    return max(pages) if pages else None


# ------------------------------------------------- 네이버 리서치 상세 파서

def parse_detail(html):
    """상세 페이지 -> {'target': int|None, 'rating_raw': str|None, 'summary': str|None}.

    상세에는 종목코드가 없다(사이드 위젯 코드에 속지 말 것). 목록에서 받은 코드를 쓴다.
    """
    soup = _soup(html)
    info = soup.select_one("div.view_info_1")

    target = None
    rating_raw = None

    money = info.select_one("em.money") if info else None
    if money is not None:
        strong = money.find("strong")
        target = to_int(_text(strong) if strong is not None else _text(money))
    coment = info.select_one("em.coment") if info else None
    if coment is not None:
        rating_raw = _text(coment) or None

    # 셀렉터가 안 먹으면 정규식으로 한 번 더 (마크업이 흔들려도 값은 건진다)
    if target is None:
        m = re.search(r"목표가\s*<em class=\"money\">(?:<strong>)?([\d,]+|없음)", html)
        if m:
            target = to_int(m.group(1))
    if not rating_raw:
        m = re.search(r"투자의견\s*<em class=\"coment\">([^<]+)</em>", html)
        if m:
            rating_raw = m.group(1).strip() or None

    summary = None
    body = soup.select_one("td.view_cnt")
    if body is not None:
        text = clean_summary(_text(body))
        if text:
            summary = text[:600]

    return {"target": target, "rating_raw": rating_raw, "summary": summary}


# 본문 끝에 첨부파일 이름이 딸려 온다. (예: '... 개선되었다. 20260904163445150_0_ko.pdf')
_TRAILING_FILE = re.compile(r"[\s]*\S+\.(?:pdf|hwp|docx?|xlsx?)\s*$", re.IGNORECASE)


def clean_summary(text):
    """요약 본문 꼬리에 붙은 첨부파일 이름을 걷어낸다."""
    if not text:
        return text
    prev = None
    # 파일이 두 개 이상 붙는 경우가 있어 더 없을 때까지 턴다
    while prev != text:
        prev = text
        text = _TRAILING_FILE.sub("", text).strip()
    return text


# ------------------------------------------------------ 한경 컨센서스 파서

def parse_hankyung_list(html):
    """한경 컨센서스 목록 -> 레코드 리스트 (애널리스트명 보강용)."""
    soup = _soup(html)
    table = soup.select_one("table.table_style01") or soup.find("table")
    if table is None:
        return []
    body = table.find("tbody") or table

    out = []
    for tr in body.find_all("tr"):
        cells = tr.find_all("td")
        if len(cells) < 6:
            continue
        cell_text = [_text(td) for td in cells]

        date = normalize_date(cell_text[0])
        if not date:
            continue

        # 제목 칸에는 마우스오버용 레이어(div.layerPop)가 같은 제목을 한 번 더 품고 있다.
        # 칸 전체 텍스트를 쓰면 제목이 겹쳐 나오므로 링크 자체의 텍스트만 취한다.
        title_a = cells[1].find("a")
        raw_title = _text(title_a) if title_a is not None else cell_text[1]

        code = None
        for a in tr.find_all("a", href=True):
            m = re.search(r"business_code=(\d{6})", a["href"])
            if m:
                code = m.group(1)
                break

        name = None
        title = raw_title
        m = re.match(r"^\s*(.+?)\((\d{6})\)\s*(.*)$", raw_title)
        if m:
            name = m.group(1).strip()
            code = code or m.group(2)
            title = m.group(3).strip() or raw_title
        if not code:
            continue

        # 적정가격 0은 '제시 안 함'이라는 뜻이다. 목표가 없음으로 둔다.
        target = to_int(cell_text[2])
        if target is not None and target <= 0:
            target = None
        rating_raw = cell_text[3] or None
        analyst = cell_text[4] or None
        broker = cell_text[5] or ""

        pdf = None
        for a in tr.find_all("a", href=True):
            m = re.search(r"report_idx=(\d+)", a["href"])
            if m:
                pdf = "https://consensus.hankyung.com/analysis/downpdf?report_idx=%s" % m.group(1)
                break

        out.append({
            "id": "hankyung:%s" % (re.search(r"report_idx=(\d+)", pdf).group(1) if pdf else "%s-%s-%s" % (date, code, normalize_broker(broker))),
            "source": "hankyung",
            "code": code,
            "name": name,
            "title": title,
            "broker": broker,
            "analyst": analyst,
            "date": date,
            "target": target,
            "rating_raw": rating_raw,
            "pdf": pdf,
            "url": pdf or "https://consensus.hankyung.com/analysis/list?report_type=CO",
            "summary": None,
            "views": None,
        })
    return out


# ------------------------------------------------------------- 현재가 파서

def parse_price_payload(payload):
    """polling.finance.naver.com 응답 -> {code: {'price': int, 'prev': int, 'change_rate': float, 'name': str}}."""
    out = {}
    if not isinstance(payload, dict):
        return out
    areas = (payload.get("result") or {}).get("areas") or []
    for area in areas:
        for item in area.get("datas") or []:
            code = item.get("cd")
            if not code:
                continue
            price = to_int(item.get("nv"))
            if price is None or price <= 0:
                continue
            out[code] = {
                "price": price,
                "prev": to_int(item.get("sv")),
                "change_rate": item.get("cr"),
                "name": item.get("nm"),
            }
    return out


# ------------------------------------------------------------ 파생값 계산

def compute_gap(target, price):
    """괴리율(%) = (목표가 - 현재가) / 현재가 * 100, 소수 2자리."""
    if target is None or price is None:
        return None
    try:
        target = float(target)
        price = float(price)
    except (TypeError, ValueError):
        return None
    if price <= 0:
        return None
    return round((target - price) / price * 100.0, 2)


def apply_target_changes(records):
    """같은 (종목코드, 증권사)의 직전 리포트와 목표가를 비교해 prev_target/target_change를 채운다.

    - 직전(더 오래된 날짜) 리포트가 없으면 'new'
    - 양쪽 중 하나라도 목표가가 없으면 None
    매 실행마다 전체를 다시 계산한다. records를 제자리에서 수정하고 그대로 돌려준다.
    """
    groups = {}
    for rec in records:
        key = (rec.get("code"), normalize_broker(rec.get("broker")))
        groups.setdefault(key, []).append(rec)

    for items in groups.values():
        items.sort(key=lambda r: ((r.get("date") or ""), str(r.get("id") or "")))
        for i, rec in enumerate(items):
            prev = None
            for j in range(i - 1, -1, -1):
                if (items[j].get("date") or "") < (rec.get("date") or ""):
                    prev = items[j]
                    break
            if prev is None:
                rec["prev_target"] = None
                rec["target_change"] = "new"
                continue
            prev_target = prev.get("target")
            cur_target = rec.get("target")
            rec["prev_target"] = prev_target
            if prev_target is None or cur_target is None:
                rec["target_change"] = None
            elif cur_target > prev_target:
                rec["target_change"] = "up"
            elif cur_target < prev_target:
                rec["target_change"] = "down"
            else:
                rec["target_change"] = "same"
    return records
