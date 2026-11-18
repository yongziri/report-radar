"""리포트 레이더 — 순수 파싱/계산 함수 모음.

네트워크를 타지 않는 함수만 둔다. 수집기(collect.py)는 여기서 가져다 쓰고,
테스트(test_parsers.py)는 픽스처 문자열만으로 이 파일을 검증한다.
"""

import datetime
import re
from html import unescape as _unescape
from urllib.parse import quote

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


# 신형 종목코드는 영문자를 품는다 (0126Z0 삼성에피스홀딩스, 00680K 미래에셋증권2우B,
# 0167A0 SOL AI반도체TOP2플러스). 여섯 자리이고 첫 자리는 늘 숫자다.
STOCK_CODE = r"[0-9][0-9A-Z]{5}"
_STOCK_CODE_RE = re.compile(r"\A%s\Z" % STOCK_CODE)


def is_stock_code(value):
    """정확히 여섯 자리 대문자 영숫자(첫 자리는 숫자)면 True."""
    return bool(_STOCK_CODE_RE.match(str(value or "").strip()))


def positive_int(value):
    """'320000' -> 320000. ''/None/'0'/음수는 '값 없음'으로 보고 None."""
    num = to_int(value)
    return num if num and num > 0 else None


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


def compact_date(value):
    """'20260907' -> '2026-09-07'. 구분자 없는 8자리가 아니면 None.

    NH가 날짜를 이 꼴로 내려준다. normalize_date는 구분자가 있어야 잡는다.
    """
    s = str(value or "").strip()
    if not re.fullmatch(r"\d{8}", s):
        return None
    return "%s-%s-%s" % (s[:4], s[4:6], s[6:])


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
    # KB의 산업 의견(Positive/Negative)이 종목 리포트에 섞여 오면 등급 없음으로 둔다
    "positive": "NR", "negative": "NR",
    # 와이즈리포트 등에서 보이는 표기
    "미제시": "NR", "투자의견미제시": "NR", "단기매수": "BUY",
    "매수buy": "BUY", "중립hold": "HOLD", "매도sell": "SELL",
}

# '[유지] 매수', 'Buy(Maintain)', '매수(신규)', 'Hold(하향)'처럼 의견 앞뒤에 붙는 변동 꼬리표.
# 다른 낱말이 함께 있을 때만 떼어 낸다('유지' 한 단어는 표에서 HOLD로 읽는다).
_RATING_TAGS = frozenset((
    "유지", "신규", "상향", "하향", "변경", "재개", "조정", "상향조정", "하향조정", "커버리지개시",
    "maintain", "maintained", "initiate", "initiation", "initiated", "reinitiate",
    "reinitiated", "resume", "upgrade", "upgraded", "downgrade", "downgraded",
    "change", "changed", "new",
))


def _rating_key(raw):
    s = str(raw or "").strip().lower()
    s = s.replace("\xa0", " ")
    s = re.sub(r"[()\[\]{}<>:/|,]", " ", s)
    s = _WS.sub(" ", s).strip()
    words = s.split(" ")
    if len(words) > 1:
        kept = [w for w in words if w.replace(".", "") not in _RATING_TAGS]
        if kept:
            s = " ".join(kept)
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


def name_is_broker(name, broker, title=None):
    """종목명이 곧 증권사명이고, 제목도 그 회사 얘기가 아니면 True.

    증권사가 자기 회사 리포트를 내는 일은 사실상 없다. 원문이 종목 칸을 잘못 채운 것으로 본다.
    제목에 종목명이 그대로 들어 있으면(공백 무시) 그 회사에 관한 글로 보고 False.
    """
    if not name or not broker:
        return False
    # 'LS'(LS증권)·'SK'(SK증권)·'현대차'(현대차증권)처럼 증권사 모회사 이름과 겹치는
    # 종목이 많다. 종목명 자체가 증권사 이름 꼴('…증권'·'…금융투자')일 때만 본다.
    if not re.search(r"증권|금융투자", str(name)):
        return False
    if normalize_broker(name) != normalize_broker(broker):
        return False
    squeeze = lambda v: re.sub(r"\s+", "", str(v or ""))
    return squeeze(name) not in squeeze(title)


# -------------------------------------------- 네이버 리서치 API 파서

# 2026-09-14경 finance.naver.com의 리서치 페이지가 stock.naver.com으로 302 되면서
# HTML 목록/상세 파서는 쓸 수 없게 되었다. 모바일 증권 JSON API로 갈아탔다.
NAVER_RESEARCH_URL = "https://m.stock.naver.com/research/company/%s"


def parse_naver_api_list(items):
    """/api/research/company 응답(배열) -> 레코드 리스트.

    상세(pdf·목표가·의견·요약)는 parse_naver_api_detail이 따로 채운다.
    nid는 상세 요청용 임시 키라 수집기가 저장 전에 지운다.
    """
    rows = []
    for it in items or []:
        if not isinstance(it, dict):
            continue
        rid = str(it.get("researchId") or "").strip()
        code = str(it.get("itemCode") or "").strip().upper()
        if not rid or not is_stock_code(code):
            continue
        rows.append({
            "id": "naver:%s" % rid,
            "source": "naver",
            "nid": rid,
            "code": code,
            "name": str(it.get("itemName") or "").strip() or None,
            "title": _WS.sub(" ", str(it.get("title") or "").strip()),
            "broker": str(it.get("brokerName") or "").strip(),
            "analyst": None,
            "date": normalize_date(it.get("writeDate")),
            "views": to_int(it.get("readCount")),
            "pdf": None,
            "url": NAVER_RESEARCH_URL % rid,
        })
    return rows


