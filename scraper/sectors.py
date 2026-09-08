"""업종 분류 수집.

네이버 금융 업종(sise_group)에서 '업종명 -> 종목코드' 목록을 긁어
data/sectors.json 을 만든다. 대분류(sector)는 아래 SECTOR_MAP 하드코딩표를 따른다.

네트워크 호출은 collect.py 가 넘겨주는 fetch/session/log 를 그대로 쓴다
(요청 간격·재시도·UA 정책을 수집기와 한 벌로 유지하기 위해서다).
파싱 함수(parse_sector_list·parse_sector_codes)는 네트워크를 타지 않아
test_parsers.py 가 픽스처만으로 검증한다.
"""

import re
import time
from datetime import datetime, timedelta, timezone
from html import unescape as _unescape

KST = timezone(timedelta(hours=9))
REQUEST_GAP = 0.4
STALE_DAYS = 7

SECTOR_LIST_URL = "https://finance.naver.com/sise/sise_group.naver"
SECTOR_DETAIL_URL = "https://finance.naver.com/sise/sise_group_detail.naver"

# 업종명 -> 대분류. 네이버 업종 79개를 11개로 접는다.
# 표에 없는 업종명이 새로 나타나면 '기타'로 두고 경고를 남긴다.
SECTOR_MAP = {
    # IT
    "반도체와반도체장비": "IT", "전자장비와기기": "IT", "디스플레이장비및부품": "IT",
    "디스플레이패널": "IT", "컴퓨터와주변기기": "IT", "사무용전자제품": "IT",
    "전자제품": "IT", "통신장비": "IT", "핸드셋": "IT", "소프트웨어": "IT",
    "IT서비스": "IT", "게임엔터테인먼트": "IT", "양방향미디어와서비스": "IT",
    "인터넷과카탈로그소매": "IT",
    # 헬스케어
    "제약": "헬스케어", "생물공학": "헬스케어", "생명과학도구및서비스": "헬스케어",
    "건강관리업체및서비스": "헬스케어", "건강관리장비와용품": "헬스케어",
    "건강관리기술": "헬스케어",
    # 금융
    "은행": "금융", "증권": "금융", "카드": "금융", "생명보험": "금융",
    "손해보험": "금융", "기타금융": "금융", "창업투자": "금융", "부동산": "금융",
    # 산업재
    "건설": "산업재", "건축제품": "산업재", "건축자재": "산업재", "기계": "산업재",
    "전기장비": "산업재", "전기제품": "산업재", "조선": "산업재",
    "우주항공과국방": "산업재", "무역회사와판매업체": "산업재", "복합기업": "산업재",
    "상업서비스와공급품": "산업재", "항공화물운송과물류": "산업재", "항공사": "산업재",
    "해운사": "산업재", "도로와철도운송": "산업재", "운송인프라": "산업재",
    # 경기소비재
    "자동차": "경기소비재", "자동차부품": "경기소비재", "호텔,레스토랑,레저": "경기소비재",
    "화장품": "경기소비재", "섬유,의류,신발,호화품": "경기소비재",
    "가정용기기와용품": "경기소비재", "가구": "경기소비재", "레저용장비와제품": "경기소비재",
    "백화점과일반상점": "경기소비재", "전문소매": "경기소비재", "판매업체": "경기소비재",
    "교육서비스": "경기소비재", "다각화된소비자서비스": "경기소비재", "문구류": "경기소비재",
    # 필수소비재
    "식품": "필수소비재", "음료": "필수소비재", "담배": "필수소비재",
    "식품과기본식료품소매": "필수소비재", "가정용품": "필수소비재",
    # 소재
    "화학": "소재", "철강": "소재", "비철금속": "소재", "종이와목재": "소재",
    "포장재": "소재",
    # 에너지
    "에너지장비및서비스": "에너지", "석유와가스": "에너지",
    # 유틸리티
    "전기유틸리티": "유틸리티", "가스유틸리티": "유틸리티", "복합유틸리티": "유틸리티",
    # 통신·미디어
    "무선통신서비스": "통신·미디어", "다각화된통신서비스": "통신·미디어",
    "방송과엔터테인먼트": "통신·미디어", "광고": "통신·미디어", "출판": "통신·미디어",
    # 기타
    "기타": "기타",
}

