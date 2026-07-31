#!/usr/bin/env python3
"""Render the CoffeeCat mug: four sprite layers plus the popup's vector paths.

Run from the repo root:

    python3 tools/render_mug.py

Everything the mug looks like lives in the GEOMETRY and PALETTE blocks below.
One spec drives both the raster layers (overlay + marketing site, which sit on
the illustrated cat) and the SVG paths (popup, which needs to retheme for dark
mode). Changing a number here changes every surface at once -- that is the whole
reason this is code and not four hand-drawn files that drift apart.

Stdlib only: zlib, struct, math. This repo has no third-party dependencies and
tests/test_extension_integrity.py already parses PNGs with `struct`; adding
Pillow just to draw one mug would be a bad trade.

Three constraints drove the design, and none of them are aesthetic:

1. The vessel is a GLASS, not opaque ceramic. It is a progress meter -- you have
   to see the level. An opaque mug would show coffee only as a disc at the rim.
   (The existing `.glass-mug` class name and the popup's cutaway already assumed
   this; it is now deliberate rather than accidental.)

2. The walls are STRAIGHT, with no taper. The liquid layer drains by translating
   vertically, so a tapered column would only register with the walls at exactly
   one fill level and spill past them everywhere else. The mechanism constrains
   the form.

3. The glass body is mostly transparent, and that is safe because the COFFEE is
   what carries the signal. The liquid is opaque and dark, so the meter stays
   readable on any page background; the glass only has to read as a container,
   which its rim, silhouette and specular do on their own. An earlier pass made
   the body substantially opaque for "legibility" and it rendered as a white
   slab that shouted over the cat.

An earlier version also dithered low-amplitude grain over the shading, on the
theory that perfectly smooth gradients are what make generated art read as CG.
Measured: the grain is invisible after a ~10x nearest-neighbour downscale and
cost 60% of the total sprite payload (287KB -> 116KB without it). Removed. If
the mug is ever displayed large enough for the smoothness to show, revisit.
"""

import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# ── Palette ──────────────────────────────────────────────────────────────────
# Sampled from assets/source/coffeecat-buddy-master.png. The cat is NOT pixel
# art: it is a 890x1142 smoothly-shaded illustration (~28k unique colours). It
# used to be painted under `image-rendering: pixelated`, and the mug was
# authored to match that -- soft-shaded at high resolution, then pushed through
# the same nearest-neighbour downscale.
#
# That is no longer what either object does. Nearest-neighbour at those ratios
# was not producing pixel art, it was producing noise: it keeps whichever pixels
# happen to land on the sampling grid, which stair-stepped the outline and broke
# the whiskers into dashes. Both sprites are now box-filtered down to delivery
# size (see tools/render_buddy.py) and painted with the browser's normal
# sampling. The palette below is unaffected -- it is about hue, not resolution.
#
# To re-derive: decode the buddy master, bucket opaque pixels by luminance/16,
# and average each bucket. That produced this ramp, light to dark:
CAT_RAMP = [
    (0xFC, 0xE0, 0xC1), (0xFC, 0xD1, 0xA5), (0xF9, 0xC0, 0x8A),
    (0xF2, 0xAD, 0x74), (0xE8, 0x9C, 0x65), (0xD8, 0x8B, 0x59),
    (0xC7, 0x7B, 0x51), (0xB3, 0x6B, 0x4A), (0xA0, 0x5C, 0x44),
    (0x8B, 0x4B, 0x3D), (0x78, 0x3C, 0x35), (0x61, 0x2C, 0x2D),
    (0x53, 0x1A, 0x26), (0x47, 0x09, 0x28),
]

# The cat's darkest edge is a plum, NOT the flat brown (#4a2b1d) every cup in
# this repo was outlined with. Wrong hue family is a big part of why the old mug
# read as pasted on. The mug uses the cat's actual edge colour.
EDGE = (0x47, 0x09, 0x28)

