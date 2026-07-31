#!/usr/bin/env python3
"""Build the zip that gets uploaded to the Chrome Web Store.

Run from the repo root:

    python3 tools/package.py              # writes dist/coffeecat-<version>.zip
    python3 tools/package.py --list       # print what would go in, and stop
    python3 tools/package.py --out build  # somewhere else

Why not just zip the repo
-------------------------
Because the repo is not the extension. Zipping the root ships the 2MB archived
character art, the 922KB illustration master, the marketing site and its two
vendored fonts, the test suite and these tools -- roughly 4MB of payload for an
extension whose actual code and art come to a couple hundred KB. Reviewers see
all of it, users download all of it, and every file in there is one more thing
that has to be explained if it looks odd.

So this is an ALLOWLIST, not a denylist. A denylist fails open: the day someone
adds assets/scratch/ it silently ships. Anything not named below is not in the
build, and tests/test_extension_integrity.py checks the other direction -- that
every file the manifest references made it in.

Determinism
-----------
Every entry gets a fixed timestamp and fixed permissions, and the file list is
sorted. Two builds of the same commit produce byte-identical zips, which is what
makes "is what I uploaded what I have here?" a question you can answer with a
checksum instead of a memory.
"""

import argparse
import hashlib
import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Everything the packaged extension consists of. Directories are taken whole;
# files are taken literally. Keep this list boring and explicit.
INCLUDE = (
    "manifest.json",
    "src/background.js",
    "src/settings.js",
    "src/mug-geometry.js",
    "src/content.js",
    "src/content.css",
    "src/float.css",
    "src/intermission.css",
    "src/shared.css",
    "src/popup.html",
    "src/popup.js",
    "src/popup.css",
    "assets/coffeecat-buddy.png",
    "assets/icons/icon-16.png",
    "assets/icons/icon-32.png",
    "assets/icons/icon-48.png",
    "assets/icons/icon-128.png",
    "assets/mug/mug-back.png",
    "assets/mug/mug-fill.png",
    "assets/mug/mug-front.png",
    "assets/mug/mug-steam.png",
)

# Named so the intent survives someone reading only this file. These are the
# things most likely to be added back by accident, because they all live under
# paths that ARE partly shipped.
EXCLUDED_ON_PURPOSE = (
    "assets/source/",           # the 890x1142 illustration master
    "assets/archive/",          # superseded character art
    "assets/coffeecat-buddy-large.png",  # the site's hero render, not the sprite
    "site/",                    # marketing site, deployed separately
    "tools/",                   # generators and screenshot harnesses
    "tests/",
    "docs/",
)

# A ceiling, not a target. The content script's assets are decoded per tab on
# every http/https page, so payload here is memory on someone else's machine,
# not just download size. If a change needs this raised, that is worth a
# conversation rather than a bump.
SIZE_BUDGET_BYTES = 400 * 1024

# ZIP stores 1980-01-01 as its zero date; anything earlier is unrepresentable.
FIXED_TIMESTAMP = (1980, 1, 1, 0, 0, 0)


def manifest_version() -> str:
    return json.loads((ROOT / "manifest.json").read_text())["version"]


def collect() -> list[Path]:
    """Resolve INCLUDE into a sorted list of real files, failing on anything missing."""
    found: list[Path] = []
    missing: list[str] = []
    for entry in INCLUDE:
        path = ROOT / entry
        if path.is_dir():
            found.extend(sorted(p for p in path.rglob("*") if p.is_file()))
        elif path.is_file():
            found.append(path)
        else:
            missing.append(entry)

    if missing:
        sys.exit("Missing files listed in INCLUDE:\n  " + "\n  ".join(missing))
    return sorted(set(found))


def build(out_dir: Path) -> Path:
    files = collect()
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / f"coffeecat-{manifest_version()}.zip"

    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in files:
            # Paths are stored relative to the repo root, so the zip unpacks to
            # the layout manifest.json already describes. The Web Store wants
            # manifest.json at the archive root, not inside a wrapper directory.
            info = zipfile.ZipInfo(str(path.relative_to(ROOT)), date_time=FIXED_TIMESTAMP)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, path.read_bytes())

    return target


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=ROOT / "dist")
    parser.add_argument("--list", action="store_true", help="Print the file list and exit.")
    args = parser.parse_args()

    files = collect()
    if args.list:
        for path in files:
            print(f"{path.stat().st_size:>9,}  {path.relative_to(ROOT)}")
        print(f"{sum(p.stat().st_size for p in files):>9,}  TOTAL (uncompressed)")
        return

    target = build(args.out)
    size = target.stat().st_size
    digest = hashlib.sha256(target.read_bytes()).hexdigest()

    print(f"{target.relative_to(ROOT) if target.is_relative_to(ROOT) else target}")
    print(f"  {len(files)} files, {size:,} bytes zipped")
    print(f"  sha256 {digest}")

    uncompressed = sum(p.stat().st_size for p in files)
    if uncompressed > SIZE_BUDGET_BYTES:
        sys.exit(
            f"\nPayload is {uncompressed:,} bytes uncompressed, over the "
            f"{SIZE_BUDGET_BYTES:,} budget in tools/package.py."
        )


if __name__ == "__main__":
    main()
