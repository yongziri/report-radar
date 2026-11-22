"""tools/parts/*.{html,js} 를 이어붙이고 종목 유니버스를 주입해 ../index.html 을 만든다.

사용: python build.py   (먼저 fetch_universe.py 로 universe.json 생성)

파일이 커서 파트로 쪼개 관리한다. 조립 순서는 PARTS 참조.
네이버의 79개 세부 업종은 트리맵 구획으로 쓰기엔 너무 잘게 쪼개져 있어
(상위 150종목이 45개 업종에 흩어짐) Finviz 식 대분류 12개로 묶어서 넣는다.

산출물 (저장소 루트):
  index.html  — 앱 본체
  fonts.css   — 우리다움체(base64). index.html 이 fonts.css?v=<해시> 로 참조해 브라우저가 캐시한다.
  sw.js       — 서비스 워커. app/sw.src.js 에 빌드 ID·폰트 주소를 찍어 만든다.
                빌드 ID 가 바뀌면 sw.js 바이트가 바뀌어 새 배포 시 이전 캐시가 교체된다.
  m/index.html, m/sw.js, m/manifest.webmanifest
              — 앱 버전(폰 전용). PC 의 CSS·본문·JS 를 그대로 싣고 app/mobile/* 를 얹는다.
                설계: docs/MOBILE-APP-SPEC.md. 자원(data/·icons/·fonts.css)은 루트 것을 ../ 로 쓴다.
"""
import hashlib
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
PARTS_DIR = os.path.join(HERE, "parts")
ROOT = os.path.normpath(os.path.join(HERE, os.pardir))
OUT = os.path.join(ROOT, "index.html")
FONTS_OUT = os.path.join(ROOT, "fonts.css")
SW_SRC = os.path.join(HERE, "sw.src.js")
SW_OUT = os.path.join(ROOT, "sw.js")
MOBILE_DIR = os.path.join(HERE, "mobile")
APP_DIR = os.path.join(ROOT, "m")

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
    ("11_repx.js", "js"),          # 내 종목 리포트·성적표·산업·시황 (09 이후 — RP_PAGE 등 상수 사용)
    ("07_init.js", "js"),
]
TAIL = "</script>\n</body>\n</html>\n"