GLASS_TINT = (0xFB, 0xEA, 0xDA)   # warm near-white; never pure white next to the cat
GLASS_LIT = (0xFF, 0xFA, 0xF2)    # specular / rim lip
# Shaded wall. Deliberately high on the ramp (index 3, not 7): glass shades far
# less than opaque ceramic, and pulling a saturated terracotta through the whole
# body turned the empty cup pink.
GLASS_SHADE = (0xE8, 0xC2, 0xA0)
BOUNCE = (0xF2, 0xAD, 0x74)       # warm light bouncing off the cat's fur

COFFEE_TOP = (0x6F, 0x35, 0x18)   # kept from the popup gradient -- it reads well
COFFEE_BOT = (0x32, 0x17, 0x0D)
COFFEE_SURFACE = (0x8A, 0x4A, 0x22)
CREMA = (0xFF, 0xCE, 0x8F)

# ── Geometry ─────────────────────────────────────────────────────────────────
# Normalised 0..1 across a square canvas. The body sits left of centre because
# the handle needs room on the right.
# Delivery size, not authoring size. The float paints the meter at 44% of a
# 64/88/116px box, and the liquid layer -- the largest of the four, since it is
# scaled back up by 100/FILL_WINDOW.width to stay in register with the vessel --
# tops out near 185 device px on a 2x display. 256 covers that with headroom on
# a 3x display and costs a quarter of what 512 did. Raising this only makes the
# extension heavier on every page; it cannot make the mug look better.
CANVAS = 256
SS = 3  # supersampling factor per axis; 3 is enough given the ~5x downscale

CX = 0.430          # body centre x
R_OUT = 0.310       # outer half-width
WALL = 0.034        # glass thickness
R_IN = R_OUT - WALL
# Wider than tall (0.62 x 0.565). A cylinder taller than it is wide reads as a
# tumbler or a beer glass; a coffee mug is squat.
RIM_Y = 0.235       # rim ellipse centre
BASE_Y = 0.800      # base ellipse centre
RY_OUT = 0.082      # rim/base ellipse minor radius (perspective foreshortening)
RY_IN = RY_OUT * (R_IN / R_OUT)

HANDLE_CX = CX + R_OUT - 0.045   # tucked inside the wall so it reads as attached
HANDLE_CY = (RIM_Y + BASE_Y) / 2
HANDLE_R = 0.148                 # centreline radius
HANDLE_T = 0.042                 # tube half-thickness

# Liquid travel. The surface is an ellipse, so "full" has to sit far enough
# below the rim that the ellipse's upper half stays inside the clip window --
# otherwise a full cup renders with its surface sliced off.
SURFACE_FULL_Y = RIM_Y + 0.012
SURFACE_EMPTY_Y = BASE_Y - 0.005
DRAIN_RANGE = SURFACE_EMPTY_Y - SURFACE_FULL_Y

# Clip window handed to CSS: the interior cavity the liquid is allowed to occupy.
WIN_X0 = CX - R_IN
WIN_X1 = CX + R_IN
WIN_Y0 = RIM_Y - RY_IN
WIN_Y1 = BASE_Y + RY_IN

# The cavity floor is a half-ellipse, but the liquid sprite is a straight column
# (see constraint 2 above) so it cannot carry its own rounded bottom -- the
# bottom has to come from the clip, which stays put while the column slides.
# Expressed as the window's bottom border-radius: 50% horizontally by this
# fraction vertically, which `overflow: hidden` then clips to.
WIN_BOTTOM_RADIUS = RY_IN / (WIN_Y1 - WIN_Y0)

LIGHT = (-0.45, -0.55, 0.70)  # upper-left-front, matching the cat's key light


# ── Small maths helpers ──────────────────────────────────────────────────────

def clamp(v, lo=0.0, hi=1.0):
    return lo if v < lo else hi if v > hi else v


def smoothstep(a, b, x):
    if a == b:
        return 0.0 if x < a else 1.0
    t = clamp((x - a) / (b - a))
    return t * t * (3.0 - 2.0 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def mix(c1, c2, t):
    return (lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t))


