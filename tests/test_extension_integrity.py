import json
import re
import struct
import subprocess
import sys
import tempfile
import zlib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
JSC = Path("/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc")


def read_text(path):
    return (ROOT / path).read_text(encoding="utf-8")


def read_manifest():
    return json.loads(read_text("manifest.json"))


def png_header(path):
    data = (ROOT / path).read_bytes()
    assert data.startswith(b"\x89PNG\r\n\x1a\n"), f"{path} is not a PNG"
    return struct.unpack(">IIBBBBB", data[16:29])


def assert_js_parses(path):
    result = subprocess.run(
        [str(JSC), "--ignoreUncaughtExceptions", str(ROOT / path)],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr or result.stdout


def test_manifest_core_contract():
    manifest = read_manifest()

    assert manifest["manifest_version"] == 3
    assert manifest["action"]["default_popup"] == "src/popup.html"
    assert "storage" in manifest["permissions"]
    assert manifest["content_scripts"][0]["js"] == ["src/mug-geometry.js", "src/content.js"]
    assert manifest["content_scripts"][0]["css"] == ["src/content.css"]
    assert manifest["content_scripts"][0]["run_at"] == "document_idle"


def test_manifest_referenced_files_exist():
    manifest = read_manifest()
    referenced = set(manifest["icons"].values())
    referenced.update(manifest["action"]["default_icon"].values())
    referenced.add(manifest["action"]["default_popup"])
    for content_script in manifest["content_scripts"]:
        referenced.update(content_script.get("css", []))
        referenced.update(content_script.get("js", []))
    for resource_group in manifest["web_accessible_resources"]:
        referenced.update(resource_group["resources"])

    assert sorted(path for path in referenced if not (ROOT / path).is_file()) == []


def test_javascript_files_parse():
    assert JSC.exists(), "JavaScriptCore is required for JS parse checks"
    assert_js_parses("src/content.js")
    assert_js_parses("src/popup.js")
    assert_js_parses("src/mug-geometry.js")
    assert_js_parses("site/script.js")


def test_style_templates_have_no_stray_backticks():
    """Guards a gap in the parse check above.

    content.js keeps its CSS in template literals, so a backtick inside a CSS
    comment silently ends the string. JSC parses function bodies lazily, and
    buildStyles() is never called during the parse check -- so that break sails
    through test_javascript_files_parse and only explodes in the browser. This
    happened for real while writing the sprite styles.
    """
    source = read_text("src/content.js")
    marker = ".textContent = `"
    pos = 0
    checked = 0
    while (start := source.find(marker, pos)) != -1:
        open_tick = start + len(marker) - 1
        end = source.find("`", open_tick + 1)
        assert end != -1, "unterminated style template literal"

        # Checking the body for backticks would be useless: a stray one is
        # indistinguishable from the real terminator, since it IS the
        # terminator as far as the parser is concerned. What gives it away is
        # what follows. A correctly closed style literal is immediately
        # followed by `;` -- a premature close is followed by more CSS.
        tail = source[end + 1:].lstrip()
        line = source.count("\n", 0, end) + 1
        assert tail.startswith(";"), (
            f"style template at line {line} closes early -- "
            f"stray backtick in the CSS, followed by {tail[:40]!r}"
        )
        checked += 1
        pos = end + 1
    assert checked >= 2, f"expected the cat and break-overlay styles, found {checked}"


def test_purr_bubble_scales_and_carries_no_hardcoded_chrome():
    """The bubble regressed twice into absolute pixels and a hard stroke.

    Its box is 64/88/116px depending on the size setting (SIZE_MAP), so any
    metric that is not derived from --cat-unit is only correct at one of the
    three. The 3px border and the raw #fff8ef it used to carry are the specific
    shape that drift took last time, hence naming them.
    """
    content = read_text("src/content.js")

    start = content.index("      .purr-bubble {")
    rule = content[start:content.index("}", start)]

    assert "var(--cat-unit)" in rule, "bubble metrics must scale with the host box"
    assert not re.search(r"^\s*border:", rule, re.M), "the material has no stroke"
    assert "#fff8ef" not in rule, "surface comes from --bubble-surface"
    assert "steps(" not in rule, "stepped motion belongs to the pixel-art era"

    # --cat-unit has exactly one producer: the same assignment that turns a size
    # setting into pixels. A second one would let the two drift.
    assert content.count('setProperty("--cat-unit"') == 1
    assert "SIZE_MAP.medium" in content

    # The bubble hangs outside the host box, so the top-viewport flip is not
    # optional decoration -- without it the cat speaks off-screen.
    assert "bubble-below" in content
    assert "hasRoomForBubbleAbove" in content


def test_focus_timer_contract_is_wired_to_mug_sprite():
    """Replaces an older test that BANNED external mug assets.

    That guardrail (resources == {buddy}, "assets/mugs/" absent) was added after
    an earlier sprite attempt was reverted. The ban is now deliberately lifted:
    the mug ships as generated sprite layers. What the old test was really
    protecting -- that the art cannot silently drift from the code -- is covered
    better by test_mug_assets_are_reproducible below, which regenerates the
    sprite and diffs it.
    """
    manifest = read_manifest()
    content = read_text("src/content.js")
    popup = read_text("src/popup.js")
    html = read_text("src/popup.html")
    resources = {
        resource
        for group in manifest["web_accessible_resources"]
        for resource in group["resources"]
    }

    assert resources == {
        "assets/coffeecat-buddy.png",
        "assets/mug/mug-back.png",
        "assets/mug/mug-fill.png",
        "assets/mug/mug-front.png",
        "assets/mug/mug-steam.png",
    }
    assert "coffee-meter" in content
    assert "mug-window" in content
    assert "mug-liquid" in content

    # The drain must translate, never scale: the sprite carries its own surface
    # ellipse and crema at a fixed thickness, and scaling squashes both. Scoped
    # to the statement that moves the liquid -- scaleY is legitimate elsewhere
    # (the napping squash, the break overlay's coffee flood).
    liquid_vars = ("fillElement", "progressFill", "demoFill")
    moves = 0
    for source in ("src/content.js", "src/popup.js", "site/script.js"):
        for line in read_text(source).splitlines():
            if ".style.transform" not in line:
                continue
            if not any(f"{name}.style.transform" in line for name in liquid_vars):
                continue
            moves += 1
            assert "translateY(" in line, (
                f"{source} moves the liquid without translateY: {line.strip()}"
            )
            assert "scaleY(" not in line, (
                f"{source} scales the liquid instead of translating it: {line.strip()}"
            )
    assert moves == 3, f"expected one drain per surface, found {moves}"

    # All three surfaces read the same generated geometry.
    for source in ("src/content.js", "src/popup.js", "site/script.js"):
        assert "COFFEECAT_MUG" in read_text(source)

    for key in (
        "coffeeDurationMs",
        "coffeePausedRemainingMs",
        "coffeeBrewMode",
        "coffeeBrewLabel",
        "coffeeRunning",
        "coffeeStartedAt",
        "coffeeSessionId",
        "completedCoffeeSessionId",
        "breakRunning",
        "breakStartedAt",
        "breakDurationMs",
        "snoozeUsedForSession",
        "snoozeSessionRunning",
        "focusStats",
    ):
        assert key in content
        assert key in popup

    assert "coffeecat-break-root" in content
    assert "break-overlay" in content
    assert "coffee-flood" in content
    assert "flood-stats" in content

    for element_id in (
        "timer-display",
        "timer-status",
        "timer-toggle",
        "timer-refill",
        "brew-deck",
        "brew-detail-copy",
    ):
        assert f'id="{element_id}"' in html

    # The popup used to end in a lifetime "N sessions / N min / N cups" strip.
    # It never reset, so it only ever counted up -- and two of its three numbers
    # were the same counter. The stats themselves still accumulate in storage
    # for the coffee-flood share card; only the popup readout is gone.
    for element_id in ("stat-sessions", "stat-minutes", "stat-cups"):
        assert f'id="{element_id}"' not in html
    assert "focusStats" in popup, "storage-side stats must survive the footer"

    for brew_mode in ("espresso", "slow-pour", "cold-brew", "decaf"):
        assert f'data-brew-mode="{brew_mode}"' in html
        assert brew_mode in popup

    assert "brew-option" in html
    assert "selectBrewMode" in popup

    # The coffee flood is unconditional. It used to hang off a per-mode
    # `breakOnComplete` flag that only Slow Pour set, which meant three of the
    # four modes hit zero and showed nothing at all. Both completion paths must
    # now start the break outright, and neither may reintroduce the flag.
    assert "breakRunning: true" in popup
    assert "breakRunning: true" in content
    assert "breakOnComplete" not in popup
    assert "breakOnComplete" not in content


def test_brew_modes_match_markup():
    """Guards drift between BREW_MODES and the segmented control markup.

    Replaces earlier assertions that pinned specific detail-element IDs into
    the popup. Those pinned presentation -- including two fields (`ambient`,
    `cat`) that described an ambient-audio system and named cats the extension
    never had. This asserts a real contract instead: the modes the popup can
    render and the modes the markup offers must be the same set.
    """
    popup = read_text("src/popup.js")
    html = read_text("src/popup.html")

    markup_modes = set(re.findall(r'data-brew-mode="([^"]+)"', html))
    config_modes = set(re.findall(r'^\s*id: "([^"]+)",$', popup, re.MULTILINE))

    assert markup_modes, "no brew modes found in popup.html"
    assert markup_modes == config_modes, (
        f"markup offers {sorted(markup_modes)} but BREW_MODES defines "
        f"{sorted(config_modes)}"
    )

    # Every mode needs the copy the popup renders for it.
    for mode in sorted(config_modes):
        assert f'"{mode}"' in popup or f"{mode}:" in popup

    # Ambient audio does not exist -- playPurr() is the only sound path.
    # Keep the UI from re-acquiring claims the code cannot back.
    content = read_text("src/content.js")
    assert "ambient" not in popup.lower()
    for invented in ("misu", "brulee", "cafe hum", "rain sounds"):
        assert invented not in popup.lower(), f"unimplemented claim in popup: {invented}"
        assert invented not in content.lower()


def test_static_site_documents_v2_launch():
    index = read_text("site/index.html")
    styles = read_text("site/styles.css")
    script = read_text("site/script.js")

    assert "CoffeeCat" in index
    # The break feature is named "Coffee break" in site copy. It was previously
    # "Gentle Gatekeeper"; renamed because visitors read the old name as jargon.
    assert "Coffee break" in index
    assert "../assets/coffeecat-buddy.png" in index
    assert "demo-fill" in index
    assert "requestAnimationFrame" in script
    assert ".flood-preview" in styles
    assert "siteCoffeeFlood" in styles


MUG_LAYERS = (
    "assets/mug/mug-back.png",
    "assets/mug/mug-fill.png",
    "assets/mug/mug-front.png",
    "assets/mug/mug-steam.png",
)


def png_pixels(path):
    """Decompressed scanlines of a PNG, given an absolute path.

    The generator writes filter type 0 on every row, so this stream is a pure
    function of the pixels -- unlike the raw file bytes, which vary with the
    zlib version doing the compressing. Comparing here rather than on file
    bytes keeps the reproducibility check from failing spuriously on a machine
    whose zlib packs the same pixels differently.
    """
    data = Path(path).read_bytes()
    assert data.startswith(b"\x89PNG\r\n\x1a\n"), f"{path} is not a PNG"
    pos = 8
    idat = b""
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos:pos + 4])
        kind = data[pos + 4:pos + 8]
        if kind == b"IDAT":
            idat += data[pos + 8:pos + 8 + length]
        elif kind == b"IEND":
            break
        pos += 12 + length
    return zlib.decompress(idat)