# 화면 칩 순서와 맞춘 대분류 목록.
SECTOR_ORDER = ["IT", "헬스케어", "금융", "산업재", "경기소비재", "필수소비재",
                "소재", "에너지", "유틸리티", "통신·미디어", "기타"]

FALLBACK_SECTOR = "기타"


def sector_of(industry):
    """업종명 -> 대분류. 표에 없으면 '기타'. 업종명이 없으면 None."""
    if not industry:
        return None
    return SECTOR_MAP.get(industry, FALLBACK_SECTOR)


# ------------------------------------------------------------------- 파서

# 목록의 링크. 네이버는 &를 그대로 주지만 &amp;로 이스케이프되어도 잡히게 둔다.
_GROUP_RE = re.compile(
    r"sise_group_detail\.naver\?type=upjong&(?:amp;)?no=(\d+)\"[^>]*>([^<]+)<")
_CODE_RE = re.compile(r"/item/main\.naver\?code=(\d{6})")


def parse_sector_list(html):
    """업종 목록 HTML -> [(no, 업종명), ...]. 등장 순서를 지키고 no로 중복을 제거한다."""
    if not html:
        return []
    out = []
    seen = set()
    for no, name in _GROUP_RE.findall(html):
        name = _unescape(name).replace("\xa0", " ").strip()
        if not name or no in seen:
            continue
        seen.add(no)
        out.append((no, name))
    return out


def parse_sector_codes(html):
    """업종 상세 HTML -> ['005930', ...]. 등장 순서를 지키고 중복을 제거한다."""
    if not html:
        return []
    out = []
    seen = set()
    for code in _CODE_RE.findall(html):
        if code in seen:
            continue
        seen.add(code)
        out.append(code)
    return out


# ------------------------------------------------------------------- 수집

def collect_sectors(session, fetch, log=print, gap=REQUEST_GAP):
    """네이버 업종 분류를 통째로 긁어 sectors.json 페이로드를 만든다.

    돌려주는 값: {'updated_at', 'industries', 'codes'} 또는 실패 시 None.
    호출부(collect.py)는 None이면 기존 파일을 그대로 둔다.
    """
    html = fetch(session, SECTOR_LIST_URL, params={"type": "upjong"}, encoding="euc-kr")
    if html is None:
        log("  ! 업종 목록을 받지 못했습니다.")
        return None
    groups = parse_sector_list(html)
    if not groups:
        log("  ! 업종 목록을 파싱하지 못했습니다 (마크업이 바뀌었을 수 있습니다).")
        return None
    log("  업종 %d개" % len(groups))

    industries = {}
    codes = {}
    unknown = []
    failed = 0
    for i, (no, name) in enumerate(groups, 1):
        if name not in SECTOR_MAP:
            unknown.append(name)
        industries[name] = sector_of(name)

        time.sleep(gap)
        detail = fetch(session, SECTOR_DETAIL_URL,
                       params={"type": "upjong", "no": no},
                       encoding="euc-kr", referer=SECTOR_LIST_URL)
        if detail is None:
            failed += 1
            continue
        for code in parse_sector_codes(detail):
            codes.setdefault(code, name)  # 먼저 만난 업종을 남긴다
        if i % 20 == 0 or i == len(groups):
            log("  업종 %d/%d: 종목 %d개" % (i, len(groups), len(codes)))

    if unknown:
        log("  ! 매핑표에 없는 업종 %d개는 '기타'로 둡니다: %s"
            % (len(unknown), ", ".join(unknown)))
    if failed:
        log("  ! 업종 상세 %d개를 받지 못했습니다 (그만큼 종목이 빠집니다)." % failed)
    if not codes:
        log("  ! 업종별 종목을 한 건도 받지 못했습니다.")
        return None

    return {
        "updated_at": datetime.now(KST).isoformat(timespec="seconds"),
        "industries": industries,
        "codes": {code: codes[code] for code in sorted(codes)},
    }


def is_stale(payload, now=None, days=STALE_DAYS):
    """sectors.json이 없거나 updated_at이 days일 이상 지났으면 True."""
    if not isinstance(payload, dict):
        return True
    raw = payload.get("updated_at")
    if not raw:
        return True
    try:
        stamp = datetime.fromisoformat(str(raw))
    except ValueError:
        return True
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=KST)
    now = now or datetime.now(KST)
    return (now - stamp) >= timedelta(days=days)