def in_ellipse(x, y, cx, cy, rx, ry):
    dx = (x - cx) / rx
    dy = (y - cy) / ry
    return dx * dx + dy * dy <= 1.0


def in_body(x, y):
    """Silhouette of a vertical cylinder: side band capped by two ellipses."""
    if y < RIM_Y:
        return in_ellipse(x, y, CX, RIM_Y, R_OUT, RY_OUT)
    if y > BASE_Y:
        return in_ellipse(x, y, CX, BASE_Y, R_OUT, RY_OUT)
    return abs(x - CX) <= R_OUT


def in_cavity(x, y):
    if y < RIM_Y:
        return in_ellipse(x, y, CX, RIM_Y, R_IN, RY_IN)
    if y > BASE_Y:
        return in_ellipse(x, y, CX, BASE_Y, R_IN, RY_IN)
    return abs(x - CX) <= R_IN


def cylinder_shade(u):
    """Diffuse term for a vertical cylinder at normalised offset u in [-1, 1].

    The surface normal has no y component, so this is a pure function of u --
    which is why the whole body can be shaded without a per-pixel normal.
    """
    u = clamp(u, -1.0, 1.0)
    nz = math.sqrt(max(0.0, 1.0 - u * u))
    d = u * LIGHT[0] + nz * LIGHT[2]
    return clamp(d / math.sqrt(LIGHT[0] ** 2 + LIGHT[1] ** 2 + LIGHT[2] ** 2))


# ── Layer samplers ───────────────────────────────────────────────────────────
# Each returns (r, g, b, a) with channels 0..255 and alpha 0..1.

def sample_back(x, y):
    """Everything behind the liquid: contact shadow, handle, glass interior."""
    # Contact shadow first -- it grounds the mug on the same plane as the cat.
    # Direction and softness mirror the cat's own drop-shadow in content.css,
    # but in the cat's plum rather than the old flat brown.
    sh_dx = (x - (CX + 0.012)) / (R_OUT * 1.05)
    sh_dy = (y - (BASE_Y + 0.052)) / (RY_OUT * 0.66)
    shadow = clamp(1.0 - math.sqrt(sh_dx * sh_dx + sh_dy * sh_dy))
    out = (EDGE[0], EDGE[1], EDGE[2], shadow * shadow * 0.34)

    # Handle: a torus section, shaded across the tube.
    hd = math.hypot(x - HANDLE_CX, y - HANDLE_CY)
    if x >= HANDLE_CX and abs(hd - HANDLE_R) <= HANDLE_T:
        v = (hd - HANDLE_R) / HANDLE_T          # -1 inner .. +1 outer
        lit = cylinder_shade(-v)
        col = mix(GLASS_SHADE, GLASS_LIT, 0.20 + 0.80 * lit)
        # Carries more edge plum than the body. At overlay size the whole tube
        # is ~3px wide, so it needs real contrast against both a white page and
        # the cat's fur or it dissolves into a faint ghost ring.
        col = mix(col, EDGE, smoothstep(0.35, 1.0, abs(v)) * 0.58)
        a = lerp(0.82, 1.0, smoothstep(0.10, 1.0, abs(v)))
        out = _over((col[0], col[1], col[2], a), out)

    if in_body(x, y):
        u = (x - CX) / R_OUT
        lit = cylinder_shade(u)
        col = mix(GLASS_SHADE, GLASS_TINT, 0.35 + 0.65 * lit)

        # Warm bounce off the cat's fur on the body-facing side. Without this
        # the glass reads as a separate object lit by a different scene.
        col = mix(col, BOUNCE, smoothstep(0.15, 1.0, -u) * 0.28)

        # Far wall darkens toward the silhouette; the thick base catches light.
        edge = smoothstep(0.58, 1.0, abs(u))
        col = mix(col, EDGE, edge * 0.18)
        base_glow = smoothstep(0.10, 0.0, abs(y - (BASE_Y - 0.012)))
        col = mix(col, GLASS_LIT, base_glow * 0.35)

        a = lerp(0.30, 0.92, edge)
        out = _over((col[0], col[1], col[2], a), out)

    return out


