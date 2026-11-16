"""parsers.py 검증. 네트워크 없이 픽스처 문자열만으로 돈다.

실행:  python scraper/test_parsers.py
       python -m unittest discover -s scraper
"""

import datetime
import os
import sys
import unittest

# 윈도우 기본 콘솔(cp949)에서 한글/기호가 깨지지 않게.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from parsers import (  # noqa: E402
    apply_target_changes,
    compact_date,
    compute_gap,
    extract_opinion_from_text,
    is_stock_code,
    normalize_broker,
    normalize_date,
    normalize_rating,
    parse_hankyung_list,
    parse_kb_list,
    parse_kis_detail,
    parse_kis_list,
    parse_kis_total,
    parse_naver_api_detail,
    parse_naver_api_list,
    parse_nh_list,
    parse_naver_research_list,
    parse_naver_research_pdf,
    parse_nh_summary,
    parse_price_payload,
    parse_sise_json,
    parse_wise_list,
    to_int,
    wise_page_info,
)
from parsers import name_is_broker  # noqa: E402
import normalize as norm  # noqa: E402
import perf as perf_mod  # noqa: E402
import store  # noqa: E402
from wise import wise_due  # noqa: E402
from check_sources import (  # noqa: E402
    business_days_since,
    stale_sources,
)
from sectors import (  # noqa: E402
    SECTOR_MAP,
    SECTOR_ORDER,
    is_stale,
    parse_sector_codes,
    parse_sector_list,
    sector_of,
)

KST_TZ = datetime.timezone(datetime.timedelta(hours=9))

# ------------------------------------------------------------------ 픽스처

# 네이버 증권 리서치 API 실측 응답 (2026-09-16).
# itemCode는 영문자를 품을 수 있다(0126Z0 삼성에피스홀딩스).
NAVER_API_LIST = [
    {
        "researchCategory": "종목분석",
        "category": "종목분석",
        "itemCode": "068270",
        "itemName": "셀트리온",
        "researchId": 96183,
        "title": "더욱 강하게 밟는 가속성장페달, 2027년",
        "brokerName": "DS투자증권",
        "writeDate": "2026-09-16",
        "readCount": "20",
        "endUrl": "https://m.stock.naver.com/research/company/96183",
    },
    {
        "researchCategory": "종목분석",
        "category": "종목분석",
        "itemCode": "0126Z0",
        "itemName": "삼성에피스홀딩스",
        "researchId": 96170,
        "title": "분할 이후를 본다",
        "brokerName": "한화투자증권",
        "writeDate": "2026-09-15",
        "readCount": "1,234",
        "endUrl": "https://m.stock.naver.com/research/company/96170",
    },
    # 종목코드가 없는 건(산업·시황이 섞여 들어오는 경우)은 버린다
    {"itemCode": "", "itemName": "", "researchId": 96169, "title": "시황",
     "brokerName": "X증권", "writeDate": "2026-09-15", "readCount": "1"},
]

NAVER_API_DETAIL = {
    "researchContent": {
        "itemCode": "068270",
        "itemName": "셀트리온",
        "researchId": "96183",
        "title": "더욱 강하게 밟는 가속성장페달, 2027년",
        "brokerName": "DS투자증권",
        "writeDate": "2026-09-16",
        "readCount": "52",
        "attachUrl": "https://stock.pstatic.net/stock-research/company/66/"
                     "20260916_company_126967000.pdf",
        "content": "<p><strong>2027년 매출액 약 7.1조원</strong></p>"
                   "<p><br>셀트리온에 대하여 고성장세를 지속할 것으로 전망한다."
                   " 20260916_company_126967000.pdf</p>",
        "opinion": "매수",
        "goalPrice": "320000",
        "prevGoalPrice": "177500",
        "priceAtWriteDate": "177500",
    },
    "researchSummaries": [],
}

# 목표가를 제시하지 않은 건. 빈 문자열·"0"·null이 섞여 온다.
NAVER_API_DETAIL_NONE = {
    "researchContent": {
        "itemCode": "123456",
        "itemName": "무등급",
        "researchId": "96000",
        "attachUrl": "",
        "content": "",
        "opinion": "Not Rated",
        "goalPrice": "0",
        "prevGoalPrice": None,
        "priceAtWriteDate": "",
    }
}

HANKYUNG_HTML = """
<html><body>
<table>
<tbody>
  <tr><th>작성일</th><th>제목</th><th>적정가격</th><th>투자의견</th><th>작성자</th>
      <th>제공출처</th><th>기업정보</th><th>차트</th><th>첨부</th></tr>
  <tr>
    <td class="first txt_number">2026-09-07</td>
    <td class="text_l">
      <a href="/analysis/downpdf?report_idx=670001" target="_blank">피에스케이홀딩스(031980) 홀딩스의 시간이 온다 </a>
      <div class="layerPop"><div class="pop01 disNone" id="content_670001">
        <strong>피에스케이홀딩스(031980) 홀딩스의 시간이 온다</strong>
      </div></div>
    </td>
    <td class="text_r txt_number">200,000</td>
    <td>\r\n매수                                </td>
    <td>김애널</td>
    <td>DS투자증권</td>
    <td><div class="dv_input"><a href="javascript:_popup_open('https://comp.kisline.com/x?code=031980')">기업정보</a></div></td>
    <td><div class="dv_input"><a class="chart_btn" href="/chart/view_frame?report_type=CO&amp;business_code=031980"><img alt="차트"/></a></div></td>
    <td><div class="dv_input"><a href="/analysis/downpdf?report_idx=670001" title="a.pdf"><img alt="a.pdf"/></a></div></td>
  </tr>
  <tr>
    <td class="first txt_number">2026-09-07</td>
    <td class="text_l">
      <a href="/analysis/downpdf?report_idx=670002" target="_blank">한경단독(123456) 컨센서스 단독 리포트</a>
      <div class="layerPop"><div class="pop01 disNone" id="content_670002">
        <strong>한경단독(123456) 컨센서스 단독 리포트</strong>
      </div></div>
    </td>
    <td class="text_r txt_number">0</td>
    <td>\r\n투자의견없음                            </td>
    <td>박애널</td>
    <td>한경증권</td>
    <td><div class="dv_input"><a href="javascript:_popup_open('https://comp.kisline.com/x?code=123456')">기업정보</a></div></td>
    <td><div class="dv_input"><a class="chart_btn" href="/chart/view_frame?report_type=CO&amp;business_code=123456"><img alt="차트"/></a></div></td>
    <td><div class="dv_input"><a href="/analysis/downpdf?report_idx=670002" title="b.pdf"><img alt="b.pdf"/></a></div></td>
  </tr>
</tbody>
</table>
</body></html>
"""

# KB 실제 응답에서 필요한 키만 남겼다. 첫 건은 산업(위클리) 리포트가 대표 종목코드를
# 달고 온 오탐이다 — stkCd 128940인데 제목의 코드는 350510이다.
KB_PAYLOAD = {
    "status": "200",
    "response": {
        "totalCount": 0,
        "reportList": [
            {"docTitle": "제약 (350510)", "docTitleSub": "Biopharma Deals & News Weekly",
             "publicDate": "2026-09-07", "stkCd": "128940", "indName": "제약",
             "recomm": "Positive", "recommChg": "Positive", "tp": "",
             "analystNm": "신지훈", "documentid": "20260907084805640K",
             "docDetail": "- 주요 기술이전 및 M&A\n- 자가면역 CAR-T 임상 중단"},
            {"docTitle": "CJ CGV (079160)", "docTitleSub": "극장 흥행 9월에도 이어질 것",
             "publicDate": "2026-09-07", "stkCd": "079160", "indName": None,
             "recomm": "Hold", "recommChg": "유지", "tp": "6000.0000",
             "analystNm": "이현지", "documentid": "20260904133704237K",
             "docDetail": "- 투자의견 Hold 유지, 목표주가 6,000원으로 상향 조정\n- 3Q26E: 컨센서스 상회 전망"},
            {"docTitle": "스몰캡 (123456)", "docTitleSub": "", "publicDate": "2026-09-05",
             "stkCd": "123456", "recomm": "Not Rated", "tp": None,
             "analystNm": "김스몰", "documentid": "20260905111111111K",
             "docDetail": "커버리지 개시 전 자료."},
        ],
    },
}

NH_LIST_PAYLOAD = {
    "DATA": {"RESPONSE": {"H3211OutBlock2": {"ROW": [
        {"rsh_ppr_no": "000000000000147095", "rsh_ppr_dru_dt": "20260907",
         "rsh_ppr_dru_tm": "00000000", "rsh_ppr_til_cts": "[아모레퍼시픽] 분명, 변화하고 있다",
         "rsh_ppr_dru_emp_fnm": "정지윤", "rsh_ppr_iem_cd_pcl": "090430",
         "rsh_ppr_dru_dt_nm": "2026.09.07",
         "hpge_fle_url_cts": "http://download.nhqv.com/CommFile/cis/rsh/epr/CISPPR1.pdf"},
        {"rsh_ppr_no": "000000000000147088", "rsh_ppr_dru_dt": "20260906",
         "rsh_ppr_dru_tm": "00000000", "rsh_ppr_til_cts": "제목만 있고 종목코드가 없는 건",
         "rsh_ppr_dru_emp_fnm": "이화정", "rsh_ppr_iem_cd_pcl": "",
         "hpge_fle_url_cts": ""},
    ]}}},
}

# rsh_ppr_cts는 HTML이 두 번 escape 되어 내려온다.
NH_SUMMARY_PAYLOAD = {
    "DATA": {"RESPONSE": {"H3212OutBlock1": {"COUNT": 1, "ROW": [{
        "rsh_ppr_iem_cd_pcl": "090430",
        "rsh_ppr_iem_nm_pcl": "아모레퍼시픽",
        "rsh_ppr_cts": (
            "&amp;lt;span style=&amp;quot;color:#616161;&amp;quot;&amp;gt;"
            "투자의견 Buy 유지하며, 목표주가를 185,000원(기존 170,000원)으로 상향."
            "&amp;lt;/span&amp;gt;&amp;lt;br /&amp;gt;&amp;amp;nbsp;밸류에이션 산정 시점을 2027년으로 변경."
        ),
    }]}}},
}

# 실제 목록 마크업을 줄여 옮겼다. 산업Note는 종목 리포트가 아니라 걸러져야 한다.
KIS_LIST_HTML = """
<html><body>
<div class="comp"><div class="right_area count_area"><p>전체건수 <span>20</span>건</p></div></div>
<ul class="view_area line">
  <li>
    <a class="view_con" href="javascript:void(0)" onclick="event.preventDefault(); doDetail('159077');return false;">
      <div class="head blue">AIR 스몰캡</div>
      <div class="body">
        <span class="body_tit">
            AIR 스몰캡 엘티씨 (170920):엘티씨, 반도체 및 디스플레이 소재...
        </span>
        <span class="body_sub">주요 손익- 2026년 2분기 기준 매출액은 1,409억원...</span>
      </div>
      <span class="tit_info"><em>김연준</em><em>2026.09.07</em></span>
    </a>
    <a class="pdf_btn" href="javascript:void(0)" onclick="javascript:prePdfFileView('?category1=05','20260907153849397_ko.pdf','01', '2026.09.07', 'N', 'Y', 'N')"><span>원문보기</span></a>
  </li>
  <li>
    <a class="view_con" href="javascript:void(0)" onclick="event.preventDefault(); doDetail('159059');return false;">
      <div class="head blue">산업Note</div>
      <div class="body"><span class="body_tit">유통:역발상이 유리한 시점</span>
        <span class="body_sub">환율에 웃고 환율에 울고</span></div>
      <span class="tit_info"><em>김유통</em><em>2026.09.07</em></span>
    </a>
  </li>
  <li>
    <a class="view_con" href="javascript:void(0)" onclick="event.preventDefault(); doDetail('159058');return false;">
      <div class="head blue">기업Note</div>
      <div class="body"><span class="body_tit">하나마이크론 (067310):NDR 후기: 정답만을 보여주는 중</span>
        <span class="body_sub">상반기 성장의 주역, 브라질 법인...</span></div>
      <span class="tit_info"><em>남채민</em><em>2026.09.07</em></span>
    </a>
  </li>
</ul>
</body></html>
"""

KIS_DETAIL_HTML = """
<html><body>
<div id="content" class="research"><div class="comp type_v"><div class="v_info_con">
  <div class="content_title">
    <span class="sub_title">기업Note</span>
    <h1 class="h1_title">하나마이크론 (067310):NDR 후기: 정답만을 보여주는 중</h1>
    <span class="info">남채민<em>2026.09.07</em></span>
  </div>
  <div class="v_info_body">
    <div class='v_info_head'>12MF PER 9.2배의 매력적인 밸류에이션</div>
    <div class='v_info_body'><BR>하나마이크론에 대한 투자의견 매수와 목표주가 68,000원을 유지한다.</div>
  </div>
</div></div></div>
</body></html>
"""

# 업종 목록 API 실측 응답 (2026-09-16). no로 중복을 제거한다.
SECTOR_LIST_PAYLOAD = {
    "stockListSortType": "INDUSTRY",
    "groups": [
        {"no": 278, "name": "전기유틸리티", "totalCount": 9},
        {"no": 261, "name": "반도체와반도체장비", "totalCount": 120},
        {"no": 261, "name": "반도체와반도체장비", "totalCount": 120},  # 중복
        {"no": 284, "name": "호텔,레스토랑,레저", "totalCount": 30},   # 콤마는 그대로
        {"no": "", "name": "이름만 있는 행"},
    ],
    "totalCount": 79,
}

