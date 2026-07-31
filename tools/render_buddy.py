#!/usr/bin/env python3
"""Downscale the buddy master into the sprite the extension actually ships.

Run from the repo root:

    python3 tools/render_buddy.py                 # writes assets/brulee-buddy.png
    python3 tools/render_buddy.py /tmp/out        # write elsewhere (used by tests)

Stdlib only, same constraint as tools/render_mug.py: this repo has no
third-party dependencies, so there is no Pillow to lean on.

Why this exists
---------------
The master is a 890x1142 illustration. The float renders it inside a box that is
64, 88 or 116 CSS px square with `object-fit: contain`, so the largest it is ever
painted is about 90x116 CSS px -- 181x232 device px on a 2x display. Shipping the
master meant every http/https page you visited decoded a 4MB bitmap to draw a
thumbnail, and the extension's single largest file was 922KB of detail no one
could see.

It also looked worse, not just heavier. The master is continuous-tone (90% of its
horizontal runs are a single pixel; it is not block pixel art), and the float used
to paint it under `image-rendering: pixelated`. Nearest-neighbour at a ~7:1 ratio
does not produce pixel art -- it drops 98% of the rows and columns and keeps
whichever pixels happen to land on the sampling grid. The result was a stair-
stepped outline, broken whiskers and speckled ear interiors. A box filter down to
delivery size, painted with the browser's normal sampling, is both smaller and
visibly cleaner.

WIDTH is 200 rather than the 181 strictly needed at 2x: the extra headroom costs
~10KB and keeps the sprite from being upscaled on a fractional-DPI display.

The downscale runs in premultiplied alpha. The master has soft alpha edges, and
averaging straight RGBA pulls the (arbitrary) colour of fully-transparent pixels
into the edge, leaving a dark halo around the cat.
"""

import struct
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MASTER = ROOT / "assets" / "source" / "brulee-buddy-master.png"


# Two sizes, because the two surfaces are not the same problem.
#
# The extension sprite is injected into every http/https page you visit and
# decoded per tab, so it is cut to exactly what the float can paint. The site's
# hero renders the same cat at 252 CSS px inside a browser mockup, which needs
# 504 device px on a 2x display -- and the site is one cached page load, not a
# cost paid on every page in the browser. Sharing one file would either blur the
# hero or make every page carry the hero's resolution.
SIZES = {
    # 181x232 device px is the largest the float can paint (116px box, 2x DPR).
    # The headroom to 200 costs ~10KB and keeps the sprite from being upscaled
    # on a fractional-DPI display.
    "brulee-buddy.png": 200,
    "brulee-buddy-large.png": 512,
}

# Below this the averaged coverage is treated as fully transparent and the pixel
# is flattened to zero. Without it the sprite carries a fringe of near-invisible
# pixels whose RGB is meaningless, which shows up as a faint halo under the
# float's drop-shadow filters.
ALPHA_FLOOR = 0.5


def decode(path):
    """8-bit RGBA, non-interlaced. That is what the master is, and all we need."""
    data = Path(path).read_bytes()
    assert data.startswith(b"\x89PNG\r\n\x1a\n"), f"{path} is not a PNG"

    pos, idat = 8, b""
    width = height = None
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos:pos + 4])
        kind = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        if kind == b"IHDR":
            width, height, depth, color, _, _, interlace = struct.unpack(">IIBBBBB", body)
            assert (depth, color, interlace) == (8, 6, 0), (
                f"{path}: expected 8-bit RGBA non-interlaced, got "
                f"depth={depth} color={color} interlace={interlace}"
            )
        elif kind == b"IDAT":
            idat += body
        elif kind == b"IEND":
            break
        pos += 12 + length

    raw = zlib.decompress(idat)
    stride = width * 4
    rows, prev, pos = [], bytearray(stride), 0
    for _ in range(height):
        filter_type = raw[pos]
        line = bytearray(raw[pos + 1:pos + 1 + stride])
        pos += 1 + stride
        if filter_type == 1:
            for i in range(4, stride):
                line[i] = (line[i] + line[i - 4]) & 0xFF
        elif filter_type == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif filter_type == 3:
            for i in range(stride):
                left = line[i - 4] if i >= 4 else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif filter_type == 4:
            for i in range(stride):
                left = line[i - 4] if i >= 4 else 0
                upper_left = prev[i - 4] if i >= 4 else 0
                up = prev[i]
                pa = abs(up - upper_left)
                pb = abs(left - upper_left)
                pc = abs(left + up - 2 * upper_left)
                if pa <= pb and pa <= pc:
                    pred = left
                elif pb <= pc:
                    pred = up
                else:
                    pred = upper_left
                line[i] = (line[i] + pred) & 0xFF
        elif filter_type != 0:
            raise ValueError(f"{path}: unsupported filter type {filter_type}")
        rows.append(bytes(line))
        prev = line
    return width, height, rows


def write_png(path, width, height, rows):
    """Filter type 0 on every row.

    Matches tools/render_mug.py, and it is what lets the tests compare
    decompressed scanlines instead of file bytes -- the pixels are then a pure
    function of the input, independent of the zlib version doing the packing.
    """
    raw = b"".join(b"\x00" + row for row in rows)

    def chunk(kind, body):
        payload = kind + body
        return struct.pack(">I", len(body)) + payload + struct.pack(">I", zlib.crc32(payload))

    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def box_downscale(width, height, rows, target_w, target_h):
    """Average each source rectangle that maps to one destination pixel.

    A box filter rather than anything fancier because this is a pure downscale
    of a soft-shaded illustration by ~4.5x: at that ratio a box filter is what
    area-averaging should do, and a bicubic kernel would only add ringing on the
    hard outline.
    """
    premultiplied = []
    for row in rows:
        line = []
        for x in range(width):
            r, g, b, a = row[x * 4], row[x * 4 + 1], row[x * 4 + 2], row[x * 4 + 3]
            weight = a / 255.0
            line.append((r * weight, g * weight, b * weight, a))
        premultiplied.append(line)

    out = []
    for ty in range(target_h):
        y0 = ty * height // target_h
        y1 = max(y0 + 1, (ty + 1) * height // target_h)
        line = bytearray()
        for tx in range(target_w):
            x0 = tx * width // target_w
            x1 = max(x0 + 1, (tx + 1) * width // target_w)
            sr = sg = sb = sa = 0.0
            count = 0
            for y in range(y0, y1):
                source = premultiplied[y]
                for x in range(x0, x1):
                    r, g, b, a = source[x]
                    sr += r
                    sg += g
                    sb += b
                    sa += a
                    count += 1
            alpha = sa / count
            if alpha < ALPHA_FLOOR:
                line += b"\x00\x00\x00\x00"
                continue
            # Un-premultiply back to straight RGBA for storage.
            weight = alpha / 255.0
            line += bytes((
                min(255, max(0, round(sr / count / weight))),
                min(255, max(0, round(sg / count / weight))),
                min(255, max(0, round(sb / count / weight))),
                min(255, max(0, round(alpha))),
            ))
        out.append(bytes(line))
    return out


def main():
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "assets"
    out_dir.mkdir(parents=True, exist_ok=True)

    width, height, rows = decode(MASTER)
    for name, target_w in SIZES.items():
        target_h = round(height * target_w / width)
        write_png(
            out_dir / name,
            target_w,
            target_h,
            box_downscale(width, height, rows, target_w, target_h),
        )
        print(f"{MASTER.name} {width}x{height} -> {name} {target_w}x{target_h}")


if __name__ == "__main__":
    main()
