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
    assert manifest["content_scripts"][0]["js"] == [
        "src/settings.js",
        "src/mug-geometry.js",
        "src/content.js",
    ]
    assert manifest["content_scripts"][0]["css"] == ["src/content.css"]
    assert manifest["content_scripts"][0]["run_at"] == "document_idle"


def test_manifest_asks_for_least_privilege():
    """What the extension requests has to stay defensible at review time.

    `host_permissions` is the specific thing being kept out. It was declared for
    all http/https and never used: content scripts inject from their own
    `matches`, and the only things fetched are the extension's own
    web_accessible_resources, which chrome-extension:// URLs reach without any
    host grant. It bought nothing and it is the first line a reviewer reads.
    """
    manifest = read_manifest()

    assert "host_permissions" not in manifest, (
        "content_scripts.matches already covers injection; host_permissions "
        "grants page access this extension never uses"
    )
    assert set(manifest["permissions"]) == {"storage", "alarms"}, (
        "storage holds the settings, alarms ends the session; anything else "
        "needs a justification in the store listing"
    )
    assert "optional_permissions" not in manifest

    # A version the Web Store will accept as a first public release, rather than
    # the 0.1.0 this shipped as while it was a local unpacked build.
    assert re.fullmatch(r"\d+\.\d+\.\d+", manifest["version"]), manifest["version"]
    assert manifest["version"] != "0.1.0"

    # color-mix() in src/intermission.css is the highest floor in the codebase
    # (Chrome 111); :has() is 105 and inert is 102. Without this Chrome offers
    # the extension to browsers that render the intermission with transparent
    # gradients and no way to know why.
    assert int(manifest["minimum_chrome_version"]) >= 111


def test_background_worker_is_wired():
    manifest = read_manifest()
    assert manifest["background"]["service_worker"] == "src/background.js"
    # MV3 service workers cannot be persistent, and declaring the key at all is
    # a manifest V2 habit that fails review.
    assert "persistent" not in manifest["background"]
    assert (ROOT / "src/background.js").is_file()


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
    assert_js_parses("src/settings.js")
    assert_js_parses("src/background.js")
    assert_js_parses("src/content.js")
    assert_js_parses("src/popup.js")
    assert_js_parses("src/mug-geometry.js")
    assert_js_parses("site/script.js")


def test_session_state_machine_behaves():
    """Actually run the completion logic, rather than reading it.

    Everything else here is static analysis. This concatenates the mocks, the
    shared session model and the service worker and drives them through the
    cases that matter: a duplicate alarm delivery must not double-count a
    session, an alarm that never fires must still be settled by the next
    startup, pausing must disarm, and a position write (which happens several
    times a second while dragging) must not rearm anything.

    The success line is checked rather than the exit status on purpose: an
    assertion thrown inside the harness's async main() surfaces as an unhandled
    rejection, and jsc still exits 0 on those. Trusting the return code here
    would make this test pass no matter what the extension did.
    """
    assert JSC.exists(), "JavaScriptCore is required for the session harness"

    sources = ("tests/session_mocks.js", "src/settings.js", "src/background.js",
               "tests/session_harness.js")
    with tempfile.TemporaryDirectory() as tmp:
        bundle = Path(tmp) / "session.js"
        bundle.write_text("\n".join(read_text(path) for path in sources), encoding="utf-8")
        result = subprocess.run(
            [str(JSC), str(bundle)], check=False, capture_output=True, text=True
        )

    output = result.stdout + result.stderr
    assert "OK session state machine" in output, output.strip() or "harness produced no output"


