#!/usr/bin/env python3
"""Render the 1280x800 screenshots the Chrome Web Store listing needs.

Run from the repo root:

    python3 tools/shoot_store.py                  # all three, into dist/store/
    python3 tools/shoot_store.py --out shots/

The Web Store requires at least one screenshot at exactly 1280x800 (or 640x400)
and shows up to five. They are the only part of the listing most people actually
look at, and they are also the thing most likely to be thrown together at the
last minute with a phone camera pointed at a laptop.

These are composed from the real UI rather than mocked up: the popup is captured
by tools/shoot_popup.py through its own storage shim, and the float and the
intermission are built from the same markup and stylesheets the content script
uses. So a screenshot cannot claim something the extension does not do -- if the
popup changes, these change with it.

Exactly 1280x800 at device scale 1. Not 2x downscaled: the store serves these at
their native size, and a 2560x1600 capture scaled down is the same trap as the
sprite this repo already fixed once.
"""

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
TOOLS = ROOT / "tools"

WIDTH, HEIGHT = 1280, 800

sys.path.insert(0, str(TOOLS))
import shoot_float  # noqa: E402  (path set above; stdlib-only sibling module)

CHROME_CANDIDATES = shoot_float.CHROME_CANDIDATES

# The site's palette, not the extension's. These screenshots sit in a store
# listing next to the site, and the extension's own chrome is deliberately
# neutral -- a neutral field behind a neutral popup gives the eye nothing.
BACKDROP = "#f4f2fa"
INK = "#171327"
INK_SOFT = "#665d80"
PAGE_DARK = "#2b1f47"

BASE_CSS = f"""
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0;
    width: {WIDTH}px;
    height: {HEIGHT}px;
    overflow: hidden;
    background: {BACKDROP};
    font-family: system-ui, -apple-system, sans-serif;
    color: {INK};
    display: grid;
    place-items: center;
  }}
  .stage {{
    width: 100%;
    height: 100%;
    padding: 64px 72px;
    display: grid;
    grid-template-rows: auto 1fr;
    gap: 40px;
  }}
  h1 {{
    margin: 0;
    font-size: 40px;
    line-height: 1.1;
    letter-spacing: -0.025em;
    font-weight: 600;
  }}
  h1 span {{ color: {INK_SOFT}; font-weight: 400; }}
  .frame {{
    position: relative;
    border-radius: 18px;
    overflow: hidden;
    background: {PAGE_DARK};
    box-shadow: 0 24px 60px rgba(23, 19, 39, 0.22);
  }}
  .chrome-bar {{
    height: 40px;
    background: rgba(255, 255, 255, 0.08);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 16px;
  }}
  .dot {{ width: 10px; height: 10px; border-radius: 50%; background: rgba(255,255,255,0.28); }}
  .url {{
    margin-left: 12px;
    font: 12px ui-monospace, monospace;
    color: rgba(255,255,255,0.55);
  }}
  .lines {{ padding: 40px; display: grid; gap: 14px; }}
  .lines span {{ height: 12px; border-radius: 6px; background: rgba(255,255,255,0.1); }}
  .lines span:nth-child(1) {{ width: 62%; }}
  .lines span:nth-child(2) {{ width: 78%; }}
  .lines span:nth-child(3) {{ width: 46%; }}
  .lines span:nth-child(4) {{ width: 70%; }}
  .lines span:nth-child(5) {{ width: 34%; }}
  .popup-shot {{
    position: absolute;
    border-radius: 14px;
    box-shadow: 0 20px 50px rgba(23, 19, 39, 0.4);
  }}
"""


def find_chrome() -> str:
    for candidate in CHROME_CANDIDATES:
        if Path(candidate).exists():
            return candidate
        found = shutil.which(candidate)
        if found:
            return found
    sys.exit("No Chrome binary found. Pass --chrome, or install Google Chrome.")