SECTOR_DETAIL_PAYLOAD = {
    "stockListSortType": "INDUSTRY",
    "stocks": [
        {"stockEndType": "stock", "itemCode": "005930", "stockName": "삼성전자"},
        {"stockEndType": "stock", "itemCode": "000660", "stockName": "SK하이닉스"},
        {"stockEndType": "stock", "itemCode": "0126Z0", "stockName": "삼성에피스홀딩스"},
        {"stockEndType": "stock", "itemCode": "005930", "stockName": "삼성전자"},  # 중복
        {"stockEndType": "stock", "itemCode": "BADCODE", "stockName": "형식 오류"},
    ],
    "totalCount": 3,
}

# 2026-09-08 기준 네이버 업종 79개. 하나도 빠짐없이 대분류가 붙어야 한다.
NAVER_INDUSTRIES = [
    "전기유틸리티", "건설", "건강관리기술", "기계", "반도체와반도체장비", "창업투자",
    "백화점과일반상점", "통신장비", "비철금속", "방송과엔터테인먼트", "조선",
    "컴퓨터와주변기기", "기타", "복합기업", "가구", "항공사", "가정용기기와용품",
    "우주항공과국방", "부동산", "증권", "가정용품", "복합유틸리티", "다각화된통신서비스",
    "교육서비스", "석유와가스", "생명과학도구및서비스", "소프트웨어", "화학",
    "식품과기본식료품소매", "건축자재", "운송인프라", "건강관리장비와용품",
    "다각화된소비자서비스", "호텔,레스토랑,레저", "레저용장비와제품", "생명보험",
    "기타금융", "전문소매", "철강", "건강관리업체및서비스", "종이와목재",
    "도로와철도운송", "제약", "무선통신서비스", "가스유틸리티", "사무용전자제품",
    "광고", "식품", "섬유,의류,신발,호화품", "건축제품", "인터넷과카탈로그소매",
    "상업서비스와공급품", "에너지장비및서비스", "음료", "담배", "화장품", "핸드셋",
    "포장재", "디스플레이패널", "디스플레이장비및부품", "전기제품", "카드", "전기장비",
    "자동차", "판매업체", "항공화물운송과물류", "은행", "무역회사와판매업체", "생물공학",
    "해운사", "자동차부품", "양방향미디어와서비스", "손해보험", "게임엔터테인먼트",
    "출판", "문구류", "전자제품", "IT서비스", "전자장비와기기",
]

PRICE_PAYLOAD = {
    "result": {
        "areas": [{
            "name": "SERVICE_ITEM",
            "datas": [
                {"cd": "031980", "nm": "피에스케이홀딩스", "nv": 152000, "sv": 150000, "cr": 1.33, "ms": "CLOSE"},
                {"cd": "005930", "nm": "삼성전자", "nv": 74800, "sv": 74000, "cr": 1.08, "ms": "CLOSE"},
                {"cd": "999999", "nm": "상장폐지", "nv": 0, "sv": 0, "cr": 0.0, "ms": "CLOSE"},
            ],
        }]
    }
}


# ------------------------------------------------------------------- 테스트

class TestStockCode(unittest.TestCase):
    def test_new_style_codes(self):
        # 영문자를 품는 신형 코드도 통과해야 한다
        for code in ("005930", "0126Z0", "00680K", "0167A0"):
            self.assertTrue(is_stock_code(code), code)

    def test_rejects(self):
        # 길이가 다르거나 첫 자리가 숫자가 아니거나 소문자면 거른다
        for bad in ("", None, "12345", "1234567", "A05930", "0126z0", "BADCODE", "종목"):
            self.assertFalse(is_stock_code(bad), repr(bad))

    def test_strips_whitespace(self):
        self.assertTrue(is_stock_code(" 005930 "))


class TestNaverApiListParser(unittest.TestCase):
    def test_rows(self):
        rows = parse_naver_api_list(NAVER_API_LIST)
        self.assertEqual(len(rows), 2)   # 종목코드 없는 행은 버린다

        first = rows[0]
        self.assertEqual(first["id"], "naver:96183")
        self.assertEqual(first["source"], "naver")
        self.assertEqual(first["nid"], "96183")
        self.assertEqual(first["code"], "068270")
        self.assertEqual(first["name"], "셀트리온")
        self.assertEqual(first["title"], "더욱 강하게 밟는 가속성장페달, 2027년")
        self.assertEqual(first["broker"], "DS투자증권")
        self.assertEqual(first["date"], "2026-09-16")
        self.assertEqual(first["views"], 20)
        self.assertIsNone(first["pdf"])     # PDF는 상세에서 붙인다
        self.assertEqual(first["url"],
                         "https://m.stock.naver.com/research/company/96183")

    def test_alpha_code_and_comma_views(self):
        second = parse_naver_api_list(NAVER_API_LIST)[1]
        self.assertEqual(second["code"], "0126Z0")
        self.assertEqual(second["name"], "삼성에피스홀딩스")
        self.assertEqual(second["date"], "2026-09-15")
        self.assertEqual(second["views"], 1234)

    def test_garbage(self):
        self.assertEqual(parse_naver_api_list(None), [])
        self.assertEqual(parse_naver_api_list([]), [])
        self.assertEqual(parse_naver_api_list(["문자열", None, 3]), [])


class TestNaverApiDetailParser(unittest.TestCase):
    def test_normal(self):
        d = parse_naver_api_detail(NAVER_API_DETAIL)
        self.assertEqual(d["target"], 320000)
        self.assertEqual(d["rating_raw"], "매수")
        self.assertEqual(d["naver_prev_target"], 177500)
        self.assertEqual(d["price_at_write"], 177500)
        self.assertTrue(d["pdf"].endswith("20260916_company_126967000.pdf"))
        # HTML 태그는 걷어내고 공백은 한 칸으로 접는다
        self.assertNotIn("<", d["summary"])
        self.assertTrue(d["summary"].startswith("2027년 매출액 약 7.1조원"))
        self.assertNotIn("  ", d["summary"])

    def test_trailing_attachment_name_stripped(self):
        # 본문 끝에 딸려 오는 첨부파일 이름은 요약에서 뺀다
        d = parse_naver_api_detail(NAVER_API_DETAIL)
        self.assertFalse(d["summary"].endswith(".pdf"))
        self.assertNotIn("20260916_company_126967000.pdf", d["summary"])

    def test_no_target(self):
        d = parse_naver_api_detail(NAVER_API_DETAIL_NONE)
        self.assertIsNone(d["target"])            # "0"은 값 없음
        self.assertIsNone(d["naver_prev_target"])  # None
        self.assertIsNone(d["price_at_write"])     # ""
        self.assertIsNone(d["pdf"])
        self.assertIsNone(d["summary"])
        self.assertEqual(d["rating_raw"], "Not Rated")
        self.assertEqual(normalize_rating(d["rating_raw"]), "NR")

    def test_summary_truncated_to_600(self):
        obj = {"researchContent": {"content": "<p>" + ("가" * 900) + "</p>"}}
        self.assertEqual(len(parse_naver_api_detail(obj)["summary"]), 600)

    def test_garbage(self):
        for obj in (None, {}, {"researchContent": None}, {"researchContent": []}):
            d = parse_naver_api_detail(obj)
            self.assertIsNone(d["target"])
            self.assertIsNone(d["rating_raw"])
            self.assertIsNone(d["summary"])

    def test_no_code_field(self):
        # 상세 파서는 종목코드를 돌려주지 않는다. 목록에서 받은 코드를 쓴다.
        self.assertNotIn("code", parse_naver_api_detail(NAVER_API_DETAIL))


class TestHankyungParser(unittest.TestCase):
    def test_rows(self):
        rows = parse_hankyung_list(HANKYUNG_HTML)
        self.assertEqual(len(rows), 2)
        a = rows[0]
        self.assertEqual(a["date"], "2026-09-07")
        self.assertEqual(a["code"], "031980")
        self.assertEqual(a["name"], "피에스케이홀딩스")
        self.assertEqual(a["title"], "홀딩스의 시간이 온다")
        self.assertEqual(a["target"], 200000)
        self.assertEqual(a["rating_raw"], "매수")
        self.assertEqual(a["analyst"], "김애널")
        self.assertEqual(a["broker"], "DS투자증권")
        self.assertEqual(a["source"], "hankyung")
        self.assertEqual(
            a["pdf"],
            "https://consensus.hankyung.com/analysis/downpdf?report_idx=670001")
        self.assertEqual(a["id"], "hankyung:670001")

    def test_zero_target_is_none(self):
        rows = parse_hankyung_list(HANKYUNG_HTML)
        self.assertIsNone(rows[1]["target"])
        self.assertEqual(normalize_rating(rows[1]["rating_raw"]), "NR")

    def test_title_not_duplicated_by_hover_layer(self):
        # div.layerPop이 제목을 한 번 더 품고 있어도 제목은 한 번만 나와야 한다
        rows = parse_hankyung_list(HANKYUNG_HTML)
        self.assertEqual(rows[0]["title"], "홀딩스의 시간이 온다")
        self.assertEqual(rows[0]["title"].count("홀딩스의 시간이 온다"), 1)

    def test_blocked_page_yields_nothing(self):
        self.assertEqual(parse_hankyung_list("Block access. 0001"), [])


class TestKbParser(unittest.TestCase):
    def test_industry_report_filtered_out(self):
        # stkCd(128940)와 제목의 코드(350510)가 다른 산업 리포트는 버린다
        rows = parse_kb_list(KB_PAYLOAD)
        self.assertEqual([r["code"] for r in rows], ["079160", "123456"])

    def test_row(self):
        row = parse_kb_list(KB_PAYLOAD)[0]
        self.assertEqual(row["id"], "kb:20260904133704237K")
        self.assertEqual(row["source"], "kb")
        self.assertEqual(row["date"], "2026-09-07")
        self.assertEqual(row["name"], "CJ CGV")
        self.assertEqual(row["title"], "극장 흥행 9월에도 이어질 것")
        self.assertEqual(row["broker"], "KB증권")
        self.assertEqual(row["analyst"], "이현지")
        self.assertEqual(row["rating_raw"], "Hold")
        self.assertEqual(normalize_rating(row["rating_raw"]), "HOLD")
        self.assertEqual(row["target"], 6000)
        self.assertEqual(row["pdf"],
                         "https://rdata.kbsec.com/pdf_data/20260904133704237K.pdf")
        self.assertEqual(row["url"], row["pdf"])
        self.assertIn("컨센서스 상회 전망", row["summary"])

    def test_empty_target_and_subtitle(self):
        row = parse_kb_list(KB_PAYLOAD)[1]
        self.assertIsNone(row["target"])          # tp가 None
        self.assertEqual(row["title"], "스몰캡 (123456)")  # 부제가 비면 원제목
        self.assertEqual(normalize_rating(row["rating_raw"]), "NR")

    def test_garbage(self):
        self.assertEqual(parse_kb_list(None), [])
        self.assertEqual(parse_kb_list({"response": {}}), [])


class TestNhParser(unittest.TestCase):
    def test_list_row(self):
        rows = parse_nh_list(NH_LIST_PAYLOAD)
        self.assertEqual(len(rows), 1)  # 종목코드 없는 건은 버린다
        row = rows[0]
        self.assertEqual(row["id"], "nh:000000000000147095")
        self.assertEqual(row["source"], "nh")
        self.assertEqual(row["code"], "090430")
        self.assertEqual(row["name"], "아모레퍼시픽")   # 대괄호 종목명은 제목에서 뗀다
        self.assertEqual(row["title"], "분명, 변화하고 있다")
        self.assertEqual(row["broker"], "NH투자증권")
        self.assertEqual(row["analyst"], "정지윤")
        self.assertEqual(row["date"], "2026-09-07")
        self.assertTrue(row["pdf"].endswith("CISPPR1.pdf"))
        self.assertIsNone(row["rating_raw"])       # 의견은 요약에서 채운다
        self.assertEqual(row["nh_no"], "000000000000147095")

    def test_summary(self):
        d = parse_nh_summary(NH_SUMMARY_PAYLOAD)
        self.assertEqual(d["name"], "아모레퍼시픽")
        self.assertEqual(d["rating_raw"], "Buy")
        self.assertEqual(d["target"], 185000)      # 기존 170,000원이 아니라 신규 목표가
        self.assertIn("밸류에이션 산정 시점", d["summary"])
        self.assertNotIn("<", d["summary"])        # 태그·escape가 남으면 안 된다
        self.assertNotIn("&", d["summary"])

    def test_garbage(self):
        self.assertEqual(parse_nh_list({}), [])
        self.assertIsNone(parse_nh_summary({})["target"])


class TestKisParser(unittest.TestCase):
    def test_only_stock_categories(self):
        rows = parse_kis_list(KIS_LIST_HTML)
        self.assertEqual([r["code"] for r in rows], ["170920", "067310"])

    def test_smallcap_row(self):
        row = parse_kis_list(KIS_LIST_HTML)[0]
        self.assertEqual(row["id"], "kis:159077")
        self.assertEqual(row["source"], "kis")
        self.assertEqual(row["name"], "엘티씨")   # 제목 앞 분류명은 뗀다
        self.assertEqual(row["title"], "엘티씨, 반도체 및 디스플레이 소재...")
        self.assertEqual(row["broker"], "한국투자증권")
        self.assertEqual(row["analyst"], "김연준")
        self.assertEqual(row["date"], "2026-09-07")
        self.assertIsNone(row["pdf"])             # PDF는 로그인해야 열린다
        self.assertEqual(
            row["url"],
            "https://securities.koreainvestment.com/main/research/research/"
            "StrategyDetail.jsp?jkGubun=10&id=159077")

    def test_company_note_row(self):
        row = parse_kis_list(KIS_LIST_HTML)[1]
        self.assertEqual(row["name"], "하나마이크론")
        self.assertEqual(row["title"], "NDR 후기: 정답만을 보여주는 중")
        self.assertIn("브라질 법인", row["summary"])

    def test_total(self):
        self.assertEqual(parse_kis_total(KIS_LIST_HTML), 20)
        self.assertIsNone(parse_kis_total("<html></html>"))

    def test_detail(self):
        d = parse_kis_detail(KIS_DETAIL_HTML)
        self.assertEqual(d["rating_raw"], "매수")
        self.assertEqual(d["target"], 68000)
        self.assertIn("하나마이크론", d["summary"])

    def test_garbage(self):
        self.assertEqual(parse_kis_list("<html></html>"), [])
        self.assertIsNone(parse_kis_detail("<html></html>")["rating_raw"])