# 앱 버전: 화면 모듈 (m_core.js 다음에 이 순서로 붙고, 끝에 mBoot() 가 붙는다)
M_SCREENS = ["home", "reports", "stock", "assets", "more"]
# 서비스 워커 프리캐시 (sw.src.js 의 __PRECACHE__ 자리에 들어간다). PC 목록은 기존 그대로.
SW_PRECACHE_PC = ["./index.html", "./__FONTS_HREF__", "./manifest.webmanifest",
                  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/mark-64.png"]
SW_PRECACHE_APP = ["./index.html", "../__FONTS_HREF__", "./manifest.webmanifest",
                   "../icons/icon-192.png", "../icons/icon-512.png", "../icons/icon-maskable-512.png",
                   "../icons/mark-64.png", "../icons/mark-128.png"]

# 대분류 -> 네이버 세부 업종
BROAD = [
    ("기술", ["반도체와반도체장비", "전자장비와기기", "IT서비스", "소프트웨어",
             "통신장비", "디스플레이장비및부품", "디스플레이패널", "전자제품",
             "핸드셋", "컴퓨터와주변기기", "사무용전자제품"]),
    ("헬스케어", ["제약", "생물공학", "건강관리장비와용품", "생명과학도구및서비스",
                "건강관리업체및서비스", "건강관리기술"]),
    ("금융", ["은행", "증권", "손해보험", "생명보험", "카드", "창업투자", "부동산",
             "기타금융"]),
    ("산업재", ["기계", "조선", "우주항공과국방", "건설", "건축자재",
              "상업서비스와공급품", "무역회사와판매업체", "전기장비", "전기제품",
              "건축제품"]),
    ("소재", ["화학", "철강", "비철금속", "종이와목재", "포장재"]),
    ("경기소비재", ["자동차", "자동차부품", "백화점과일반상점", "섬유,의류,신발,호화품",
                 "호텔,레스토랑,레저", "교육서비스", "인터넷과카탈로그소매",
                 "가정용기기와용품", "판매업체", "화장품", "가구", "레저용장비와제품",
                 "다각화된소비자서비스", "전문소매", "문구류"]),
    ("필수소비재", ["식품", "음료", "담배", "가정용품", "식품과기본식료품소매"]),
    ("커뮤니케이션", ["게임엔터테인먼트", "방송과엔터테인먼트", "양방향미디어와서비스",
                  "무선통신서비스", "다각화된통신서비스", "광고", "출판"]),
    ("에너지", ["석유와가스", "에너지장비및서비스"]),
    ("유틸리티", ["전기유틸리티", "가스유틸리티", "복합유틸리티"]),
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


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def js_parts(is_app):
    """<script> + 공유 JS. 빌드가 IS_APP·APP_BASE 를 맨 앞에 넣는다 (PC false/"", 앱 true/"../")."""
    buf = []
    for fname, kind in PARTS:
        if kind != "js":
            continue
        txt = read(os.path.join(PARTS_DIR, fname))
        if fname == "03_core.js":
            buf.append('<script>\n"use strict";\n')
            buf.append("const IS_APP = %s;\nconst APP_BASE = %s;\n"
                       % ("true" if is_app else "false", '"../"' if is_app else '""'))
        buf.append(txt)
        if not txt.endswith("\n"):
            buf.append("\n")
    return buf


def assemble():
    buf = []
    for fname, kind in PARTS:
        if kind is None:
            buf.append(read(os.path.join(PARTS_DIR, fname)))
    buf.extend(js_parts(False))
    buf.append(TAIL)
    return "".join(buf)


def assemble_app():
    """앱 버전 m/index.html.
    머리: app/mobile/m_head.html — PC <style> 본문이 __DESKTOP_CSS__, 화면별 m_*.css 가 __SCREEN_CSS__ 자리에
    본문: <body class="mapp"> + m_shell.html + 02_body.html (맨 앞 <body> 제거, icons/ → ../icons/)
    스크립트: 공유 JS(03~11, 07) + m_core.js + 화면 모듈 + mBoot()"""
    head_pc = read(os.path.join(PARTS_DIR, "01_head.html"))
    i, j = head_pc.index("<style>") + len("<style>"), head_pc.rindex("</style>")
    desktop_css = head_pc[i:j].strip("\n") + "\n"
    screen_css = []
    for name in M_SCREENS:
        css = read(os.path.join(MOBILE_DIR, "m_%s.css" % name))
        screen_css.append("/* ---- m_%s.css ---- */\n%s%s" % (name, css, "" if css.endswith("\n") else "\n"))
    head = read(os.path.join(MOBILE_DIR, "m_head.html"))
    for token, val in (("__DESKTOP_CSS__", desktop_css), ("__SCREEN_CSS__", "".join(screen_css))):
        assert token in head, "placeholder %s not found in m_head.html" % token
        head = head.replace(token, val)

    body = read(os.path.join(PARTS_DIR, "02_body.html"))
    assert body.startswith("<body>"), "02_body.html 은 <body> 로 시작해야 한다"
    body = body[len("<body>"):].lstrip("\n")
    # 루트 자원 경로는 빌드 때 바꾼다 (공유 파트는 그대로)
    body = body.replace('src="icons/', 'src="../icons/').replace('srcset="icons/', 'srcset="../icons/')
    body = body.replace(", icons/", ", ../icons/")
    shell = read(os.path.join(MOBILE_DIR, "m_shell.html"))

    buf = [head, '<body class="mapp">\n', shell, "\n", body]
    buf.extend(js_parts(True))
    for fname in ["m_core.js"] + ["m_%s.js" % n for n in M_SCREENS]:
        txt = read(os.path.join(MOBILE_DIR, fname))
        buf.append("/* ==== app/mobile/%s ==== */\n" % fname)
        buf.append(txt)
        if not txt.endswith("\n"):
            buf.append("\n")
    buf.append("mBoot();\n")
    buf.append(TAIL)
    return "".join(buf)


def precache_js(lst):
    return "[\n  " + ",\n  ".join('"%s"' % u for u in lst) + "\n]"


def build_sw(sw_src, html, fonts_css, fonts_href, cache_prefix, precache, asset_base):
    """서비스 워커: 빌드 ID 는 산출물 내용 해시 — 내용이 같으면 sw.js 도 바이트 단위로 같다"""
    sw = sw_src
    for token, val in (("__CACHE_PREFIX__", cache_prefix), ("__PRECACHE__", precache_js(precache)),
                       ("__ASSET_BASE__", asset_base)):
        assert token in sw, "placeholder %s not found in sw.src.js" % token
        sw = sw.replace(token, val)
    build_id = hashlib.sha256((html + fonts_css + sw).encode("utf-8")).hexdigest()[:12]
    for token, val in (("__BUILD_ID__", build_id), ("__FONTS_HREF__", fonts_href)):
        assert token in sw, "placeholder %s not found in sw.src.js" % token
        sw = sw.replace(token, val)
    return sw, build_id


def main():
    with open(os.path.join(HERE, "universe.json"), encoding="utf-8") as f:
        uni = json.load(f)

    ind_names = sorted({u[4] for u in uni})
    industries = {n: i for i, n in enumerate(ind_names)}

    # BROAD 표에 없는 업종은 전부 "복합·기타"로 떨어진다. 네이버가 업종을 늘리면
    # 조용히 뭉뚱그려지므로 빌드 때마다 알려준다.
    unmapped = [n for n in ind_names if n not in IND2BROAD]
    if unmapped:
        print("  ! BROAD 미매핑 업종 %d개 (복합·기타로 처리): %s"
              % (len(unmapped), ", ".join(unmapped)))
    else:
        print("  BROAD 미매핑 업종 0개")
    kospi = [u for u in uni if u[2] == "KOSPI"]
    kosdaq = [u for u in uni if u[2] == "KOSDAQ"]

    fonts_path = os.path.join(PARTS_DIR, "_fonts.css")
    if os.path.exists(fonts_path):
        with open(fonts_path, encoding="utf-8") as f:
            fonts_css = f.read().strip()
    else:
        fonts_css = "/* 폰트 없음: python embed_fonts.py 를 먼저 실행하세요 */"
        print("  ! parts/_fonts.css 없음 — 폰트 미내장으로 빌드")
    fonts_css += "\n"
    with open(FONTS_OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(fonts_css)
    fonts_hash = hashlib.sha256(fonts_css.encode("utf-8")).hexdigest()[:10]
    fonts_href = "fonts.css?v=" + fonts_hash

    repl = {
        "__FONTS_HREF__": fonts_href,
        "__KR_KOSPI__": pack(kospi, industries),
        "__KR_KOSDAQ__": pack(kosdaq, industries),
        "__SECTORS__": ";".join(BROAD_NAMES),
        "__INDUSTRIES__": ";".join(clean(n) for n in ind_names),
        # INDUSTRIES 와 같은 순서의 대분류 idx — 리포트 탭이 record.industry 로 대분류를 찾는다
        "__IND_BROAD__": ";".join(str(IND2BROAD.get(n, FALLBACK)) for n in ind_names),
    }

    def fill(page):
        for token, val in repl.items():
            assert token in page, "placeholder %s not found" % token
            page = page.replace(token, val)
        return page

    sw_src = read(SW_SRC)

    # ---- PC 버전 ----
    html = fill(assemble())
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(html)
    sw, build_id = build_sw(sw_src, html, fonts_css, fonts_href, "gongdo-radar-", SW_PRECACHE_PC, "./")
    with open(SW_OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(sw)

    print("wrote", os.path.normpath(OUT))
    print("  fonts.css %d bytes (%s) / sw.js build %s" % (len(fonts_css), fonts_href, build_id))
    print("  KOSPI %d / KOSDAQ %d / 업종 %d / 대분류 %d / bytes %d"
          % (len(kospi), len(kosdaq), len(ind_names), len(BROAD_NAMES), len(html)))

    # ---- 앱 버전 (m/) ----  폰트는 m_head.html 이 "../__FONTS_HREF__" 로 루트 fonts.css 를 가리킨다
    os.makedirs(APP_DIR, exist_ok=True)
    app_html = fill(assemble_app())
    with open(os.path.join(APP_DIR, "index.html"), "w", encoding="utf-8", newline="\n") as f:
        f.write(app_html)
    # 캐시 이름 접두어는 PC("gongdo-radar-")와 겹치면 안 된다 — PC 워커의 activate 가 접두어로 지운다
    app_sw, app_build = build_sw(sw_src, app_html, fonts_css, fonts_href, "gongdo-app-", SW_PRECACHE_APP, "../")
    with open(os.path.join(APP_DIR, "sw.js"), "w", encoding="utf-8", newline="\n") as f:
        f.write(app_sw)
    man = json.loads(read(os.path.join(MOBILE_DIR, "m_manifest.json")))
    with open(os.path.join(APP_DIR, "manifest.webmanifest"), "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(man, ensure_ascii=False, indent=2) + "\n")
    print("wrote", os.path.normpath(os.path.join(APP_DIR, "index.html")))
    print("  m/sw.js build %s / bytes %d" % (app_build, len(app_html)))


if __name__ == "__main__":
    main()