def sample_fill(x, y):
    """The coffee column, with its elliptical surface and crema at the top.

    Drawn once at the FULL position and translated down at runtime, so the
    crema band keeps constant thickness at every level. Scaling it -- which is
    what the overlay and site used to do -- squashes the crema as it drains.
    """
    if not (WIN_X0 <= x <= WIN_X1):
        return (0, 0, 0, 0.0)

    sy = SURFACE_FULL_Y
    u = (x - CX) / R_IN

    # Above the surface centre: only inside the surface ellipse's upper half.
    if y < sy:
        if not in_ellipse(x, y, CX, sy, R_IN, RY_IN):
            return (0, 0, 0, 0.0)
        # Top of the liquid, seen at a glancing angle: crema film.
        t = smoothstep(sy - RY_IN, sy, y)
        col = mix(CREMA, COFFEE_SURFACE, t)
        return (col[0], col[1], col[2], 1.0)

    # The column. Depth gradient, plus the front arc of the surface ellipse
    # read as the meniscus line.
    depth = clamp((y - sy) / (WIN_Y1 - sy))
    col = mix(COFFEE_TOP, COFFEE_BOT, depth ** 0.75)

    ell = ((x - CX) / R_IN) ** 2 + ((y - sy) / RY_IN) ** 2
    if ell <= 1.0:
        # Still inside the surface ellipse: lighter, it is the liquid's top face.
        t = smoothstep(0.0, 1.0, ell)
        col = mix(mix(CREMA, COFFEE_SURFACE, 0.55), col, t)

    # Meniscus highlight where the surface meets the glass.
    men = smoothstep(0.86, 1.0, ell) * smoothstep(1.14, 1.0, ell)
    col = mix(col, CREMA, men * 0.5)

    # Light passing through the liquid near the lit wall.
    col = mix(col, COFFEE_SURFACE, smoothstep(0.35, 1.0, -u) * 0.22)
    return (col[0], col[1], col[2], 1.0)


def sample_front(x, y):
    """Near glass wall: rim lip, silhouette brightening, specular streak."""
    out = (0, 0, 0, 0.0)
    if not in_body(x, y):
        return out

    u = (x - CX) / R_OUT

    # Rim annulus. Opaque enough to cap the liquid column cleanly -- it is what
    # hides the top edge of the fill sprite.
    if in_ellipse(x, y, CX, RIM_Y, R_OUT, RY_OUT) and not in_ellipse(x, y, CX, RIM_Y, R_IN, RY_IN):
        lit = cylinder_shade(u)
        col = mix(GLASS_SHADE, GLASS_LIT, 0.35 + 0.65 * lit)
        col = mix(col, EDGE, smoothstep(0.72, 1.0, abs(u)) * 0.35)
        out = _over((col[0], col[1], col[2], 0.97), out)
        return out

    # Silhouette edges: glass goes bright at grazing angles.
    #
    # Asymmetric on purpose. The left edge sits against the cat's fur, and a
    # bright white line there cut a hard seam between the two -- glass reflects
    # what is next to it, so that edge warms toward the fur bounce instead.
    edge = smoothstep(0.70, 1.0, abs(u))
    if edge > 0.0:
        col = mix(GLASS_LIT, BOUNCE, smoothstep(0.0, -1.0, u) * 0.55)
        col = mix(col, EDGE, smoothstep(0.90, 1.0, abs(u)) * 0.45)
        out = _over((col[0], col[1], col[2], edge * 0.66), out)

    # The classic vertical specular streak, on the key-light side.
    spec = math.exp(-((u + 0.55) ** 2) / (2 * 0.11 ** 2))
    span = smoothstep(RIM_Y, RIM_Y + 0.10, y) * smoothstep(BASE_Y, BASE_Y - 0.16, y)
    if spec * span > 0.001:
        out = _over((GLASS_LIT[0], GLASS_LIT[1], GLASS_LIT[2], spec * span * 0.45), out)

    return out