class TestOpinionExtraction(unittest.TestCase):
    def test_target_raised_with_previous_in_parens(self):
        self.assertEqual(
            extract_opinion_from_text(
                "투자의견 Buy 유지하며, 목표주가를 185,000원(기존 170,000원)으로 상향"),
            ("Buy", 185000))

    def test_korean_rating_and_maintained_target(self):
        self.assertEqual(
            extract_opinion_from_text("투자의견 매수와 목표주가 68,000원을 유지"),
            ("매수", 68000))

    def test_previous_target_skipped(self):
        _, target = extract_opinion_from_text("기존 목표주가 50,000원에서 60,000원으로 상향")
        self.assertEqual(target, 60000)

    def test_no_opinion(self):
        self.assertEqual(
            extract_opinion_from_text("3분기 실적은 시장 기대에 부합할 전망이다."),
            (None, None))
        self.assertEqual(extract_opinion_from_text(""), (None, None))
        self.assertEqual(extract_opinion_from_text(None), (None, None))

    def test_english_ratings(self):
        for text, expected in (
            ("투자의견 Hold 유지", "Hold"),
            ("투자의견 Not Rated", "Not Rated"),
            ("투자의견을 비중확대로 상향", "비중확대"),
            ("투자의견: Outperform", "Outperform"),
        ):
            self.assertEqual(extract_opinion_from_text(text)[0], expected, text)


class TestRatingNormalization(unittest.TestCase):
    def test_buy(self):
        for raw in ["매수", "Buy", "BUY", " buy ", "StrongBuy", "적극매수",
                    "Outperform", "Overweight", "비중확대", "Accumulate"]:
            self.assertEqual(normalize_rating(raw), "BUY", raw)

    def test_hold(self):
        for raw in ["중립", "Hold", "Neutral", "Marketperform", "Market Perform",
                    "보유", "유지", "시장수익률"]:
            self.assertEqual(normalize_rating(raw), "HOLD", raw)

    def test_sell(self):
        for raw in ["매도", "Sell", "Reduce", "Underperform", "Underweight", "비중축소"]:
            self.assertEqual(normalize_rating(raw), "SELL", raw)

    def test_nr(self):
        for raw in ["없음", "Not Rated", "N/A", "NR", "nr", "투자의견없음", "", None, "   ",
                    "Positive", "Negative"]:
            self.assertEqual(normalize_rating(raw), "NR", repr(raw))

    def test_unknown_falls_back_to_nr(self):
        self.assertEqual(normalize_rating("듣도보도 못한 의견"), "NR")

    def test_suffixed(self):
        self.assertEqual(normalize_rating("매수(유지)"), "BUY")
        self.assertEqual(normalize_rating("BUY (상향)"), "BUY")


class TestBrokerNormalization(unittest.TestCase):
    def test_matches_across_sources(self):
        self.assertEqual(normalize_broker("DS투자증권"), normalize_broker("DS 투자증권"))
        self.assertEqual(normalize_broker("미래에셋증권"), normalize_broker("미래에셋 증권"))
        self.assertNotEqual(normalize_broker("NH투자증권"), normalize_broker("한국투자증권"))

    def test_none(self):
        self.assertEqual(normalize_broker(None), "")


class TestGap(unittest.TestCase):
    def test_positive(self):
        self.assertEqual(compute_gap(200000, 152000), 31.58)

    def test_negative(self):
        self.assertEqual(compute_gap(70000, 74800), -6.42)

    def test_missing(self):
        self.assertIsNone(compute_gap(None, 100))
        self.assertIsNone(compute_gap(100, None))
        self.assertIsNone(compute_gap(100, 0))


class TestTargetChange(unittest.TestCase):
    def records(self):
        return [
            {"id": "naver:3", "code": "031980", "broker": "DS투자증권",
             "date": "2026-09-07", "target": 200000},
            {"id": "naver:2", "code": "031980", "broker": "DS 투자증권",
             "date": "2026-08-01", "target": 180000},
            {"id": "naver:1", "code": "031980", "broker": "미래에셋증권",
             "date": "2026-07-01", "target": 150000},
            {"id": "naver:4", "code": "005930", "broker": "DS투자증권",
             "date": "2026-09-07", "target": None},
            {"id": "naver:5", "code": "005930", "broker": "DS투자증권",
             "date": "2026-09-01", "target": 90000},
        ]

    def test_up_and_new(self):
        recs = {r["id"]: r for r in apply_target_changes(self.records())}
        self.assertEqual(recs["naver:3"]["target_change"], "up")
        self.assertEqual(recs["naver:3"]["prev_target"], 180000)
        self.assertEqual(recs["naver:2"]["target_change"], "new")
        self.assertIsNone(recs["naver:2"]["prev_target"])
        # 증권사가 다르면 별개 계열이다
        self.assertEqual(recs["naver:1"]["target_change"], "new")

    def test_missing_target_gives_null(self):
        recs = {r["id"]: r for r in apply_target_changes(self.records())}
        self.assertIsNone(recs["naver:4"]["target_change"])
        self.assertEqual(recs["naver:4"]["prev_target"], 90000)

    def test_down_and_same(self):
        data = [
            {"id": "a", "code": "1", "broker": "X증권", "date": "2026-01-01", "target": 100},
            {"id": "b", "code": "1", "broker": "X증권", "date": "2026-02-01", "target": 80},
            {"id": "c", "code": "1", "broker": "X증권", "date": "2026-03-01", "target": 80},
        ]
        recs = {r["id"]: r for r in apply_target_changes(data)}
        self.assertEqual(recs["b"]["target_change"], "down")
        self.assertEqual(recs["c"]["target_change"], "same")


class TestPricePayload(unittest.TestCase):
    def test_parse(self):
        prices = parse_price_payload(PRICE_PAYLOAD)
        self.assertEqual(prices["031980"]["price"], 152000)
        self.assertEqual(prices["005930"]["price"], 74800)
        # 0원은 유효한 시세가 아니라 버린다
        self.assertNotIn("999999", prices)

    def test_garbage(self):
        self.assertEqual(parse_price_payload(None), {})
        self.assertEqual(parse_price_payload({}), {})


class TestSectorParser(unittest.TestCase):
    def test_list(self):
        groups = parse_sector_list(SECTOR_LIST_PAYLOAD)
        self.assertEqual(groups, [
            ("278", "전기유틸리티"),
            ("261", "반도체와반도체장비"),   # 같은 no가 두 번 와도 한 번만
            ("284", "호텔,레스토랑,레저"),   # 업종명의 콤마는 그대로 둔다
        ])

    def test_codes(self):
        # 형식이 어긋난 코드는 버리고, 영문자를 품는 신형 코드는 살린다
        self.assertEqual(parse_sector_codes(SECTOR_DETAIL_PAYLOAD),
                         ["005930", "000660", "0126Z0"])

    def test_garbage(self):
        self.assertEqual(parse_sector_list({}), [])
        self.assertEqual(parse_sector_list(None), [])
        self.assertEqual(parse_sector_list({"groups": ["문자열", None]}), [])
        self.assertEqual(parse_sector_codes(None), [])
        self.assertEqual(parse_sector_codes({"stocks": None}), [])


class TestSectorMap(unittest.TestCase):
    def test_all_naver_industries_mapped(self):
        self.assertEqual(len(NAVER_INDUSTRIES), 79)
        missing = [n for n in NAVER_INDUSTRIES if n not in SECTOR_MAP]
        self.assertEqual(missing, [], "대분류가 없는 업종: %s" % missing)

    def test_map_has_no_extra_entries(self):
        extra = [n for n in SECTOR_MAP if n not in NAVER_INDUSTRIES]
        self.assertEqual(extra, [], "네이버에 없는 업종이 표에 있음: %s" % extra)

    def test_sectors_are_known(self):
        for industry, sector in SECTOR_MAP.items():
            self.assertIn(sector, SECTOR_ORDER, industry)

    def test_sector_of(self):
        self.assertEqual(sector_of("반도체와반도체장비"), "IT")
        self.assertEqual(sector_of("호텔,레스토랑,레저"), "경기소비재")
        self.assertEqual(sector_of("듣도보도 못한 업종"), "기타")  # 새 업종은 기타
        self.assertIsNone(sector_of(None))
        self.assertIsNone(sector_of(""))


class TestSectorStale(unittest.TestCase):
    def now(self):
        from datetime import datetime, timedelta, timezone
        return datetime(2026, 9, 8, 12, 0, tzinfo=timezone(timedelta(hours=9)))

    def test_fresh(self):
        self.assertFalse(is_stale({"updated_at": "2026-09-05T09:00:00+09:00"}, self.now()))

    def test_old(self):
        self.assertTrue(is_stale({"updated_at": "2026-08-01T09:00:00+09:00"}, self.now()))

    def test_missing_or_broken(self):
        self.assertTrue(is_stale(None, self.now()))
        self.assertTrue(is_stale({}, self.now()))
        self.assertTrue(is_stale({"updated_at": "어제"}, self.now()))


class TestSourceStale(unittest.TestCase):
    """소스 정지 판정. 2026-09-14(월) ~ 09-18(금), 09-19(토), 09-21(월)."""

    def status(self, **last):
        # 기본은 전부 어제(09-16 수) 까지 들어온 정상 상태
        base = {}
        for src in ("naver", "hankyung", "kb", "nh", "kis"):
            base[src] = {"last_date": last.get(src, "2026-09-16"),
                         "new_run": 0, "total": 100}
        return base

    def names(self, status, today):
        return [s["source"] for s in stale_sources(status, today)]

    def test_business_days_since(self):
        d = datetime.date
        self.assertEqual(business_days_since(d(2026, 9, 16), d(2026, 9, 17)), 1)
        self.assertEqual(business_days_since(d(2026, 9, 15), d(2026, 9, 17)), 2)
        self.assertEqual(business_days_since(d(2026, 9, 18), d(2026, 9, 21)), 1)  # 주말 건너뜀
        self.assertEqual(business_days_since(d(2026, 9, 17), d(2026, 9, 17)), 0)

    def test_weekday_ok(self):
        self.assertEqual(self.names(self.status(), datetime.date(2026, 9, 17)), [])

    def test_weekday_stale(self):
        # naver 는 월요일이 마지막(3영업일 공백) → 경보, hankyung 은 3영업일까지 봐준다
        st = self.status(naver="2026-09-14", hankyung="2026-09-15")
        self.assertEqual(self.names(st, datetime.date(2026, 9, 17)), ["naver"])

    def test_hankyung_has_longer_limit(self):
        st = self.status(hankyung="2026-09-14")   # 3영업일 공백
        self.assertEqual(self.names(st, datetime.date(2026, 9, 17)), ["hankyung"])

    def test_weekend_never_alerts(self):
        st = self.status(naver="2026-09-10", kb="2026-09-01")
        self.assertEqual(self.names(st, datetime.date(2026, 9, 19)), [])  # 토
        self.assertEqual(self.names(st, datetime.date(2026, 9, 20)), [])  # 일

    def test_monday_boundary(self):
        # 월요일 아침: 금요일이 마지막이면 정상
        st = self.status()
        for k in st:
            st[k]["last_date"] = "2026-09-18"
        self.assertEqual(self.names(st, datetime.date(2026, 9, 21)), [])
        # 목요일이 마지막이면 금요일 하루가 통째로 비었으므로 경보
        st["naver"]["last_date"] = "2026-09-17"
        self.assertEqual(self.names(st, datetime.date(2026, 9, 21)), ["naver"])

    def test_missing_or_broken(self):
        st = self.status()
        st["naver"]["last_date"] = None
        del st["kb"]                      # 항목 자체가 없으면 건너뛴다
        self.assertEqual(self.names(st, datetime.date(2026, 9, 17)), ["naver"])
        self.assertEqual(stale_sources(None, datetime.date(2026, 9, 17)), [])


# ------------------------------------------------- 2026-11 신뢰도·형식 v2

# 한경 원문이 종목 칸에 증권사 자신을 적은 행 (2026-10-19 실측, 첨부 파일명은 Poongsan).
HANKYUNG_SELF_HTML = """
<html><body><table><tbody>
  <tr>
    <td class="first txt_number">2026-10-19</td>
    <td class="text_l">
      <a href="/analysis/downpdf?report_idx=653063" target="_blank">한화투자증권(003530) 3Q26 Preview: 메탈은 줄고 방산은 이연된 3분기 </a>
      <div class="layerPop"><div id="content_653063" class="pop01 disNone">
        <strong>한화투자증권(003530) 3Q26 Preview: 메탈은 줄고 방산은 이연된 3분기 </strong>
      </div></div>
    </td>
    <td class="text_r txt_number">98,000</td>
    <td>\r\nBuy                                </td>
    <td>권지우</td>
    <td>한화투자증권</td>
    <td><div class="dv_input"><a class="chart_btn" href="/chart/view_frame?report_type=CO&amp;business_code=003530"><img alt="차트"/></a></div></td>
    <td><div class="dv_input"><a href="/analysis/downpdf?report_idx=653063" title="261018_Poongsan 3Q26 Preview v1.0(1).pdf"><img alt="p.pdf"/></a></div></td>
  </tr>
  <tr>
    <td class="first txt_number">2026-10-19</td>
    <td class="text_l"><a href="/analysis/downpdf?report_idx=653070">대신증권(003540) 대신증권, 배당 확대 기대</a></td>
    <td class="text_r txt_number">30,000</td><td>Buy</td><td>김애널</td><td>LS증권</td>
    <td><a class="chart_btn" href="/chart/view_frame?report_type=CO&amp;business_code=003540">차트</a></td>
  </tr>
</tbody></table></body></html>
"""


