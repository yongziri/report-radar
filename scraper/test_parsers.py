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
    normalize_broker,
    normalize_date,
    normalize_rating,
    parse_detail,
    parse_hankyung_list,
    parse_kb_list,
    parse_kis_detail,
    parse_kis_list,
    parse_kis_total,
    parse_list_last_page,
    parse_list_page,
    parse_nh_list,
    parse_nh_summary,
    parse_price_payload,
    to_int,
)

# ------------------------------------------------------------------ 픽스처

LIST_HTML = """
<html><head><meta charset="utf-8"></head><body>
<table class="type_1">
  <tr><th>종목명</th><th>제목</th><th>증권사</th><th>첨부</th><th>작성일</th><th>조회수</th></tr>
  <tr><td colspan="6" class="line"></td></tr>
  <tr>
    <td><a href="/item/main.naver?code=031980" title="피에스케이홀딩스" class="stock_item">피에스케이홀딩스</a></td>
    <td><a href="company_read.naver?nid=96032&amp;page=1">홀딩스의 시간이 온다</a><img alt="NEW"></td>
    <td>DS투자증권</td>
    <td class="file"><a href="https://stock.pstatic.net/stock-research/company/66/20260907_company_169484000.pdf"></a></td>
    <td class="date">26.09.07</td>
    <td class="date">4006</td>
  </tr>
  <tr>
    <td><a href="/item/main.naver?code=005930" title="삼성전자" class="stock_item">삼성전자</a></td>
    <td><a href="company_read.naver?nid=96031&amp;page=1">반등의 조건</a></td>
    <td>미래에셋증권</td>
    <td class="file"></td>
    <td class="date">26.09.05</td>
    <td class="date">12,340</td>
  </tr>
</table>
<table class="Nnavi">
  <tr>
    <td class="on">1</td>
    <td><a href="/research/company_list.naver?&amp;page=2">2</a></td>
    <td><a href="/research/company_list.naver?&amp;page=3">3</a></td>
  </tr>
</table>
</body></html>
"""

DETAIL_HTML = """
<html><body>
<div class="view_info_1">
  <span>목표가 <em class="money"><strong>200,000</strong></em></span>
  <span>투자의견 <em class="coment">매수</em></span>
</div>
<table><tr><td class="view_cnt">
  홀딩스의 시간이 온다.   반도체 후공정   장비 업체로서
  내년 실적   개선이 가시화된다.
</td></tr></table>
<div class="side"><a href="/item/main.naver?code=005930">삼성전자</a></div>
</body></html>
"""

DETAIL_HTML_NONE = """
<html><body>
<div class="view_info_1">
  <span>목표가 <em class="money">없음</em></span>
  <span>투자의견 <em class="coment">Not Rated</em></span>
</div>
<table><tr><td class="view_cnt">커버리지 개시 전 자료.</td></tr></table>
</body></html>
"""

# 실제 마크업을 그대로 옮겼다. 제목 칸의 div.layerPop이 같은 제목을 한 번 더 품고 있고,
# 적정가격을 제시하지 않은 리포트는 0으로 내려온다.
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

class TestListParser(unittest.TestCase):
    def test_rows(self):
        rows = parse_list_page(LIST_HTML)
        self.assertEqual(len(rows), 2)

        first = rows[0]
        self.assertEqual(first["id"], "naver:96032")
        self.assertEqual(first["source"], "naver")
        self.assertEqual(first["code"], "031980")
        self.assertEqual(first["name"], "피에스케이홀딩스")
        self.assertEqual(first["title"], "홀딩스의 시간이 온다")
        self.assertEqual(first["broker"], "DS투자증권")
        self.assertEqual(first["date"], "2026-09-07")
        self.assertEqual(first["views"], 4006)
        self.assertTrue(first["pdf"].endswith("169484000.pdf"))
        self.assertEqual(
            first["url"],
            "https://finance.naver.com/research/company_read.naver?nid=96032")

    def test_second_row_and_missing_pdf(self):
        rows = parse_list_page(LIST_HTML)
        second = rows[1]
        self.assertEqual(second["code"], "005930")
        self.assertEqual(second["date"], "2026-09-05")
        self.assertEqual(second["views"], 12340)
        self.assertIsNone(second["pdf"])

    def test_header_and_filler_rows_skipped(self):
        # th 헤더 행과 line 행은 stock_item이 없으니 걸러진다
        self.assertEqual(len(parse_list_page("<table class='type_1'></table>")), 0)
        self.assertEqual(parse_list_page("<html></html>"), [])

    def test_last_page(self):
        self.assertEqual(parse_list_last_page(LIST_HTML), 3)
        self.assertIsNone(parse_list_last_page("<html></html>"))


class TestDetailParser(unittest.TestCase):
    def test_normal(self):
        d = parse_detail(DETAIL_HTML)
        self.assertEqual(d["target"], 200000)
        self.assertEqual(d["rating_raw"], "매수")
        self.assertIn("반도체 후공정 장비 업체", d["summary"])
        self.assertNotIn("  ", d["summary"])

    def test_trailing_attachment_name_stripped(self):
        html = ('<div class="view_info_1"><em class="money"><strong>1,000</strong></em>'
                '<em class="coment">매수</em></div>'
                '<td class="view_cnt">실적이 개선되었다. 20260904163445150_0_ko.pdf</td>')
        self.assertEqual(parse_detail(html)["summary"], "실적이 개선되었다.")

    def test_multiple_attachment_names_stripped(self):
        html = ('<div class="view_info_1"><em class="money">없음</em></div>'
                '<td class="view_cnt">본문 끝. a_기업리포트.pdf 260907_b.pdf</td>')
        self.assertEqual(parse_detail(html)["summary"], "본문 끝.")

    def test_no_target(self):
        d = parse_detail(DETAIL_HTML_NONE)
        self.assertIsNone(d["target"])
        self.assertEqual(d["rating_raw"], "Not Rated")
        self.assertEqual(normalize_rating(d["rating_raw"]), "NR")

    def test_summary_truncated_to_600(self):
        html = ('<div class="view_info_1"><em class="money">없음</em>'
                '<em class="coment">매수</em></div>'
                '<td class="view_cnt">' + ("가" * 900) + "</td>")
        self.assertEqual(len(parse_detail(html)["summary"]), 600)

    def test_regex_fallback(self):
        # 셀렉터가 못 잡는 마크업이라도 정규식으로 건진다
        html = '<div class="wrap">목표가 <em class="money"><strong>88,000</strong></em>' \
               ' 투자의견 <em class="coment">중립</em></div>'
        d = parse_detail(html)
        self.assertEqual(d["target"], 88000)
        self.assertEqual(d["rating_raw"], "중립")

    def test_side_widget_code_not_used(self):
        # 상세 파서는 종목코드를 아예 돌려주지 않는다 (사이드 위젯 오염 방지)
        self.assertNotIn("code", parse_detail(DETAIL_HTML))


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