def sample_steam(x, y):
    """A single soft wisp, drifting up. Instanced twice with an offset delay.

    The old steam was two 3px `border-left` lines, which read as antennae.
    """
    t = clamp((0.95 - y) / 0.9)
    if t <= 0.0:
        return (0, 0, 0, 0.0)
    # Sine curl that widens and fades as it rises.
    curl = math.sin(t * 3.6) * 0.075 * t
    width = 0.035 + 0.075 * t
    d = abs(x - (0.5 + curl)) / width
    body = clamp(1.0 - d * d)
    fade = smoothstep(0.0, 0.22, t) * smoothstep(1.0, 0.45, t)
    a = body * fade * 0.55
    if a <= 0.002:
        return (0, 0, 0, 0.0)
    return (GLASS_LIT[0], GLASS_LIT[1], GLASS_LIT[2], a)


def _over(src, dst):
    """Standard source-over composite on straight-alpha tuples."""
    sa = clamp(src[3])
    da = clamp(dst[3])
    oa = sa + da * (1 - sa)
    if oa <= 0.0:
        return (0, 0, 0, 0.0)
    r = (src[0] * sa + dst[0] * da * (1 - sa)) / oa
    g = (src[1] * sa + dst[1] * da * (1 - sa)) / oa
    b = (src[2] * sa + dst[2] * da * (1 - sa)) / oa
    return (r, g, b, oa)


# ── Rasteriser ───────────────────────────────────────────────────────────────

def render(sampler, size=CANVAS, ss=SS):
    """Box-filtered supersample.

    Accumulates premultiplied so partially covered edge pixels do not pick up
    colour from fully transparent samples -- the classic dark-fringe bug.
    """
    buf = bytearray(size * size * 4)
    inv = 1.0 / (ss * ss)
    step = 1.0 / (size * ss)
    half = step * 0.5
    for py in range(size):
        row = py * size * 4
        for px in range(size):
            ar = ag = ab = aa = 0.0
            for sy in range(ss):
                y = (py * ss + sy) * step + half
                for sx in range(ss):
                    x = (px * ss + sx) * step + half
                    r, g, b, a = sampler(x, y)
                    if a > 0.0:
                        ar += r * a
                        ag += g * a
                        ab += b * a
                        aa += a
            o = row + px * 4
            if aa <= 0.0:
                continue
            buf[o] = int(clamp(ar / aa, 0, 255) + 0.5)
            buf[o + 1] = int(clamp(ag / aa, 0, 255) + 0.5)
            buf[o + 2] = int(clamp(ab / aa, 0, 255) + 0.5)
            buf[o + 3] = int(clamp(aa * inv) * 255 + 0.5)
    return buf


def write_png(path, size, rgba):
    """Minimal RGBA8 PNG writer.

    Filter type 0 on every row: the output is small and keeping it filter-free
    makes the bytes a pure function of the pixels, which the reproducibility
    test depends on.
    """
    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw.append(0)
        raw += rgba[y * stride:(y + 1) * stride]

    def chunk(typ, data):
        return (struct.pack(">I", len(data)) + typ + data
                + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF))

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


# ── SVG emission (popup) ─────────────────────────────────────────────────────
# The popup needs vector, not raster: it has full light/dark tokens and a raster
# cup cannot retheme. Emitting its path data from the same constants is what
# makes "the same cup in two media" a fact rather than an intention.

def _n(v):
    return f"{v * 100:.2f}".rstrip("0").rstrip(".")