def capture(chrome: str, page: Path, out: Path,
            size: tuple[int, int] = (WIDTH, HEIGHT)) -> None:
    result = subprocess.run(
        [
            chrome,
            "--headless",
            "--disable-gpu",
            "--hide-scrollbars",
            "--force-device-scale-factor=1",
            f"--window-size={size[0]},{size[1]}",
            "--virtual-time-budget=2500",
            f"--screenshot={out}",
            page.as_uri(),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        sys.exit(f"Chrome failed on {page}:\n{result.stderr.strip()}")


def float_markup(px: int) -> str:
    """The float, at a real size setting, with its real geometry."""
    geometry = shoot_float.read_geometry()
    style = shoot_float.host_style(px, geometry)
    return f'<div class="host" style="{style}">{shoot_float.build_markup("assets/")}</div>'


def stage_assets(workdir: Path, theme: str = "light") -> None:
    """Copy in the stylesheets and art the float and intermission need."""
    for name in ("shared.css", "float.css", "intermission.css"):
        css = shoot_float.theme_css((SRC / name).read_text(), theme)
        (workdir / name).write_text(css.replace(":host", ".host"))
    shutil.copytree(ROOT / "assets", workdir / "assets", dirs_exist_ok=True)


def scene_companion(workdir: Path, popup_png: str) -> str:
    return f"""<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="shared.css"><link rel="stylesheet" href="float.css">
<style>{BASE_CSS}
  /* The cat sits bottom-right because that is where the extension actually
     puts her; the popup hangs from the top-right because that is where it drops
     from the toolbar. Keeping the real spatial relationship also keeps the two
     off each other -- an earlier pass had the popup bottom-right too, which
     covered the cat completely and produced a screenshot of an empty page. */
  .host {{ position: absolute; display: block; right: 44px; bottom: 36px; }}
  .popup-shot {{ top: 56px; right: 28px; width: 268px; }}
</style></head><body>
  <div class="stage">
    <h1>A cat on every page.<br><span>She sits in the corner and keeps you company.</span></h1>
    <div class="frame">
      <div class="chrome-bar"><i class="dot"></i><i class="dot"></i><i class="dot"></i><span class="url">a page you were reading anyway</span></div>
      <div class="lines"><span></span><span></span><span></span><span></span><span></span></div>
      {float_markup(116)}
      <img class="popup-shot" src="{popup_png}" alt="">
    </div>
  </div>
</body></html>"""


def scene_timer(workdir: Path, popup_png: str, settings_png: str) -> str:
    return f"""<!doctype html><html><head><meta charset="utf-8">
<style>{BASE_CSS}
  .pair {{ display: flex; gap: 56px; align-items: center; justify-content: center; }}
  .pair img {{ width: 300px; border-radius: 14px; box-shadow: 0 20px 50px rgba(23,19,39,0.22); }}
</style></head><body>
  <div class="stage">
    <h1>Pour a Focus Coffee.<br><span>Four brews, from a 15-minute decaf to a 90-minute cold brew.</span></h1>
    <div class="pair"><img src="{popup_png}" alt=""><img src="{settings_png}" alt=""></div>
  </div>
</body></html>"""


def scene_intermission(workdir: Path) -> str:
    """The intermission's real markup, rebuilt the way content.js builds it."""
    geometry = shoot_float.read_geometry()
    return f"""<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="shared.css"><link rel="stylesheet" href="intermission.css">
<style>{BASE_CSS}
  .host {{ position: absolute; inset: 0; display: block; }}
  /* The intermission is `position: fixed` -- it covers a viewport in real use.
     A transform on an ancestor makes that ancestor the containing block for
     fixed descendants, which is what keeps the coffee rise inside the mock
     browser instead of washing the entire screenshot, headline and all. */
  .frame {{ transform: translate(0); }}
</style></head><body>
  <div class="stage">
    <h1>When the cup runs out, so does the session.<br><span>Five minutes, then refill or snooze.</span></h1>
    <div class="frame">
      <div class="chrome-bar"><i class="dot"></i><i class="dot"></i><i class="dot"></i><span class="url">your page, still there underneath</span></div>
      <div class="lines"><span></span><span></span><span></span><span></span><span></span></div>
      <div class="host">
        <section class="intermission" aria-label="Brûlée Focus intermission">
          <div class="coffee-rise" aria-hidden="true">
            <span class="coffee-wave wave-a"></span><span class="coffee-wave wave-b"></span>
          </div>
          <div class="intermission-panel">
            {cup_markup(geometry)}
            <strong class="time-display">4:12</strong>
            <p class="intermission-caption">intermission</p>
            <div class="intermission-actions">
              <button class="button-primary" type="button">Refill coffee</button>
              <p class="intermission-choice-note">Not ready for another session?</p>
              <button class="button-secondary" type="button">Snooze</button>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</body></html>"""


def cup_markup(geometry: dict) -> str:
    """The vector cup, from the generated geometry, part-filled.

    Mirrors buildCupMarkup() in src/content.js. The ids are different because
    two of these could otherwise collide inside one screenshot document.
    """
    import re

    text = (SRC / "mug-geometry.js").read_text()

    def path(key):
        marker = f'{key}: "'
        start = text.index(marker) + len(marker)
        return text[start:text.index('"', start)]

    rim_cy = float(re.search(r"cy: ([0-9.]+)", text).group(1))
    interior_height = float(re.search(r"interiorHeight: ([0-9.]+)", text).group(1))
    surface_y = rim_cy + 1.2
    rx = geometry["width"] / 2
    ry = rim_cy - geometry["y"]
    # Part-drained, so the cup reads as a meter rather than as a full mug.
    offset = 0.45 * interior_height

    return f"""
      <svg class="cup" viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <clipPath id="store-cup-interior"><path d="{path('interior')}"></path></clipPath>
          <linearGradient id="store-coffee" x1="0" y1="0" x2="0" y2="1">
            <stop class="liquid-top" offset="0"></stop><stop class="liquid-bottom" offset="1"></stop>
          </linearGradient>
        </defs>
        <path class="cup-handle" d="{path('handle')}"></path>
        <path class="cup-wall" d="{path('body')}"></path>
        <g clip-path="url(#store-cup-interior)">
          <g class="cup-liquid" style="transform: translateY({offset:.2f}px)">
            <rect x="0" y="{surface_y}" width="100" height="90" fill="url(#store-coffee)"></rect>
            <ellipse class="cup-crema" cx="43" cy="{surface_y}" rx="{rx}" ry="{ry}"></ellipse>
          </g>
        </g>
        <path class="cup-body" d="{path('body')}"></path>
      </svg>"""


# The small promo tile. Its own size, so it gets its own capture pass.
#
# Optional in the sense that the store will accept a listing without one, and
# not optional in practice: without a small tile the item is ineligible for any
# Chrome Web Store featuring, and that eligibility cannot be applied
# retroactively to a launch.
PROMO_WIDTH, PROMO_HEIGHT = 440, 280


def scene_promo() -> str:
    """440x280. Read at thumbnail size, so it carries the cat and the name only.

    Deliberately not a screenshot. A promo tile is shown small and in a grid
    next to other tiles, where UI detail turns to mush; the two things that have
    to survive that are the silhouette and the wordmark. The large buddy render
    is used rather than the extension's sprite because this paints her at ~190px
    and the shipped sprite tops out at 200px wide.
    """
    return f"""<!doctype html><html><head><meta charset="utf-8">
<style>
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0;
    width: {PROMO_WIDTH}px;
    height: {PROMO_HEIGHT}px;
    overflow: hidden;
    background: {BACKDROP};
    font-family: system-ui, -apple-system, sans-serif;
    color: {INK};
    display: flex;
    align-items: center;
    gap: 22px;
    padding: 0 34px;
  }}
  img {{
    height: 196px;
    width: auto;
    flex: none;
    filter: drop-shadow(0 10px 18px rgba(23, 19, 39, 0.22));
  }}
  h1 {{
    margin: 0 0 6px;
    font-size: 33px;
    line-height: 1.05;
    letter-spacing: -0.03em;
    font-weight: 600;
  }}
  p {{ margin: 0; font-size: 15px; line-height: 1.35; color: {INK_SOFT}; }}
</style></head><body>
  <img src="assets/brulee-buddy-large.png" alt="">
  <div>
    <h1>Br&ucirc;l&eacute;e<br>Focus</h1>
    <p>A cozy focus timer,<br>kept by a coffee cat.</p>
  </div>
</body></html>"""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=ROOT / "dist" / "store")
    parser.add_argument("--chrome", default=None)
    args = parser.parse_args()

    chrome = args.chrome or find_chrome()
    out_dir = args.out
    out_dir.mkdir(parents=True, exist_ok=True)
    workdir = Path(tempfile.mkdtemp(prefix="brulee-store-"))

    # The popup is captured by its own tool, shim and all, rather than
    # re-implemented here. If it can render for review it can render for a
    # listing, and there is then only one thing to keep working.
    popup_dir = workdir / "popup"
    subprocess.run(
        [sys.executable, str(TOOLS / "shoot_popup.py"), "--out", str(popup_dir)],
        check=True,
        capture_output=True,
        text=True,
        cwd=ROOT,
    )

    stage_assets(workdir)
    for name in ("focus-light.png", "settings-light.png"):
        shutil.copy(popup_dir / name, workdir / name)

    scenes = {
        "01-companion.png": scene_companion(workdir, "focus-light.png"),
        "02-focus-coffee.png": scene_timer(workdir, "focus-light.png", "settings-light.png"),
        "03-intermission.png": scene_intermission(workdir),
    }

    for name, html in scenes.items():
        page = workdir / name.replace(".png", ".html")
        page.write_text(html)
        capture(chrome, page, out_dir / name)
        print(f"  {out_dir / name}")

    promo = workdir / "promo.html"
    promo.write_text(scene_promo())
    capture(chrome, promo, out_dir / "promo-small-tile.png", (PROMO_WIDTH, PROMO_HEIGHT))
    print(f"  {out_dir / 'promo-small-tile.png'}")

    shutil.rmtree(workdir, ignore_errors=True)
    print(f"\n{len(scenes)} screenshots at {WIDTH}x{HEIGHT}, "
          f"plus a {PROMO_WIDTH}x{PROMO_HEIGHT} small promo tile.")


if __name__ == "__main__":
    main()