def parse_naver_api_detail(obj):
    """/api/research/company/{researchId} 응답 -> 상세 필드.

    naver_prev_target(prevGoalPrice)·price_at_write(priceAtWriteDate)는
    네이버가 알려주는 값을 그대로 담는다. 우리가 이력으로 계산하는
    prev_target/target_change와는 별개 필드다.
    """
    content = (obj or {}).get("researchContent")
    if not isinstance(content, dict):
        content = {}
    summary = clean_summary(_html_to_text(content.get("content")))
    return {
        "target": positive_int(content.get("goalPrice")),
        "rating_raw": str(content.get("opinion") or "").strip() or None,
        "summary": summary[:600] if summary else None,
        "pdf": str(content.get("attachUrl") or "").strip() or None,
        "naver_prev_target": positive_int(content.get("prevGoalPrice")),
        "price_at_write": positive_int(content.get("priceAtWriteDate")),
    }


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
            m = re.search(r"business_code=(%s)" % STOCK_CODE, a["href"])
            if m:
                code = m.group(1)
                break

        name = None
        title = raw_title
        m = re.match(r"^\s*(.+?)\((%s)\)\s*(.*)$" % STOCK_CODE, raw_title)
        if m:
            name = m.group(1).strip()
            code = code or m.group(2)
            title = m.group(3).strip() or raw_title
        if not code:
            continue

        broker = cell_text[5] or ""
        # 한경 원문 자체가 종목 자리에 증권사 자신을 적어 둔 행이 있다
        # (예: '한화투자증권(003530) 3Q26 Preview: 메탈은 줄고 방산은 이연된 3분기',
        #  첨부 파일명은 Poongsan). 진짜 종목을 알 길이 없으니 버린다.
        if name_is_broker(name, broker, title):
            continue

        # 적정가격 0은 '제시 안 함'이라는 뜻이다. 목표가 없음으로 둔다.
        target = to_int(cell_text[2])
        if target is not None and target <= 0:
            target = None
        rating_raw = cell_text[3] or None
        analyst = cell_text[4] or None

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


# --------------------------------------------- 본문에서 의견·목표가 뽑아내기

# NH 요약문과 한국투자증권 상세 본문에는 의견·목표가 칸이 따로 없다. 문장에서 캔다.
_RATING_WORDS = (r"(매수|중립|매도|비중확대|비중축소|Strong\s*Buy|Buy|Hold|Neutral|Sell|"
                 r"Outperform|Underperform|Marketperform|Overweight|Underweight|Not\s*Rated|NR)")
_OPINION_RE = re.compile(
    r"투자의견\s*[:：]?\s*(?:을|를)?\s*['\"]?" + _RATING_WORDS, re.IGNORECASE)
# '투자의견 중립에서 매수로 상향'은 뒤쪽(바뀐 뒤) 의견이 맞다.
_OPINION_TO_RE = re.compile(
    r"['\"]?\s*(?:에서|→|->)\s*['\"]?" + _RATING_WORDS, re.IGNORECASE)
_TARGET_WORD = re.compile(r"목표주가")
# '16만5,000원'·'16.5만원'·'44만원' 같은 만 단위 표기도 잡는다.
# 예전에는 '([\d,]+)\s*원'만 봐서 '16만5,000원'을 5,000원으로 읽었다(NH 롯데웰푸드).
_TARGET_NUM = re.compile(
    r"(\d[\d,]*(?:\.\d+)?)\s*만\s*(?:(\d[\d,]*)\s*)?원|(\d[\d,]*)\s*원")
# '기존 170,000원', '기존 목표주가 50,000원'처럼 직전 목표가를 가리키는 숫자는 건너뛴다.
_PREV_TARGET = re.compile(r"기존\s*(?:목표주가\s*(?:를|은|는|도)?\s*)?$")
# '목표주가는 12개월 선행 EPS 3,898원에 …'처럼 주당 지표를 가리키는 숫자도 건너뛴다.
# (한투 파마리서치·HL만도·한국타이어에서 EPS를 목표가로 읽었다)
_PER_SHARE = re.compile(r"EPS|BPS|DPS|SPS|CPS|주당|순이익|배당금", re.IGNORECASE)
# '목표주가' 뒤 이 글자 수 안에서만 금액을 찾는다. 너무 넓히면 본문 숫자를 물어 온다.
_TARGET_WINDOW = 40
# 주당 지표를 건너뛴 경우에는 그 숫자 뒤로 이만큼 더 본다
# ('… EPS 3,898원에 멀티플 13.3배를 적용하여 52,000원을 제시').
_TARGET_EXTEND = 90
# PDF 1쪽에서 '…투자의견과 목표주가를 유지한다. 종가(26.11.11) 38,700원'의 종가를 목표가로 읽었다
# (상상인 JYP·YG). 문장이 끝났거나 종가·현재가 칸이면 그 숫자는 목표가가 아니다.
_SENTENCE_END = re.compile(r"다\s*[.。]")
_PRICE_LABEL = re.compile(r"종가|현재가|현재\s*주가")


def _target_value(num):
    """_TARGET_NUM 매치 -> 원 단위 정수. 못 읽으면 None."""
    if num.group(1) is not None:
        try:
            man = float(num.group(1).replace(",", ""))
        except ValueError:
            return None
        rest = to_int(num.group(2)) or 0
        return int(round(man * 10000)) + rest
    return to_int(num.group(3))


def extract_opinion_from_text(text):
    """자연어 본문에서 (투자의견 원문, 목표주가)를 뽑는다. 못 찾으면 각각 None."""
    if not text:
        return None, None
    s = _WS.sub(" ", str(text).replace("\xa0", " "))

    rating_raw = None
    m = _OPINION_RE.search(s)
    if m:
        rating_raw = _WS.sub(" ", m.group(1)).strip()
        to = _OPINION_TO_RE.match(s, m.end())
        if to:
            rating_raw = _WS.sub(" ", to.group(1)).strip()

    target = None
    for kw in _TARGET_WORD.finditer(s):
        pos = kw.end()
        end = kw.end() + _TARGET_WINDOW
        seg_start = kw.end()
        while True:
            num = _TARGET_NUM.search(s, pos, min(end, len(s)))
            if num is None:
                break
            pos = num.end()
            before = s[seg_start:num.start()]
            seg_start = num.end()
            if _SENTENCE_END.search(before):
                break  # '목표주가를 유지한다. 종가 38,700원' — 문장이 끝난 뒤 숫자는 목표가가 아니다
            if _PRICE_LABEL.search(before):
                continue  # 종가·현재가 칸
            if _PREV_TARGET.search(s[:num.start()]):
                continue  # 기존 목표가는 건너뛰고 다음 금액을 본다
            if _PER_SHARE.search(before):
                end = max(end, num.end() + _TARGET_EXTEND)
                continue
            value = _target_value(num)
            if value:
                target = value
                break
        if target is not None:
            break
    return rating_raw, target


