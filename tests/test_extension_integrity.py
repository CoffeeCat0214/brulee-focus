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
    assert manifest["content_scripts"][0]["js"] == ["src/content.js"]
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


def test_focus_timer_contract_is_wired_without_external_mug_assets():
    manifest = read_manifest()
    content = read_text("src/content.js")
    popup = read_text("src/popup.js")
    html = read_text("src/popup.html")
    resources = {
        resource
        for group in manifest["web_accessible_resources"]
        for resource in group["resources"]
    }

    assert resources == {"assets/coffeecat-buddy.png"}
    assert "assets/mugs/" not in content
    assert "coffee-meter" in content
    assert "coffee-fill" in content
    assert "glass-mug" in content

    for key in ("coffeeDurationMs", "coffeePausedRemainingMs", "coffeeRunning", "coffeeStartedAt"):
        assert key in content
        assert key in popup

    for element_id in ("timer-display", "timer-status", "timer-toggle", "timer-refill"):
        assert f'id="{element_id}"' in html


def test_png_assets_are_valid_rgba():
    expected_sizes = {
        "assets/coffeecat-buddy.png": None,
        "assets/icons/icon-16.png": (16, 16),
        "assets/icons/icon-32.png": (32, 32),
        "assets/icons/icon-48.png": (48, 48),
        "assets/icons/icon-128.png": (128, 128),
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
