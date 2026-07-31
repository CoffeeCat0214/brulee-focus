#!/usr/bin/env python3
"""Stage the marketing site for deployment, with the site at the domain root.

Run from the repo root:

    python3 tools/build_site.py              # writes dist/site/
    python3 tools/build_site.py --list       # print what would go in, and stop
    python3 tools/build_site.py --out build  # somewhere else

Then point Cloudflare Pages (or anything else) at `dist/site` as the output
directory, with no build command.

Why this exists
---------------
The site is authored to be served from the REPO ROOT: its pages reach back into
`../assets` for the sprites and `../src` for the generated mug geometry. That is
the right layout for local development (`python3 -m http.server` at the root,
open /site/) but it makes for two bad deployment options:

1. Deploy the repo root. Works, but the site lives at /site/privacy.html, and
   the CDN also gets the test suite, these tools, and the 922KB illustration
   master, none of which anyone should be downloading.

2. Deploy site/ alone. Every sprite, icon and the mug geometry 404s.

So this stages a third thing: the site at the root of its own tree, with the ten
`../` references rewritten to plain relative paths. `privacy.html` then answers
at /privacy (Cloudflare Pages resolves extensionless paths to .html), which is
the URL that goes in the Chrome Web Store listing and is awkward to change
later.

Same allowlist discipline as tools/package.py, and for the same reason: a
denylist fails open, and the whole point is that the deployed tree contains
nothing but the site.
"""

# Deferred annotation evaluation, so `str | None` and `tuple[list[Path], ...]`
# below do not require Python 3.10 at import time. This script runs in
# Cloudflare Pages' build image as well as locally, and pinning a floor there is
# a build failure waiting for whenever that image changes under us.
from __future__ import annotations

import argparse
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Files that live in site/ and land at the root of the output.
SITE_FILES = (
    "index.html",
    "privacy.html",
    "styles.css",
    "script.js",
)

# site/fonts/ is copied wholesale: styles.css resolves url()s against itself, so
# the fonts keep their relative path and need no rewriting.
SITE_DIRS = ("fonts",)

# Everything the site reaches for outside its own directory, kept at the same
# sub-paths so the rewrite below is a pure prefix strip. Derived by grepping the
# site for `../`; test_site_build_is_complete re-derives it and fails if the two
# disagree, so adding an image to the site cannot silently ship a 404.
EXTERNAL_FILES = (
    "assets/brulee-buddy.png",
    "assets/brulee-buddy-large.png",
    "assets/icons/icon-32.png",
    "assets/icons/icon-48.png",
    "assets/icons/icon-128.png",
    "assets/mug/mug-back.png",
    "assets/mug/mug-fill.png",
    "assets/mug/mug-front.png",
    "src/mug-geometry.js",
)

# `../assets/x` -> `assets/x`. The site sits at the root of the output tree, so
# stripping the parent hop is the whole transformation. Anchored on the two
# directories that actually exist rather than a bare `../`, so a stray `../`
# anywhere else is left alone and shows up as a broken link in review instead of
# being silently rewritten into something plausible.
REWRITE = re.compile(r"\.\./(assets|src)/")


def rewrite(text: str) -> str:
    return REWRITE.sub(r"\1/", text)


def absolutize_social(text: str, origin: str) -> str:
    """Make og:image and og:url absolute.

    Open Graph is the one place a relative path is not merely ugly but broken:
    the crawlers that build link previews generally will not resolve a relative
    og:image against the page URL, so a shared link comes back with no card. The
    repo cannot hardcode an origin (it has to keep working from a local server
    and from whatever domain this ends up on), so the deploy step is the right
    place to bind it.
    """
    text = re.sub(
        r'(<meta property="og:image" content=")([^"]+)(">)',
        lambda m: m.group(1) + origin + "/" + m.group(2).lstrip("/") + m.group(3),
        text,
    )
    # og:url has no equivalent in the source, and a canonical origin is the
    # thing preview cards key on, so it is added rather than rewritten.
    return text.replace(
        '<meta property="og:type" content="website">',
        f'<meta property="og:type" content="website">\n    '
        f'<meta property="og:url" content="{origin}/">',
    )


