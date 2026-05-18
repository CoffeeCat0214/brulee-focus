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
- Use **Focus Coffee** as a Pomodoro-style timer; the cup drains as time runs out.
- Add distracting domains to **Gentle Gatekeeper** so CoffeeCat can cover those pages for a short break when Focus Coffee ends.
- Use **Reset position** to return CoffeeCat to the default corner.

## Website

Open `site/index.html` in a browser to preview the CoffeeCat V2 launch page. It uses the same CoffeeCat assets and demonstrates the draining cup and coffee-flood break concept without calling Chrome extension APIs.

## Privacy

CoffeeCat has no backend, no analytics, and no account system. It stores only its local extension settings: enabled state, size, page position, protected domains, timer state, and local focus stats. It does not collect browsing history or page content.

## Notes

Chrome does not allow extensions to freely draw inside the browser's native tab strip, so CoffeeCat appears as a friendly on-page buddy instead.

The Focus Coffee cup updates its liquid level several times per second for a smoother drain. The coffee surface is intentionally subtle so the changing level remains easier to read than the crema highlight.

Gentle Gatekeeper only appears on domains the user adds. It is a local, page-level break reminder, not a network blocker.
