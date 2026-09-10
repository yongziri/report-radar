"""우리다움체 TTF -> WOFF2 무손실 변환 후 base64 @font-face CSS 조각 생성.

서브셋(글자 추려내기)은 하지 않는다 — 전체 글립을 그대로 유지하고 압축만 한다.
결과: parts/_fonts.css  (build.py 가 __FONTS__ 자리에 주입)

사용: python embed_fonts.py
"""
import base64
import os

from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "fonts")
OUT = os.path.join(HERE, "parts", "_fonts.css")

FACES = [
    ("WooridaumL.ttf", 300),
    ("WooridaumR.ttf", 400),
    ("WooridaumB.ttf", 700),
]


def to_woff2(path):
    """TTF -> WOFF2 바이트. brotli 미설치 등으로 실패하면 None."""
    try:
        out = path + ".woff2"
        f = TTFont(path)
        f.flavor = "woff2"
        f.save(out)
        f.close()
        with open(out, "rb") as fh:
            data = fh.read()
        os.remove(out)
        return data
    except Exception as e:                      # noqa: BLE001
        print("   ! WOFF2 변환 실패(%s): %s" % (os.path.basename(path), e))
        return None


def main():
    css = []
    total = 0
    for fname, weight in FACES:
        path = os.path.join(SRC, fname)
        raw = open(path, "rb").read()
        data = to_woff2(path)
        if data:
            fmt, mime = "woff2", "font/woff2"
        else:
            data, fmt, mime = raw, "truetype", "font/ttf"
        b64 = base64.b64encode(data).decode("ascii")
        total += len(b64)
        print("  %-16s %4d  ttf %6.0fKB -> %-8s %6.0fKB  (base64 %6.0fKB)"
              % (fname, weight, len(raw)/1024, fmt, len(data)/1024, len(b64)/1024))
        css.append(
            "@font-face{font-family:'Wooridaum';font-style:normal;font-weight:%d;"
            "font-display:swap;src:url(data:%s;base64,%s) format('%s')}"
            % (weight, mime, b64, fmt)
        )
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(css) + "\n")
    print("wrote %s  (base64 합계 %.1fMB)" % (os.path.normpath(OUT), total/1024/1024))


if __name__ == "__main__":
    main()
