"""tools/parts/*.{html,js} 를 이어붙이고 종목 유니버스를 주입해 ../index.html 을 만든다.

사용: python build.py   (먼저 fetch_universe.py 로 universe.json 생성)

파일이 커서 파트로 쪼개 관리한다. 조립 순서는 PARTS 참조.
네이버의 79개 세부 업종은 트리맵 구획으로 쓰기엔 너무 잘게 쪼개져 있어
(상위 150종목이 45개 업종에 흩어짐) Finviz 식 대분류 12개로 묶어서 넣는다.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
PARTS_DIR = os.path.join(HERE, "parts")
OUT = os.path.join(HERE, os.pardir, "index.html")

PARTS = [
    ("01_head.html", None),        # <!doctype> ~ </style></head>
    ("02_body.html", None),        # <body> ~ 마크업 끝 (스크립트 직전)
    ("03_core.js", "js"),
    ("04_dash.js", "js"),
    ("05_analysis.js", "js"),
    ("06_screener.js", "js"),
    ("08_import.js", "js"),        # 순수 파서 (init 보다 먼저)
    ("09_reports.js", "js"),       # 증권사 리포트 (init 보다 먼저 — 상수 초기화 순서)
    ("10_account.js", "js"),       # 계좌 탭 (setupSearch 정의 이후)
    ("07_init.js", "js"),
]
TAIL = "</script>\n</body>\n</html>\n"

# 대분류 -> 네이버 세부 업종
BROAD = [
    ("기술", ["반도체와반도체장비", "전자장비와기기", "IT서비스", "소프트웨어",
             "통신장비", "디스플레이장비및부품", "디스플레이패널", "전자제품",
             "핸드셋", "컴퓨터와주변기기"]),
    ("헬스케어", ["제약", "생물공학", "건강관리장비와용품", "생명과학도구및서비스",
                "건강관리업체및서비스", "건강관리기술"]),
    ("금융", ["은행", "증권", "손해보험", "생명보험", "카드", "창업투자", "부동산"]),
    ("산업재", ["기계", "조선", "우주항공과국방", "건설", "건축자재",
              "상업서비스와공급품", "무역회사와판매업체", "전기장비", "전기제품"]),
    ("소재", ["화학", "철강", "비철금속", "종이와목재", "포장재"]),
    ("경기소비재", ["자동차", "자동차부품", "백화점과일반상점", "섬유,의류,신발,호화품",
                 "호텔,레스토랑,레저", "교육서비스", "인터넷과카탈로그소매",
                 "가정용기기와용품", "판매업체", "화장품"]),
    ("필수소비재", ["식품", "음료", "담배"]),
    ("커뮤니케이션", ["게임엔터테인먼트", "방송과엔터테인먼트", "양방향미디어와서비스",
                  "무선통신서비스", "다각화된통신서비스", "광고"]),
    ("에너지", ["석유와가스", "에너지장비및서비스"]),
    ("유틸리티", ["전기유틸리티", "가스유틸리티"]),
    ("운송", ["항공사", "해운사", "항공화물운송과물류", "운송인프라", "도로와철도운송"]),
    ("복합·기타", ["복합기업", "기타"]),
]
BROAD_NAMES = [b[0] for b in BROAD]
IND2BROAD = {ind: i for i, (_, inds) in enumerate(BROAD) for ind in inds}
FALLBACK = BROAD_NAMES.index("복합·기타")


def clean(s):
    """구분자와 충돌하는 문자 제거"""
    return s.replace(";", " ").replace("|", " ").strip()


def pack(rows, industries):
    """행: code|name|cap|broadIdx|industryIdx|kind , 행 구분자 ';'
    kind: "" 주식 / E ETF / N ETN"""
    out = []
    for code, name, _mk, cap, ind, kind in rows:
        b = IND2BROAD.get(ind, FALLBACK)
        k = {"ETF": "E", "ETN": "N"}.get(kind, "")
        out.append("%s|%s|%d|%d|%d|%s" % (code, clean(name), cap, b, industries[ind], k))
    return ";".join(out)


def assemble():
    buf = []
    for fname, kind in PARTS:
        path = os.path.join(PARTS_DIR, fname)
        with open(path, encoding="utf-8") as f:
            txt = f.read()
        if kind == "js" and fname == "03_core.js":
            buf.append('<script>\n"use strict";\n')
        buf.append(txt)
        if not txt.endswith("\n"):
            buf.append("\n")
    buf.append(TAIL)
    return "".join(buf)


def main():
    with open(os.path.join(HERE, "universe.json"), encoding="utf-8") as f:
        uni = json.load(f)

    ind_names = sorted({u[4] for u in uni})
    industries = {n: i for i, n in enumerate(ind_names)}
    kospi = [u for u in uni if u[2] == "KOSPI"]
    kosdaq = [u for u in uni if u[2] == "KOSDAQ"]

    fonts_path = os.path.join(PARTS_DIR, "_fonts.css")
    if os.path.exists(fonts_path):
        with open(fonts_path, encoding="utf-8") as f:
            fonts_css = f.read().strip()
    else:
        fonts_css = "/* 폰트 없음: python embed_fonts.py 를 먼저 실행하세요 */"
        print("  ! parts/_fonts.css 없음 — 폰트 미내장으로 빌드")

    html = assemble()
    repl = {
        "__FONTS__": fonts_css,
        "__KR_KOSPI__": pack(kospi, industries),
        "__KR_KOSDAQ__": pack(kosdaq, industries),
        "__SECTORS__": ";".join(BROAD_NAMES),
        "__INDUSTRIES__": ";".join(clean(n) for n in ind_names),
    }
    for token, val in repl.items():
        assert token in html, "placeholder %s not found" % token
        html = html.replace(token, val)

    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(html)

    print("wrote", os.path.normpath(OUT))
    print("  KOSPI %d / KOSDAQ %d / 업종 %d / 대분류 %d / bytes %d"
          % (len(kospi), len(kosdaq), len(ind_names), len(BROAD_NAMES), len(html)))


if __name__ == "__main__":
    main()