class TestHankyungNameIsBroker(unittest.TestCase):
    def test_self_row_dropped(self):
        rows = parse_hankyung_list(HANKYUNG_SELF_HTML)
        # 한화투자증권이 낸 '한화투자증권' 리포트(실제로는 풍산)는 버리고,
        # 다른 증권사가 낸 대신증권 리포트는 남긴다
        self.assertEqual([r["code"] for r in rows], ["003540"])

    def test_name_is_broker(self):
        self.assertTrue(name_is_broker("한화투자증권", "한화투자증권", "3Q26 Preview: 메탈은 줄고"))
        self.assertTrue(name_is_broker("대신증권", "대신 증권", "Qlex 판매 확대와 신규 계약 효과 확인"))
        # 제목이 그 회사 얘기면 정상
        self.assertFalse(name_is_broker("대신증권", "대신증권", "대신증권 3Q 리뷰"))
        # 증권사 모회사와 이름이 겹치는 일반 종목은 해당 없음
        self.assertFalse(name_is_broker("LS", "LS증권", "보수적으로 봐도 주가 상승여력 충분"))
        self.assertFalse(name_is_broker("SK", "SK증권", "실적개선과 주주환원"))
        self.assertFalse(name_is_broker("현대차", "현대차증권", "CID 2026"))
        self.assertFalse(name_is_broker(None, "KB증권", "x"))

    def test_normalize_drops_hankyung_flags_others(self):
        recs = [
            {"id": "hankyung:1", "source": "hankyung", "name": "한화투자증권",
             "broker": "한화투자증권", "title": "다시 늘어나는 미수금"},
            {"id": "naver:1", "source": "naver", "name": "한화투자증권",
             "broker": "한화투자증권", "title": "다시 늘어나는 미수금"},
            {"id": "naver:2", "source": "naver", "name": "삼성전자",
             "broker": "한화투자증권", "title": "x", "suspect": "name_is_broker"},
        ]
        out, dropped, flagged = norm.drop_or_flag_name_is_broker(recs)
        self.assertEqual((dropped, flagged), (1, 1))
        self.assertEqual([r["id"] for r in out], ["naver:1", "naver:2"])
        self.assertEqual(out[0]["suspect"], "name_is_broker")
        self.assertNotIn("suspect", out[1])  # 더 이상 해당하지 않으면 지운다


class TestTargetExtractionFixes(unittest.TestCase):
    """2026-11 실측 오파싱 사례."""

    def test_man_unit(self):
        # NH 롯데웰푸드: 예전엔 5,000원으로 읽었다
        self.assertEqual(
            extract_opinion_from_text("투자의견 Buy 및 목표주가 16만5,000원 유지."),
            ("Buy", 165000))
        self.assertEqual(extract_opinion_from_text("목표주가 16.5만원으로 상향")[1], 165000)
        self.assertEqual(extract_opinion_from_text("목표주가 9만원 유지")[1], 90000)

    def test_eps_is_not_target(self):
        # 한투 파마리서치: '44만원(12MF EPS 23,068원 …)' → 44만원
        self.assertEqual(extract_opinion_from_text(
            "목표주가를 44만원(12MF EPS 23,068원, Target PER 19.2배)으로 하향")[1], 440000)
        # 한투 한국타이어: '목표주가는 12개월 선행 EPS 추정치 10,718원에 …' → 앞의 9만원
        self.assertEqual(extract_opinion_from_text(
            "투자의견 매수와 목표주가 9만원을 유지한다. 목표주가는 12개월 선행 EPS 추정치 "
            "10,718원에 P/E 멀티플 8.7배를 적용한 값이다.")[1], 90000)

    def test_eps_skipped_then_target_found(self):
        # 한투 HL만도: EPS 3,898원은 건너뛰고 뒤의 52,000원
        self.assertEqual(extract_opinion_from_text(
            "목표주가는 12개월 예상 선행 EPS 3,898원에 글로벌 경쟁사 평균 멀티플 11.1배를 "
            "적용하고, 액추에이터 사업 진출 가치를 반영해 20% 할증한 13.3배를 적용하여 "
            "52,000원을 제시한다")[1], 52000)

    def test_eps_only_gives_none(self):
        self.assertIsNone(extract_opinion_from_text("목표주가 산정 기준 EPS 3,898원")[1])

    def test_rating_change_takes_new_one(self):
        self.assertEqual(extract_opinion_from_text("투자의견 중립에서 매수로 상향한다")[0], "매수")
        self.assertEqual(extract_opinion_from_text("투자의견 Hold → Buy 상향")[0], "Buy")

    def test_reparse_nh_targets(self):
        recs = [
            {"id": "nh:1", "source": "nh", "target": 5000,
             "summary": "투자의견 Buy 및 목표주가 16만5,000원 유지."},
            {"id": "nh:2", "source": "nh", "target": 70000,
             "summary": "요약이 잘려서 목표가가 안 보인다"},
            {"id": "kb:1", "source": "kb", "target": 5000,
             "summary": "목표주가 16만5,000원"},
        ]
        self.assertEqual(norm.reparse_nh_targets(recs), 1)
        self.assertEqual([r["target"] for r in recs], [165000, 70000, 5000])


def _rec(rid, source, title, **kw):
    base = {"id": rid, "source": source, "code": "005930", "date": "2026-11-10",
            "broker": "하나증권", "title": title, "analyst": None, "target": None,
            "rating_raw": None, "summary": None, "pdf": None}
    base.update(kw)
    return base


class TestDedupe(unittest.TestCase):
    def ids(self, records):
        return sorted(r["id"] for r in records)

    def test_same_title_whitespace_merged_and_filled(self):
        recs = [
            _rec("hankyung:2", "hankyung", "실적둔화에도 견조한 보유 CSM 순증",
                 analyst="김애널", pdf="hk.pdf", target=750000),
            _rec("naver:1", "naver", "실적 둔화에도 견조한 보유 CSM 순증",
                 broker="하나 증권", rating_raw="매수", summary="요약"),
        ]
        out, merged = norm.dedupe_records(recs)
        self.assertEqual(merged, 1)
        self.assertEqual(len(out), 1)
        keep = out[0]
        self.assertEqual(keep["id"], "naver:1")            # 네이버 우선
        self.assertEqual(keep["analyst"], "김애널")         # 빈 칸은 채운다
        self.assertEqual(keep["target"], 750000)
        self.assertEqual(keep["pdf"], "hk.pdf")
        self.assertEqual(keep["summary"], "요약")           # 있는 값은 그대로

    def test_same_source_different_titles_kept(self):
        recs = [
            _rec("kb:1", "kb", "아이온2 흥행 확인, 다음 모멘텀을 기다리며", target=380000),
            _rec("kb:2", "kb", "3Q26 실적 및 컨퍼런스 콜 요약", target=440000),
        ]
        out, merged = norm.dedupe_records(recs)
        self.assertEqual(merged, 0)
        self.assertEqual(self.ids(out), ["kb:1", "kb:2"])

    def test_cross_source_different_titles_kept_unless_hankyung(self):
        recs = [_rec("naver:1", "naver", "3Q 리뷰"), _rec("kis:1", "kis", "컨퍼런스콜 요약")]
        self.assertEqual(norm.dedupe_records(recs)[1], 0)
        recs = [_rec("naver:1", "naver", "3Q26 Review: 기대치 하회. 장기 전망 유지"),
                _rec("hankyung:1", "hankyung", "3Q26 Review: 기대치 하회 (수정)",
                     analyst="박애널")]
        out, merged = norm.dedupe_records(recs)
        self.assertEqual((merged, self.ids(out)), (1, ["naver:1"]))
        self.assertEqual(out[0]["analyst"], "박애널")

    def test_hankyung_attaches_to_most_similar(self):
        recs = [
            _rec("naver:1", "naver", "2026년 3분기 컨퍼런스콜 요약"),
            _rec("naver:2", "naver", "3Q 실적 부진, 하지만 매수로 대응해야"),
            _rec("hankyung:1", "hankyung", "3Q 실적 부진 하지만 매수로 대응", analyst="한"),
        ]
        out, merged = norm.dedupe_records(recs)
        self.assertEqual(merged, 1)
        by_id = {r["id"]: r for r in out}
        self.assertEqual(sorted(by_id), ["naver:1", "naver:2"])
        self.assertEqual(by_id["naver:2"]["analyst"], "한")
        self.assertIsNone(by_id["naver:1"]["analyst"])

    def test_hankyung_pair_different_titles_kept(self):
        recs = [_rec("hankyung:1", "hankyung", "바이오 부문 감익 불구"),
                _rec("hankyung:2", "hankyung", "기다려지는 미래")]
        self.assertEqual(norm.dedupe_records(recs)[1], 0)

    def test_truncated_title_and_more_complete_kept(self):
        recs = [
            _rec("naver:98033", "naver", "3Q26 Review: 계절성 사라진 역대급 실적"),
            _rec("naver:98113", "naver", "3Q26 Review: 계절성 사라진 역대급 실적",
                 target=390000, rating_raw="매수"),
            _rec("naver:95894", "naver", "악재 충분히 반영한 주가, 다시 내일을 논하..",
                 date="2026-09-01"),
            _rec("naver:95886", "naver", "악재 충분히 반영한 주가, 다시 내일을 논하다",
                 date="2026-09-01", target=55000),
        ]
        out, merged = norm.dedupe_records(recs)
        self.assertEqual(merged, 2)
        self.assertEqual(self.ids(out), ["naver:95886", "naver:98113"])

    def test_different_key_not_merged(self):
        recs = [_rec("naver:1", "naver", "같은 제목"),
                _rec("naver:2", "naver", "같은 제목", date="2026-11-11"),
                _rec("naver:3", "naver", "같은 제목", broker="KB증권")]
        self.assertEqual(norm.dedupe_records(recs)[1], 0)

    def test_idempotent(self):
        recs = [
            _rec("hankyung:2", "hankyung", "A B", analyst="김"),
            _rec("naver:1", "naver", "AB"),
            _rec("kb:1", "kb", "다른 리포트"),
        ]
        once, m1 = norm.dedupe_records(recs)
        twice, m2 = norm.dedupe_records([dict(r) for r in once])
        self.assertEqual(m1, 1)
        self.assertEqual(m2, 0)
        self.assertEqual(once, twice)


class TestRatingInference(unittest.TestCase):
    def test_inherits_most_recent_prior(self):
        recs = [
            {"id": "a", "code": "1", "broker": "KB증권", "date": "2026-08-01", "target": 100, "rating": "HOLD"},
            {"id": "b", "code": "1", "broker": "KB 증권", "date": "2026-09-01", "target": 110, "rating": "BUY"},
            {"id": "c", "code": "1", "broker": "KB증권", "date": "2026-10-01", "target": 120, "rating": "NR"},
            # 같은 날 건은 '직전'이 아니다
            {"id": "d", "code": "2", "broker": "KB증권", "date": "2026-10-01", "target": 50, "rating": "NR"},
            {"id": "e", "code": "2", "broker": "KB증권", "date": "2026-10-01", "target": 50, "rating": "BUY"},
            # 목표가가 없으면 승계하지 않는다
            {"id": "f", "code": "1", "broker": "KB증권", "date": "2026-10-02", "target": None, "rating": "NR"},
            # 다른 증권사의 의견은 쓰지 않는다
            {"id": "g", "code": "1", "broker": "NH투자증권", "date": "2026-10-03", "target": 90, "rating": "NR"},
        ]
        self.assertEqual(norm.infer_ratings(recs), 1)
        by_id = {r["id"]: r for r in recs}
        self.assertEqual(by_id["c"]["rating"], "BUY")
        self.assertTrue(by_id["c"]["rating_inferred"])
        for rid in ("a", "b", "d", "e", "f", "g"):
            self.assertNotIn("rating_inferred", by_id[rid], rid)
        self.assertEqual(by_id["d"]["rating"], "NR")
        self.assertEqual(by_id["g"]["rating"], "NR")

    def test_rerun_is_stable(self):
        recs = [
            {"id": "a", "code": "1", "broker": "X", "date": "2026-08-01", "target": 1, "rating_raw": "매수"},
            {"id": "b", "code": "1", "broker": "X", "date": "2026-09-01", "target": 1, "rating_raw": None},
        ]
        for _ in range(2):
            norm.renormalize_ratings(recs)
            self.assertEqual(norm.infer_ratings(recs), 1)
        self.assertEqual(recs[1]["rating"], "BUY")