def test_session_model_has_one_definition():
    """src/settings.js is the only place a session is defined.

    The brew table, the defaults and the remaining-time maths used to be
    copy-pasted between content.js and popup.js. Two copies drifted quietly --
    nothing failed, the popup and the float just disagreed about what a mode
    meant -- and adding the service worker would have made three. The test that
    used to stand in for this only checked that the same storage KEY NAMES
    appeared in both files, which a copy-paste satisfies trivially.
    """
    settings = read_text("src/settings.js")
    consumers = {
        name: read_text(f"src/{name}")
        for name in ("content.js", "popup.js", "background.js")
    }

    for symbol in ("BREW_MODES", "DEFAULT_SETTINGS", "SIZE_MAP"):
        assert f"const {symbol}" in settings, f"{symbol} must live in settings.js"
        for name, source in consumers.items():
            assert f"const {symbol} =" not in source, (
                f"src/{name} redefines {symbol}; destructure it from "
                f"globalThis.COFFEECAT instead"
            )

    # Duration literals belong to the brew table. A minutes-to-ms expression in a
    # consumer is how a mode's real length drifts from the copy describing it.
    for name, source in consumers.items():
        assert not re.search(r"\d+\s*\*\s*60\s*\*\s*1000", source), (
            f"src/{name} spells out a duration; take it from BREW_MODES"
        )

    for name, source in consumers.items():
        assert "globalThis.COFFEECAT" in source, f"src/{name} does not read the shared model"

    # The popup loads it as a plain script, so order is the whole contract:
    # popup.js destructures the global at its top level. Read the actual <script>
    # sequence rather than searching for filenames -- the prose around these tags
    # names them too, and a substring search finds the comment first.
    scripts = re.findall(r'<script src="([^"]+)"', read_text("src/popup.html"))
    assert scripts.index("settings.js") < scripts.index("popup.js"), scripts
    assert scripts.index("mug-geometry.js") < scripts.index("popup.js"), scripts
    # importScripts, not import: the worker is classic, which is what lets the
    # same file serve a content script, a document and a worker with no build.
    assert 'importScripts("settings.js")' in consumers["background.js"]


def test_session_completion_has_exactly_one_owner():
    """Only the service worker may end a focus session.

    Every mounted content script used to run its own 250ms tick and write the
    completion patch when it saw the clock hit zero. N open tabs meant N writes
    of the same patch, each waking every other tab's storage listener; and with
    no http/https tab open, nothing ticked, so the session never ended at all.

    The rule is therefore about WRITES, not about reads. Both surfaces still
    derive remaining time from the stored timestamps -- that is what keeps them
    correct between alarms -- they just no longer decide anything.
    """
    background = read_text("src/background.js")
    content = read_text("src/content.js")
    popup = read_text("src/popup.js")

    assert "buildCompletionPatch" in background
    assert "chrome.alarms" in background

    for name, source in (("content.js", content), ("popup.js", popup)):
        assert "buildCompletionPatch" not in source, (
            f"src/{name} must not complete sessions; src/background.js owns that"
        )
        assert "completeFocusSession" not in source, (
            f"src/{name} still carries the old completion path"
        )
        # The tell-tale of a surface writing the completion patch itself.
        assert "breakRunning: true" not in source, (
            f"src/{name} starts an intermission; only the service worker may"
        )

    # The patch is built in settings.js and written in exactly one place.
    assert "breakRunning: true" in read_text("src/settings.js")
    assert background.count("chrome.storage.local.set(patch)") == 1

    # Ending the break is the same problem in miniature: an expired intermission
    # has to leave the screen locally, but clearing the stored flag from every
    # tab is the same herd. content.js may remove the panel; it may not write.
    assert "removeIntermission()" in content


def test_storage_is_local_everywhere():
    """The privacy claim in the UI has to be true of the code.

    The popup says "CoffeeCat stays local. Nothing leaves your browser." while
    the extension used chrome.storage.sync, which replicates through the user's
    Google account to their other devices. That is a statement the Web Store
    data-use disclosure asks you to certify, so it is pinned here rather than
    left to a copy review.

    storage.local also removes the sync write-rate quota and stops a session
    started on one machine from appearing on another.
    """
    surfaces = ("src/content.js", "src/popup.js", "src/background.js")
    for path in surfaces:
        source = read_text(path)
        assert "storage.sync" not in source, f"{path} still uses chrome.storage.sync"
        assert "storage.local" in source, f"{path} does not touch storage.local"
        # The area name is a filter on storage.onChanged; the wrong one means the
        # surface silently stops responding to changes it should see.
        if "onChanged" in source:
            assert '!== "local"' in source, f"{path} filters onChanged on the wrong area"

    # The screenshot harness fakes this API. Pointed at the wrong area it renders
    # a popup stuck on defaults, which looks entirely plausible.
    assert "storage.sync" not in read_text("tools/shoot_popup.py")

    assert "Nothing leaves your browser" in read_text("src/popup.html")


