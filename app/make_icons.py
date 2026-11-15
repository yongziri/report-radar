"""PWA 아이콘 생성 — 레이더(동심원 + 스윕) 위에 막대 차트 글리프.

산출물 (저장소 루트 icons/):
  icon-192.png, icon-512.png       purpose "any"  (둥근 사각 배경)
  icon-maskable-512.png             purpose "maskable" (전면 배경, 글리프는 안전영역 80% 안)
  apple-touch-icon.png (180)        iOS 홈 화면 (전면 배경 — iOS 가 모서리를 깎는다)

사용: python make_icons.py   (Pillow 필요. 없으면 표준 라이브러리 PNG 작성기로 단순 버전을 만든다)
색은 앱 다크 테마 토큰과 맞춘다: 배경 --bg #22262F, 패널 #353945, 강조 --link #2F91EF, 상승 #34C062
"""
import math
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, os.pardir, "icons")

BG = (0x22, 0x26, 0x2F)
PANEL = (0x35, 0x39, 0x45)
ACCENT = (0x2F, 0x91, 0xEF)
UP = (0x34, 0xC0, 0x62)

SS = 4   # 슈퍼샘플링 배율 (Pillow 경로)


def draw_pillow(size, full_bleed, glyph_scale):
    from PIL import Image, ImageDraw
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if full_bleed:
        d.rectangle([0, 0, S, S], fill=BG + (255,))
    else:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=BG + (255,))
    cx = cy = S / 2
    R = S * 0.40 * glyph_scale
    w = max(2, int(S * 0.018 * glyph_scale))
    # 레이더 동심원
    for k, a in ((1.0, 255), (0.68, 200), (0.36, 160)):
        r = R * k
        col = ACCENT + (a,)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=col, width=w)
    # 스윕 부채꼴 (반투명)
    sweep = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sweep)
    sd.pieslice([cx - R, cy - R, cx + R, cy + R], start=-90, end=-30, fill=ACCENT + (70,))
    img = Image.alpha_composite(img, sweep)
    d = ImageDraw.Draw(img)
    ang = math.radians(-30)
    d.line([cx, cy, cx + R * math.cos(ang), cy + R * math.sin(ang)], fill=ACCENT + (255,), width=w)
    # 막대 차트 (아래 반원 안)
    bw = R * 0.20
    gap = R * 0.09
    heights = (0.34, 0.56, 0.82)
    base = cy + R * 0.52
    x0 = cx - (3 * bw + 2 * gap) / 2
    for i, h in enumerate(heights):
        x = x0 + i * (bw + gap)
        col = UP if i == 2 else (0xF3, 0xF3, 0xF5)
        d.rectangle([x, base - R * h, x + bw, base], fill=col + (255,))
    # 블립
    br = R * 0.07
    bx, by = cx + R * 0.48, cy - R * 0.55
    d.ellipse([bx - br, by - br, bx + br, by + br], fill=UP + (255,))
    return img.resize((size, size), Image.LANCZOS)


# ---------- 표준 라이브러리 대체 경로 (Pillow 없을 때) ----------
def _png(size, pixels):
    raw = b"".join(b"\x00" + bytes(row) for row in pixels)

    def chunk(t, data):
        c = struct.pack(">I", len(data)) + t + data
        return c + struct.pack(">I", zlib.crc32(t + data) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)) +
            chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def draw_plain(size, full_bleed, glyph_scale):
    cx = cy = size / 2
    R = size * 0.40 * glyph_scale
    w = max(1.0, size * 0.018 * glyph_scale)
    rows = []
    for y in range(size):
        row = []
        for x in range(size):
            px = BG + (255,)
            if not full_bleed:
                rr = size * 0.22
                qx = min(x, size - 1 - x)
                qy = min(y, size - 1 - y)
                if qx < rr and qy < rr and math.hypot(rr - qx, rr - qy) > rr:
                    px = (0, 0, 0, 0)
            dist = math.hypot(x - cx, y - cy)
            if px[3] and any(abs(dist - R * k) < w / 2 for k in (1.0, 0.68, 0.36)):
                px = ACCENT + (255,)
            row.extend(px)
        rows.append(row)
    return _png(size, rows)


def main():
    os.makedirs(OUT, exist_ok=True)
    specs = [
        ("icon-192.png", 192, False, 1.0),
        ("icon-512.png", 512, False, 1.0),
        ("icon-maskable-512.png", 512, True, 0.78),   # 안전영역(지름 80%) 안에 들어가게
        ("apple-touch-icon.png", 180, True, 0.92),
    ]
    try:
        import PIL  # noqa: F401
        use_pil = True
    except ImportError:
        use_pil = False
        print("  ! Pillow 없음 — 단순(동심원만) 아이콘으로 생성")
    for name, size, full, scale in specs:
        path = os.path.join(OUT, name)
        if use_pil:
            draw_pillow(size, full, scale).save(path, optimize=True)
        else:
            with open(path, "wb") as f:
                f.write(draw_plain(size, full, scale))
        print("  wrote icons/%s (%d bytes)" % (name, os.path.getsize(path)))


if __name__ == "__main__":
    main()