class TestTargetRange(unittest.TestCase):
    def recs(self):
        return [
            # 본인 price_at_write 기준: 5,000 / 126,900 → 범위 밖
            {"id": "nh:1", "code": "280360", "date": "2026-11-10", "target": 5000,
             "price_at_write": 126900},
            # 기준가가 없으면 같은 종목 인접일 리포트의 price_at_write
            {"id": "kb:1", "code": "011070", "date": "2026-11-09", "target": 2400000},
            {"id": "naver:1", "code": "011070", "date": "2026-11-12", "target": 900000,
             "price_at_write": 600000},
            # 그것도 없으면 현재가
            {"id": "kis:1", "code": "204320", "date": "2026-07-31", "target": 52000},
            {"id": "kis:2", "code": "204320", "date": "2026-07-31", "target": 3898},
            # 목표가 없음 → 판정 안 함
            {"id": "x", "code": "204320", "date": "2026-07-31", "target": None},
            # 종목명=증권사 표시는 그대로 둔다
            {"id": "y", "code": "003530", "date": "2026-07-31", "target": 1,
             "suspect": "name_is_broker", "price_at_write": 1000},
        ]

    def test_flags(self):
        recs = self.recs()
        ids = {r["id"] for r in recs}
        stats = norm.evaluate_target_range(recs, ids, {"204320": 34750})
        by_id = {r["id"]: r for r in recs}
        self.assertEqual(by_id["nh:1"].get("suspect"), "target_range")
        self.assertEqual(by_id["kb:1"].get("suspect"), "target_range")   # 2,400,000/600,000 = 4.0배
        self.assertNotIn("suspect", by_id["naver:1"])
        self.assertNotIn("suspect", by_id["kis:1"])
        self.assertEqual(by_id["kis:2"].get("suspect"), "target_range")
        self.assertNotIn("suspect", by_id["x"])
        self.assertEqual(by_id["y"]["suspect"], "name_is_broker")
        self.assertEqual(stats["flagged"], 3)
        self.assertEqual((stats["own"], stats["near"], stats["current"]), (2, 1, 2))

    def test_only_listed_ids_evaluated(self):
        recs = self.recs()
        # 이미 판정된 건은 다시 보지 않는다 (주가가 움직여도 결과 유지)
        recs[3]["suspect"] = "target_range"
        norm.evaluate_target_range(recs, {"nh:1"}, {"204320": 999999999})
        self.assertEqual(recs[3]["suspect"], "target_range")
        self.assertNotIn("suspect", recs[4])
        # 목표가가 바뀌어 다시 판정하면 풀린다
        norm.evaluate_target_range(recs, {"kis:1"}, {"204320": 34750})
        self.assertNotIn("suspect", recs[3])