def test_shadow_css_lives_in_files():
    """Replaces test_style_templates_have_no_stray_backticks.

    The shadow roots' CSS used to be two template literals inside content.js,
    which had a failure mode nothing else could catch: a backtick in a CSS
    comment silently ends the string, JSC parses function bodies lazily so
    buildStyles() was never executed during the parse check, and the break
    only showed up in a browser. The old test hand-rolled a scanner for it.

    The CSS is now in real files, adopted as constructed stylesheets, so that
    hazard is gone by construction. What is worth pinning instead is that it
    stays that way -- CSS-in-a-JS-string is the thing being prevented -- plus
    the wiring that makes the files reachable, since a shadow root fetching a
    resource that is not web-accessible fails at runtime and never at import.
    """
    content = read_text("src/content.js")
    manifest = read_manifest()
    resources = {
        resource
        for group in manifest["web_accessible_resources"]
        for resource in group["resources"]
    }

    for path in ("src/shared.css", "src/float.css", "src/intermission.css"):
        assert (ROOT / path).is_file(), f"{path} is missing"
        assert path in content, f"{path} is not referenced by content.js"
        assert path in resources, f"{path} is not web-accessible"

    assert ".textContent = `" not in content, (
        "shadow CSS belongs in the .css files above, not in a template literal"
    )
    # The mechanism, not just the absence of the old one: <link> inside a shadow
    # root paints the tree unstyled for a frame, and one of these trees covers
    # the whole viewport.
    assert "adoptedStyleSheets" in content

    # The popup reads the same token file, so the two surfaces cannot drift.
    assert "shared.css" in read_text("src/popup.html")


def test_purr_bubble_scales_and_carries_no_hardcoded_chrome():
    """The bubble regressed twice into absolute pixels and a hard stroke.

    Its box is 64/88/116px depending on the size setting (SIZE_MAP), so any
    metric that is not derived from --cat-unit is only correct at one of the
    three. The 3px border and the raw #fff8ef it used to carry are the specific
    shape that drift took last time, hence naming them.
    """
    content = read_text("src/content.js")
    css = read_text("src/float.css")

    start = css.index(".purr-bubble {")
    rule = css[start:css.index("}", start)]

    assert "var(--cat-unit)" in rule, "bubble metrics must scale with the host box"
    assert not re.search(r"^\s*border:", rule, re.M), "the material has no stroke"
    assert "#fff8ef" not in rule, "surface comes from --cup-body in shared.css"
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
        # The shadow roots fetch their stylesheets, so those files have to be
        # reachable from a content script. See test_shadow_css_lives_in_files.
        "src/shared.css",
        "src/float.css",
        "src/intermission.css",
    }
    assert "coffee-meter" in content
    assert "mug-window" in content
    assert "mug-liquid" in content

    # The drain must translate, never scale: the sprite carries its own surface
    # ellipse and crema at a fixed thickness, and scaling squashes both. Scoped
    # to the statement that moves the liquid -- scaleY is legitimate elsewhere
    # (the napping squash, the intermission's coffee rise).
    #
    # intermissionFill is the intermission's own cup, which runs the mechanism
    # backwards: it fills as the break elapses. Named here so the rule covers it
    # too; leaving it out would silently exempt the newest liquid.
    liquid_vars = ("fillElement", "progressFill", "demoFill", "intermissionFill")
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
    assert moves == 4, f"expected one liquid move per surface, found {moves}"

    # All three surfaces read the same generated geometry.
    for source in ("src/content.js", "src/popup.js", "site/script.js"):
        assert "COFFEECAT_MUG" in read_text(source)

    # The persisted shape now has one definition, so this asserts it exists
    # there rather than asserting the same names appear in two hand-kept copies.
    # See test_session_model_has_one_definition.
    settings_module = read_text("src/settings.js")
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
        "focusStats",
    ):
        assert key in settings_module

    assert "coffeecat-intermission-root" in content
    assert "intermission" in content
    assert "coffee-rise" in content
    assert "intermission-stats" in content

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
    # for the intermission's summary line; only the popup readout is gone.
    for element_id in ("stat-sessions", "stat-minutes", "stat-cups"):
        assert f'id="{element_id}"' not in html
    # The stats themselves still accumulate: buildCompletionPatch() increments
    # them, the service worker writes that patch, and the intermission renders
    # the summary line.
    settings_module = read_text("src/settings.js")
    assert "focusStats" in settings_module
    assert settings_module.index("function buildCompletionPatch") < settings_module.index(
        "cupsFinished: stats.cupsFinished + 1"
    )
    assert "buildCompletionPatch" in read_text("src/background.js")
    assert "formatFocusSummary" in content

    for brew_mode in ("espresso", "slow-pour", "cold-brew", "decaf"):
        assert f'data-brew-mode="{brew_mode}"' in html
        assert brew_mode in read_text("src/settings.js")

    assert "brew-option" in html
    assert "selectBrewMode" in popup

    # The intermission is unconditional. It used to hang off a per-mode
    # `breakOnComplete` flag that only Slow Pour set, which meant three of the
    # four modes hit zero and showed nothing at all. Completion now happens in
    # exactly one place (see test_session_completion_has_exactly_one_owner), and
    # that place must start the break outright rather than reintroduce the flag.
    # buildCompletionPatch() in settings.js is where the intermission is opened;
    # src/background.js is its only caller.
    assert "breakRunning: true" in read_text("src/settings.js")
    for source in (popup, content, read_text("src/background.js"), read_text("src/settings.js")):
        assert "breakOnComplete" not in source