def _html_to_text(value):
    """escape가 겹쳐 있는 HTML 조각을 평문으로 편다."""
    if not value:
        return ""
    text = str(value)
    for _ in range(4):
        # NH는 이중 escape라 두 번은 풀어야 태그가 드러난다. 더 안 풀릴 때까지 돈다.
        opened = _unescape(text)
        if opened == text:
            break
        text = opened
    text = re.sub(r"<[^>]+>", " ", text)
    return _WS.sub(" ", _unescape(text).replace("\xa0", " ")).strip()


# ------------------------------------------------------------- KB증권 파서

KB_PDF_URL = "https://rdata.kbsec.com/pdf_data/%s.pdf"


def _kb_target(value):
    """KB의 tp는 '6000.0000' 꼴 문자열이다. ''/None/0은 목표가 없음으로 본다."""
    s = str(value or "").replace(",", "").strip()
    if not s:
        return None
    try:
        num = int(float(s))
    except ValueError:
        return None
    return num if num > 0 else None


def parse_kb_list(payload):
    """KB증권 리서치 목록 JSON -> 레코드 리스트.

    산업 리포트가 대표 종목코드를 달고 섞여 들어온다(제약 위클리 stkCd 128940,
    제목은 '제약 (350510)'). 제목의 (코드)와 stkCd가 같을 때만 종목 리포트로 본다.
    """
    rows = []
    items = ((payload or {}).get("response") or {}).get("reportList") or []
    for it in items:
        if not isinstance(it, dict):
            continue
        code = str(it.get("stkCd") or "").strip()
        doc_title = _WS.sub(" ", str(it.get("docTitle") or "").strip())
        m = re.search(r"\((%s)\)" % STOCK_CODE, doc_title)
        if not is_stock_code(code) or m is None or m.group(1) != code:
            continue
        docid = str(it.get("documentid") or "").strip()
        if not docid:
            continue

        title = _WS.sub(" ", str(it.get("docTitleSub") or "").strip()) or doc_title
        summary = clean_summary(_WS.sub(" ", str(it.get("docDetail") or "").strip()))
        pdf = KB_PDF_URL % docid
        rows.append({
            "id": "kb:%s" % docid,
            "source": "kb",
            "code": code,
            "name": doc_title[:m.start()].strip() or None,
            "title": title,
            "broker": "KB증권",
            "analyst": str(it.get("analystNm") or "").strip() or None,
            "date": normalize_date(it.get("publicDate")),
            "target": _kb_target(it.get("tp")),
            "rating_raw": str(it.get("recomm") or "").strip() or None,
            "pdf": pdf,
            "url": pdf,
            "summary": summary[:600] if summary else None,
            "views": None,
        })
    return rows


# -------------------------------------------------------- NH투자증권 파서

NH_LIST_URL = "https://www.nhsec.com/research/boardList.action?rsh_ppr_dit_cd=01"


def parse_nh_list(payload):
    """NH투자증권 목록(H3211) JSON -> 레코드 리스트.

    의견·목표가는 목록에 없다. 요약(H3212)에서 따로 캔다.
    페이징 커서로 쓰는 원본 번호·날짜·시각은 nh_* 임시 키에 실어 보낸다
    (수집기가 저장 전에 지운다).
    """
    rows = []
    resp = ((payload or {}).get("DATA") or {}).get("RESPONSE") or {}
    block = resp.get("H3211OutBlock2") or {}
    for it in block.get("ROW") or []:
        if not isinstance(it, dict):
            continue
        no = str(it.get("rsh_ppr_no") or "").strip()
        if not no:
            continue
        m_code = re.search(STOCK_CODE, str(it.get("rsh_ppr_iem_cd_pcl") or ""))
        if m_code is None:
            continue  # 종목코드가 없는 건(전략·산업 등)은 버린다

        raw_title = _WS.sub(" ", str(it.get("rsh_ppr_til_cts") or "").strip())
        name = None
        title = raw_title
        m = re.match(r"^\[([^\]]+)\]\s*(.*)$", raw_title)
        if m:
            name = m.group(1).strip() or None
            title = m.group(2).strip() or raw_title

        dt_raw = str(it.get("rsh_ppr_dru_dt") or "").strip()
        rows.append({
            "id": "nh:%s" % no,
            "source": "nh",
            "code": m_code.group(0),
            "name": name,
            "title": title,
            "broker": "NH투자증권",
            "analyst": str(it.get("rsh_ppr_dru_emp_fnm") or "").strip() or None,
            "date": normalize_date(it.get("rsh_ppr_dru_dt_nm")) or compact_date(dt_raw),
            "target": None,
            "rating_raw": None,
            "pdf": str(it.get("hpge_fle_url_cts") or "").strip() or None,
            "url": NH_LIST_URL,
            "summary": None,
            "views": None,
            "nh_no": no,
            "nh_dt": dt_raw,
            "nh_tm": str(it.get("rsh_ppr_dru_tm") or "").strip(),
        })
    return rows


def parse_nh_summary(payload):
    """NH 요약(H3212) JSON -> {'name', 'target', 'rating_raw', 'summary'}."""
    out = {"name": None, "target": None, "rating_raw": None, "summary": None}
    resp = ((payload or {}).get("DATA") or {}).get("RESPONSE") or {}
    rows = ((resp.get("H3212OutBlock1") or {}).get("ROW")) or []
    if not rows or not isinstance(rows[0], dict):
        return out
    row = rows[0]
    out["name"] = str(row.get("rsh_ppr_iem_nm_pcl") or "").strip() or None
    text = _html_to_text(row.get("rsh_ppr_cts"))
    if text:
        out["summary"] = text[:600]
        out["rating_raw"], out["target"] = extract_opinion_from_text(text)
    return out