class TestStoreV2(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.tmp = tempfile.mkdtemp()
        self.layout = store.Layout(self.tmp)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def records(self):
        return [
            {"id": "naver:2", "source": "naver", "date": "2026-11-03", "code": "005930",
             "name": "삼성전자", "title": "B", "broker": "하나증권", "rating": "BUY",
             "rating_raw": "매수", "target": 300000, "summary": "요약 B", "views": 3,
             "suspect": "target_range"},
            {"id": "kb:1", "source": "kb", "date": "2026-10-30", "code": "000660",
             "name": "SK하이닉스", "title": "A", "broker": "KB증권", "rating": "BUY",
             "rating_raw": None, "target": 100, "summary": None, "rating_inferred": True},
            {"id": "naver:3", "source": "naver", "date": "2026-11-03", "code": "000660",
             "name": "SK하이닉스", "title": "C", "broker": "DS투자증권", "rating": "NR",
             "summary": "요약 C", "detail_tries": 0},
        ]

    def save(self, records, prices=None):
        meta_base = {"updated_at": "2026-11-15T10:00:00+09:00", "count": len(records)}
        return store.save_v2(self.layout, [dict(r) for r in records],
                             prices or {"005930": {"p": 209000, "d": "2026-11-14"}},
                             meta_base, "2026-11-15T10:00:00+09:00")

    def read(self, path):
        with open(path, "rb") as f:
            return f.read()

    def test_month_split_and_fields(self):
        import json as _json
        _, meta = self.save(self.records())
        self.assertEqual(meta["data_version"], 2)
        self.assertEqual([m["month"] for m in meta["months"]], ["2026-11", "2026-10"])
        self.assertEqual([m["count"] for m in meta["months"]], [2, 1])
        nov = _json.loads(self.read(self.layout.month_path("2026-11")).decode("utf-8"))
        self.assertEqual([r["id"] for r in nov], ["naver:3", "naver:2"])  # 날짜·id 내림차순
        self.assertEqual(list(nov[1].keys())[:20], list(store.RECORD_FIELDS))
        for gone in ("summary", "price", "price_date", "gap", "detail_tries"):
            self.assertNotIn(gone, nov[0])
        self.assertTrue(nov[1]["has_summary"])
        self.assertEqual(nov[1]["suspect"], "target_range")
        oct_ = _json.loads(self.read(self.layout.month_path("2026-10")).decode("utf-8"))
        self.assertTrue(oct_[0]["rating_inferred"])
        self.assertNotIn("has_summary", oct_[0])
        sums = _json.loads(self.read(self.layout.summary_path("2026-11")).decode("utf-8"))
        self.assertEqual(sums, {"naver:3": "요약 C", "naver:2": "요약 B"})
        self.assertEqual(self.read(self.layout.summary_path("2026-10")), b"{}\n")
        prices = _json.loads(self.read(self.layout.prices_path).decode("utf-8"))
        self.assertEqual(prices["prices"]["005930"], {"p": 209000, "d": "2026-11-14"})
        meta_file = _json.loads(self.read(self.layout.meta_path).decode("utf-8"))
        self.assertEqual(meta_file["months"][0]["v"],
                         store.content_version(self.read(self.layout.month_path("2026-11"))))
        self.assertEqual(meta_file["months"][0]["sv"],
                         store.content_version(self.read(self.layout.summary_path("2026-11"))))
        self.assertEqual(meta_file["prices_v"],
                         store.content_version(self.read(self.layout.prices_path)))
        self.assertEqual(len(meta_file["months"][0]["v"]), 10)

    def test_stable_bytes_and_untouched_files(self):
        self.save(self.records())
        first = {p: self.read(p) for p in (self.layout.month_path("2026-11"),
                                           self.layout.month_path("2026-10"),
                                           self.layout.summary_path("2026-11"),
                                           self.layout.meta_path)}
        # 순서를 뒤섞어 다시 저장해도 같은 바이트, 바뀐 파일 없음
        changed, _ = self.save(list(reversed(self.records())))
        self.assertEqual(changed, [])
        for path, data in first.items():
            self.assertEqual(self.read(path), data)
        # 11월 건 하나만 바꾸면 11월 파일과 meta만 바뀐다
        recs = self.records()
        recs[0]["target"] = 310000
        changed, _ = self.save(recs)
        self.assertEqual(sorted(os.path.basename(p) for p in changed),
                         ["2026-11.json", "meta.json"])

    def test_load_roundtrip(self):
        self.save(self.records())
        loaded = {r["id"]: r for r in store.load_v2(self.layout)}
        self.assertEqual(loaded["naver:2"]["summary"], "요약 B")
        self.assertIsNone(loaded["kb:1"]["summary"])
        self.assertNotIn("has_summary", loaded["naver:2"])
        self.assertTrue(self.layout.is_v2())

    def test_old_months_removed(self):
        self.save(self.records())
        recs = [r for r in self.records() if r["date"] >= "2026-11"]
        changed, meta = self.save(recs)
        self.assertFalse(os.path.exists(self.layout.month_path("2026-10")))
        self.assertFalse(os.path.exists(self.layout.summary_path("2026-10")))
        self.assertEqual([m["month"] for m in meta["months"]], ["2026-11"])

    def test_month_cutoff(self):
        self.assertEqual(norm.month_cutoff(datetime.date(2026, 11, 15), 730), "2024-11")

    def test_v1_migration(self):
        import json as _json
        v1 = []
        for r in self.records():
            r = dict(r)
            r.pop("suspect", None)
            r.pop("rating_inferred", None)
            r.update({"price": 1000, "price_date": "2026-11-14", "gap": 1.0})
            v1.append(r)
        # 같은 리포트가 한경에도 있는 v1 중복
        v1.append({"id": "hankyung:9", "source": "hankyung", "date": "2026-11-03",
                   "code": "005930", "name": "삼성전자", "title": "B ", "broker": "하나 증권",
                   "analyst": "홍길동", "target": 300000, "price": 209000,
                   "price_date": "2026-11-14", "gap": 43.5})
        with open(self.layout.v1_path, "w", encoding="utf-8") as f:
            _json.dump(v1, f, ensure_ascii=False)
        self.assertFalse(self.layout.is_v2())

        records, prices = store.load_v1(self.layout)
        self.assertEqual(len(records), 4)
        self.assertNotIn("price", records[0])
        self.assertEqual(prices["005930"], {"p": 209000, "d": "2026-11-14"})
        records, merged = norm.dedupe_records(records)
        self.assertEqual(merged, 1)
        _, meta = self.save(records, prices)
        self.assertFalse(os.path.exists(self.layout.v1_path))   # v1은 지운다
        self.assertTrue(self.layout.is_v2())
        self.assertEqual(sum(m["count"] for m in meta["months"]), 3)
        loaded = {r["id"]: r for r in store.load_v2(self.layout)}
        self.assertEqual(loaded["naver:2"]["analyst"], "홍길동")
        self.assertNotIn("hankyung:9", loaded)


class TestSmallHelpers(unittest.TestCase):
    def test_to_int(self):
        self.assertEqual(to_int("200,000"), 200000)
        self.assertIsNone(to_int("없음"))
        self.assertIsNone(to_int(""))
        self.assertIsNone(to_int(None))

    def test_normalize_date(self):
        self.assertEqual(normalize_date("26.09.07"), "2026-09-07")
        self.assertEqual(normalize_date("2026-09-07"), "2026-09-07")
        self.assertEqual(normalize_date("2026.9.7"), "2026-09-07")
        self.assertIsNone(normalize_date("작성일"))

    def test_compact_date(self):
        self.assertEqual(compact_date("20260907"), "2026-09-07")
        self.assertIsNone(compact_date("2026-09-07"))
        self.assertIsNone(compact_date(""))


# ------------------------------------------------- 와이즈리포트·산업·성과 (2026-11)

# 와이즈리포트 c1080001_data.aspx 실측 응답 (2026-11-16, 4건으로 줄이고 요약을 줄임).
WISE_PAYLOAD = {
    "lists": [
        {"RPT_ID": 1150538, "ANL_DT": "26/11/13", "IDX": "20261116.021292",
         "PRE_TITLE": "[기업분석]", "RPT_TITLE": "보험손익의 회복, 주주환원까지의 시차",
         "CMP_CD": "001450", "BRK_CD": 48, "ANL_NM_KOR": "김현수", "RPT_TYP": 1,
         "RPT_SUB_TYP": 3, "TARGET_PRC": "66,000", "RECOMM": "BUY",
         "COMMENT2": "<span class='comment_text'>▶</span> 보험손익 개선에도 투자손익 부진으로 "
                     "기대치 하회  \r\n<br/><span class='comment_text'>▶</span> 자본비율은 안정화",
         "VISIT_CNT": 5, "FILE_NM": "1F04820261113_001450.pdf", "CLOSE_PRC": "36,200",
         "RECOMM_ACTION_TYP_NM": "변동없음", "PRC_ACTION_TYP_NM": "변동없음",
         "TOTROW": 33452, "CMP_NM_KOR": "현대해상", "BRK_NM_KOR": "상상인증권",
         "BRK_NM_SHORT_KOR": "상상인", "NUM": 0},
        # 회사 IR 자료 — 버린다
        {"RPT_ID": 1150336, "ANL_DT": "26/11/13", "IDX": "", "PRE_TITLE": "[기업COMMENT]",
         "RPT_TITLE": "2026년 3분기 경영실적", "CMP_CD": "100090", "ANL_NM_KOR": "IR팀",
         "RPT_SUB_TYP": 9, "TARGET_PRC": "", "RECOMM": None, "COMMENT2": "",
         "FILE_NM": "해당기업_SK오션플랜트_20261113131403.pdf", "CMP_NM_KOR": "SK오션플랜트",
         "BRK_NM_KOR": "해당기업"},
        # 의견·목표가 없음, 증권사 이름에 괄호 꼬리, 공동 애널리스트
        {"RPT_ID": 1150401, "ANL_DT": "26/11/12", "IDX": "20261112.021001",
         "PRE_TITLE": "[기업분석]", "RPT_TITLE": "기술분석보고서", "CMP_CD": "0181E0",
         "ANL_NM_KOR": "이태경,이길림", "RPT_SUB_TYP": 3, "TARGET_PRC": "", "RECOMM": None,
         "COMMENT2": None, "CMP_NM_KOR": "신규종목", "BRK_NM_KOR": "한국IR협의회(기술분석보고서)"},
        # 비상장(000000)은 버린다
        {"RPT_ID": 1150403, "ANL_DT": "26/11/12", "RPT_TITLE": "y", "CMP_CD": "000000",
         "RPT_SUB_TYP": 3, "BRK_NM_KOR": "밸류파인더"},
        # 종목코드가 아니면 버린다
        {"RPT_ID": 1150402, "ANL_DT": "26/11/12", "RPT_TITLE": "x", "CMP_CD": "",
         "RPT_SUB_TYP": 3, "BRK_NM_KOR": "KB증권"},
    ],
    "cp": 1, "tp": 67, "tc": 33452, "tr": 500,
}

# 네이버 /api/research/industry·market 실측 (2026-11-16, 2건씩)
NAVER_INDUSTRY_LIST = [
    {"researchCategory": "산업분석", "category": "화장품", "researchId": 46991,
     "title": "에이피알 vs 달바글로벌 3Q26 실적 비교", "brokerName": "신한투자증권",
     "writeDate": "2026-11-13", "readCount": "2262",
     "endUrl": "https://m.stock.naver.com/research/industry/46991"},
    {"researchCategory": "산업분석", "category": "유틸리티", "researchId": 46990,
     "title": "유틸리티 Weekly: 11월 일별 SMP 상승 확인", "brokerName": "하나증권",
     "writeDate": "2026-11-13", "readCount": "1639"},
]
NAVER_MARKET_LIST = [
    {"researchCategory": "시황정보", "category": "시황정보", "researchId": 38159,
     "title": "마켓레이더 - Nvidia 흔들려도 AI는 확장, KOSPI 5,400선 회복 (11월 13일)",
     "brokerName": "신한투자증권", "writeDate": "2026-11-13", "readCount": "1845",
     "endUrl": "https://m.stock.naver.com/research/market/38159"},
    {"researchId": None, "title": "깨진 행", "writeDate": "2026-11-13"},
]
NAVER_INDUSTRY_DETAIL = {
    "researchContent": {
        "category": "화장품", "researchId": "46991", "brokerName": "신한투자증권",
        "attachUrl": "https://stock.pstatic.net/stock-research/industry/21/"
                     "20261113_industry_445863000.pdf",
        "content": "<p><strong>외형 성장이냐, 수익성 향상이냐 차이</strong></p>"},
    "researchSummaries": [],
}

# siseJson 실측 응답 (엘앤에프 066970, 2026-11-02~13 중 일부). 엄밀한 JSON이 아니다.
SISE_TEXT = (
    "\n [['날짜', '시가', '고가', '저가', '종가', '거래량', '외국인소진율'],\n\n\t\n\t\n\t\t\n"
    '["20261104", 82900, 95300, 78500, 92100, 950624, 15.48],\n\t\t\n'
    '["20261105", 91600, 93300, 80800, 84300, 693241, 15.27],\n\t\t\n'
    '["20261106", 77000, 78700, 71400, 76300, 888616, 14.8],\n\t\t\n'
    '["20261109", 72300, 73800, 69000, 69900, 405722, 14.68],\n\t\t\n'
    '["20261110", 73000, 78300, 72900, 76200, 478701, 15.05],\n\t\t\n'
    '["20261111", 76700, 82900, 76400, 82700, 360360, 15.33]\n\t\t\n\t\n\n]\n'
)


class TestWiseParser(unittest.TestCase):
    def test_parse(self):
        rows = parse_wise_list(WISE_PAYLOAD)
        self.assertEqual([r["id"] for r in rows], ["wise:1150538", "wise:1150401"])
        a, b = rows
        self.assertEqual(a["source"], "wise")
        self.assertEqual((a["code"], a["name"], a["date"]), ("001450", "현대해상", "2026-11-13"))
        self.assertEqual((a["broker"], a["analyst"]), ("상상인증권", "김현수"))
        self.assertEqual((a["target"], a["rating_raw"]), (66000, "BUY"))
        self.assertEqual(a["summary"], "▶ 보험손익 개선에도 투자손익 부진으로 기대치 하회 ▶ 자본비율은 안정화")
        self.assertIsNone(a["pdf"])
        self.assertIsNone(a["views"])
        self.assertEqual(a["url"], "https://comp.wisereport.co.kr/company/c1080001.aspx?cmp_cd=001450")
        self.assertEqual(b["code"], "0181E0")
        self.assertEqual(b["broker"], "한국IR협의회")
        self.assertEqual(b["analyst"], "이태경, 이길림")
        self.assertIsNone(b["target"])
        self.assertIsNone(b["rating_raw"])
        self.assertIsNone(b["summary"])

    def test_page_info_and_garbage(self):
        self.assertEqual(wise_page_info(WISE_PAYLOAD), (1, 67, 33452))
        self.assertEqual(parse_wise_list(None), [])
        self.assertEqual(parse_wise_list({"lists": None}), [])
        self.assertEqual(wise_page_info("x"), (None, None, None))

    def test_wise_due(self):
        now = datetime.datetime(2026, 11, 16, 10, 0, tzinfo=KST_TZ)
        self.assertTrue(wise_due(None, now))
        self.assertTrue(wise_due("깨짐", now))
        self.assertFalse(wise_due("2026-11-16T08:00:00+09:00", now))
        self.assertTrue(wise_due("2026-11-16T07:00:00+09:00", now))


class TestRatingTableAdditions(unittest.TestCase):
    def test_new_notations(self):
        cases = {
            "보유": "HOLD", "Buy(Maintain)": "BUY", "Buy(Reinitiate)": "BUY",
            "매수(신규)": "BUY", "N.R": "NR", "[유지] 매수": "BUY", "[하향] 중립": "HOLD",
            "Hold(Downgrade)": "HOLD", "Trading BUY": "BUY", "Marketperform": "HOLD",
            "NEUTRAL": "HOLD", "Sell (신규)": "SELL", "매수 / Buy": "BUY", "미제시": "NR",
            "Outperform(Maintain)": "BUY", "[신규] Not Rated": "NR",
        }
        for raw, want in cases.items():
            self.assertEqual(normalize_rating(raw), want, raw)

    def test_existing_meanings_kept(self):
        # '유지' 한 단어는 기존대로 HOLD, Positive는 산업 의견이라 등급 없음으로 둔다.
        self.assertEqual(normalize_rating("유지"), "HOLD")
        self.assertEqual(normalize_rating("Positive"), "NR")
        self.assertEqual(normalize_rating("매수유지"), "BUY")


def _w(rid, title, **kw):
    return _rec(rid, "wise", title, **kw)


class TestAbsorbWise(unittest.TestCase):
    def test_fill_and_drop(self):
        recs = [
            _rec("naver:1", "naver", "3Q26 Review: 스페이스X 제외해도 부진. 주주환원도 아쉬움",
                 target=30000, rating_raw="Buy", summary="네이버 요약"),
            _w("wise:1", "스페이스X 제외해도 부진. 주주환원도 아쉬움", analyst="정애널",
               target=31000, rating_raw="BUY", summary="와이즈 요약"),
        ]
        out, stats = norm.absorb_wise(recs)
        self.assertEqual([r["id"] for r in out], ["naver:1"])
        keep = out[0]
        self.assertEqual(keep["analyst"], "정애널")          # 빈 칸만 채운다
        self.assertEqual(keep["target"], 30000)              # 있는 값은 그대로
        self.assertEqual(keep["summary"], "네이버 요약")
        self.assertEqual(stats["absorbed"], 1)
        self.assertEqual(stats["filled_records"], 1)
        self.assertEqual(stats["filled"]["analyst"], 1)

    def test_prefix_typo_date_and_translation(self):
        recs = [
            _rec("kb:1", "kb", "3Q26 실적 속보: 컨센서스 하회", broker="KB증권", analyst="김"),
            _w("wise:1", "[AI 실적속보] 3Q26 실적 속보: 컨센서스 하회", broker="KB증권"),
            _rec("naver:2", "naver", "3Q26 Review: 평법함이 특별해지는 순간", broker="SK증권"),
            _w("wise:2", "3Q26 Review: 평범함이 특별해지는 순간", broker="SK증권",
               analyst="박", rating_raw="매수"),
            # 작성일이 하루 어긋나도 제목이 같으면 같은 리포트
            _rec("naver:3", "naver", "섣부른 판단은 금물", broker="삼성증권", date="2026-11-12"),
            _w("wise:3", "섣부른 판단은 금물", broker="삼성증권", date="2026-11-13", analyst="최"),
            # 영문판: 같은 날 한글 리포트의 번역본
            _rec("naver:4", "naver", "예상보다 무거웠던 비용의 무게", broker="신한투자증권",
                 target=50000),
            _w("wise:4", "Cost pressures worse than expected", broker="신한투자증권",
               analyst="허", target=50000),
            # 와이즈에만 있는 리포트는 남는다
            _w("wise:5", "그래도 소는 키워야", broker="다올투자증권", analyst="정"),
        ]
        out, stats = norm.absorb_wise(recs)
        by_id = {r["id"]: r for r in out}
        self.assertEqual(sorted(by_id), ["kb:1", "naver:2", "naver:3", "naver:4", "wise:5"])
        self.assertEqual(by_id["naver:2"]["analyst"], "박")
        self.assertEqual(by_id["naver:2"]["rating_raw"], "매수")
        self.assertEqual(by_id["naver:3"]["analyst"], "최")
        self.assertEqual(by_id["naver:4"]["analyst"], "허")
        self.assertEqual(stats["absorbed"], 4)
        self.assertEqual(stats["filled_records"], 3)        # kb:1은 채울 칸이 없다

    def test_not_absorbed(self):
        recs = [
            # 제목이 다른 같은 날 같은 증권사 리포트는 별개
            _rec("kb:1", "kb", "2026년 3분기 컨퍼런스콜 요약", broker="KB증권"),
            _w("wise:1", "투자손익 변동성 확대와 배당가능이익 감소", broker="KB증권"),
            # 4일 넘게 떨어지면 별개
            _rec("naver:2", "naver", "주주 환원 강화로 이익 공백 상쇄", date="2026-10-30"),
            _w("wise:2", "주주 환원 강화로 이익 공백 상쇄", date="2026-11-12"),
            # 한경은 와이즈보다 아래라 흡수 대상이 아니다
            _rec("hankyung:3", "hankyung", "본업은 순항", broker="LS증권"),
            _w("wise:3", "본업은 순항", broker="LS증권", analyst="홍"),
        ]
        out, stats = norm.absorb_wise(recs)
        self.assertEqual(stats["absorbed"], 0)
        self.assertEqual(len(out), 6)
        # 한경과 같은 리포트는 dedupe에서 와이즈를 남긴다
        out, merged = norm.dedupe_records(out)
        ids = sorted(r["id"] for r in out)
        self.assertIn("wise:3", ids)
        self.assertNotIn("hankyung:3", ids)

    def test_idempotent(self):
        recs = [_rec("naver:1", "naver", "A 리포트"), _w("wise:1", "A 리포트", analyst="김"),
                _w("wise:2", "B 리포트")]
        once, _ = norm.absorb_wise(recs)
        # 다음 실행에 같은 와이즈 행이 또 들어와도 결과가 같다
        again, stats = norm.absorb_wise([dict(r) for r in once] + [_w("wise:1", "A 리포트",
                                                                         analyst="김")])
        self.assertEqual(sorted(r["id"] for r in again), ["naver:1", "wise:2"])
        self.assertEqual(stats["filled_records"], 0)

    def test_title_score(self):
        self.assertEqual(norm.wise_title_score("A B C", "ABC"), 1.0)
        self.assertEqual(norm.wise_title_score("[AI 실적속보] 3Q26 실적 Review", "3Q26 실적 Review"), 0.95)
        self.assertEqual(norm.wise_title_score("완전히 다른 제목", "전혀 무관한 리포트"), 0.0)


class TestIndustryParser(unittest.TestCase):
    def test_industry(self):
        rows = parse_naver_research_list(NAVER_INDUSTRY_LIST, "industry")
        self.assertEqual([r["id"] for r in rows], ["industry:46991", "industry:46990"])
        a = rows[0]
        self.assertEqual(list(a.keys()), list(store.INDUSTRY_FIELDS))
        self.assertEqual((a["kind"], a["date"], a["broker"], a["category"]),
                         ("industry", "2026-11-13", "신한투자증권", "화장품"))
        self.assertEqual(a["views"], 2262)
        self.assertIsNone(a["analyst"])
        self.assertIsNone(a["pdf"])
        self.assertEqual(rows[1]["url"], "https://m.stock.naver.com/research/industry/46990")

    def test_market(self):
        rows = parse_naver_research_list(NAVER_MARKET_LIST, "market")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], "market:38159")
        self.assertIsNone(rows[0]["category"])               # 시황은 업종 없음
        with self.assertRaises(ValueError):
            parse_naver_research_list(NAVER_MARKET_LIST, "company")

    def test_pdf(self):
        self.assertTrue(parse_naver_research_pdf(NAVER_INDUSTRY_DETAIL).endswith(
            "20261113_industry_445863000.pdf"))
        self.assertIsNone(parse_naver_research_pdf({}))
        self.assertIsNone(parse_naver_research_pdf(None))

    def test_store_industry(self):
        import json as _json
        import shutil
        import tempfile
        tmp = tempfile.mkdtemp()
        try:
            layout = store.Layout(tmp)
            rows = (parse_naver_research_list(NAVER_INDUSTRY_LIST, "industry")
                    + parse_naver_research_list(NAVER_MARKET_LIST, "market"))
            rows.append(dict(rows[0], id="industry:1", date="2026-10-01"))
            changed, months = store.save_industry(layout, rows)
            self.assertEqual([m["month"] for m in months], ["2026-11", "2026-10"])
            self.assertEqual([m["count"] for m in months], [3, 1])
            with open(layout.industry_path("2026-11"), "rb") as f:
                data = f.read()
            self.assertEqual(months[0]["v"], store.content_version(data))
            nov = _json.loads(data.decode("utf-8"))
            self.assertEqual([r["id"] for r in nov],
                             ["market:38159", "industry:46991", "industry:46990"])
            self.assertEqual(len(store.load_industry(layout)), 4)
            changed, _ = store.save_industry(layout, list(reversed(rows)))
            self.assertEqual(changed, [])                     # 같은 내용이면 안 쓴다
            changed, months = store.save_industry(layout, rows[:3])
            self.assertFalse(os.path.exists(layout.industry_path("2026-10")))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class TestSiseJson(unittest.TestCase):
    def test_parse(self):
        rows = parse_sise_json(SISE_TEXT)
        self.assertEqual(len(rows), 6)
        self.assertEqual(rows[0], ("2026-11-04", 82900, 95300, 78500, 92100))
        self.assertEqual(rows[-1][0], "2026-11-11")

    def test_garbage(self):
        self.assertEqual(parse_sise_json(""), [])
        self.assertEqual(parse_sise_json(None), [])
        self.assertEqual(parse_sise_json("<html>error</html>"), [])
        # 0 값 행(거래정지)은 버린다, 순서는 날짜 오름차순
        text = '["20261102", 0, 0, 0, 0, 0, 0.0],["20261101", 1, 2, 1, 2, 5, 0.1]'
        self.assertEqual(parse_sise_json(text), [("2026-11-01", 1, 2, 1, 2)])


