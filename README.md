# CoffeeCat

CoffeeCat is a Chrome extension that puts a coffee cat buddy on the pages you browse, with a Focus Coffee timer you read by watching her cup empty.

- **Launching it:** see [LAUNCH.md](LAUNCH.md).
- **Privacy policy:** [site/privacy.html](site/privacy.html).
- **Licence:** MIT, see [LICENSE](LICENSE).

## Install Locally

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this `CoffeeCat` folder.
5. Visit a normal `http` or `https` page and CoffeeCat will appear near the bottom-right.

Chrome 111 or newer. That floor is `color-mix()` in the intermission's stylesheet, and it is declared as `minimum_chrome_version` so older Chromes are never offered the extension.

## Controls

- Click the CoffeeCat toolbar icon to open settings.
- Toggle CoffeeCat on or off.
- Choose small, medium, or large.
- Drag CoffeeCat to a new spot on the page.
- Click CoffeeCat to sip and purr.
- Use **Focus Coffee** to choose Espresso Shot, Slow Pour, Cold Brew, or Decaf with the brew mode toggles.
- The cup drains as time runs out. Every finished session ends in a five-minute intermission, whichever brew you picked.
- During the intermission the cup refills instead. Hit **Refill coffee** when you are ready to set up the next session, or hit **Snooze** (or press `Escape`) to dismiss it without restarting. Leave it alone and it clears itself when the countdown runs out.
- Use **Reset position** to return CoffeeCat to the default corner.

## Privacy

CoffeeCat has no backend, no analytics, no accounts, and makes no network requests. Settings live in `chrome.storage.local`, on your own machine: enabled state, size, page position, timer state, and a local focus tally. It does not read browsing history or page content. The full policy is at [site/privacy.html](site/privacy.html).

It asks for two permissions. `storage` keeps the settings above. `alarms` is what ends a focus session at the right moment even when no page is open.

## Architecture

Four surfaces, one model:

| File | Job |
| --- | --- |
| `src/settings.js` | What a session *is*: defaults, brew table, remaining-time maths. Loaded by all three others. |
| `src/background.js` | The only thing that ends a session. Owns `chrome.alarms`. |
| `src/content.js` | Draws the float and the intermission. Renders; decides nothing. |
| `src/popup.js` | Draws the toolbar popup and handles its actions. |

Session completion belongs to the service worker alone. It used to happen in whichever content script noticed first, which meant every open tab wrote the same completion patch at once, and a browser with no `http`/`https` tab open never ended a session at all. The clock is derived from stored timestamps rather than counted down, so every surface stays correct between alarms without being told anything, and a service worker evicted mid-session costs nothing.

## Building a release

```
python3 tools/package.py
```

Writes `dist/coffeecat-<version>.zip` and prints its SHA-256. The build is an explicit allowlist, not a zip of the repo: the marketing site, the tests, these tools, the illustration master and the archived art are all deliberately out. Builds are deterministic, so the same commit always produces the same bytes.

## Tests

```
python3 tests/test_extension_integrity.py
```

No pytest needed, though it runs under pytest too. Mostly static checks over the sources, plus `tests/session_harness.js`, which runs the real completion logic under JavaScriptCore with mocked Chrome APIs and drives it through duplicate alarm deliveries, lost alarms, pausing, and dragging.

## Art

Both sprites are generated, and both are checked by regenerating and diffing:

```
python3 tools/render_mug.py      # assets/mug/*.png + src/mug-geometry.js
python3 tools/render_buddy.py    # assets/coffeecat-buddy*.png
```

`tools/render_mug.py` is the source of truth for the cup: it emits the four sprite layers *and* the SVG paths the popup and the intermission draw, so the raster and the vector cannot drift.

`tools/render_buddy.py` box-filters `assets/source/coffeecat-buddy-master.png` down to delivery size. Two sizes come out of it: a 200px sprite for the extension, and a 512px render for the site's hero. The extension's is small on purpose: that file is decoded per tab on every page you visit, and the float paints it at most 116px square.

Neither sprite is painted with `image-rendering: pixelated` any more. The master is a continuous-tone illustration, not block pixel art, so nearest-neighbour was not preserving a pixel grid (there is none), it was dropping ~98% of rows and columns and keeping whatever landed on the sampling grid. That gave a stair-stepped outline and whiskers broken into dashes.

## Website

Serve the **repo root** and open `http://localhost:8000/site/`:

```
python3 -m http.server 8000
```

The page reaches back into `../assets` and `../src`, so opening `site/index.html` straight off the filesystem leaves the sprites and the mug geometry 404ing. It uses the same CoffeeCat assets and demonstrates the draining cup and the intermission without calling Chrome extension APIs.

Type is [Geist and Geist Mono](https://github.com/vercel/geist-font), vendored as variable `.woff2` under `site/fonts/` and licensed under the SIL OFL (`site/fonts/LICENSE.txt`). They are self-hosted rather than CDN-linked so the site keeps the extension's no-network property.

## Notes

Chrome does not allow extensions to freely draw inside the browser's native tab strip, so CoffeeCat appears as a friendly on-page buddy instead.

The Focus Coffee cup updates its liquid level several times per second for a smoother drain. The coffee surface is intentionally subtle so the changing level remains easier to read than the crema highlight.

The intermission appears on the current page when Focus Coffee ends, on every brew mode. It is a local, page-level break reminder, not a network blocker. It only draws where the content script runs, so an `http`/`https` tab must be open and CoffeeCat must be enabled. It draws over the page without capturing it: only the intermission panel takes clicks, so the page underneath stays usable for anyone who needs it.

## Styling

`src/shared.css` is the extension's one design layer: tokens plus the controls and cup art that appear on more than one surface. Three places read it, so they cannot drift apart:

- the popup, which links it ahead of `src/popup.css`
- the on-page float, whose shadow root adopts it with `src/float.css`
- the intermission, whose shadow root adopts it with `src/intermission.css`

The shadow roots fetch those files at runtime, which is why they are listed in `web_accessible_resources`. The marketing site under `site/` deliberately keeps its own palette and type: what it shares with the extension is the layer below, the art palette and geometry generated by `tools/render_mug.py`.

## Screenshots

```
python3 tools/shoot_popup.py     # popup, both themes, both panes, 2x
python3 tools/shoot_float.py     # the on-page float at all three sizes
```

Both force the theme in CSS rather than trusting the host, because headless Chrome reports `prefers-color-scheme: dark` by default and an unforced capture is quietly whatever the flags produced. `shoot_popup.py` also shims `chrome.storage`; without it the popup throws and renders its HTML defaults, which looks plausible and is not the UI.
