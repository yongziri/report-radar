"""parsers.py 검증. 네트워크 없이 픽스처 문자열만으로 돈다.

실행:  python scraper/test_parsers.py
       python -m unittest discover -s scraper
"""

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
    parse_nh_summary,
    parse_price_payload,
    to_int,
)
from sectors import (  # noqa: E402
    SECTOR_MAP,
    SECTOR_ORDER,
    is_stale,
    parse_sector_codes,
    parse_sector_list,
    sector_of,
)

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


if __name__ == "__main__":
    result = unittest.main(exit=False, verbosity=2).result
    print("\n%s — 실행 %d, 실패 %d, 오류 %d"
          % ("통과" if result.wasSuccessful() else "실패",
             result.testsRun, len(result.failures), len(result.errors)))
    sys.exit(0 if result.wasSuccessful() else 1)