class TestPerf(unittest.TestCase):
    rows = parse_sise_json(SISE_TEXT)

    def test_hit_and_range(self):
        rec = {"id": "a", "code": "066970", "date": "2026-11-05", "target": 82000,
               "price_at_write": 84000}
        item = perf_mod.compute_item(rec, self.rows)
        self.assertEqual(item["paw"], 84000)                 # price_at_write가 종가와 맞으면 그 값
        self.assertEqual(item["max"], 82900)                 # 11-06 이후 고가 최댓값
        self.assertEqual(item["min"], 69000)
        self.assertEqual(item["hit"], "2026-11-11")          # 고가 82,900 ≥ 82,000

    def test_no_hit(self):
        rec = {"id": "a", "code": "066970", "date": "2026-11-04", "target": 120000}
        item = perf_mod.compute_item(rec, self.rows)
        self.assertEqual(item["paw"], 92100)                 # price_at_write 없으면 그날 종가
        self.assertIsNone(item["hit"])
        self.assertEqual(item["max"], 93300)

    def test_paw_fallbacks(self):
        # 주말(11-08) 리포트 → 직전 거래일(11-06) 종가, 다음 거래일 11-09부터 본다
        rec = {"id": "a", "code": "066970", "date": "2026-11-08", "target": 100000}
        item = perf_mod.compute_item(rec, self.rows)
        self.assertEqual(item["paw"], 76300)
        self.assertEqual(item["min"], 69000)
        self.assertEqual(item["max"], 82900)
        # price_at_write가 종가와 2배 넘게 다르면 종가 (엘앤에프 8,579 vs 76,300)
        rec = {"id": "b", "code": "066970", "date": "2026-11-06", "target": 120000,
               "price_at_write": 8579}
        self.assertEqual(perf_mod.compute_item(rec, self.rows)["paw"], 76300)
        # 가장 최근 거래일 리포트는 이후 구간이 없다
        rec = {"id": "c", "code": "066970", "date": "2026-11-11", "target": 90000}
        item = perf_mod.compute_item(rec, self.rows)
        self.assertEqual((item["paw"], item["max"], item["min"], item["hit"]),
                         (82700, None, None, None))
        # 일봉보다 이전 날짜면 종가가 없다
        rec = {"id": "d", "code": "066970", "date": "2026-10-01", "target": 90000}
        self.assertIsNone(perf_mod.compute_item(rec, self.rows))

    def test_compute_perf_filters(self):
        recs = [
            {"id": "a", "code": "066970", "date": "2026-11-05", "target": 82000},
            {"id": "b", "code": "066970", "date": "2026-11-05", "target": None},
            {"id": "c", "code": "066970", "date": "2026-11-05", "target": 1,
             "suspect": "target_range"},
            {"id": "d", "code": "999999", "date": "2026-11-05", "target": 1000},
        ]
        items = perf_mod.compute_perf(recs, {"066970": self.rows})
        self.assertEqual(sorted(items), ["a"])

    def test_history_window(self):
        recs = [{"code": "066970", "date": "2026-11-05"}, {"code": "066970", "date": "2026-10-20"},
                {"code": "005930", "date": "2026-11-13"}, {"code": None, "date": "2026-11-13"}]
        w = perf_mod.history_window(recs, datetime.date(2026, 11, 16))
        self.assertEqual(w, {"066970": "2026-10-06", "005930": "2026-10-30"})

    def test_perf_due(self):
        at = lambda h, d=16: datetime.datetime(2026, 11, d, h, 0, tzinfo=KST_TZ)
        self.assertTrue(perf_mod.perf_due(None, at(10)))
        self.assertTrue(perf_mod.perf_due("2026-11-16T09:00:00+09:00", at(10), force=True))
        self.assertFalse(perf_mod.perf_due("2026-11-15T16:30:00+09:00", at(10)))   # 17.5시간
        self.assertTrue(perf_mod.perf_due("2026-11-15T13:00:00+09:00", at(10)))    # 21시간
        self.assertTrue(perf_mod.perf_due("2026-11-16T10:00:00+09:00", at(16)))    # 16시 이후 첫 실행
        self.assertFalse(perf_mod.perf_due("2026-11-16T16:00:00+09:00", at(17)))   # 오늘 이미 함

    def test_encode_perf(self):
        import json as _json
        items = {"b": {"paw": 1, "max": 2, "min": 1, "hit": None},
                 "a": {"paw": 3, "max": None, "min": None, "hit": "2026-11-11"}}
        data = store.encode_perf("2026-11-16T16:05:00+09:00", items)
        obj = _json.loads(data.decode("utf-8"))
        self.assertEqual(list(obj["items"]), ["a", "b"])
        self.assertEqual(obj["items"]["a"], items["a"])
        self.assertEqual(store.encode_perf("x", dict(reversed(list(items.items())))),
                         store.encode_perf("x", items))


class TestTargetRangeWithCloses(unittest.TestCase):
    def test_reevaluate(self):
        closes = {("066970", "2026-11-06"): 76300, ("A", "2026-07-30"): 10000,
                  ("B", "2026-07-30"): 10000, ("C", "2026-07-30"): 10000}
        lookup = lambda code, day: closes.get((code, day))
        recs = [
            # 현재가 기준으로 잘못 걸렸던 건: 발간일 종가 대비 2.5배 → 해제
            {"id": "a", "code": "A", "date": "2026-07-30", "target": 25000,
             "suspect": "target_range"},
            # price_at_write가 엉터리(8,579): 종가 76,300을 믿는다 → 해제
            {"id": "e", "code": "066970", "date": "2026-11-06", "target": 120000,
             "price_at_write": 8579, "suspect": "target_range"},
            # 종가 기준으로도 범위 밖 → 유지
            {"id": "b", "code": "B", "date": "2026-07-30", "target": 2000,
             "suspect": "target_range"},
            # 새로 걸리는 건
            {"id": "c", "code": "C", "date": "2026-07-30", "target": 40000},
            # 종가가 없으면 이전 판정 유지
            {"id": "d", "code": "D", "date": "2026-07-30", "target": 1,
             "suspect": "target_range"},
            # 종목명=증권사는 건드리지 않는다
            {"id": "n", "code": "A", "date": "2026-07-30", "target": 1,
             "suspect": "name_is_broker"},
        ]
        stats = norm.reevaluate_target_range_with_closes(recs, lookup)
        by_id = {r["id"]: r for r in recs}
        self.assertNotIn("suspect", by_id["a"])
        self.assertNotIn("suspect", by_id["e"])
        self.assertEqual(by_id["b"]["suspect"], "target_range")
        self.assertEqual(by_id["c"]["suspect"], "target_range")
        self.assertEqual(by_id["d"]["suspect"], "target_range")
        self.assertEqual(by_id["n"]["suspect"], "name_is_broker")
        self.assertEqual((stats["checked"], stats["paw_wrong"], stats["cleared"],
                          stats["newly_flagged"], stats["flagged"]), (4, 1, 2, 1, 2))
        # 다시 돌려도 같다 (기준가가 과거 고정값)
        again = norm.reevaluate_target_range_with_closes(recs, lookup)
        self.assertEqual((again["cleared"], again["newly_flagged"]), (0, 0))

    def test_close_lookup(self):
        lookup = perf_mod.CloseLookup({"066970": parse_sise_json(SISE_TEXT)})
        self.assertEqual(lookup("066970", "2026-11-08"), 76300)
        self.assertEqual(lookup("066970", "2026-11-04"), 92100)
        self.assertIsNone(lookup("066970", "2026-11-01"))
        self.assertIsNone(lookup("000000", "2026-11-04"))


class TestMetaExtraAndWiseStale(unittest.TestCase):
    def test_meta_extra_order(self):
        import shutil
        import tempfile
        tmp = tempfile.mkdtemp()
        try:
            layout = store.Layout(tmp)
            _, meta = store.save_v2(layout, [], {}, {"updated_at": "x"}, "x",
                                    meta_extra={"perf_v": "abc", "industry_months": None})
            self.assertEqual(list(meta)[-2:], ["prices_v", "perf_v"])
            self.assertNotIn("industry_months", meta)
            self.assertEqual(store.load_meta(layout)["perf_v"], "abc")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_wise_stale(self):
        monday = datetime.date(2026, 11, 16)
        status = {"wise": {"last_date": "2026-11-11"}, "naver": {"last_date": "2026-11-13"}}
        bad = stale_sources(status, monday)
        self.assertEqual([b["source"] for b in bad], ["wise"])
        self.assertEqual(bad[0]["limit"], 2)


# ------------------------------------- 증권사 직접 수집 2차 (iM·BNK·상상인)

import parsers as P  # noqa: E402

# iM증권 _json/source.jsp board_list 실측(2026-11-16) 두 행 + 제목 꼴이 다른 행(종목 아님) 하나.
IM_LIST_PAYLOAD = [
    [
        {"view_chk": "", "sdate": "20050630", "view_cnt": "8618", "mod_dt": "", "rmd_cnt": "0",
         "title": "[HMM/Hold] 실적은 기대 이상, 관건은 내년 운임", "body": "", "userid": "210133",
         "edate": "", "depth": "0", "reg_dt": "2026/11/13", "attach_flg": "", "bflag": "261896",
         "page": "1", "bid": "R_E081", "aid": "15078", "email": "", "username": "배세호"},
        {"view_chk": "", "sdate": "20050630", "view_cnt": "13166", "mod_dt": "", "rmd_cnt": "0",
         "title": "[메리츠금융지주/Buy] 3Q26 Review: 소외되었던 26년보다 27년이 기대되는 회사",
         "body": "", "userid": "260062", "edate": "", "depth": "0", "reg_dt": "2026/11/12",
         "attach_flg": "", "bflag": "261870", "page": "1", "bid": "R_E081", "aid": "15072",
         "email": "", "username": "설용진"},
        {"title": "11월 Top Picks", "reg_dt": "2026/11/10", "aid": "15000", "bid": "R_E081",
         "username": "리서치센터"},
    ],
    [{"total_count": "14971"}],
    [],
]
IM_ATTACH_PAYLOAD = [[{"reg_dt": "2026-11-13", "file_name": "[13080033]_011200.pdf",
                       "file_type": "F", "file_dir": "R_E08/2026/11", "bflag": "261896",
                       "attach_1": "", "title": "[HMM/Hold] 실적은 기대 이상, 관건은 내년 운임",
                       "bid": "R_E081", "username": "배세호"}]]

# BNK투자증권 기업분석 목록 실측 두 행(공백 정리).
BNK_LIST_HTML = """
<table><tbody>
<tr>
  <td>85467</td>
  <td class="TL">
    <a href="#" onclick="viewAction(this, '85467', '/uploads/85467/1', '171077_307.pdf');" target="_blank" title="171077_307.pdf 첨부파일 다운로드">[삼표시멘트/보유] ESG 경영 성과 가시화</a>
    <span class="badge square fill-opa-red ml8">New</span>
  </td>
  <td>이선일</td>
  <td><a href="#none" onclick="fn_download2('85467', '1', '171077_307.pdf');"><img src="/img/ic_attach.svg" alt="첨부파일 다운로드" /></a><br /></td>
  <!--<td>2026-11-13</td>-->
  <td>2026.11.13</td>
  <td id="inq_cnt_85467">22</td>
</tr>
<tr>
  <td>85446</td>
  <td class="TL">
    <a href="#" onclick="viewAction(this, '85446', '/uploads/85446/1', '251699_70.pdf');" target="_blank" title="251699_70.pdf 첨부파일 다운로드">[카카오/매수] 본업 이익 성장과 AI 투자회수의 교차점</a>
  </td>
  <td>이종원</td>
  <td></td>
  <td>2026.11.12</td>
  <td id="inq_cnt_85446">43</td>
</tr>
</tbody></table>
<ol><li><a href="#none" onclick="fn_search('2')">2</a></li>
<li><a href="#none" class="arrow last" onclick="fn_search('482');">last</a></li></ol>
"""

# 상상인증권 /notice/getNoticeList 실측 두 행 + 종목코드 없는 행.
SSI_LIST_PAYLOAD = [{"getStarCnt": 0, "getCount": 4699, "getNoticeList": [
    {"HIT": 2, "STAR_YN": "N", "STOCK_CD": "001450", "REGDT": "2026.11.15", "STOCK_NM": "현대해상",
     "NT_NO": 4699, "TITLE": "현대해상(001450):보험손익의 회복, 주주환원까지의 시차",
     "FILE_YN": "Y", "NM": "리서치센터"},
    {"HIT": 15, "STAR_YN": "N", "STOCK_CD": "014680", "REGDT": "2026.11.13", "STOCK_NM": "한솔케미칼",
     "NT_NO": 4698, "TITLE": "한솔케미칼(014680):3Q26 Review 방향성은 유효", "FILE_YN": "Y",
     "NM": "리서치센터"},
    {"HIT": 1, "STOCK_CD": "", "REGDT": "2026.11.10", "STOCK_NM": "", "NT_NO": 4690,
     "TITLE": "공지", "FILE_YN": "N", "NM": "리서치센터"},
]}]
# /notice/getNoticeDetail 실측 (ntNo 4698).
SSI_DETAIL_PAYLOAD = {
    "notice": {"PRE_TITLE_NO": 4697, "STOCK_CD": "014680", "STOCK_NM": "한솔케미칼",
               "REGDT": "2026.11.13", "NT_NO": 4698, "CMS_CD": "CM0079", "HIT": 15,
               "TITLE": "한솔케미칼(014680):3Q26 Review 방향성은 유효", "NM": "리서치센터",
               "CONTS": "한솔케미칼 [BUY / 340,000]<br>3Q26 Review: 방향성은 유효<br>"
                        "[상상인증권 IT/전기전자 엄우용]<br><br>▶3Q26 Review: 컨센서스 소폭 하회"
                        "<br><br>▶투자의견 BUY 유지, 목표주가 340,000원으로 하향<br><br>"
                        "* 해당 내용은 컴플라이언스 승인을 필하였습니다"},
    "file": [{"ORD": 1, "FNM": "상상인_기업분석_한솔케미칼_20261113.pdf", "FNO": 1, "NT_NO": 4698,
              "FSZ": 3662027, "CMS_CD": "CM0079"},
             {"ORD": 2, "FNM": "상상인_기업분석_한솔케미칼_20261113.png", "FNO": 2, "NT_NO": 4698,
              "FSZ": 266058, "CMS_CD": "CM0079"}],
}