# ------------------------------------------------------ 한국투자증권 파서

KIS_DETAIL_URL = ("https://securities.koreainvestment.com/main/research/research/"
                  "StrategyDetail.jsp?jkGubun=10&id=%s")
# 목록에는 산업Note·해외주식·ESG Note가 섞여 있다. 종목 리포트로 볼 분류만 남긴다.
KIS_CATEGORIES = ("기업Note", "AIR 스몰캡")


def parse_kis_list(html):
    """한국투자증권 리서치 목록 HTML -> 레코드 리스트.

    PDF는 로그인해야 열리므로 pdf는 항상 None이고, url은 상세 페이지를 가리킨다.
    """
    soup = _soup(html)
    rows = []
    for li in soup.select("ul.view_area > li"):
        head = _text(li.select_one(".head"))
        if head not in KIS_CATEGORIES:
            continue
        link = li.select_one("a.view_con")
        if link is None:
            continue
        m_id = re.search(r"doDetail\('(\d+)'\)", link.get("onclick") or "")
        if m_id is None:
            continue

        raw_title = _text(li.select_one(".body_tit"))
        m = re.match(r"^(.+?)\s*\((%s)\)\s*:?\s*(.*)$" % STOCK_CODE, raw_title)
        if m is None:
            continue
        # 스몰캡은 제목 앞에 분류명이 한 번 더 붙는다('AIR 스몰캡 엘티씨 (170920)').
        name = re.sub(r"^%s\s*" % re.escape(head), "", m.group(1)).strip() or None
        title = m.group(3).strip() or raw_title

        analyst = None
        date = None
        for em in li.select(".tit_info em"):
            value = _text(em)
            parsed = normalize_date(value)
            if parsed and date is None:
                date = parsed
            elif value and analyst is None:
                analyst = value

        summary = clean_summary(_text(li.select_one(".body_sub")))
        rid = m_id.group(1)
        rows.append({
            "id": "kis:%s" % rid,
            "source": "kis",
            "code": m.group(2),
            "name": name,
            "title": title,
            "broker": "한국투자증권",
            "analyst": analyst,
            "date": date,
            "target": None,
            "rating_raw": None,
            "pdf": None,
            "url": KIS_DETAIL_URL % rid,
            "summary": summary[:600] if summary else None,
            "views": None,
            "kis_id": rid,
        })
    return rows


def parse_kis_total(html):
    """목록 상단 '전체건수 N건'. 페이지 수 계산에 쓴다. 못 찾으면 None.

    분류 필터로 걸러낸 뒤에는 행 수로 마지막 페이지를 판단할 수 없어서 필요하다.
    """
    if not html:
        return None
    m = re.search(r"전체건수[^<]*<span[^>]*>\s*([\d,]+)\s*</span>", html)
    if m is None:
        m = re.search(r"전체건수\s*([\d,]+)\s*건", html)
    return to_int(m.group(1)) if m else None


def parse_kis_detail(html):
    """상세 페이지 -> {'target', 'rating_raw', 'summary'}.

    의견·목표가 칸이 따로 없어 본문 문장에서 캔다.
    """
    soup = _soup(html)
    node = soup.select_one("div.v_info_con")
    if node is None:
        for junk in soup(["script", "style"]):
            junk.decompose()
        node = soup.body or soup
    text = clean_summary(_text(node))
    rating_raw, target = extract_opinion_from_text(text)
    return {"target": target, "rating_raw": rating_raw,
            "summary": text[:600] if text else None}


# ------------------------------------------------------ 와이즈리포트 파서

# comp.wisereport.co.kr 기업 리포트 목록(c1080001_data.aspx) — 전 증권사 종목 리포트.
# PDF 뷰어는 로그인이 필요해 pdf는 비워 두고, url은 공개된 종목별 리포트 목록 페이지를 가리킨다.
WISE_COMPANY_URL = "https://comp.wisereport.co.kr/company/c1080001.aspx?cmp_cd=%s"
# 회사 IR 자료(실적발표 PPT 등)는 증권사 리포트가 아니다.
WISE_SKIP_BROKERS = ("해당기업",)
WISE_SKIP_SUB_TYPES = (9,)
# 비상장사 리포트는 종목코드 자리에 000000이 온다(실측 64건). 시세·업종을 붙일 수 없어 버린다.
WISE_SKIP_CODES = ("000000",)


def _wise_broker(name):
    """'한국IR협의회(기술분석보고서)' -> '한국IR협의회'. 괄호 꼬리를 떼어 증권사 목록을 하나로 둔다."""
    s = _WS.sub(" ", str(name or "").strip())
    return re.sub(r"\s*\([^)]*\)\s*$", "", s).strip() or s


def _wise_analyst(value):
    """'박성순,김지은' -> '박성순, 김지은'. 비었으면 None."""
    names = [n.strip() for n in re.split(r"[,/]", str(value or "")) if n.strip()]
    return ", ".join(names) or None


