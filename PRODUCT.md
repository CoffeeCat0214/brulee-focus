# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Anyone who browses the web and wants a friendly, low-pressure companion while they work, read, or take a break. The product is intentionally for anyone: we should all love cats.

## Product Purpose

Brûlée Focus is a local Chrome extension that places a pixel coffee cat on ordinary web pages. It makes focused work feel gentler and more inviting through a Focus Coffee timer: the cup drains with the session, then the cat marks the end with a five-minute intermission. Success means helping people protect attention and take breaks while giving them a small cat to enjoy.

## Positioning

Brûlée Focus is a cat-coded focus companion, not a productivity dashboard. Time is expressed through a cat, a coffee cup, and a quiet on-page presence rather than charts, pressure, or interruption-heavy alerts. Its companionship and focus tools stay together in the browser, and the experience remains local and private.

## Operating Context

Brûlée Focus lives on normal `http` and `https` pages while someone browses. The toolbar popup controls visibility, size, brew mode, and the timer. The cat can be moved around the page, clicked to sip and purr, and returned to its default position. Espresso Shot, Slow Pour, Cold Brew, and Decaf provide different focus durations. When a session ends, a five-minute intermission appears on the current page and can be refilled, dismissed with Escape, or allowed to clear when its countdown ends.

## Capabilities and Constraints

- Chrome extension using Manifest V3.
- The on-page companion runs on ordinary `http` and `https` pages; Chrome does not allow it to draw in the native tab strip.
- Settings, timer state, position, size, and local focus statistics are stored in `chrome.storage.local`, on the user's own machine, through the `storage` permission.
- The `alarms` permission lets a background service worker end a focus session at the right moment even when no page is open. That worker is the only thing that ends a session.
- No backend, analytics, account system, browsing-history collection, or page-content collection. The extension makes no network requests at all.
- The intermission is a local page-level break reminder. It does not block, close, capture, or navigate the page underneath.
- The extension is distributed through the Chrome Web Store, and can also be loaded from source as an unpacked extension. `tools/package.py` builds the upload.
- Chrome 111 or newer, declared as `minimum_chrome_version`.

## Brand Commitments

- Product name: Brûlée Focus.
- Primary character: Crème Brûlée, a pixel coffee cat.
- The product should stay distinctly cat-coded: the cat is a meaningful part of the experience and voice, not decorative branding added around a generic timer.
- Preserve the existing Brûlée Focus, Focus Coffee, brew-mode, and intermission terminology unless the user changes it.
- Keep the tone cozy, playful, and low-pressure while remaining clear about what the extension does.

## Evidence on Hand

- `manifest.json`: Manifest V3 extension metadata, permissions, assets, content-script scope, and the background service worker.
- `README.md`: installation, controls, privacy behavior, and implementation notes.
- `docs/WEBSITE_BRIEF.md`: product messaging, feature requirements, constraints, and site acceptance criteria.
- `src/`: popup, on-page companion, focus timer, and intermission implementation. `settings.js` is the shared session model; `background.js` owns session completion.
- `LAUNCH.md`: the Chrome Web Store submission runbook.
- `assets/`: Brûlée Focus character, mug art, and extension icons.
- `site/`: runnable public website demonstration and local installation guidance.

## Product Principles

- Make focused time feel more human and inviting through companionship.
- Put the cat at the center of the experience, with productivity supporting the cat-coded ritual rather than replacing it.
- Keep attention support gentle, understandable, and under the user's control.
- Stay local and private by default.
- Respect the page and the person's existing browsing context.
