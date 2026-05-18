# CoffeeCat Website Brief

This document captures the product, messaging, and implementation details needed to build a public website for CoffeeCat.

## Product Summary

CoffeeCat is a tiny Chrome extension that adds a pixel coffee cat buddy to normal web pages. The cat sits on the page while you browse, can be dragged around, purrs when clicked, and includes a Focus Coffee timer where the cup drains as the Pomodoro-style session runs out.

The site should sell CoffeeCat as a cozy, low-pressure browser companion: part desk pet, part focus timer, and intentionally local/private.

## Core Message

Primary positioning:

> A cozy pixel coffee cat for your browser.

Supporting copy:

> CoffeeCat keeps a small companion on the pages you browse, gives you a gentle Focus Coffee timer, and stays local with no backend or analytics.

Good short phrases:

- Pixel coffee cat buddy
- Gentle focus timer
- A tiny companion for browsing
- Local-first and private
- Drag, sip, purr, focus

Avoid claiming:

- Productivity improvement guarantees
- Medical, wellness, or mental health benefits
- Cross-browser support unless implemented
- Store availability unless published

## Current Features

- Chrome extension using Manifest V3.
- On-page CoffeeCat buddy appears on normal `http` and `https` pages.
- Toolbar popup for settings.
- Show/hide toggle.
- Small, medium, and large size options.
- Draggable page position with saved coordinates.
- Reset position control.
- Click interaction that triggers a sip/purr animation and sound.
- Focus Coffee timer in the popup.
- Gentle Gatekeeper domain list in the popup.
- Floating cup next to CoffeeCat mirrors the timer state.
- Coffee liquid drains as time runs out.
- On user-managed protected domains, CoffeeCat can show a coffee-flood break overlay when Focus Coffee ends.
- The break overlay fills the screen upward with semi-transparent coffee, then shows a five-minute countdown, refill action, and one snooze.
- Local stats track sessions completed, minutes protected, and cups finished.
- Coffee fill updates every `250ms` for smoother perceived motion.
- Coffee level uses a bottom-anchored CSS `scaleY(...)` transform with 4-decimal precision.
- Coffee surface highlight is intentionally thin and subtle so the level remains readable.
- Local storage only through `chrome.storage.sync`.
- No backend, no analytics, no account system.

## Visual Direction

The website should feel warm, playful, and focused on the actual extension experience.

Recommended visual assets:

- Use `assets/coffeecat-buddy.png` as a primary character image.
- Show a real browser-page mockup with CoffeeCat sitting near the bottom-right.
- Include a close-up or animated demo of the Focus Coffee cup draining and the page filling with coffee.
- Use the extension icons from `assets/icons/` for favicon/app icon treatments.

Recommended style:

- Pixel-art inspired details, but keep the site readable and modern.
- Warm coffee colors, cream backgrounds, dark brown outlines, and soft pink accents.
- Do not make the site only brown/orange; balance with cream, blush, and a calm dark green or neutral page background.
- Use real screenshots or rendered UI states instead of abstract illustrations.

Hero direction:

- First viewport should immediately show CoffeeCat and the cup, not just text.
- Headline should name the product: `CoffeeCat`.
- Supporting text should explain the browser buddy and Focus Coffee timer.
- Primary call to action should be install-oriented, such as `Load locally` until the extension is published.

## Suggested Website Structure

1. Hero
   - Product name: CoffeeCat.
   - Short value prop: a tiny pixel coffee cat for your browser.
   - Visual: CoffeeCat on a browser-page background with the coffee cup visible.
   - CTA: local install instructions or download link.

2. Focus Coffee
   - Explain the Pomodoro-style timer.
   - Show the draining coffee level.
   - Mention the cup updates smoothly and the timer remains visible.
   - Show the coffee flood takeover as the end-of-session moment.

3. Browser Buddy Features
   - Drag CoffeeCat.
   - Resize CoffeeCat.
   - Click to sip and purr.
   - Reset position.

4. Privacy
   - No backend.
   - No analytics.
   - No accounts.
   - Stores only extension settings such as enabled state, size, position, and timer state.

5. Install Locally
   - Open `chrome://extensions`.
   - Enable Developer mode.
   - Load unpacked.
   - Select the CoffeeCat folder.
   - Visit a normal web page.

6. Technical Notes
   - Chrome extension, Manifest V3.
   - Requires `storage` permission.
   - Runs on `http` and `https` pages.
   - Chrome does not allow free drawing in the native tab strip, so CoffeeCat appears as an on-page buddy.

## Website Interaction Ideas

Recommended interactive demo:

- Build a small mock browser canvas or section where CoffeeCat appears with the coffee cup.
- Add a demo timer state control or automatic loop that drains/refills the cup and previews the coffee flood.
- The demo should use the same visual principle as the extension:
  - cup outline remains fixed
  - liquid is anchored at the bottom
  - liquid height changes via scale/height
  - surface highlight stays thin

Do not make the demo depend on real Chrome extension APIs. It should be a static website simulation of the product behavior.

Current site implementation:

- `site/index.html`
- `site/styles.css`
- `site/script.js`

The site is static and can be opened directly in a browser.

## Copy Blocks

Hero copy:

```text
CoffeeCat
A cozy pixel coffee cat for your browser.

Keep a tiny companion on the pages you browse, start a gentle Focus Coffee timer, and watch the cup drain as time runs out.
```

Focus Coffee copy:

```text
Focus Coffee turns time into a tiny cup of coffee. As your session runs down, the coffee level drains smoothly, giving you a quick visual sense of how much focus time is left.
```

Privacy copy:

```text
CoffeeCat stays local. There is no backend, no analytics, and no account system. The extension stores only its settings, like whether it is enabled, where it sits, and the current timer state.
```

Install copy:

```text
CoffeeCat is currently loaded as an unpacked Chrome extension. Open Chrome extensions, enable Developer mode, choose Load unpacked, and select the CoffeeCat folder.
```

## Implementation Notes For The Website

- Keep the website separate from the extension source unless intentionally adding a site app.
- If building in this repo, put website files under a clear directory such as `site/`.
- Reuse the existing PNG assets instead of recreating the character.
- The site can simulate the coffee fill and flood with CSS:
  - a fixed cup container
  - a bottom-anchored fill element
  - `transform-origin: center bottom`
  - `transform: scaleY(progress)`
  - a subtle 1px surface highlight
  - a full-viewport coffee layer using `transform-origin: bottom`
  - a semi-transparent brown fill so the page remains visible underneath
- For a live demo, update visual progress with `requestAnimationFrame` or a short interval; do not involve the Chrome extension storage APIs.

## Acceptance Criteria For A First Website Version

- The first screen clearly shows CoffeeCat, the cup, and the product name.
- The site explains what the extension does in under 10 seconds.
- The Focus Coffee draining behavior and coffee-flood break moment are visible or demonstrated.
- Privacy claims match the current extension implementation.
- Local install instructions are accurate.
- The design uses actual CoffeeCat assets.
- The site works on mobile and desktop without overlapping text or clipped controls.