def parse_wise_list(payload):
    """와이즈리포트 c1080001_data.aspx 응답 -> 레코드 리스트.

    날짜는 ANL_DT('26/11/13', 작성일). 목록 순서는 등록 순(IDX)이라 작성일과 조금 어긋날 수 있다.
    """
    rows = []
    items = (payload or {}).get("lists") if isinstance(payload, dict) else None
    for it in items or []:
        if not isinstance(it, dict):
            continue
        rid = str(it.get("RPT_ID") or "").strip()
        code = str(it.get("CMP_CD") or "").strip().upper()
        broker_raw = str(it.get("BRK_NM_KOR") or "").strip()
        if not rid or not is_stock_code(code) or code in WISE_SKIP_CODES or not broker_raw:
            continue
        if broker_raw in WISE_SKIP_BROKERS or it.get("RPT_SUB_TYP") in WISE_SKIP_SUB_TYPES:
            continue
        date = normalize_date(it.get("ANL_DT"))
        title = _WS.sub(" ", str(it.get("RPT_TITLE") or "").strip())
        if not date or not title:
            continue
        summary = clean_summary(_html_to_text(it.get("COMMENT2")))
        rows.append({
            "id": "wise:%s" % rid,
            "source": "wise",
            "code": code,
            "name": str(it.get("CMP_NM_KOR") or "").strip() or None,
            "title": title,
            "broker": _wise_broker(broker_raw),
            "analyst": _wise_analyst(it.get("ANL_NM_KOR")),
            "date": date,
            "target": positive_int(it.get("TARGET_PRC")),
            "rating_raw": str(it.get("RECOMM") or "").strip() or None,
            "pdf": None,
            "url": WISE_COMPANY_URL % code,
            "summary": summary[:600] if summary else None,
            # 와이즈 조회수(VISIT_CNT)는 네이버 조회수와 척도가 달라 섞지 않는다.
            "views": None,
        })
    return rows


def wise_page_info(payload):
    """(현재 페이지, 전체 페이지, 전체 건수). 못 읽으면 None 자리."""
    if not isinstance(payload, dict):
        return None, None, None
    return to_int(payload.get("cp")), to_int(payload.get("tp")), to_int(payload.get("tc"))


# ------------------------------------------------ 씽크풀 (api.thinkpool.com) 파서

# 2026-11-18 실측: allReport?pno=N 응답은 {"totalCount", "todayDate": "2026.11.18", "list": [...]},
# 한 페이지 20건. 행: rcpNo(정수 id), date('11/18', 연도 없음), stockCode, stockName, price·ratio
# (조회 시점 현재가·등락률이라 쓰지 않음), targetPrice(없으면 키가 없음), targetChange('하향' 등, 가끔),
# subject(제목), opinion, compName(증권사), past·delay(불린, 뜻 불명이라 쓰지 않음), cont(요약).
# PDF·애널리스트·공개 리포트 주소가 없다 → pdf·url·analyst는 null.

# 씽크풀이 옛 사명으로 내려주는 증권사를 보관 중인 현재 사명으로 맞춘다.
THINKPOOL_BROKER_ALIASES = {
    "하나금융투자": "하나증권",
    "이베스트투자증권": "LS증권",
    "이베스트증권": "LS증권",
    "하이투자증권": "iM증권",
    "메리츠종금증권": "메리츠증권",
    "신한금융투자": "신한투자증권",
    "KTB투자증권": "다올투자증권",
    "DB금융투자": "DB증권",
}


def thinkpool_broker(name):
    """씽크풀 증권사명 -> 보관 레코드에서 쓰는 이름. 공백을 줄이고 옛 사명은 현재 사명으로."""
    s = _WS.sub(" ", str(name or "").strip())
    return THINKPOOL_BROKER_ALIASES.get(s.replace(" ", ""), THINKPOOL_BROKER_ALIASES.get(s, s))


def thinkpool_today(payload):
    """응답의 todayDate('2026.11.18') -> date. 없거나 깨졌으면 None."""
    if not isinstance(payload, dict):
        return None
    iso = normalize_date(payload.get("todayDate"))
    try:
        return datetime.date.fromisoformat(iso) if iso else None
    except ValueError:
        return None


def infer_year_date(value, anchor):
    """연도 없는 'MM/DD'를 anchor(date) 기준 미래가 아닌 가장 최근 날짜로. 'YYYY-MM-DD' 또는 None.

    연도가 들어 있으면('2026.11.18', '26/11/18') 그 값을 쓴다. 12월 날짜를 1월에 읽으면 전년도다.
    2월 29일처럼 그해에 없는 날은 그 날이 있는 직전 해로 간다(최대 8년).
    """
    s = str(value or "").strip()
    full = normalize_date(s)
    if full:
        return full
    m = re.fullmatch(r"(\d{1,2})[./\-](\d{1,2})\.?", s)
    if not m or anchor is None:
        return None
    mo, d = int(m.group(1)), int(m.group(2))
    for year in range(anchor.year, anchor.year - 9, -1):
        try:
            cand = datetime.date(year, mo, d)
        except ValueError:
            continue
        if cand <= anchor:
            return cand.isoformat()
    return None


def parse_thinkpool_list(payload, today=None):
    """씽크풀 allReport 응답 -> 레코드 리스트.

    연도 추정 기준일은 응답의 todayDate, 없으면 today(date). 종목코드가 올바르지 않은 행
    (산업·시황 등)과 증권사·제목·날짜가 빈 행은 버린다.
    """
    rows = []
    items = payload.get("list") if isinstance(payload, dict) else None
    anchor = thinkpool_today(payload) or today
    for it in items or []:
        if not isinstance(it, dict):
            continue
        rid = str(it.get("rcpNo") or "").strip()
        code = str(it.get("stockCode") or "").strip().upper()
        broker = thinkpool_broker(it.get("compName"))
        if not rid or not is_stock_code(code) or not broker:
            continue
        date = infer_year_date(it.get("date"), anchor)
        title = _WS.sub(" ", str(it.get("subject") or "").strip())
        if not date or not title:
            continue
        summary = clean_summary(_html_to_text(it.get("cont")))
        rows.append({
            "id": "thinkpool:%s" % rid,
            "source": "thinkpool",
            "code": code,
            "name": str(it.get("stockName") or "").strip() or None,
            "title": title,
            "broker": broker,
            "analyst": None,
            "date": date,
            "target": positive_int(it.get("targetPrice")),
            "rating_raw": str(it.get("opinion") or "").strip() or None,
            "pdf": None,
            "url": None,
            "summary": summary[:600] if summary else None,
            "views": None,
        })
    return rows


def thinkpool_rcp_no(rec_id):
    """'thinkpool:569000' -> 569000. 아니면 None."""
    s = str(rec_id or "")
    if not s.startswith("thinkpool:"):
        return None
    return to_int(s.split(":", 1)[1])


# ------------------------------- 증권사 직접 수집 2차 (iM·BNK·상상인) 파서

