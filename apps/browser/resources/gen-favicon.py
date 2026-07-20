#!/usr/bin/env python3
"""Generate apps/browser/resources/favicon.ico (32x32 32bpp ICO).

Kairo brand mark: rounded purple square (#7C3AED) with a white "K".
Pure stdlib so it runs anywhere without Pillow. Regenerate with:
    python3 apps/browser/resources/gen-favicon.py
"""
import struct
import os

SIZE = 32
BG = (0x7C, 0x3A, 0xED)   # --kairo-primary
FG = (0xFF, 0xFF, 0xFF)

# "K" glyph on an 8x8 logical grid, scaled to the center 16x16 px.
GLYPH = [
    "X...X",
    "X..X.",
    "X.X..",
    "XX...",
    "XX...",
    "X.X..",
    "X..X.",
    "X...X",
]
GW, GH = len(GLYPH[0]), len(GLYPH)
SCALE = 2  # each logical pixel -> 2x2 px
OX = (SIZE - GW * SCALE) // 2
OY = (SIZE - GH * SCALE) // 2


def rounded_rect_mask(x, y, r=6):
    """True if (x,y) is inside a rounded rect of SIZE x SIZE with radius r."""
    cx = min(max(x, r), SIZE - 1 - r)
    cy = min(max(y, r), SIZE - 1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def pixel(x, y):
    if not rounded_rect_mask(x, y):
        return (0, 0, 0, 0)  # transparent
    gx = (x - OX) // SCALE
    gy = (y - OY) // SCALE
    if 0 <= gx < GW and 0 <= gy < GH and GLYPH[gy][gx] == "X":
        return (*FG, 255)
    return (*BG, 255)


def main():
    # ICO pixel data is BGRA, bottom-up.
    xor = bytearray()
    for y in range(SIZE - 1, -1, -1):
        for x in range(SIZE):
            r, g, b, a = pixel(x, y)
            xor += bytes((b, g, r, a))
    # AND mask: 1bpp, rows padded to 32 bits; 0 = opaque pixel kept.
    and_mask = bytearray()
    for y in range(SIZE - 1, -1, -1):
        row = 0
        for x in range(SIZE):
            if pixel(x, y)[3] == 0:
                row |= 1 << (31 - x)
        and_mask += struct.pack(">I", row)

    bih = struct.pack(
        "<IIIHHIIIIII",
        40,          # header size
        SIZE,        # width
        SIZE * 2,    # height (xor + and)
        1,           # planes
        32,          # bpp
        0,           # compression
        len(xor) + len(and_mask),
        0, 0, 0, 0,
    )
    image = bytes(bih) + bytes(xor) + bytes(and_mask)
    header = struct.pack("<HHH", 0, 1, 1)
    entry = struct.pack("<BBBBHHII", SIZE, SIZE, 0, 0, 1, 32, len(image), 6 + 16)
    out = os.path.join(os.path.dirname(__file__), "favicon.ico")
    with open(out, "wb") as f:
        f.write(header + entry + image)
    print(f"wrote {out} ({6 + 16 + len(image)} bytes)")


if __name__ == "__main__":
    main()
