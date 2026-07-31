#!/usr/bin/env python3
"""Screenshot the on-page float the way a content script builds it.

Run from the repo root:

    python3 tools/shoot_float.py                  # all three sizes, light
    python3 tools/shoot_float.py --theme dark
    python3 tools/shoot_float.py --out shots/

The popup already has tools/shoot_popup.py. The float had nothing, which meant
the one surface that appears on every page someone visits was the only surface
reviewed by reading CSS -- and the sprite sampling bug that motivated this file
was invisible in source and obvious on screen.

Rebuilding the shadow tree here rather than driving the real extension is a
deliberate trade. Loading an unpacked extension into headless Chrome and waiting
for a content script to mount is slow, flaky, and needs a real profile; what is
being reviewed is how the sprite and the stylesheet render, and that is fully
determined by the markup in buildCat(), src/float.css, and the geometry custom
properties applySettings() writes. Those three are read straight from the repo
below, so the only thing this file hand-maintains is the wiring between them.
"""

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"

# SIZE_MAP in src/content.js. Mirrored rather than imported because there is no
# JS runtime in this script; assert_sizes_match_content_js() below fails loudly
# if content.js moves and this does not.
SIZES = {"small": 64, "medium": 88, "large": 116}

CHROME_CANDIDATES = (
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "google-chrome",
    "chromium",
)

PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="shared.css">
<link rel="stylesheet" href="float.css">
<style>
  body {{
    margin: 0;
    background: {backdrop};
    font: 13px/1 system-ui;
    color: {label};
    display: flex;
    align-items: flex-end;
    gap: 40px;
    padding: 40px;
  }}
  .cell {{ text-align: center; }}
  .cell p {{ margin: 16px 0 0; opacity: 0.55; }}
  /* Stands in for #coffeecat-root in src/content.css. Only the box matters
     here: the fixed positioning and the z-index are about living on someone
     else's page, which this harness is not.

     `display: block` is load-bearing. float.css opens by applying `all:
     initial` to the host, which resets display to inline -- and width/height do
     not apply to an inline box, so without this every cell renders at intrinsic
     size and the three size settings come out identical. content.css gets this
     for free because `position: fixed` blockifies the element; `position:
     relative` does not. */
  .host {{ position: relative; display: block; }}
</style>
</head>
<body>
{cells}
</body>
</html>
"""

CELL = """
<div class="cell">
  <div class="host" style="{style}">{markup}</div>
  <p>{name} {px}px</p>