def test_brew_modes_match_markup():
    """Guards drift between BREW_MODES and the segmented control markup.

    Replaces earlier assertions that pinned specific detail-element IDs into
    the popup. Those pinned presentation -- including two fields (`ambient`,
    `cat`) that described an ambient-audio system and named cats the extension
    never had. This asserts a real contract instead: the modes the popup can
    render and the modes the markup offers must be the same set.
    """
    settings = read_text("src/settings.js")
    popup = read_text("src/popup.js")
    html = read_text("src/popup.html")

    markup_modes = set(re.findall(r'data-brew-mode="([^"]+)"', html))
    config_modes = set(re.findall(r'^\s*id: "([^"]+)",$', settings, re.MULTILINE))

    assert markup_modes, "no brew modes found in popup.html"
    assert markup_modes == config_modes, (
        f"markup offers {sorted(markup_modes)} but BREW_MODES defines "
        f"{sorted(config_modes)}"
    )

    # Every mode needs both the copy the popup renders and the duration it
    # promises, and the two have to agree. The copy is prose, so this reads the
    # number back out of it rather than trusting that someone updated both.
    for block in re.findall(r"\{[^{}]*?id: \"[^\"]+\"[^{}]*?\}", settings, re.DOTALL):
        mode_id = re.search(r'id: "([^"]+)"', block).group(1)
        duration = re.search(r"durationMs: (\d+) \* 60 \* 1000", block)
        copy = re.search(r'copy: "(\d+) minutes', block)
        assert duration and copy, f"{mode_id} is missing a duration or its copy"
        assert duration.group(1) == copy.group(1), (
            f"{mode_id} runs {duration.group(1)} minutes but its copy says "
            f"{copy.group(1)}"
        )

    # Ambient audio does not exist -- playPurr() is the only sound path.
    # Keep the UI from re-acquiring claims the code cannot back.
    content = read_text("src/content.js")
    assert "ambient" not in (popup + settings).lower()
    for invented in ("misu", "brulee", "cafe hum", "rain sounds"):
        assert invented not in popup.lower(), f"unimplemented claim in popup: {invented}"
        assert invented not in content.lower()
        assert invented not in settings.lower()


def test_static_site_documents_v2_launch():
    index = read_text("site/index.html")
    styles = read_text("site/styles.css")
    script = read_text("site/script.js")

    assert "CoffeeCat" in index
    # The feature is named "Intermission" in site copy. It has been renamed
    # twice: "Gentle Gatekeeper" read as jargon, and "coffee flood" read as
    # damage. The section id is still #gatekeeper, which only anchors deep links.
    assert "Intermission" in index
    assert "../assets/coffeecat-buddy.png" in index
    assert "demo-fill" in index
    assert "requestAnimationFrame" in script
    assert ".intermission-preview" in styles
    assert "siteCoffeeRise" in styles


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
        # Delivery size, not authoring size. See test_sprites_are_cut_to_delivery_size.
        "assets/coffeecat-buddy.png": (200, 257),
        "assets/coffeecat-buddy-large.png": (512, 657),
        "assets/source/coffeecat-buddy-master.png": (890, 1142),
        "assets/icons/icon-16.png": (16, 16),
        "assets/icons/icon-32.png": (32, 32),
        "assets/icons/icon-48.png": (48, 48),
        "assets/icons/icon-128.png": (128, 128),
        **{layer: (256, 256) for layer in MUG_LAYERS},
    }

    for path, expected_size in expected_sizes.items():
        width, height, bit_depth, color_type, *_ = png_header(path)
        assert (width, height) == expected_size, f"{path} is {width}x{height}"
        assert bit_depth == 8
        assert color_type == 6


