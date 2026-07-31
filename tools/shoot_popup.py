#!/usr/bin/env python3
"""Screenshot src/popup.html the way Chrome actually renders it.

Run from the repo root:

    python3 tools/shoot_popup.py                 # all four captures
    python3 tools/shoot_popup.py --only focus-light
    python3 tools/shoot_popup.py --out shots/    # keep them somewhere

Writes focus-light, focus-dark, settings-light and settings-dark PNGs at 2x,
cropped to the popup's real width and its measured height, and prints where
they went. Stdlib only, same as tools/render_mug.py; the only external thing is
the Chrome binary, which is already on any machine that can load this
extension.

Reviewing CSS by reading it does not work -- spacing that looks fine in the
stylesheet collides on screen, and contrast problems are invisible in source.
But the two obvious ways to render this popup both lie to you, which is the
entire reason this file exists:

1. Headless Chrome reports `prefers-color-scheme: dark` by default, on a Mac
   that is sitting in light mode. Ask for a screenshot of "the popup" and you
   get the dark theme without being told. So neither theme here is left to the
   host: `--light` deletes the dark media block outright and `--dark` hoists it
   into `:root`, which means each capture is the theme it claims to be no
   matter what the host, the CI runner or a future Chrome flag believes.

2. Loaded over file://, `chrome.storage` does not exist, so popup.js throws on
   its first line of real work and paints nothing. The markup still renders --
   it has sensible defaults hard-coded -- so you get a screenshot that looks
   plausible and is not the UI. Every dynamic element (the drained cup, the
   segmented thumb position, Refill vs Start) is stuck at its HTML default.
   The shim below is what makes the render real, and it deliberately keeps
   writes in memory so a capture can drive the popup through its own states.

Both failures are silent. That is what makes them worth a tool.
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

# Mirrors body { width: 360px } in popup.css. The popup is a fixed-width
# surface; capturing it at any other width is a review of something else.
POPUP_WIDTH = 360

# The stylesheet that holds the light/dark token sets, and therefore the only
# one theme_css() has to rewrite. This moved out of popup.css when the tokens
# became shared with the content script's shadow roots; pointed at the wrong
# file, theme_css() finds no dark block and every capture silently comes back
# in one theme.
THEMED_SHEET = "shared.css"

# Enough rope for the measure pass to lay the page out before we read it back.
# The real height comes from the measurement, not from this.
PROBE_HEIGHT = 900

CHROME_CANDIDATES = (
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "google-chrome",
    "chromium",
)

# popup.js only ever touches storage (get/set/onChanged). Anything it does not
# use is deliberately absent: a shim that stubs the whole extension API hides
# the day the popup starts depending on something this cannot fake.
#
# `local`, not `sync`. The area name is part of the contract -- popup.js filters
# storage.onChanged on it -- so a shim offering the wrong one would render a
# popup stuck on its defaults and look entirely plausible doing it.
SHIM = """\
// Screenshot harness only. See tools/shoot_popup.py.
const memory = {};
window.chrome = {
  storage: {
    local: {
      get: (defaults, cb) => cb({ ...defaults, ...memory }),
      set: (patch, cb) => { Object.assign(memory, patch); if (cb) cb(); }
    },
    onChanged: { addListener: () => {} }
  }
};
"""

# Both of these run synchronously at the end of <body>, deliberately. The
# obvious spelling is requestAnimationFrame, since popup.js paints from a
# storage callback -- but --dump-dom does not reliably wait for a frame, and
# the measure pass failed roughly half the time as a result. It does not need
# one: the shim resolves get() synchronously, so popup.js has finished painting
# by the time these run, and getBoundingClientRect forces layout itself.
OPEN_SETTINGS = """\
<script>document.getElementById("open-settings").click();</script>
"""

MEASURE = """\
<script>
const bottom = (sel) => document.querySelector(sel).getBoundingClientRect().bottom;
document.body.setAttribute("data-shot", JSON.stringify({
  body: Math.ceil(document.body.getBoundingClientRect().height),
  focus: Math.ceil(bottom("#pane-focus .actions")),
  settings: Math.ceil(bottom(".settings-note"))
}));
</script>
"""


def find_chrome() -> str:
    for candidate in CHROME_CANDIDATES:
        if Path(candidate).exists():
            return candidate
        found = shutil.which(candidate)
        if found:
            return found
    sys.exit(
        "No Chrome binary found. Set BRULEE_CHROME or install Google Chrome.\n"
        "Tried:\n  " + "\n  ".join(CHROME_CANDIDATES)
    )


def dark_block_span(css: str) -> tuple[int, int]:
    """Locate the `@media (prefers-color-scheme: dark)` block by brace matching.

    A regex cannot do this: the block contains braces. Matching them is three
    lines and does not break the first time someone nests a rule in there.
    """
    start = css.index("@media (prefers-color-scheme: dark)")
    depth = 0
    for i in range(start, len(css)):
        if css[i] == "{":
            depth += 1
        elif css[i] == "}":
            depth -= 1
            if depth == 0:
                return start, i + 1
    raise ValueError(f"{THEMED_SHEET}: dark media block is unbalanced")


def theme_css(css: str, theme: str) -> str:
    start, end = dark_block_span(css)
    if theme == "light":
        return css[:start] + css[end:]
    # Hoist the block's contents to top level so they apply unconditionally.
    # The block is a bare `:root, :host { ... }`, so its body is already a
    # valid rule.
    inner = css[css.index("{", start) + 1 : end - 1]
    return css[:start] + inner + css[end:]


def stage(workdir: Path, theme: str, pane: str, measure: bool = False) -> Path:
    """Write one self-contained copy of the popup and return its entry point."""
    name = f"{pane}-{theme}" + ("-measure" if measure else "")
    out = workdir / name
    out.mkdir(parents=True, exist_ok=True)

    for asset in ("popup.js", "settings.js", "mug-geometry.js", "popup.css"):
        shutil.copy(SRC / asset, out / asset)
    (out / "shim.js").write_text(SHIM)
    # Only the token sheet carries a dark block, so it is the only one that gets
    # rewritten. Headless Chrome reports prefers-color-scheme: dark by default,
    # which means an unforced capture is whatever the flags happened to produce
    # rather than the theme it claims -- so the theme is decided here, in the
    # CSS, and never left to the host.
    (out / THEMED_SHEET).write_text(theme_css((SRC / THEMED_SHEET).read_text(), theme))

    html = (SRC / "popup.html").read_text()
    # Ahead of every other script, so the shim exists before popup.js runs.
    html = html.replace(
        '<script src="settings.js"></script>',
        '<script src="shim.js"></script>\n    <script src="settings.js"></script>',
    )
    if pane == "settings":
        html = html.replace("</body>", f"    {OPEN_SETTINGS}  </body>")
    if measure:
        html = html.replace("</body>", f"    {MEASURE}  </body>")

    page = out / "popup.html"
    page.write_text(html)
    return page


def run_chrome(chrome: str, page: Path, height: int, extra: list[str]) -> str:
    result = subprocess.run(
        [
            chrome,
            "--headless",
            "--disable-gpu",
            "--hide-scrollbars",
            "--force-device-scale-factor=2",
            f"--window-size={POPUP_WIDTH},{height}",
            # popup.js paints from a storage callback and the segmented thumb
            # settles a frame later; without a time budget the shot can land
            # mid-transition.
            "--virtual-time-budget=1500",
            *extra,
            page.as_uri(),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        sys.exit(f"Chrome failed on {page}:\n{result.stderr.strip()}")
    return result.stdout


def measure(chrome: str, workdir: Path) -> dict:
    """Read the popup's real height out of the rendered page.

    Both panes share one grid cell, so this is a property of the taller pane
    and is identical across themes -- one probe covers all four captures.
    """
    page = stage(workdir, "light", "focus", measure=True)
    dom = run_chrome(chrome, page, PROBE_HEIGHT, ["--dump-dom"])
    match = re.search(r'data-shot="([^"]*)"', dom)
    if not match:
        sys.exit("Measure pass produced no data-shot attribute; did popup.js throw?")
    return json.loads(match.group(1).replace("&quot;", '"'))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--out",
        type=Path,
        help="Directory for the PNGs (default: a fresh temp directory)",
    )
    parser.add_argument(
        "--only",
        action="append",
        choices=["focus-light", "focus-dark", "settings-light", "settings-dark"],
        help="Capture just these (repeatable). Default: all four.",
    )
    parser.add_argument(
        "--chrome",
        default=None,
        help="Path to a Chrome binary (default: first of the known locations)",
    )
    args = parser.parse_args()

    chrome = args.chrome or find_chrome()
    out_dir = args.out or Path(tempfile.mkdtemp(prefix="brulee-shots-"))
    out_dir.mkdir(parents=True, exist_ok=True)
    workdir = Path(tempfile.mkdtemp(prefix="brulee-stage-"))

    heights = measure(chrome, workdir)
    height = heights["body"]

    wanted = args.only or ["focus-light", "focus-dark", "settings-light", "settings-dark"]
    for name in wanted:
        pane, theme = name.split("-")
        page = stage(workdir, theme, pane)
        png = out_dir / f"{name}.png"
        run_chrome(chrome, page, height, [f"--screenshot={png}"])
        print(f"  {png}")

    shutil.rmtree(workdir, ignore_errors=True)

    print(
        f"\n{POPUP_WIDTH}x{height} at 2x. Content bottoms: "
        f"focus {heights['focus']}, settings {heights['settings']}."
    )
    # The panes share a grid cell, so the taller one sets the popup height and
    # the other ends in dead space. Worth knowing after any change that adds or
    # removes a row: it is the difference between a popup that ends where its
    # content ends and one with an unexplained gap under the last control.
    slack = heights["body"] - max(heights["focus"], heights["settings"])
    taller = "focus" if heights["focus"] >= heights["settings"] else "settings"
    print(f"{taller} pane sets the height; {slack}px padding below it.")


if __name__ == "__main__":
    main()