def test_mug_assets_are_reproducible():
    """The checked-in sprite must match what the generator produces today.

    This is the point of rendering the mug from code: the art is verifiable.
    A hand-edited PNG, or a geometry change committed without re-running the
    generator, fails here instead of shipping.
    """
    with tempfile.TemporaryDirectory() as tmp:
        result = subprocess.run(
            [sys.executable, str(ROOT / "tools" / "render_mug.py"), tmp],
            check=False,
            capture_output=True,
            text=True,
            cwd=ROOT,
        )
        assert result.returncode == 0, result.stderr or result.stdout

        for layer in MUG_LAYERS:
            name = Path(layer).name
            regenerated = Path(tmp) / name
            assert regenerated.is_file(), f"generator did not emit {name}"
            assert png_pixels(regenerated) == png_pixels(ROOT / layer), (
                f"{layer} is stale -- re-run tools/render_mug.py"
            )


def test_generated_geometry_is_in_sync():
    """src/mug-geometry.js is generated too, and every surface reads it."""
    geometry = read_text("src/mug-geometry.js")
    assert "GENERATED by tools/render_mug.py" in geometry
    assert "COFFEECAT_MUG" in geometry
    for key in ("FILL_WINDOW", "DRAIN_RANGE", "bottomRadius", "interiorHeight"):
        assert key in geometry

    # It has to load before anything that reads it.
    manifest = read_manifest()
    js = manifest["content_scripts"][0]["js"]
    assert js.index("src/mug-geometry.js") < js.index("src/content.js")

    popup_html = read_text("src/popup.html")
    assert popup_html.index("mug-geometry.js") < popup_html.index("popup.js")

    # The popup's path data is generated; it must not drift from the sprite.
    for path_key in ("body", "interior", "handle"):
        marker = f'{path_key}: "'
        start = geometry.index(marker) + len(marker)
        assert geometry[start:geometry.index('"', start)] in popup_html, (
            f"popup.html {path_key} path differs from the generated geometry"
        )


def test_png_assets_are_valid_rgba():
    expected_sizes = {
        "assets/coffeecat-buddy.png": None,
        "assets/icons/icon-16.png": (16, 16),
        "assets/icons/icon-32.png": (32, 32),
        "assets/icons/icon-48.png": (48, 48),
        "assets/icons/icon-128.png": (128, 128),
        **{layer: (512, 512) for layer in MUG_LAYERS},
    }

    for path, expected_size in expected_sizes.items():
        width, height, bit_depth, color_type, *_ = png_header(path)
        if expected_size:
            assert (width, height) == expected_size
        else:
            assert width > 0 and height > 0
        assert bit_depth == 8
        assert color_type == 6


if __name__ == "__main__":
    tests = [
        value
        for name, value in sorted(globals().items())
        if name.startswith("test_") and callable(value)
    ]
    for test in tests:
        test()
        print(f"ok {test.__name__}")
    print(f"{len(tests)} tests passed")