# 2026-11-16 실측. 셋 다 로그인 없이 목록이 열리고 PDF가 공개 경로에 있다.
# - iM증권: 모바일 리서치 게시판 JSON(_json/source.jsp). 제목 '[종목/의견] 제목', 첨부 조회로 PDF 경로를 받는다
#   (파일명 끝에 종목코드: '[13080033]_011200.pdf').
# - BNK투자증권: 기업분석 게시판 HTML. 제목 '[종목/의견] 제목', 종목코드 없음(이름 매핑), PDF는 /uploads/.
# - 상상인증권: 기업리포트 JSON(종목코드 있음). 상세 본문 '[BUY / 340,000]'에 의견·목표가.
IM_SITE = "https://www.imfnsec.com"
IM_LIST_URL = IM_SITE + "/mobile/invest/invest02.jsp?bid=R_E08&isSmartHi=N"
IM_UPLOAD = IM_SITE + "/upload/"
BNK_SITE = "https://www.bnkfn.co.kr"
BNK_LIST_URL = BNK_SITE + "/research/analysingCompany.jspx"
SSI_SITE = "https://www.sangsanginib.com"
SSI_LIST_URL = SSI_SITE + "/research/enterpriseReport/enterpriseReportView"
SSI_PDF_URL = SSI_SITE + "/_upload/attFile/%s/%s_%s_%s.%s"

_BRACKET_TITLE = re.compile(r"^\s*\[\s*([^\]/]+?)\s*/\s*([^\]]+?)\s*\]\s*(.*)$")
_NAME_JUNK = re.compile(r"\(주\)|㈜|[\s.·,'\"&()\-_/]+")


def split_bracket_title(raw):
    """'[HMM/Hold] 실적은 기대 이상' -> ('HMM', 'Hold', '실적은 기대 이상').

    이 꼴이 아니면(전략·산업 글 등) (None, None, 원문 제목).
    """
    s = _WS.sub(" ", str(raw or "")).strip()
    m = _BRACKET_TITLE.match(s)
    if m is None:
        return None, None, s
    return m.group(1).strip() or None, m.group(2).strip() or None, m.group(3).strip() or s


def name_key(name):
    """종목명 비교용 키. 공백·문장부호·(주)를 떼고 소문자로."""
    return _NAME_JUNK.sub("", str(name or "")).lower()


def build_name_map(universe_rows=None, records=None):
    """{name_key: 종목코드}. 유니버스(app/universe.json 행 [코드, 이름, ...])가 먼저,
    보관 중인 레코드의 (이름, 코드)가 빈 자리를 채운다."""
    out = {}
    for row in universe_rows or ():
        if not isinstance(row, (list, tuple)) or len(row) < 2:
            continue
        code = str(row[0] or "").strip().upper()
        key = name_key(row[1])
        if key and is_stock_code(code):
            out.setdefault(key, code)
    for rec in records or ():
        code = str(rec.get("code") or "").strip().upper()
        key = name_key(rec.get("name"))
        if key and is_stock_code(code):
            out.setdefault(key, code)
    return out


def lookup_code(name, name_map):
    """이름 -> 종목코드. 없으면 None."""
    key = name_key(name)
    return (name_map or {}).get(key) if key else None


def parse_im_list(payload):
    """iM증권 기업분석 목록(_json/source.jsp, board_list) -> 레코드 리스트.

    응답은 [[행...], [{"total_count"}], []]. 제목이 '[종목/의견] 제목' 꼴이 아니면 종목 리포트가 아니다.
    종목코드·PDF는 첨부 조회(parse_im_attach)에서 채운다. im_bid는 첨부 조회용 임시 키.
    """
    rows = []
    items = payload[0] if isinstance(payload, list) and payload else []
    for it in items if isinstance(items, list) else []:
        if not isinstance(it, dict):
            continue
        aid = str(it.get("aid") or "").strip()
        name, rating, title = split_bracket_title(it.get("title"))
        date = normalize_date(it.get("reg_dt"))
        if not aid or not name or not date:
            continue
        rows.append({
            "id": "im:%s" % aid,
            "source": "im",
            "code": None,
            "name": name,
            "title": title,
            "broker": "iM증권",
            "analyst": str(it.get("username") or "").strip() or None,
            "date": date,
            "target": None,
            "rating_raw": rating,
            "pdf": None,
            "url": IM_LIST_URL,
            "summary": None,
            # 사이트 조회수는 네이버와 척도가 달라 쓰지 않는다
            "views": None,
            "im_bid": str(it.get("bid") or "").strip() or None,
        })
    return rows


def im_list_total(payload):
    """목록 응답의 전체 건수. 못 읽으면 None."""
    try:
        return to_int(payload[1][0].get("total_count"))
    except (TypeError, IndexError, AttributeError, KeyError):
        return None


def im_list_dates(payload):
    """목록 응답에 든 모든 행의 날짜(버린 행 포함). 페이지 넘김을 멈출 때 쓴다."""
    items = payload[0] if isinstance(payload, list) and payload else []
    return [d for d in (normalize_date(it.get("reg_dt")) for it in items
                        if isinstance(it, dict)) if d]


_FILE_CODE = re.compile(r"_(%s)\.pdf$" % STOCK_CODE, re.IGNORECASE)


def parse_im_attach(payload):
    """첨부 조회(db/research/twbbacl_attach) -> (PDF URL, 파일명의 종목코드). 없으면 None."""
    files = payload[0] if isinstance(payload, list) and payload else []
    for f in files if isinstance(files, list) else []:
        if not isinstance(f, dict):
            continue
        fname = str(f.get("file_name") or "").strip()
        fdir = str(f.get("file_dir") or "").strip().strip("/")
        if not fname.lower().endswith(".pdf") or not fdir:
            continue
        m = _FILE_CODE.search(fname)
        url = IM_UPLOAD + quote("%s/%s" % (fdir, fname), safe="/")
        return url, (m.group(1).upper() if m else None)
    return None, None


_BNK_VIEW = re.compile(r"viewAction\(\s*this\s*,\s*'(\d+)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*\)")