</div>
"""


def find_chrome() -> str:
    for candidate in CHROME_CANDIDATES:
        if Path(candidate).exists():
            return candidate
        found = shutil.which(candidate)
        if found:
            return found
    sys.exit("No Chrome binary found. Pass --chrome, or install Google Chrome.")


def read_geometry() -> dict:
    """Pull FILL_WINDOW out of the generated src/mug-geometry.js.

    The file is JS, not JSON, so this reads the numbers it needs by name rather
    than pretending to parse it. Hand-copying them would make this harness a
    second source of generated geometry, which is the drift tools/render_mug.py
    exists to prevent.
    """
    text = (SRC / "mug-geometry.js").read_text()
    window = text[text.index("FILL_WINDOW"):text.index("DRAIN_RANGE")]
    values = {}
    for key in ("x", "y", "width", "height", "bottomRadius"):
        match = re.search(rf"^\s*{key}: ([0-9.]+)", window, re.M)
        if not match:
            sys.exit(f"mug-geometry.js: no FILL_WINDOW.{key}")
        values[key] = float(match.group(1))
    return values


def assert_sizes_match_content_js() -> None:
    content = (SRC / "content.js").read_text()
    block = content[content.index("const SIZE_MAP"):content.index("};", content.index("const SIZE_MAP"))]
    found = {k: int(v) for k, v in re.findall(r"(\w+): (\d+)", block)}
    if found != SIZES:
        sys.exit(f"SIZE_MAP drifted: content.js has {found}, this script has {SIZES}")


def host_style(px: int, geometry: dict) -> str:
    """The inline properties applySettings() writes onto the host element."""
    fill = geometry
    declarations = {
        "width": f"{px}px",
        "height": f"{px}px",
        "--cat-unit": f"{px / SIZES['medium']:.4f}",
        "--win-x": f"{fill['x']}%",
        "--win-y": f"{fill['y']}%",
        "--win-w": f"{fill['width']}%",
        "--win-h": f"{fill['height']}%",
        "--win-r": f"{fill['bottomRadius']}%",
        "--liq-w": f"{10000 / fill['width']}%",
        "--liq-h": f"{10000 / fill['height']}%",
        "--liq-x": f"{(-fill['x'] * 100) / fill['width']}%",
        "--liq-y": f"{(-fill['y'] * 100) / fill['height']}%",
    }
    return "".join(f"{k}:{v};" for k, v in declarations.items())


def build_markup(asset_prefix: str) -> str:
    """The tree buildCat() creates, with extension URLs swapped for local paths."""
    return f"""
      <button class="coffee-cat" type="button" aria-label="CoffeeCat browser buddy">
        <img class="cat-art" src="{asset_prefix}coffeecat-buddy.png" alt="">
        <span class="coffee-meter" aria-hidden="true">
          <img class="mug-layer mug-back" src="{asset_prefix}mug/mug-back.png" alt="">
          <span class="mug-window">
            <img class="mug-liquid" src="{asset_prefix}mug/mug-fill.png" alt="">
          </span>
          <img class="mug-layer mug-front" src="{asset_prefix}mug/mug-front.png" alt="">
          <img class="mug-steam steam-a" src="{asset_prefix}mug/mug-steam.png" alt="">
          <img class="mug-steam steam-b" src="{asset_prefix}mug/mug-steam.png" alt="">
        </span>
        <span class="purr-bubble" aria-hidden="true">prr</span>
      </button>
    """


def dark_block_span(css: str) -> tuple[int, int]:
    start = css.index("@media (prefers-color-scheme: dark)")
    depth = 0
    for i in range(start, len(css)):
        if css[i] == "{":
            depth += 1
        elif css[i] == "}":
            depth -= 1
            if depth == 0:
                return start, i + 1
    raise ValueError("dark media block is unbalanced")


def theme_css(css: str, theme: str) -> str:
    """Force the theme in CSS rather than trusting the host.

    Same reason tools/shoot_popup.py does it: headless Chrome reports
    prefers-color-scheme: dark by default, so an unforced capture is whatever
    the flags produced rather than the theme it claims to be.
    """
    if "@media (prefers-color-scheme: dark)" not in css:
        return css
    start, end = dark_block_span(css)
    if theme == "light":
        return css[:start] + css[end:]
    inner = css[css.index("{", start) + 1: end - 1]
    return css[:start] + inner + css[end:]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path)
    parser.add_argument("--theme", choices=["light", "dark"], default="light")
    parser.add_argument("--chrome", default=None)
    parser.add_argument(
        "--state",
        choices=["full", "paused", "empty"],
        default="full",
        help="Meter state: full cup, paused, or drained.",
    )
    args = parser.parse_args()

    assert_sizes_match_content_js()
    chrome = args.chrome or find_chrome()
    out_dir = args.out or Path(tempfile.mkdtemp(prefix="coffeecat-float-"))
    out_dir.mkdir(parents=True, exist_ok=True)
    workdir = Path(tempfile.mkdtemp(prefix="coffeecat-float-stage-"))

    # The float's stylesheets are adopted into a shadow root at runtime, where
    # :host matches the host element. Linked into a document they have to match
    # the harness's stand-in instead, so :host becomes .host.
    for name in ("shared.css", "float.css"):
        css = theme_css((SRC / name).read_text(), args.theme)
        (workdir / name).write_text(css.replace(":host", ".host"))

    shutil.copytree(ROOT / "assets", workdir / "assets", dirs_exist_ok=True)

    geometry = read_geometry()
    markup = build_markup("assets/")
    if args.state != "full":
        markup = markup.replace(
            'class="coffee-meter"', f'class="coffee-meter is-{args.state}"'
        )

    cells = "".join(
        CELL.format(style=host_style(px, geometry), markup=markup, name=name, px=px)
        for name, px in SIZES.items()
    )
    backdrop, label = ("#fcfbf9", "#1b1a18") if args.theme == "light" else ("#1c1b19", "#f4f2ee")
    page = workdir / "float.html"
    page.write_text(PAGE.format(cells=cells, backdrop=backdrop, label=label))

    png = out_dir / f"float-{args.theme}-{args.state}.png"
    result = subprocess.run(
        [
            chrome,
            "--headless",
            "--disable-gpu",
            "--hide-scrollbars",
            "--force-device-scale-factor=2",
            "--window-size=560,300",
            # The bob and steam animations are always running; without a budget
            # the capture lands on an arbitrary frame of both.
            "--virtual-time-budget=1500",
            f"--screenshot={png}",
            page.as_uri(),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        sys.exit(f"Chrome failed:\n{result.stderr.strip()}")

    shutil.rmtree(workdir, ignore_errors=True)
    print(f"  {png}")
    print(json.dumps({"theme": args.theme, "state": args.state, "sizes": SIZES}))


if __name__ == "__main__":
    main()