def test_buddy_sprite_is_reproducible():
    """The shipped sprite must match what the generator produces from the master.

    Same contract as test_mug_assets_are_reproducible: the art is verifiable, so
    a hand-edited PNG fails here instead of shipping. The master lives in
    assets/source/ and is deliberately not packaged.
    """
    with tempfile.TemporaryDirectory() as tmp:
        result = subprocess.run(
            [sys.executable, str(ROOT / "tools" / "render_buddy.py"), tmp],
            check=False,
            capture_output=True,
            text=True,
            cwd=ROOT,
        )
        assert result.returncode == 0, result.stderr or result.stdout

        for name in ("coffeecat-buddy.png", "coffeecat-buddy-large.png"):
            regenerated = Path(tmp) / name
            assert regenerated.is_file(), f"generator did not emit {name}"
            assert png_pixels(regenerated) == png_pixels(ROOT / "assets" / name), (
                f"assets/{name} is stale -- re-run tools/render_buddy.py"
            )


def test_sprites_are_cut_to_delivery_size():
    """The float's art is decoded per tab on every page someone visits.

    The extension used to ship the 890x1142 illustration master and paint it in
    a box at most 116px square, which cost ~4MB of decoded bitmap per tab to
    draw a thumbnail. It also looked worse: the master is continuous-tone, so
    the `image-rendering: pixelated` it was painted under was not preserving a
    pixel grid -- there is none -- it was dropping ~98% of rows and columns and
    keeping whatever landed on the sampling grid.

    Both halves are pinned. Sizes are checked above; this checks that nothing
    re-adds nearest-neighbour sampling or points the float back at the master.
    """
    float_css = read_text("src/float.css")
    declarations = [
        line for line in float_css.splitlines()
        if "image-rendering" in line and not line.lstrip().startswith(("*", "/*"))
    ]
    assert declarations == [], f"nearest-neighbour sampling is back: {declarations}"

    content = read_text("src/content.js")
    assert "coffeecat-buddy.png" in content
    assert "coffeecat-buddy-large.png" not in content, (
        "the large render is the site's hero, not the float's sprite"
    )
    assert "assets/source/" not in content


def test_package_ships_the_extension_and_nothing_else():
    """tools/package.py is an allowlist; this checks it from both directions.

    A denylist fails open -- add assets/scratch/ and it ships silently. The
    allowlist can fail the other way instead: a new file the manifest references
    that nobody added to INCLUDE produces a zip that installs and then breaks at
    runtime, which is the failure the Web Store review will not catch for you.
    """
    sys.path.insert(0, str(ROOT / "tools"))
    try:
        import package
    finally:
        sys.path.pop(0)

    shipped = {str(p.relative_to(ROOT)) for p in package.collect()}

    manifest = read_manifest()
    referenced = set(manifest["icons"].values())
    referenced.update(manifest["action"]["default_icon"].values())
    referenced.add(manifest["action"]["default_popup"])
    referenced.add(manifest["background"]["service_worker"])
    for content_script in manifest["content_scripts"]:
        referenced.update(content_script.get("css", []))
        referenced.update(content_script.get("js", []))
    for group in manifest["web_accessible_resources"]:
        referenced.update(group["resources"])
    referenced.add("manifest.json")

    assert referenced <= shipped, (
        f"manifest references files the package omits: {sorted(referenced - shipped)}"
    )

    # popup.html pulls its stylesheets itself; the manifest never names them.
    for linked in re.findall(r'<link rel="stylesheet" href="([^"]+)"', read_text("src/popup.html")):
        assert f"src/{linked}" in shipped, f"popup.html links {linked}, which is not packaged"
    for script in re.findall(r'<script src="([^"]+)"', read_text("src/popup.html")):
        assert f"src/{script}" in shipped, f"popup.html loads {script}, which is not packaged"

    for excluded in package.EXCLUDED_ON_PURPOSE:
        assert not any(path.startswith(excluded.rstrip("/")) for path in shipped), (
            f"{excluded} is in the package"
        )

    total = sum((ROOT / path).stat().st_size for path in shipped)
    assert total <= package.SIZE_BUDGET_BYTES, (
        f"payload is {total:,} bytes, over the {package.SIZE_BUDGET_BYTES:,} budget"
    )


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