def parse_bnk_list(html):
    """BNK투자증권 기업분석 목록 HTML -> 레코드 리스트.

    종목코드가 없어 code는 None(수집기가 이름으로 매핑한다). 제목이 '[종목/의견] 제목' 꼴만 남긴다.
    """
    soup = _soup(html)
    rows = []
    for tr in soup.select("tbody tr"):
        link = tr.find("a", onclick=_BNK_VIEW)
        if link is None:
            continue
        m = _BNK_VIEW.search(link.get("onclick") or "")
        seq, path, fname = m.group(1), m.group(2).strip(), m.group(3).strip()
        name, rating, title = split_bracket_title(_text(link))
        tds = tr.find_all("td", recursive=False)
        date = None
        for td in tds:
            parsed = normalize_date(_text(td)) if re.fullmatch(
                r"\d{4}\.\d{1,2}\.\d{1,2}", _text(td)) else None
            if parsed:
                date = parsed
        if not name or not date:
            continue
        analyst = _text(tds[2]) if len(tds) > 2 else ""
        pdf = None
        if fname.lower().endswith(".pdf") and path:
            pdf = BNK_SITE + quote("%s/%s" % (path.rstrip("/"), fname), safe="/")
        rows.append({
            "id": "bnk:%s" % seq,
            "source": "bnk",
            "code": None,
            "name": name,
            "title": title,
            "broker": "BNK투자증권",
            "analyst": analyst or None,
            "date": date,
            "target": None,
            "rating_raw": rating,
            "pdf": pdf,
            "url": pdf or BNK_LIST_URL,
            "summary": None,
            "views": None,
        })
    return rows


def bnk_list_dates(html):
    """목록 HTML의 모든 행 날짜(종목 리포트가 아닌 행 포함)."""
    return [normalize_date(d) for d in re.findall(r"<td>\s*(\d{4}\.\d{2}\.\d{2})\s*</td>",
                                                  html or "")]


def bnk_last_page(html):
    """페이지 나눔의 마지막 쪽 번호. 못 읽으면 None."""
    nums = [int(n) for n in re.findall(r"fn_search\('(\d+)'\)", html or "")]
    return max(nums) if nums else None


_SSI_TITLE = re.compile(r"^.*?\(\s*%s\s*\)\s*:\s*(.*)$" % STOCK_CODE)


def parse_sangsangin_list(payload):
    """상상인증권 기업리포트 목록(/notice/getNoticeList) -> 레코드 리스트.

    의견·목표가·PDF·애널리스트는 상세(parse_sangsangin_detail)에서 채운다.
    목록의 NM('리서치센터'·'research')은 작성 부서라 애널리스트로 쓰지 않는다.
    """
    rows = []
    block = payload[0] if isinstance(payload, list) and payload else {}
    items = block.get("getNoticeList") if isinstance(block, dict) else None
    for it in items or []:
        if not isinstance(it, dict):
            continue
        no = str(it.get("NT_NO") or "").strip()
        code = str(it.get("STOCK_CD") or "").strip().upper()
        date = normalize_date(it.get("REGDT"))
        raw = _WS.sub(" ", str(it.get("TITLE") or "")).strip()
        if not no or not is_stock_code(code) or not date or not raw:
            continue
        m = _SSI_TITLE.match(raw)
        title = (m.group(1).strip() if m else "") or raw
        rows.append({
            "id": "sangsangin:%s" % no,
            "source": "sangsangin",
            "code": code,
            "name": str(it.get("STOCK_NM") or "").strip() or None,
            "title": title,
            "broker": "상상인증권",
            "analyst": None,
            "date": date,
            "target": None,
            "rating_raw": None,
            "pdf": None,
            "url": SSI_LIST_URL,
            "summary": None,
            "views": None,
        })
    return rows


def sangsangin_list_dates(payload):
    block = payload[0] if isinstance(payload, list) and payload else {}
    items = block.get("getNoticeList") if isinstance(block, dict) else None
    return [d for d in (normalize_date(it.get("REGDT")) for it in items or []
                        if isinstance(it, dict)) if d]


def sangsangin_total(payload):
    block = payload[0] if isinstance(payload, list) and payload else {}
    return to_int(block.get("getCount")) if isinstance(block, dict) else None


_SSI_OPINION = re.compile(
    r"\[\s*([A-Za-z가-힣][A-Za-z가-힣 .()]*?)\s*/\s*(?:TP\s*[:：]?\s*)?(\d[\d,]*|-|N/?A)\s*원?\s*\]",
    re.IGNORECASE)
_SSI_ANALYST = re.compile(r"\[\s*상상인증권\s+([^\]]+?)\s*\]")


def parse_sangsangin_detail(payload):
    """상세(/notice/getNoticeDetail) -> {'rating_raw', 'target', 'analyst', 'pdf', 'summary'}.

    본문 첫머리 '[BUY / 340,000]'에서 의견·목표가를, '[상상인증권 IT/전기전자 엄우용]'에서
    애널리스트(마지막 낱말)를 뽑는다. 꼴이 다르면 본문 문장에서 한 번 더 찾는다.
    """
    out = {"rating_raw": None, "target": None, "analyst": None, "pdf": None, "summary": None}
    if not isinstance(payload, dict):
        return out
    notice = payload.get("notice") or {}
    text = _html_to_text(notice.get("CONTS")) if isinstance(notice, dict) else ""
    if text:
        m = _SSI_OPINION.search(text)
        if m:
            out["rating_raw"] = _WS.sub(" ", m.group(1)).strip() or None
            out["target"] = positive_int(m.group(2)) if m.group(2)[0].isdigit() else None
        if out["rating_raw"] is None or out["target"] is None:
            rating_raw, target = extract_opinion_from_text(text)
            out["rating_raw"] = out["rating_raw"] or rating_raw
            out["target"] = out["target"] or target
        a = _SSI_ANALYST.search(text)
        if a:
            out["analyst"] = a.group(1).split()[-1]
        summary = clean_summary(text)
        out["summary"] = summary[:600] if summary else None
    for f in payload.get("file") or []:
        if not isinstance(f, dict):
            continue
        fname = str(f.get("FNM") or "")
        if not fname.lower().endswith(".pdf"):
            continue
        cms = str(f.get("CMS_CD") or "").strip()
        if cms and f.get("NT_NO") is not None and f.get("FNO") is not None:
            out["pdf"] = SSI_PDF_URL % (cms, cms, f.get("NT_NO"), f.get("FNO"), "pdf")
            break
    return out