# PDF 1쪽 텍스트(pypdf 추출 결과를 줄인 합성 표본). 실제 PDF는 저장소에 넣지 않는다.
PDF_TEXT_IM = """2026.11.13
HMM  (011200)
실적은 기대 이상, 관건은 내년 운임 Company Brief
투자의견 Hold, 목표주가 23,000원 유지
HMM에 대해 투자의견 Hold와 목표주가 23,000원을 유지한다. 목표주가는 12개월
선행 EBITDA에 ... 적용했다.
Hold (Maintain)
목표주가(12M) 23,000원(유지)
종가(2026.11.12) 20,700원
EPS(원) 1,991 3,515 1,897 2,056
"""
PDF_TEXT_BNK = """2026/11/12
카카오 (035720)
기업분석 리포트
투자의견
[유지]
매수
목표주가(6M)
[하향]
44,000원
37.5%
현재주가
2026/11/11
32,000원
"""
PDF_TEXT_MAN = "투 자 의 견 BUY 목 표 주 가 16만5,000원 (상향)  EPS 3,898원"
PDF_TEXT_EN = "Samsung SDI (006400) Rating BUY  Target Price (12M) KRW 420,000  Current 300,000"


class TestDirectParsers(unittest.TestCase):
    def test_split_bracket_title(self):
        self.assertEqual(P.split_bracket_title("[HMM/Hold] 실적은 기대 이상"),
                         ("HMM", "Hold", "실적은 기대 이상"))
        self.assertEqual(P.split_bracket_title("11월 Top Picks"), (None, None, "11월 Top Picks"))

    def test_im_list(self):
        rows = P.parse_im_list(IM_LIST_PAYLOAD)
        self.assertEqual([r["id"] for r in rows], ["im:15078", "im:15072"])  # 종목 아닌 행 제외
        r = rows[0]
        self.assertEqual((r["name"], r["rating_raw"], r["title"], r["date"], r["analyst"]),
                         ("HMM", "Hold", "실적은 기대 이상, 관건은 내년 운임", "2026-11-13", "배세호"))
        self.assertIsNone(r["code"])
        self.assertEqual(r["im_bid"], "R_E081")
        self.assertEqual(rows[1]["title"], "3Q26 Review: 소외되었던 26년보다 27년이 기대되는 회사")
        self.assertEqual(P.im_list_total(IM_LIST_PAYLOAD), 14971)
        self.assertEqual(P.parse_im_list(None), [])

    def test_im_attach(self):
        pdf, code = P.parse_im_attach(IM_ATTACH_PAYLOAD)
        self.assertEqual(pdf, "https://www.imfnsec.com/upload/R_E08/2026/11/%5B13080033%5D_011200.pdf")
        self.assertEqual(code, "011200")
        self.assertEqual(P.parse_im_attach([[]]), (None, None))

    def test_bnk_list(self):
        rows = P.parse_bnk_list(BNK_LIST_HTML)
        self.assertEqual([r["id"] for r in rows], ["bnk:85467", "bnk:85446"])
        r = rows[1]
        self.assertEqual((r["name"], r["rating_raw"], r["title"], r["date"], r["analyst"]),
                         ("카카오", "매수", "본업 이익 성장과 AI 투자회수의 교차점", "2026-11-12", "이종원"))
        self.assertEqual(r["pdf"], "https://www.bnkfn.co.kr/uploads/85446/1/251699_70.pdf")
        self.assertIsNone(r["code"])
        self.assertEqual(P.bnk_last_page(BNK_LIST_HTML), 482)
        self.assertEqual(P.bnk_list_dates(BNK_LIST_HTML), ["2026-11-13", "2026-11-12"])

    def test_sangsangin_list(self):
        rows = P.parse_sangsangin_list(SSI_LIST_PAYLOAD)
        self.assertEqual([r["id"] for r in rows], ["sangsangin:4699", "sangsangin:4698"])
        self.assertEqual((rows[1]["code"], rows[1]["name"], rows[1]["title"], rows[1]["date"]),
                         ("014680", "한솔케미칼", "3Q26 Review 방향성은 유효", "2026-11-13"))
        self.assertIsNone(rows[1]["analyst"])  # NM은 부서명
        self.assertEqual(P.sangsangin_total(SSI_LIST_PAYLOAD), 4699)

    def test_sangsangin_detail(self):
        d = P.parse_sangsangin_detail(SSI_DETAIL_PAYLOAD)
        self.assertEqual((d["rating_raw"], d["target"], d["analyst"]), ("BUY", 340000, "엄우용"))
        self.assertEqual(d["pdf"], "https://www.sangsanginib.com/_upload/attFile/CM0079/CM0079_4698_1.pdf")
        self.assertTrue(d["summary"].startswith("한솔케미칼 [BUY / 340,000]"))
        self.assertEqual(P.parse_sangsangin_detail(None)["target"], None)


class TestNameMap(unittest.TestCase):
    def test_universe_then_records(self):
        uni = [["005930", "삼성전자", "KOSPI"], ["035720", "카카오", "KOSPI"],
               ["0126Z0", "삼성에피스홀딩스", "KOSPI"], ["bad", "엉터리"]]
        recs = [{"name": "카카오", "code": "999999"},          # 유니버스가 우선
                {"name": "S-Oil", "code": "010950"},
                {"name": "LIG디펜스앤에어로스페이스", "code": "079550"}]
        m = P.build_name_map(uni, recs)
        self.assertEqual(P.lookup_code("카카오", m), "035720")
        self.assertEqual(P.lookup_code("삼성 전자", m), "005930")   # 공백 무시
        self.assertEqual(P.lookup_code("S-OIL", m), "010950")       # 대소문자·문장부호 무시
        self.assertEqual(P.lookup_code("삼성에피스홀딩스", m), "0126Z0")
        self.assertEqual(P.lookup_code("LIG디펜스앤에어로스페이스", m), "079550")
        self.assertIsNone(P.lookup_code("엉터리", m))
        self.assertIsNone(P.lookup_code("", m))


class TestPdfExtract(unittest.TestCase):
    def test_im_first_page(self):
        self.assertEqual(P.extract_pdf_opinion(PDF_TEXT_IM), ("Hold", 23000))
        self.assertEqual(P.extract_code_from_text(PDF_TEXT_IM, "HMM"), "011200")

    def test_bnk_tag_between(self):
        # '투자의견 [유지] 매수', '목표주가(6M) [하향] 44,000원'
        self.assertEqual(P.extract_pdf_opinion(PDF_TEXT_BNK), ("매수", 44000))
        self.assertEqual(P.extract_code_from_text(PDF_TEXT_BNK, "카카오"), "035720")
        self.assertIsNone(P.extract_code_from_text(PDF_TEXT_BNK, "삼성전자"))

    def test_spaced_and_man_notation(self):
        self.assertEqual(P.extract_pdf_opinion(PDF_TEXT_MAN), ("BUY", 165000))

    def test_close_price_after_sentence_not_target(self):
        # 상상인 JYP Ent. PDF 1쪽 실측: 목표가 숫자는 이미지라 텍스트에 없고 종가만 있다
        text = ("안정적인 실적이 예상되어 투자의견과 목표주가를 유지한다. \n"
                "종가(26.11.11) 38,700원 \n상승여력 34.4%")
        self.assertEqual(extract_opinion_from_text(text)[1], None)
        self.assertEqual(P.extract_pdf_opinion(text)[1], None)

    def test_english_target(self):
        self.assertEqual(P.extract_pdf_opinion(PDF_TEXT_EN)[1], 420000)

    def test_nothing(self):
        self.assertEqual(P.extract_pdf_opinion(""), (None, None))
        self.assertEqual(P.extract_pdf_opinion("표 1. 매출 추이 2,000원"), (None, None))

    def test_pdftext_fails_soft(self):
        import pdftext
        self.assertIsNone(pdftext.first_page_text(b""))
        self.assertIsNone(pdftext.first_page_text(b"%PDF-1.4 broken"))


def _direct_rec(**kw):
    rec = {"id": "im:1", "source": "im", "code": "011200", "name": "HMM", "broker": "iM증권",
           "date": "2026-11-13", "title": "실적은 기대 이상, 관건은 내년 운임",
           "analyst": "배세호", "rating_raw": "Hold", "target": 23000,
           "pdf": "https://www.imfnsec.com/upload/x.pdf", "url": "https://www.imfnsec.com/upload/x.pdf",
           "summary": None}
    rec.update(kw)
    return rec


class TestAbsorbDirect(unittest.TestCase):
    def wise(self, **kw):
        rec = {"id": "wise:9", "source": "wise", "code": "011200", "name": "HMM", "broker": "iM증권",
               "date": "2026-11-14", "title": "실적은 기대 이상, 관건은 내년 운임", "analyst": None,
               "rating_raw": "Hold", "target": 22000, "pdf": None,
               "url": "https://comp.wisereport.co.kr/company/c1080001.aspx?cmp_cd=011200",
               "summary": "와이즈 요약"}
        rec.update(kw)
        return rec

    def test_attach_to_wise_prefers_direct(self):
        w = self.wise()
        out, st = norm.absorb_direct([w, _direct_rec()])
        self.assertEqual(out, [w])
        self.assertEqual(w["pdf"], "https://www.imfnsec.com/upload/x.pdf")
        self.assertEqual(w["url"], w["pdf"])
        self.assertEqual(w["target"], 23000)          # 직접 수집 값 우선
        self.assertEqual(w["analyst"], "배세호")       # 빈 칸 채움
        self.assertEqual(w["summary"], "와이즈 요약")
        self.assertEqual(w["direct"], "im:1")
        self.assertEqual(st["attached"], {"wise": 1})
        self.assertEqual(st["pdf_gained"], 1)
        self.assertEqual((st["compared"], st["agree"]), (1, 0))
        self.assertEqual(st["disagree"], [("wise:9", "im:1", 22000, 23000, True)])
        # 멱등: 다시 돌려도 그대로
        again, st2 = norm.absorb_direct(out)
        self.assertEqual(again, [w])
        self.assertEqual(st2["attached"], {})

    def test_far_target_not_overridden(self):
        w = self.wise(target=22000)
        norm.absorb_direct([w, _direct_rec(target=3515)])  # EPS를 잘못 읽은 경우
        self.assertEqual(w["target"], 22000)
        self.assertEqual(w["pdf"], "https://www.imfnsec.com/upload/x.pdf")

    def test_naver_not_downgraded(self):
        n = {"id": "naver:5", "source": "naver", "code": "011200", "broker": "iM증권",
             "date": "2026-11-13", "title": "실적은 기대 이상, 관건은 내년 운임", "analyst": "배세호",
             "rating_raw": "Buy", "target": 25000, "pdf": "https://stock.pstatic.net/a.pdf",
             "url": "https://m.stock.naver.com/research/company/5"}
        out, st = norm.absorb_direct([n, _direct_rec()])
        self.assertEqual(out, [n])
        self.assertEqual((n["target"], n["rating_raw"], n["pdf"]),
                         (25000, "Buy", "https://stock.pstatic.net/a.pdf"))
        self.assertEqual(n["direct"], "im:1")
        self.assertEqual(st["pdf_gained"], 0)
        self.assertEqual(st["disagree"][0][4], False)

    def test_no_match_stays(self):
        d = _direct_rec()
        other = self.wise(date="2026-11-01")              # 3일 넘게 떨어짐
        diff_title = self.wise(id="wise:10", title="전혀 다른 제목의 리포트입니다")
        out, st = norm.absorb_direct([d, other, diff_title])
        self.assertEqual(len(out), 3)
        self.assertNotIn("direct", other)

    def test_hankyung_attached(self):
        h = self.wise(id="hankyung:1", source="hankyung", target=None, rating_raw=None)
        out, _ = norm.absorb_direct([h, _direct_rec()])
        self.assertEqual(out, [h])
        self.assertEqual((h["target"], h["rating_raw"]), (23000, "Hold"))

    def test_priority_and_stale_limit(self):
        self.assertEqual(norm.SOURCE_PRIORITY["im"], norm.SOURCE_PRIORITY["kb"])
        self.assertLess(norm.SOURCE_PRIORITY["bnk"], norm.SOURCE_PRIORITY["wise"])
        monday = datetime.date(2026, 11, 16)
        status = {"bnk": {"last_date": "2026-11-11"}, "im": {"last_date": "2026-11-06"}}
        bad = stale_sources(status, monday)
        self.assertEqual([b["source"] for b in bad], ["im"])
        self.assertEqual(bad[0]["limit"], 5)


if __name__ == "__main__":
    result = unittest.main(exit=False, verbosity=2).result
    print("\n%s — 실행 %d, 실패 %d, 오류 %d"
          % ("통과" if result.wasSuccessful() else "실패",
             result.testsRun, len(result.failures), len(result.errors)))
    sys.exit(0 if result.wasSuccessful() else 1)
