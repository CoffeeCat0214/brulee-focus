import json
import struct
import subprocess
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
    width, height, bit_depth, color_type, *_ = struct.unpack(">IIBBBBB", data[16:29])
    return width, height, bit_depth, color_type


def assert_js_parses(path):
    result = subprocess.run(
        [str(JSC), "--ignoreUncaughtExceptions", str(ROOT / path)],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr or result.stdout


def test_manifest_declares_required_mv3_extension_surfaces():
    manifest = read_manifest()

    assert manifest["manifest_version"] == 3
    assert manifest["action"]["default_popup"] == "src/popup.html"
    assert "storage" in manifest["permissions"]
    assert manifest["content_scripts"][0]["matches"] == ["http://*/*", "https://*/*"]
    assert manifest["content_scripts"][0]["js"] == ["src/content.js"]


def test_manifest_referenced_files_exist():
    manifest = read_manifest()
    referenced = set()

    referenced.update(manifest["icons"].values())
    referenced.update(manifest["action"]["default_icon"].values())
    referenced.add(manifest["action"]["default_popup"])
    for content_script in manifest["content_scripts"]:
        referenced.update(content_script.get("css", []))
        referenced.update(content_script.get("js", []))
    for resource_group in manifest["web_accessible_resources"]:
        referenced.update(resource_group["resources"])

    missing = sorted(path for path in referenced if not (ROOT / path).is_file())
    assert missing == []


def test_web_accessible_assets_match_content_script_usage():
    manifest = read_manifest()
    resources = {
        resource
        for resource_group in manifest["web_accessible_resources"]
        for resource in resource_group["resources"]
    }
    content = read_text("src/content.js")

    for asset in resources:
        assert asset in content or asset == "assets/coffeecat-buddy.png"

    assert "assets/coffeecat-idle.png" in resources
    assert "assets/coffeecat-sip.png" not in resources
    assert not any(resource.startswith("assets/mugs/") for resource in resources)


def test_javascript_files_parse():
    assert JSC.exists(), "JavaScriptCore is required for local JS parse checks"
    assert_js_parses("src/content.js")
    assert_js_parses("src/popup.js")


def test_focus_timer_controls_and_storage_contract_exist():
    popup_html = read_text("src/popup.html")
    popup_js = read_text("src/popup.js")
    content_js = read_text("src/content.js")

    for element_id in (
        "timer-display",
        "timer-status",
        "coffee-progress-fill",
        "timer-toggle",
        "timer-refill",
    ):
        assert f'id="{element_id}"' in popup_html

    for key in (
        "coffeeDurationMs",
        "coffeePausedRemainingMs",
        "coffeeRunning",
        "coffeeStartedAt",
    ):
        assert key in popup_js
        assert key in content_js

    assert "getCoffeeRemaining" in popup_js
    assert "getCoffeeRemaining" in content_js
    assert "coffee-meter-liquid" in content_js
    assert "assets/mugs/" not in content_js


def test_png_assets_are_valid_and_icon_sized():
    expected_sizes = {
        "assets/icons/icon-16.png": (16, 16),
        "assets/icons/icon-32.png": (32, 32),
        "assets/icons/icon-48.png": (48, 48),
        "assets/icons/icon-128.png": (128, 128),
    }

    for path, expected in expected_sizes.items():
        width, height, bit_depth, color_type = png_header(path)
        assert (width, height) == expected
        assert bit_depth == 8
        assert color_type == 6

    for path in ("assets/coffeecat-buddy.png", "assets/coffeecat-idle.png"):
        width, height, bit_depth, color_type = png_header(path)
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