# PDF 1쪽 텍스트(pypdf)에서 의견·목표가를 뽑는다. 본문 추출 규칙(extract_opinion_from_text)이
# 만 단위 표기와 EPS·BPS·주당 수치를 이미 걸러 주므로 그것을 먼저 쓰고, 영문 표기만 덧붙인다.
_SPACED_TARGET = re.compile(r"목\s*표\s*주\s*가")
_SPACED_OPINION = re.compile(r"투\s*자\s*의\s*견")
# '투자의견 [유지] 매수', '투자의견(12M) Buy' — 꼬리표·기간이 끼어 있는 경우
_PDF_OPINION = re.compile(
    r"투자의견\s*(?:\([^)]{0,8}\))?\s*[:：]?\s*(?:\[[^\]]{1,6}\]\s*)?" + _RATING_WORDS,
    re.IGNORECASE)
_PDF_TP_EN = re.compile(
    r"(?:Target\s*Price|\bTP)\s*(?:\([^)]{0,8}\))?\s*[:：]?\s*(?:KRW|₩|W)?\s*(\d[\d,]{2,})\s*(?:원|KRW)?",
    re.IGNORECASE)


def extract_pdf_opinion(text):
    """PDF 1쪽 텍스트 -> (투자의견 원문, 목표주가). 못 찾으면 각각 None."""
    if not text:
        return None, None
    s = _SPACED_TARGET.sub("목표주가", str(text))
    s = _SPACED_OPINION.sub("투자의견", s)
    rating_raw, target = extract_opinion_from_text(s)
    flat = _WS.sub(" ", s.replace("\xa0", " "))
    if rating_raw is None:
        m = _PDF_OPINION.search(flat)
        if m:
            rating_raw = _WS.sub(" ", m.group(1)).strip()
    if target is None:
        m = _PDF_TP_EN.search(flat)
        if m:
            value = to_int(m.group(1))
            target = value if value and value >= 100 else None
    return rating_raw, target


_PAREN_CODE = re.compile(r"\(\s*A?(%s)\s*\)" % STOCK_CODE)


def extract_code_from_text(text, name=None, head=1500):
    """PDF 1쪽 머리에서 '종목명 (035720)'의 코드를 찾는다. 못 찾으면 None.

    name이 있으면 코드 바로 앞(40자 안)에 그 이름이 있는 것만 받는다.
    """
    s = str(text or "")[:head]
    want = name_key(name)
    for m in _PAREN_CODE.finditer(s):
        if not want or want in name_key(s[max(0, m.start() - 40):m.start()]):
            return m.group(1)
    return None


# --------------------------------------- 네이버 산업·시황 리포트 파서

NAVER_RESEARCH_KIND_URL = "https://m.stock.naver.com/research/%s/%s"
RESEARCH_KINDS = ("industry", "market")


def parse_naver_research_list(items, kind):
    """/api/research/industry·market 응답(배열) -> 산업·시황 레코드 리스트.

    애널리스트는 목록·상세 어디에도 없어 None. pdf는 상세(attachUrl)에서 채운다.
    category는 산업 리포트의 업종명이고, 시황 리포트는 None이다.
    """
    if kind not in RESEARCH_KINDS:
        raise ValueError("kind는 industry 또는 market: %r" % (kind,))
    rows = []
    for it in items or []:
        if not isinstance(it, dict):
            continue
        rid = str(it.get("researchId") or "").strip()
        date = normalize_date(it.get("writeDate"))
        if not rid.isdigit() or not date:
            continue
        category = None
        if kind == "industry":
            category = str(it.get("category") or "").strip() or None
        url = str(it.get("endUrl") or "").strip() or NAVER_RESEARCH_KIND_URL % (kind, rid)
        rows.append({
            "id": "%s:%s" % (kind, rid),
            "kind": kind,
            "date": date,
            "title": _WS.sub(" ", str(it.get("title") or "").strip()),
            "broker": str(it.get("brokerName") or "").strip(),
            "analyst": None,
            "category": category,
            "pdf": None,
            "url": url,
            "views": to_int(it.get("readCount")),
        })
    return rows


def parse_naver_research_pdf(obj):
    """산업·시황 상세 응답 -> PDF 주소 또는 None."""
    content = (obj or {}).get("researchContent") if isinstance(obj, dict) else None
    if not isinstance(content, dict):
        return None
    return str(content.get("attachUrl") or "").strip() or None


# ------------------------------------------------------- 일봉(siseJson) 파서

_SISE_ROW = re.compile(
    r"\[\s*['\"](\d{8})['\"]\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,"
    r"\s*(-?[\d.]+)")


def parse_sise_json(text):
    """api.finance.naver.com/siseJson.naver 응답 -> [(YYYY-MM-DD, 시가, 고가, 저가, 종가), ...].

    엄밀한 JSON이 아니다(작은따옴표 머리줄, 줄바꿈·탭, 끝 쉼표). 날짜로 시작하는 행만 정규식으로 줍고
    날짜 오름차순으로 돌려준다. 값이 0 이하인 행(거래정지 등)은 버린다.
    """
    out = {}
    for m in _SISE_ROW.finditer(str(text or "")):
        d = m.group(1)
        try:
            o, h, l, c = (int(float(m.group(i))) for i in range(2, 6))
        except ValueError:
            continue
        if min(h, l, c) <= 0:
            continue
        out["%s-%s-%s" % (d[:4], d[4:6], d[6:])] = (o, h, l, c)
    return [(d,) + out[d] for d in sorted(out)]


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