def vessel_path(r, ry, top, bot):
    """Cylinder outline in a 0..100 viewBox: top arc, sides, bottom arc."""
    return (
        f"M{_n(CX - r)} {_n(top)}"
        f" A{_n(r)} {_n(ry)} 0 0 1 {_n(CX + r)} {_n(top)}"
        f" L{_n(CX + r)} {_n(bot)}"
        f" A{_n(r)} {_n(ry)} 0 0 1 {_n(CX - r)} {_n(bot)}"
        f" Z"
    )


def handle_path():
    a = math.acos(0.0)  # handle spans the right half, top to bottom
    x0 = HANDLE_CX + HANDLE_R * math.cos(-a)
    y0 = HANDLE_CY + HANDLE_R * math.sin(-a)
    x1 = HANDLE_CX + HANDLE_R * math.cos(a)
    y1 = HANDLE_CY + HANDLE_R * math.sin(a)
    return (f"M{_n(x0)} {_n(y0)}"
            f" A{_n(HANDLE_R)} {_n(HANDLE_R)} 0 0 1 {_n(x1)} {_n(y1)}")


def write_geometry_js(path):
    """Constants the overlay, the popup and the site all read.

    Emitted as a CLASSIC script assigning one frozen global, not an ES module.
    None of the three consumers can import: MV3 content scripts have no module
    mode, and popup.html and site/index.html both load plain <script> tags.
    A global keeps all three on the same numbers with no build step.

    FILL_WINDOW and DRAIN_RANGE are percentages of the sprite canvas, which is
    square and drawn at the same origin for all four layers -- so CSS can place
    the clip window and the drain travel without knowing any pixel sizes.
    """
    body = f"""// GENERATED by tools/render_mug.py -- do not edit by hand.
// Re-run the generator after changing the geometry there.

globalThis.COFFEECAT_MUG = Object.freeze({{
  FILL_WINDOW: Object.freeze({{
    x: {WIN_X0 * 100:.4f},
    y: {WIN_Y0 * 100:.4f},
    width: {(WIN_X1 - WIN_X0) * 100:.4f},
    height: {(WIN_Y1 - WIN_Y0) * 100:.4f},
    // Bottom border-radius, as `50% / bottomRadius%`, so `overflow: hidden`
    // gives the liquid the cavity's rounded floor. The sliding column has no
    // bottom of its own.
    bottomRadius: {WIN_BOTTOM_RADIUS * 100:.4f}
  }}),

  // How far the liquid travels from full to empty, as a percentage of the
  // sprite canvas. Translate by (1 - fill) * DRAIN_RANGE; never scale.
  DRAIN_RANGE: {DRAIN_RANGE * 100:.4f},

  // Popup vector cup: same geometry, 0 0 100 100 viewBox.
  SVG: Object.freeze({{
    viewBox: "0 0 100 100",
    body: "{vessel_path(R_OUT, RY_OUT, RIM_Y, BASE_Y)}",
    interior: "{vessel_path(R_IN, RY_IN, RIM_Y, BASE_Y)}",
    handle: "{handle_path()}",
    rim: Object.freeze({{ cx: {CX * 100:.2f}, cy: {RIM_Y * 100:.2f}, rx: {R_OUT * 100:.2f}, ry: {RY_OUT * 100:.2f} }}),
    // Liquid travel in viewBox user units, for the popup's translateY drain.
    interiorHeight: {DRAIN_RANGE * 100:.4f}
  }})
}});
"""
    path.write_text(body, encoding="utf-8")


LAYERS = (
    ("mug-back.png", sample_back),
    ("mug-fill.png", sample_fill),
    ("mug-front.png", sample_front),
    ("mug-steam.png", sample_steam),
)


def main(out_dir=None):
    out_dir = Path(out_dir) if out_dir else ROOT / "assets" / "mug"
    for name, sampler in LAYERS:
        print(f"rendering {name} ...", flush=True)
        write_png(out_dir / name, CANVAS, render(sampler))
    write_geometry_js(ROOT / "src" / "mug-geometry.js")
    print("done")


if __name__ == "__main__":
    import sys
    main(sys.argv[1] if len(sys.argv) > 1 else None)
