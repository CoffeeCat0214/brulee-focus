# CoffeeCat

CoffeeCat is a tiny Chrome extension that puts a pixel coffee cat buddy on the pages you browse.

## Install Locally

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this `CoffeeCat` folder.
5. Visit a normal `http` or `https` page and CoffeeCat will appear near the bottom-right.

## Controls

- Click the CoffeeCat toolbar icon to open settings.
- Toggle CoffeeCat on or off.
- Choose small, medium, or large.
- Drag CoffeeCat to a new spot on the page.
- Click CoffeeCat to sip and purr.
- Use **Focus Coffee** to choose Espresso Shot, Slow Pour, Cold Brew, or Decaf with the brew mode toggles.
- The cup drains as time runs out. Every finished session ends with a 5-minute coffee-flood break, whichever brew you picked.
- Use **Reset position** to return CoffeeCat to the default corner.

## Website

Serve the **repo root** and open `http://localhost:8000/site/`:

```
python3 -m http.server 8000
```

The page reaches back into `../assets` and `../src`, so opening `site/index.html` straight off the filesystem leaves the sprites and the mug geometry 404ing. It uses the same CoffeeCat assets and demonstrates the draining cup and coffee-flood break concept without calling Chrome extension APIs.

Type is [Geist and Geist Mono](https://github.com/vercel/geist-font), vendored as variable `.woff2` under `site/fonts/` and licensed under the SIL OFL (`site/fonts/LICENSE.txt`). They are self-hosted rather than CDN-linked so the site keeps the extension's no-network property.

## Privacy

CoffeeCat has no backend, no analytics, and no account system. It stores only its local extension settings: enabled state, size, page position, timer state, and local focus stats. It does not collect browsing history or page content.

## Notes

Chrome does not allow extensions to freely draw inside the browser's native tab strip, so CoffeeCat appears as a friendly on-page buddy instead.

The Focus Coffee cup updates its liquid level several times per second for a smoother drain. The coffee surface is intentionally subtle so the changing level remains easier to read than the crema highlight.

The coffee flood appears on the current page when Focus Coffee ends, on every brew mode. It is a local, page-level break reminder, not a network blocker. It only draws where the content script runs, so an `http`/`https` tab must be open and CoffeeCat must be enabled.
