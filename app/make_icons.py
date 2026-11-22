"""브랜드 마크·PWA 아이콘 생성 — 원본 픽셀아트(app/brand/mark-source.png)에서 잘라 만든다.

원본: 1024x1024 RGBA, 투명 배경. 둥근 안경·남색 머리 인물이 캔들 막대를 쥔 손을 든 그림.
머리카락이 남색, 외곽선이 검정이라 앱 다크 배경(#22262F) 위에 그대로 두면 묻힌다
→ 모든 산출물은 강조색 파랑(--link #2F91EF, 아래로 아주 살짝 어두워지는 그라데이션) 배경 위에 얹는다.

산출물 (저장소 루트 icons/):
  icon-192.png, icon-512.png   purpose "any"  둥근 사각(모서리 반경 22%) + 상반신
  icon-maskable-512.png         purpose "maskable" 전면 파랑, 머리·손이 중앙 80% 안전원 안
  apple-touch-icon.png (180)    전면 파랑 정사각 (iOS 가 모서리를 깎는다)
  mark-64.png, mark-128.png     헤더용 원형 아바타 (원 밖은 투명)
  favicon-48.png                둥근 사각, 얼굴+손 쪽으로 조금 더 당겨 16~32px 에서도 읽히게

자르기 기준 (원본 픽셀 좌표):
  머리+든 손의 불투명 픽셀(y<540)을 모두 담는 최소 원 ≈ 중심 (432,360), 반지름 386.
  BUST = 이 원을 살짝 넉넉히(반지름 400) 감싸는 정사각 (32,-30)-(832,770).
    → 정사각에 내접하는 원 안에 머리·손이 다 들어가므로 원형 아바타에도 같은 자르기를 쓴다.
    → 위쪽 30px 은 원본 밖(투명)이지만 머리 위 여백으로 쓰인다. 아래는 어깨·윗팔까지.
  마스커블은 같은 중심에서 정사각을 키워(반 변 500) 안전원(지름 80%) 안에 머리·손을 넣고,
  몸통은 아래 가장자리까지 이어지게 한다.

사용: python app/make_icons.py   (Pillow 필요. CI·build.py 는 부르지 않는다 — 원본을 바꿨을 때 손으로 실행)
결정적: 난수·시간 의존 없음. 같은 원본이면 같은 PNG 가 나온다.
"""
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "brand", "mark-source.png")
OUT = os.path.join(HERE, os.pardir, "icons")

TOP = (0x2F, 0x91, 0xEF)     # --link
BOTTOM = (0x26, 0x82, 0xDD)  # 아래쪽으로 살짝 어둡게 (평면 느낌 유지)

SS = 4   # 마스크 슈퍼샘플링 배율

# 자르기 상자 (left, top, right, bottom) — 원본 좌표, 원본 밖은 투명으로 채운다
CX, CY = 432, 370
BUST = (CX - 400, CY - 400, CX + 400, CY + 400)        # (32,-30)-(832,770)
MASKABLE = (CX - 500, CY - 500, CX + 500, CY + 500)    # 머리·손 원(r≈392)이 지름 80% 안에
FAVICON = (120, 60, 740, 680)                          # 얼굴+손 쪽으로 당긴 정사각 (620px, 16·32px 축소 비교로 선택)


def crop(src, box):
    """원본 밖 영역은 투명으로 채우며 정사각 자르기."""
    l, t, r, b = box
    canvas = Image.new("RGBA", (r - l, b - t), (0, 0, 0, 0))
    canvas.paste(src, (-l, -t))
    return canvas


def backdrop(S):
    """세로 그라데이션 파랑 (TOP → BOTTOM)."""
    col = Image.new("RGB", (1, 256))
    for y in range(256):
        k = y / 255
        col.putpixel((0, y), tuple(round(TOP[i] + (BOTTOM[i] - TOP[i]) * k) for i in range(3)))
    return col.resize((S, S), Image.BILINEAR).convert("RGBA")


def render(src, box, size, shape):
    """shape: "full"(전면) | "round"(둥근 사각 22%) | "circle"(원, 밖은 투명)."""
    S = size * SS
    art = crop(src, box).resize((S, S), Image.LANCZOS)
    img = Image.alpha_composite(backdrop(S), art)
    if shape != "full":
        mask = Image.new("L", (S, S), 0)
        d = ImageDraw.Draw(mask)
        if shape == "round":
            d.rounded_rectangle([0, 0, S - 1, S - 1], radius=round(S * 0.22), fill=255)
        else:
            d.ellipse([0, 0, S - 1, S - 1], fill=255)
        img.putalpha(mask)
    return img.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    src = Image.open(SRC).convert("RGBA")
    specs = [
        ("icon-192.png", BUST, 192, "round"),
        ("icon-512.png", BUST, 512, "round"),
        ("icon-maskable-512.png", MASKABLE, 512, "full"),
        ("apple-touch-icon.png", BUST, 180, "full"),
        ("mark-64.png", BUST, 64, "circle"),
        ("mark-128.png", BUST, 128, "circle"),
        ("favicon-48.png", FAVICON, 48, "round"),
    ]
    for name, box, size, shape in specs:
        path = os.path.join(OUT, name)
        img = render(src, box, size, shape)
        if shape == "full":
            img = img.convert("RGB")   # 전면 배경은 알파 불필요
        img.save(path, optimize=True)
        print("  wrote icons/%s (%d bytes)" % (name, os.path.getsize(path)))


if __name__ == "__main__":
    main()