def collect() -> tuple[list[Path], list[Path], list[Path]]:
    site = [ROOT / "site" / name for name in SITE_FILES]
    external = [ROOT / name for name in EXTERNAL_FILES]
    fonts = []
    for name in SITE_DIRS:
        fonts.extend(sorted(p for p in (ROOT / "site" / name).rglob("*") if p.is_file()))

    missing = [p for p in site + external + fonts if not p.is_file()]
    if missing:
        sys.exit("Missing files:\n  " + "\n  ".join(str(p.relative_to(ROOT)) for p in missing))
    return site, fonts, external


def build(out_dir: Path, origin: str | None = None) -> Path:
    site, fonts, external = collect()

    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)

    for path in site:
        # Text files get the path rewrite; only .html actually carries `../`
        # today, but running it over the css and js too costs nothing and means
        # this does not have to be revisited the first time a background-image
        # points at a sprite.
        text = rewrite(path.read_text(encoding="utf-8"))
        if origin and path.suffix == ".html":
            text = absolutize_social(text, origin)
        (out_dir / path.name).write_text(text, encoding="utf-8")

    for path in fonts:
        target = out_dir / path.relative_to(ROOT / "site")
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(path, target)

    for path in external:
        target = out_dir / path.relative_to(ROOT)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(path, target)

    verify(out_dir)
    return out_dir


# The ways this site points at a file. `content` is deliberately NOT matched
# generally: on <meta> it usually holds prose, not a path, and a bare
# `content="..."` pattern treats the viewport string and the page description as
# missing files.
REFERENCE = re.compile(r'(?:href|src)="([^"]+)"')
OG_IMAGE = re.compile(r'<meta property="og:image" content="([^"]+)"')
CSS_URL = re.compile(r"url\(['\"]?([^)'\"]+)")


def verify(out_dir: Path) -> None:
    """Fail the build rather than deploy a tree with broken links.

    Checks references, not raw text. The first version of this asserted that
    `../` did not appear anywhere in the file, which failed the build on the
    HTML comment that *explains* the `../` convention -- prose, not a link. A
    check that fires on documentation is a check people learn to bypass.
    """
    problems = []
    for page in sorted(out_dir.glob("*.html")) + sorted(out_dir.glob("*.css")):
        text = page.read_text(encoding="utf-8")
        if page.suffix == ".html":
            refs = REFERENCE.findall(text) + OG_IMAGE.findall(text)
        else:
            refs = CSS_URL.findall(text)

        for ref in refs:
            if ref.startswith(("http://", "https://", "mailto:", "#", "data:")):
                continue
            if ref.startswith("../"):
                problems.append(f"{page.name}: {ref} escaped the rewrite")
            elif not (out_dir / ref).is_file():
                problems.append(f"{page.name}: references {ref}, which is not in the build")

    if problems:
        sys.exit("Site build is broken:\n  " + "\n  ".join(problems))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=ROOT / "dist" / "site")
    parser.add_argument("--list", action="store_true")
    parser.add_argument(
        "--domain",
        help="Domain the site will be served from, e.g. bruleepomodoro.com. "
             "Used to make og:image and og:url absolute, which link-preview "
             "crawlers require. Omit for a local preview build.",
    )
    args = parser.parse_args()

    site, fonts, external = collect()
    if args.list:
        for path in site + fonts + external:
            print(f"{path.stat().st_size:>9,}  {path.relative_to(ROOT)}")
        print(f"{sum(p.stat().st_size for p in site + fonts + external):>9,}  TOTAL")
        return

    origin = None
    if args.domain:
        origin = args.domain if args.domain.startswith("http") else f"https://{args.domain}"
    out_dir = build(args.out, origin)
    files = sorted(p for p in out_dir.rglob("*") if p.is_file())
    total = sum(p.stat().st_size for p in files)

    print(f"{out_dir.relative_to(ROOT) if out_dir.is_relative_to(ROOT) else out_dir}")
    print(f"  {len(files)} files, {total:,} bytes")
    print()
    print("  Cloudflare Pages (Git integration):")
    print(f"    build command:    python3 tools/build_site.py --domain <domain>")
    print(f"    output directory: {out_dir.relative_to(ROOT)}")
    # privacy.html, not /privacy: Cloudflare's clean-URL resolution is their
    # behaviour, not something this build controls, and the privacy URL is the
    # one field on the store form where a 404 is an automatic rejection.
    print(f"  Policy URL:       {origin or 'https://<domain>'}/privacy.html")
    if not origin:
        print("  (pass --domain to make og:image absolute for link previews)")


if __name__ == "__main__":
    main()
