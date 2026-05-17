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
- Start, pause, and refill the 25-minute Focus Coffee timer.
- Choose small, medium, or large.
- Drag CoffeeCat to a new spot on the page.
- Click CoffeeCat to sip and purr.
- Use **Reset position** to return CoffeeCat to the default corner.

## Focus Coffee

CoffeeCat includes a built-in 25-minute focus timer. Start it from the popup and the tiny coffee meter beside CoffeeCat drains from full to empty while you work. Pause keeps the current coffee level, and Refill resets the timer back to `25:00`.

## Local Checks

Run the extension integrity checks before loading or committing changes:

```bash
python3 -B tests/test_extension_integrity.py
```

## Privacy

CoffeeCat has no backend, no analytics, and no account system. It stores only its local extension settings: enabled state, size, and page position. It does not collect browsing history or page content.

## Notes

Chrome does not allow extensions to freely draw inside the browser's native tab strip, so CoffeeCat appears as a friendly on-page buddy instead.
