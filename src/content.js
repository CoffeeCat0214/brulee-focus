(function coffeeCatContent() {
  const ROOT_ID = "coffeecat-root";
  const BREAK_ROOT_ID = "coffeecat-break-root";
  const FOCUS_DURATION_MS = 25 * 60 * 1000;
  const BREAK_DURATION_MS = 5 * 60 * 1000;
  const COFFEE_RENDER_INTERVAL_MS = 250;
  const DEFAULT_SETTINGS = {
    enabled: true,
    size: "medium",
    position: null,
    coffeeDurationMs: FOCUS_DURATION_MS,
    coffeePausedRemainingMs: FOCUS_DURATION_MS,
    coffeeBrewMode: "espresso",
    coffeeBrewLabel: "Espresso Shot",
    coffeeRunning: false,
    coffeeStartedAt: null,
    coffeeSessionId: null,
    completedCoffeeSessionId: null,
    breakRunning: false,
    breakStartedAt: null,
    breakDurationMs: BREAK_DURATION_MS,
    snoozeUsedForSession: false,
    snoozeSessionRunning: false,
    focusStats: {
      sessionsCompleted: 0,
      minutesProtected: 0,
      cupsFinished: 0
    }
  };

  // Modes differ by duration only. The coffee flood used to be per-mode, which
  // meant three of the four modes ended in silence -- the timer expired and
  // nothing on screen said so. Every finished session floods now, so the flag
  // that used to gate it is gone rather than set to true four times.
  const BREW_MODES = {
    espresso: {
      id: "espresso",
      label: "Espresso Shot",
      durationMs: 25 * 60 * 1000
    },
    "slow-pour": {
      id: "slow-pour",
      label: "Slow Pour",
      durationMs: 45 * 60 * 1000
    },
    "cold-brew": {
      id: "cold-brew",
      label: "Cold Brew",
      durationMs: 90 * 60 * 1000
    },
    decaf: {
      id: "decaf",
      label: "Decaf",
      durationMs: 15 * 60 * 1000
    }
  };
  const DEFAULT_BREW_MODE = BREW_MODES.espresso;

  const SIZE_MAP = {
    small: 64,
    medium: 88,
    large: 116
  };

  // Covers the purr bubble's gap and tail, which sit outside its own box.
  const BUBBLE_EDGE_SLACK_PX = 8;

  // Emitted by tools/render_mug.py and loaded as a content script ahead of this
  // one (see manifest). It is the single source of truth for where the liquid
  // sits inside the glass and how far it travels -- the popup and the marketing
  // site read the same object, which is what stops the three surfaces drifting
  // into three different cups again.
  const { FILL_WINDOW, DRAIN_RANGE } = globalThis.COFFEECAT_MUG;

  let settings = { ...DEFAULT_SETTINGS };
  let root = null;
  let breakRoot = null;
  let breakShadow = null;
  let shadow = null;
  let cat = null;
  let dragState = null;
  let moodTimer = null;
  let coffeeTimer = null;
  let breakTimer = null;
  let audioContext = null;

  init();

  async function init() {
    if (!hasExtensionContext()) {
      removeExistingRoot();
      return;
    }

    settings = await loadSettings();
    if (settings.enabled) {
      mount();
    }

    watchSettings();
  }

  function loadSettings() {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
          try {
            if (getRuntimeLastError()) {
              resolve(DEFAULT_SETTINGS);
              return;
            }

            resolve(normalizeSettings({
              ...DEFAULT_SETTINGS,
              ...stored,
              size: SIZE_MAP[stored.size] ? stored.size : DEFAULT_SETTINGS.size
            }));
          } catch {
            handleInvalidatedContext();
            resolve(DEFAULT_SETTINGS);
          }
        });
      } catch {
        handleInvalidatedContext();
        resolve(DEFAULT_SETTINGS);
      }
    });
  }

  function mount() {
    removeExistingRoot();

    root = document.createElement("div");
    root.id = ROOT_ID;
    shadow = root.attachShadow({ mode: "closed" });
    shadow.append(buildStyles(), buildCat());
    document.documentElement.appendChild(root);

    applySettings();
    startCoffeeTimer();
    scheduleMood();
  }

  function removeExistingRoot() {
    document.getElementById(ROOT_ID)?.remove();
    document.getElementById(BREAK_ROOT_ID)?.remove();
  }

  function watchSettings() {
    try {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        try {
          if (areaName !== "sync") return;

          settings = normalizeSettings({
            ...settings,
            ...Object.fromEntries(
              Object.entries(changes).map(([key, change]) => [key, change.newValue])
            ),
            size: SIZE_MAP[changes.size?.newValue ?? settings.size]
              ? changes.size?.newValue ?? settings.size
              : DEFAULT_SETTINGS.size
          });

          if (!settings.enabled) {
            unmount();
            return;
          }

          if (!root) mount();
          applySettings();
          renderBreakOverlay();
        } catch {
          handleInvalidatedContext();
        }
      });
    } catch {
      handleInvalidatedContext();
    }
  }

  function hasExtensionContext() {
    try {
      return Boolean(chrome?.runtime?.id && chrome?.storage?.sync);
    } catch {
      return false;
    }
  }

  function getExtensionUrl(path) {
    try {
      return chrome.runtime.getURL(path);
    } catch {
      handleInvalidatedContext();
      return "";
    }
  }

  function saveSettings(nextSettings) {
    try {
      chrome.storage.sync.set(nextSettings);
    } catch {
      handleInvalidatedContext();
    }
  }

  function getRuntimeLastError() {
    try {
      return chrome.runtime.lastError;
    } catch {
      handleInvalidatedContext();
      return null;
    }
  }

  function handleInvalidatedContext() {
    unmount();
    removeExistingRoot();
  }

  function unmount() {
    window.clearTimeout(moodTimer);
    moodTimer = null;
    window.clearInterval(coffeeTimer);
    coffeeTimer = null;
    window.clearInterval(breakTimer);
    breakTimer = null;
    dragState = null;

    if (root) {
      root.remove();
    }
    if (breakRoot) {
      breakRoot.remove();
    }

    root = null;
    breakRoot = null;
    breakShadow = null;
    shadow = null;
    cat = null;
  }

  function buildCat() {
    cat = document.createElement("button");
    cat.className = "coffee-cat";
    cat.type = "button";
    // No `title`: the native tooltip fades in over the same spot the purr
    // bubble occupies, in the host OS's styling rather than ours. aria-label
    // already gives the button its accessible name.
    cat.setAttribute("aria-label", "CoffeeCat browser buddy");
    const buddyImage = getExtensionUrl("assets/coffeecat-buddy.png");
    const mugBack = getExtensionUrl("assets/mug/mug-back.png");
    const mugFill = getExtensionUrl("assets/mug/mug-fill.png");
    const mugFront = getExtensionUrl("assets/mug/mug-front.png");
    const mugSteam = getExtensionUrl("assets/mug/mug-steam.png");

    // Layer order matters: the liquid sits between the vessel's far wall and
    // its near wall, which is what makes it read as being *inside* the glass
    // rather than painted on top of it.
    cat.innerHTML = `
      <img class="cat-art" src="${buddyImage}" alt="">
      <span class="coffee-meter" aria-hidden="true">
        <img class="mug-layer mug-back" src="${mugBack}" alt="">
        <span class="mug-window">
          <img class="mug-liquid" src="${mugFill}" alt="">
        </span>
        <img class="mug-layer mug-front" src="${mugFront}" alt="">
        <img class="mug-steam steam-a" src="${mugSteam}" alt="">
        <img class="mug-steam steam-b" src="${mugSteam}" alt="">
      </span>
      <span class="purr-bubble" aria-hidden="true">prr</span>
    `;

    cat.addEventListener("pointerdown", startDrag);
    cat.addEventListener("click", sipAndPurr);
    return cat;
  }

  function buildStyles() {
    const style = document.createElement("style");
    style.textContent = `
      :host {
        all: initial;
      }

      .coffee-cat {
        /* Sampled from the buddy art itself (see tools/render_mug.py). The
           previous set declared six tokens, used one, and hardcoded every mug
           colour to hex that had drifted away from the illustration -- notably
           a flat brown edge where the cat's is actually plum. */
        --cat-edge: #470928;
        --cat-edge-a: 71, 9, 40;
        --cat-cream: #fce0c1;
        --cat-fur: #e89c65;

        /* Fallback only. applySettings() overwrites this on the host element
           with size / SIZE_MAP.medium, and it inherits through the shadow
           boundary -- the "all: initial" above does not touch custom properties.
           Declaring it here means a failure to inherit degrades to medium
           sizing rather than invalidating every calc() that reads it. */
        --cat-unit: 1;

        /* Borrowed verbatim from popup.css, which is already built on the HIG:
           system-ui resolves to SF on macOS (SF Pro itself is not
           bundleable), and the curve is Apple's standard ease. */
        --bubble-font: system-ui, -apple-system, "Segoe UI Variable Text", "Segoe UI", sans-serif;
        --bubble-ease: cubic-bezier(0.32, 0.72, 0, 1);
        --bubble-surface: #fffdf9;
        --bubble-label: #241812;
        --bubble-shadow-a: 36, 24, 18;
        appearance: none;
        position: relative;
        display: block;
        width: 100%;
        height: 100%;
        padding: 0;
        border: 0;
        background: transparent;
        cursor: grab;
        image-rendering: pixelated;
        transform-origin: center bottom;
        animation: bob 4.8s steps(2, end) infinite;
        transition: transform 160ms ease, filter 160ms ease;
      }

      /* Follows the OS appearance, not the host page's -- a content script has
         no reliable read on an arbitrary site's theme. The sprite itself stays
         cream-and-orange either way. */
      @media (prefers-color-scheme: dark) {
        .coffee-cat {
          --bubble-surface: #2a2724;
          --bubble-label: #f5efe7;
          --bubble-shadow-a: 0, 0, 0;
        }
      }

      .coffee-cat:active {
        cursor: grabbing;
      }

      .coffee-cat:hover {
        filter: drop-shadow(0 0 12px rgba(255, 186, 73, 0.55));
      }

      .cat-art {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: contain;
        pointer-events: none;
        image-rendering: pixelated;
        filter:
          drop-shadow(0 8px 0 rgba(var(--cat-edge-a), 0.12))
          drop-shadow(0 10px 18px rgba(var(--cat-edge-a), 0.22));
        transform-origin: center bottom;
      }

      .coffee-cat.is-sipping .cat-art {
        animation: sip 650ms steps(2, end);
      }

      .coffee-cat.is-purring .cat-art {
        animation: purr 90ms steps(2, end) infinite;
      }

      .coffee-cat.is-napping .cat-art {
        transform: translateY(2px) scaleY(0.98);
        filter:
          drop-shadow(0 8px 0 rgba(var(--cat-edge-a), 0.12))
          drop-shadow(0 10px 18px rgba(var(--cat-edge-a), 0.18))
          saturate(0.92);
      }

      /* The mug is four sprite layers rendered by tools/render_mug.py, all on
         the same square canvas at the same origin, so they register by simply
         being stacked. Geometry numbers come from the generator -- never
         hand-tune them here or the clip window drifts off the glass. */
      .coffee-meter {
        position: absolute;
        right: -6%;
        bottom: 1%;
        z-index: 3;
        width: 44%;
        height: 44%;
        pointer-events: none;
      }

      .mug-layer,
      .mug-liquid,
      .mug-steam {
        position: absolute;
        display: block;
        pointer-events: none;
        /* Same nearest-neighbour downscale the cat gets. This is what puts the
           two objects in the same medium: identical sampling, identical
           aliasing character at every size. */
        image-rendering: pixelated;
      }

      .mug-layer {
        inset: 0;
        width: 100%;
        height: 100%;
      }

      .mug-window {
        position: absolute;
        left: ${FILL_WINDOW.x}%;
        top: ${FILL_WINDOW.y}%;
        width: ${FILL_WINDOW.width}%;
        height: ${FILL_WINDOW.height}%;
        overflow: hidden;
        /* The cavity floor is a half-ellipse and the liquid column is a
           straight rectangle, so the rounded bottom has to come from the clip,
           which stays put while the column slides through it. */
        border-radius: 0 0 50% 50% / 0 0 ${FILL_WINDOW.bottomRadius}% ${FILL_WINDOW.bottomRadius}%;
      }

      .mug-liquid {
        /* Drawn on the full mug canvas, so it is sized back up to the meter box
           and offset to cancel the window's own inset. That keeps it in
           register with the vessel at every fill level. */
        width: ${(10000 / FILL_WINDOW.width).toFixed(4)}%;
        height: ${(10000 / FILL_WINDOW.height).toFixed(4)}%;
        left: ${(-FILL_WINDOW.x * 100 / FILL_WINDOW.width).toFixed(4)}%;
        top: ${(-FILL_WINDOW.y * 100 / FILL_WINDOW.height).toFixed(4)}%;
        transform: translateY(0);
        transition: transform 220ms linear, opacity 180ms ease;
      }

      .mug-steam {
        width: 30%;
        height: 44%;
        bottom: 72%;
        opacity: 0;
        animation: steam 3.4s ease-out infinite;
      }

      .steam-a {
        left: 24%;
      }

      .steam-b {
        left: 40%;
        animation-delay: 1400ms;
        animation-duration: 3.9s;
      }

      /* "animation: none", not "animation-play-state: paused". A paused
         animation still applies its current keyframe, and the keyframes drive
         opacity -- so pausing would freeze the wisp visible over the rim
         instead of hiding it. Removing the animation lets the base opacity
         below actually win. */
      .coffee-meter.is-paused .mug-steam,
      .coffee-meter.is-empty .mug-steam {
        animation: none;
        opacity: 0;
      }

      .coffee-meter.is-empty .mug-liquid {
        opacity: 0.35;
      }

      .coffee-meter.is-paused {
        opacity: 0.82;
      }

      /* The sprite fills its box edge to edge -- head top at ~2%, mug at the
         bottom right -- so there is no interior space for a bubble. It lives
         entirely above the host box and points back down into the notch
         between the ears. Centred, so a ~30px bubble inside an 88px box
         overflows on no horizontal edge; only the top needs handling, which
         sipAndPurr() does with .bubble-below.

         Every metric is scaled by --cat-unit. Absolute pixels would only be
         correct at one of the three SIZE_MAP sizes. */
      .purr-bubble {
        position: absolute;
        left: 50%;
        bottom: 100%;
        z-index: 4;
        margin-bottom: calc(4px * var(--cat-unit));
        padding: calc(4px * var(--cat-unit)) calc(8px * var(--cat-unit));
        border-radius: calc(8px * var(--cat-unit));
        background: var(--bubble-surface);
        color: var(--bubble-label);
        /* Everything else scales freely, but type has a legibility floor:
           unclamped, the small cat would set this at 8px. */
        font: 600 max(9px, calc(11px * var(--cat-unit)))/1.2 var(--bubble-font);
        letter-spacing: 0.01em;
        white-space: nowrap;
        -webkit-font-smoothing: antialiased;
        /* One filter over the element *and* its ::before tail, so the two cast
           a single continuous shadow: filter resolves against the composited
           subtree, whereas a box-shadow on each part leaves a visible seam
           along the joint where the two shadows overlap. The third, tight
           drop-shadow stands in for a hairline border -- an actual border
           would be drawn on the body only and stop dead at the tail. */
        filter:
          drop-shadow(0 calc(1px * var(--cat-unit)) calc(2px * var(--cat-unit)) rgba(var(--bubble-shadow-a), 0.16))
          drop-shadow(0 calc(5px * var(--cat-unit)) calc(12px * var(--cat-unit)) rgba(var(--bubble-shadow-a), 0.16))
          drop-shadow(0 0 0.5px rgba(var(--bubble-shadow-a), 0.16));
        opacity: 0;
        transform: translateX(-50%) translateY(calc(2px * var(--cat-unit))) scale(0.92);
        transform-origin: bottom center;
        /* Dismissal is quicker than arrival, per the platform convention;
           .is-purring below overrides the duration on the way in. */
        transition: opacity 160ms var(--bubble-ease), transform 160ms var(--bubble-ease);
      }

      /* Clipped triangle rather than the usual 45deg-rotated square: a square
         can only ever produce a 90deg tip, which at this size hangs off the
         bubble like a drip. Decoupling width from height gives the shallow,
         wide tail the platform actually uses. Same fill, no shadow of its own
         -- the parent's filter covers it. */
      .purr-bubble::before {
        content: "";
        position: absolute;
        left: 50%;
        top: 100%;
        width: calc(11px * var(--cat-unit));
        height: calc(5px * var(--cat-unit));
        background: var(--bubble-surface);
        /* Overlaps the body's rounded bottom edge by a hair so the join is
           solid rather than pinched. */
        margin-top: -1px;
        clip-path: polygon(0 0, 100% 0, 50% 100%);
        transform: translateX(-50%);
      }

      .coffee-cat.is-purring .purr-bubble {
        opacity: 1;
        transform: translateX(-50%) translateY(0) scale(1);
        transition-duration: 260ms;
      }

      /* Flipped under the cat when it is parked too near the top of the
         viewport. Must stay after the .is-purring rule above: both are three
         classes deep, so source order settles it. */
      .coffee-cat.bubble-below .purr-bubble {
        top: 100%;
        bottom: auto;
        margin-top: calc(4px * var(--cat-unit));
        margin-bottom: 0;
        transform: translateX(-50%) translateY(calc(-2px * var(--cat-unit))) scale(0.92);
        transform-origin: top center;
      }

      .coffee-cat.bubble-below .purr-bubble::before {
        top: auto;
        bottom: 100%;
        margin-top: 0;
        margin-bottom: -1px;
        clip-path: polygon(50% 0, 100% 100%, 0 100%);
      }

      .coffee-cat.bubble-below.is-purring .purr-bubble {
        transform: translateX(-50%) translateY(0) scale(1);
      }

      @keyframes bob {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-3px); }
      }

      @keyframes sip {
        0%, 100% { transform: rotate(0deg); }
        45%, 65% { transform: rotate(-4deg) translateY(-3px); }
      }

      @keyframes purr {
        0%, 100% { transform: translateX(0); }
        50% { transform: translateX(1px); }
      }

      @keyframes steam {
        0% { transform: translateY(12%) scaleX(0.85); opacity: 0; }
        25% { opacity: 0.75; }
        100% { transform: translateY(-34%) scaleX(1.15); opacity: 0; }
      }

      @media (prefers-reduced-motion: reduce) {
        .coffee-cat,
        .cat-art,
        .coffee-cat.is-purring .cat-art,
        .mug-steam {
          animation: none;
        }

        /* The steam sprite is only ever visible mid-animation, so killing the
           animation has to also hide it -- otherwise it freezes on frame zero
           as a static smudge over the rim. */
        .mug-steam {
          opacity: 0;
        }

        /* The drain is information, not decoration: it still moves, just
           without the easing. */
        .mug-liquid {
          transition: none;
        }

        /* The bubble still has to appear -- it is the feedback for the click,
           not decoration -- it just must not travel or scale. Each selector
           here matches its counterpart above at equal specificity and wins on
           source order, which is why the flipped variants are spelled out
           rather than folded into one. */
        .purr-bubble,
        .coffee-cat.is-purring .purr-bubble,
        .coffee-cat.bubble-below .purr-bubble,
        .coffee-cat.bubble-below.is-purring .purr-bubble {
          transform: translateX(-50%);
          transition: opacity 100ms linear;
        }
      }
    `;
    return style;
  }

  function applySettings() {
    if (!root) return;

    const size = SIZE_MAP[settings.size] || SIZE_MAP.medium;
    root.style.width = `${size}px`;
    root.style.height = `${size}px`;
    // Every purr-bubble metric is calc()'d off this. SIZE_MAP is already the
    // one place a size setting becomes pixels, so the multiplier is derived
    // here too -- computing it anywhere else gives the bubble a second source
    // of truth that can drift out of step with the box it hangs off.
    root.style.setProperty("--cat-unit", (size / SIZE_MAP.medium).toFixed(4));

    if (settings.position && Number.isFinite(settings.position.x) && Number.isFinite(settings.position.y)) {
      moveTo(settings.position.x, settings.position.y);
    } else {
      root.style.left = "auto";
      root.style.top = "auto";
      root.style.right = "24px";
      root.style.bottom = "24px";
    }

    updateCoffeeMeter();
    renderBreakOverlay();
  }

  function startCoffeeTimer() {
    window.clearInterval(coffeeTimer);
    updateCoffeeMeter();
    coffeeTimer = window.setInterval(updateCoffeeMeter, COFFEE_RENDER_INTERVAL_MS);
  }

  // Ending the session and painting the cup are two different jobs. They used
  // to share one early return on the meter's DOM: if the mug nodes were missing
  // the tick bailed before completeFocusSession(), so a paint problem turned
  // into "the timer never ended and the flood never came". Expiry is state, so
  // it is settled first and unconditionally; only the drawing is guarded.
  function updateCoffeeMeter() {
    const duration = getValidDuration(settings.coffeeDurationMs);
    const remaining = getCoffeeRemaining(settings);

    if (settings.coffeeRunning && remaining <= 0) {
      completeFocusSession();
    }

    renderBreakOverlay();
    paintCoffeeMeter(remaining, duration);
  }

  function paintCoffeeMeter(remaining, duration) {
    const meter = cat?.querySelector(".coffee-meter");
    const fillElement = cat?.querySelector(".mug-liquid");
    if (!meter || !fillElement) return;

    const fill = Math.max(0, Math.min(1, remaining / duration));

    // Translate, never scale. The liquid sprite carries its own crema band and
    // meniscus at a fixed thickness; scaling the layer squashes both as the cup
    // drains, which is what the old scaleY() did here. Sliding a full-height
    // column behind a fixed clip window keeps the surface identical at every
    // level. popup.js does the same thing for the same reason.
    fillElement.style.transform = `translateY(${((1 - fill) * DRAIN_RANGE).toFixed(4)}%)`;
    meter.classList.toggle("is-empty", remaining <= 0);
    meter.classList.toggle("is-paused", !settings.coffeeRunning);
  }

  function completeFocusSession() {
    if (!settings.coffeeSessionId || settings.completedCoffeeSessionId === settings.coffeeSessionId) {
      return;
    }

    const duration = getValidDuration(settings.coffeeDurationMs);
    const nextStats = settings.snoozeSessionRunning
      ? settings.focusStats
      : {
          sessionsCompleted: settings.focusStats.sessionsCompleted + 1,
          minutesProtected: settings.focusStats.minutesProtected + Math.round(duration / 60000),
          cupsFinished: settings.focusStats.cupsFinished + 1
        };

    settings = {
      ...settings,
      coffeeRunning: false,
      coffeeStartedAt: null,
      coffeePausedRemainingMs: 0,
      completedCoffeeSessionId: settings.coffeeSessionId,
      breakRunning: true,
      breakStartedAt: Date.now(),
      snoozeSessionRunning: false,
      focusStats: nextStats
    };

    saveSettings({
      coffeeRunning: false,
      coffeeStartedAt: null,
      coffeePausedRemainingMs: 0,
      completedCoffeeSessionId: settings.coffeeSessionId,
      breakRunning: true,
      breakStartedAt: settings.breakStartedAt,
      snoozeSessionRunning: false,
      focusStats: nextStats
    });
  }

  function renderBreakOverlay() {
    const shouldShow = settings.enabled && settings.breakRunning;
    if (!shouldShow) {
      removeBreakOverlay();
      return;
    }

    if (!breakRoot) {
      breakRoot = document.createElement("div");
      breakRoot.id = BREAK_ROOT_ID;
      breakShadow = breakRoot.attachShadow({ mode: "closed" });
      breakShadow.append(buildBreakStyles(), buildBreakOverlay());
      document.documentElement.appendChild(breakRoot);
    }

    updateBreakOverlay();
    window.clearInterval(breakTimer);
    breakTimer = window.setInterval(updateBreakOverlay, 1000);
  }

  function removeBreakOverlay() {
    window.clearInterval(breakTimer);
    breakTimer = null;
    if (breakRoot) {
      breakRoot.remove();
    }
    breakRoot = null;
    breakShadow = null;
  }

  function buildBreakOverlay() {
    const overlay = document.createElement("section");
    overlay.className = "break-overlay";
    overlay.setAttribute("aria-label", "CoffeeCat break reminder");
    const buddyImage = getExtensionUrl("assets/coffeecat-buddy.png");
    overlay.innerHTML = `
      <div class="coffee-flood" aria-hidden="true">
        <span class="coffee-wave wave-a"></span>
        <span class="coffee-wave wave-b"></span>
      </div>
      <div class="break-panel">
        <img class="break-cat" src="${buddyImage}" alt="">
        <div class="break-copy">
          <p class="break-kicker">CoffeeCat coffee flood</p>
          <h1>Coffee's gone. Tiny break.</h1>
          <p class="break-message">The coffee is taking over this page while you refill yourself first.</p>
          <strong class="break-countdown" id="break-countdown">5:00</strong>
        </div>
        <div class="break-actions">
          <button id="break-start" type="button">Start break</button>
          <button id="break-refill" type="button">Refill coffee</button>
          <button id="break-snooze" type="button">Snooze once</button>
        </div>
        <div class="flood-stats" id="flood-stats">
          <span>CoffeeCat protected</span>
          <strong id="share-minutes">0 focus minutes</strong>
          <small id="share-cups">0 cups finished</small>
        </div>
      </div>
    `;

    overlay.querySelector("#break-start")?.addEventListener("click", startBreakNow);
    overlay.querySelector("#break-refill")?.addEventListener("click", refillCoffeeFromBreak);
    overlay.querySelector("#break-snooze")?.addEventListener("click", snoozeBreak);
    return overlay;
  }

  function buildBreakStyles() {
    const style = document.createElement("style");
    style.textContent = `
      :host {
        all: initial;
      }

      .break-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: grid;
        place-items: center;
        padding: 28px;
        overflow: hidden;
        background: rgba(36, 24, 18, 0.18);
        color: #241812;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-sizing: border-box;
      }

      .coffee-flood {
        position: absolute;
        inset: 0;
        z-index: 0;
        overflow: hidden;
        background:
          linear-gradient(rgba(123, 62, 25, 0.22), rgba(55, 24, 12, 0.72)),
          rgba(79, 36, 16, 0.72);
        transform: scaleY(0);
        transform-origin: center bottom;
        animation: coffeeFloodRise 1400ms cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
        backdrop-filter: sepia(0.38) saturate(0.95);
      }

      .coffee-flood::before {
        content: "";
        position: absolute;
        left: -8%;
        right: -8%;
        top: -18px;
        height: 42px;
        border-radius: 50%;
        background:
          radial-gradient(ellipse at 20% 50%, rgba(255, 190, 116, 0.38), transparent 34%),
          radial-gradient(ellipse at 70% 48%, rgba(255, 226, 184, 0.24), transparent 30%),
          rgba(94, 44, 18, 0.92);
        box-shadow: 0 8px 24px rgba(43, 19, 10, 0.28);
      }

      .coffee-wave {
        position: absolute;
        left: -20%;
        right: -20%;
        top: -20px;
        height: 38px;
        border-radius: 50%;
        background: rgba(255, 190, 116, 0.2);
        animation: coffeeWave 2200ms ease-in-out infinite alternate;
      }

      .wave-b {
        top: -8px;
        opacity: 0.55;
        animation-delay: 500ms;
        animation-duration: 2800ms;
      }

      .break-panel {
        width: min(520px, calc(100vw - 56px));
        display: grid;
        gap: 18px;
        justify-items: center;
        padding: 26px;
        border: 4px solid #4a2b1d;
        border-radius: 14px;
        background: rgba(255, 253, 248, 0.94);
        box-shadow: 0 14px 0 rgba(74, 43, 29, 0.18), 0 24px 54px rgba(36, 24, 18, 0.32);
        text-align: center;
        z-index: 2;
        opacity: 0;
        transform: translateY(18px);
        animation: breakPanelAppear 360ms ease forwards;
        animation-delay: 1050ms;
      }

      .break-cat {
        width: 156px;
        height: 156px;
        object-fit: contain;
        image-rendering: pixelated;
        filter: drop-shadow(0 12px 0 rgba(74, 43, 29, 0.12));
      }

      .break-copy {
        display: grid;
        gap: 8px;
      }

      .break-kicker,
      .break-message,
      .flood-stats span,
      .flood-stats small {
        margin: 0;
        color: #6f594d;
        font-size: 14px;
        line-height: 1.4;
      }

      h1 {
        margin: 0;
        color: #4a2b1d;
        font-size: 30px;
        line-height: 1.05;
        letter-spacing: 0;
      }

      .break-countdown {
        color: #4a2b1d;
        font-size: 46px;
        line-height: 1;
        font-variant-numeric: tabular-nums;
      }

      .break-actions {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
        width: 100%;
      }

      button {
        min-height: 42px;
        border: 3px solid #4a2b1d;
        border-radius: 8px;
        background: #4a2b1d;
        color: #fff8ef;
        cursor: pointer;
        font: 800 13px/1.1 Inter, ui-sans-serif, system-ui, sans-serif;
      }

      button:nth-child(2),
      button:nth-child(3) {
        background: #fff8ef;
        color: #4a2b1d;
      }

      button:disabled {
        cursor: not-allowed;
        opacity: 0.5;
      }

      .flood-stats {
        width: min(300px, 100%);
        display: grid;
        gap: 5px;
        padding: 14px;
        border: 3px solid #4a2b1d;
        border-radius: 10px;
        background: linear-gradient(135deg, #fff8ef, #ffe2b8);
        box-sizing: border-box;
      }

      .flood-stats strong {
        color: #4a2b1d;
        font-size: 20px;
      }

      @keyframes coffeeFloodRise {
        0% { transform: scaleY(0); }
        100% { transform: scaleY(1); }
      }

      @keyframes coffeeWave {
        0% { transform: translateX(-24px) scaleX(1.04); }
        100% { transform: translateX(24px) scaleX(0.96); }
      }

      @keyframes breakPanelAppear {
        100% {
          opacity: 1;
          transform: translateY(0);
        }
      }

      /* Both the flood and the panel rest in an invisible state -- scaleY(0)
         and opacity 0 -- and are only made visible by their animations. So
         "animation: none" alone hides the break entirely instead of calming
         it. Every rule here has to restore the end state by hand. site's
         styles.css solves the same trap the same way. */
      @media (prefers-reduced-motion: reduce) {
        .coffee-flood {
          animation: none;
          transform: scaleY(1);
        }

        .coffee-wave {
          animation: none;
        }

        .break-panel {
          animation: none;
          opacity: 1;
          transform: none;
        }
      }

      @media (max-width: 480px) {
        .break-panel {
          padding: 20px;
        }

        .break-actions {
          grid-template-columns: 1fr;
        }

        h1 {
          font-size: 25px;
        }
      }
    `;
    return style;
  }

  function updateBreakOverlay() {
    if (!breakShadow || !settings.breakRunning) return;

    const remaining = getBreakRemaining(settings);
    const countdown = breakShadow.querySelector("#break-countdown");
    const snoozeButton = breakShadow.querySelector("#break-snooze");
    const shareMinutes = breakShadow.querySelector("#share-minutes");
    const shareCups = breakShadow.querySelector("#share-cups");

    if (remaining <= 0) {
      endBreak();
      return;
    }

    if (countdown) countdown.textContent = formatTime(remaining);
    if (snoozeButton) snoozeButton.disabled = Boolean(settings.snoozeUsedForSession);
    if (shareMinutes) shareMinutes.textContent = `${settings.focusStats.minutesProtected} focus minutes`;
    if (shareCups) shareCups.textContent = `${settings.focusStats.cupsFinished} cups finished`;
  }

  function startBreakNow() {
    const startedAt = Number.isFinite(settings.breakStartedAt) ? settings.breakStartedAt : Date.now();
    settings = {
      ...settings,
      breakStartedAt: startedAt
    };
    saveSettings({ breakStartedAt: startedAt });
    updateBreakOverlay();
  }

  function refillCoffeeFromBreak() {
    const activeMode = getBrewMode(settings.coffeeBrewMode);
    const duration = activeMode.durationMs;
    settings = {
      ...settings,
      coffeeRunning: false,
      coffeeStartedAt: null,
      coffeePausedRemainingMs: duration,
      coffeeDurationMs: duration,
      coffeeBrewMode: activeMode.id,
      coffeeBrewLabel: activeMode.label,
      breakRunning: false,
      breakStartedAt: null,
      snoozeUsedForSession: false,
      snoozeSessionRunning: false
    };
    saveSettings({
      coffeeRunning: false,
      coffeeStartedAt: null,
      coffeePausedRemainingMs: duration,
      coffeeDurationMs: duration,
      coffeeBrewMode: activeMode.id,
      coffeeBrewLabel: activeMode.label,
      breakRunning: false,
      breakStartedAt: null,
      snoozeUsedForSession: false,
      snoozeSessionRunning: false
    });
    removeBreakOverlay();
  }

  function snoozeBreak() {
    if (settings.snoozeUsedForSession) return;
    const duration = getValidDuration(settings.coffeeDurationMs);
    const snoozeRemaining = Math.min(5 * 60 * 1000, duration);
    const coffeeSessionId = `${Date.now()}-snooze`;
    settings = {
      ...settings,
      coffeeRunning: true,
      coffeeStartedAt: Date.now() - (duration - snoozeRemaining),
      coffeePausedRemainingMs: snoozeRemaining,
      coffeeSessionId,
      completedCoffeeSessionId: null,
      breakRunning: false,
      breakStartedAt: null,
      snoozeUsedForSession: true,
      snoozeSessionRunning: true
    };
    saveSettings({
      coffeeRunning: true,
      coffeeStartedAt: settings.coffeeStartedAt,
      coffeePausedRemainingMs: snoozeRemaining,
      coffeeSessionId,
      completedCoffeeSessionId: null,
      breakRunning: false,
      breakStartedAt: null,
      snoozeUsedForSession: true,
      snoozeSessionRunning: true
    });
    removeBreakOverlay();
  }

  function endBreak() {
    settings = {
      ...settings,
      breakRunning: false,
      breakStartedAt: null,
      snoozeUsedForSession: false,
      snoozeSessionRunning: false
    };
    saveSettings({
      breakRunning: false,
      breakStartedAt: null,
      snoozeUsedForSession: false,
      snoozeSessionRunning: false
    });
    removeBreakOverlay();
  }

  function startDrag(event) {
    if (!root || event.button !== 0) return;

    const rect = root.getBoundingClientRect();
    dragState = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false
    };

    cat.setPointerCapture(event.pointerId);
    cat.addEventListener("pointermove", drag);
    cat.addEventListener("pointerup", finishDrag, { once: true });
    cat.addEventListener("pointercancel", finishDrag, { once: true });
  }

  function drag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;

    dragState.moved = true;
    moveTo(event.clientX - dragState.offsetX, event.clientY - dragState.offsetY);
  }

  function finishDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;

    cat.removeEventListener("pointermove", drag);
    const rect = root.getBoundingClientRect();
    settings.position = {
      x: Math.round(rect.left),
      y: Math.round(rect.top)
    };

    saveSettings({ position: settings.position });
    window.setTimeout(() => {
      dragState = null;
    }, 0);
  }

  function moveTo(x, y) {
    const maxX = Math.max(0, window.innerWidth - root.offsetWidth);
    const maxY = Math.max(0, window.innerHeight - root.offsetHeight);
    const nextX = Math.min(Math.max(0, x), maxX);
    const nextY = Math.min(Math.max(0, y), maxY);

    root.style.left = `${nextX}px`;
    root.style.top = `${nextY}px`;
    root.style.right = "auto";
    root.style.bottom = "auto";
  }

  function sipAndPurr() {
    if (!cat || dragState?.moved) return;

    cat.classList.remove("is-napping");
    cat.classList.toggle("bubble-below", !hasRoomForBubbleAbove());
    cat.classList.add("is-sipping");
    cat.classList.add("is-purring");
    playPurr();
    window.setTimeout(() => {
      cat?.classList.remove("is-sipping");
    }, 700);
    window.setTimeout(() => {
      cat?.classList.remove("is-purring");
    }, 1200);
  }

  // The bubble renders entirely outside the host box, and moveTo() clamps the
  // root to the viewport rather than the bubble -- so a cat parked against the
  // top edge would otherwise speak off-screen. Measured rather than assumed
  // because the height scales with --cat-unit.
  function hasRoomForBubbleAbove() {
    const bubble = cat?.querySelector(".purr-bubble");
    if (!bubble || !root) return true;
    return root.getBoundingClientRect().top >= bubble.offsetHeight + BUBBLE_EDGE_SLACK_PX;
  }

  function playPurr() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    audioContext ||= new AudioContextClass();
    if (audioContext.state === "suspended") {
      audioContext.resume();
    }

    const startedAt = audioContext.currentTime;
    const duration = 1.1;
    const output = audioContext.createGain();
    output.gain.setValueAtTime(0.0001, startedAt);
    output.gain.exponentialRampToValueAtTime(0.045, startedAt + 0.04);
    output.gain.setValueAtTime(0.045, startedAt + duration - 0.12);
    output.gain.exponentialRampToValueAtTime(0.0001, startedAt + duration);
    output.connect(audioContext.destination);

    createPurrOscillator(output, startedAt, duration, 46);
    createPurrOscillator(output, startedAt, duration, 61);

    window.setTimeout(() => {
      output.disconnect();
    }, Math.ceil((duration + 0.1) * 1000));
  }

  function createPurrOscillator(destination, startedAt, duration, baseFrequency) {
    const oscillator = audioContext.createOscillator();
    const tremolo = audioContext.createOscillator();
    const tremoloGain = audioContext.createGain();
    const voiceGain = audioContext.createGain();

    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(baseFrequency, startedAt);
    tremolo.frequency.setValueAtTime(24, startedAt);
    tremoloGain.gain.setValueAtTime(18, startedAt);
    voiceGain.gain.setValueAtTime(0.5, startedAt);

    tremolo.connect(tremoloGain);
    tremoloGain.connect(oscillator.frequency);
    oscillator.connect(voiceGain);
    voiceGain.connect(destination);

    oscillator.start(startedAt);
    tremolo.start(startedAt);
    oscillator.stop(startedAt + duration);
    tremolo.stop(startedAt + duration);
  }

  function scheduleMood() {
    window.clearTimeout(moodTimer);
    moodTimer = window.setTimeout(() => {
      if (!cat) return;

      cat.classList.add("is-napping");
      window.setTimeout(() => {
        cat?.classList.remove("is-napping");
        scheduleMood();
      }, 3200);
    }, 12000 + Math.random() * 10000);
  }

  function getCoffeeRemaining(source) {
    const duration = getValidDuration(source.coffeeDurationMs);
    const pausedRemaining = getValidRemaining(source.coffeePausedRemainingMs, duration);

    if (!source.coffeeRunning || !Number.isFinite(source.coffeeStartedAt)) {
      return pausedRemaining;
    }

    return Math.max(0, duration - (Date.now() - source.coffeeStartedAt));
  }

  function getBreakRemaining(source) {
    const duration = getValidBreakDuration(source.breakDurationMs);
    if (!source.breakRunning || !Number.isFinite(source.breakStartedAt)) {
      return duration;
    }

    return Math.max(0, duration - (Date.now() - source.breakStartedAt));
  }

  function normalizeSettings(source) {
    const brewMode = getBrewMode(source.coffeeBrewMode);
    const coffeeDurationMs = getValidDuration(source.coffeeDurationMs);
    return {
      ...DEFAULT_SETTINGS,
      ...source,
      size: SIZE_MAP[source.size] ? source.size : DEFAULT_SETTINGS.size,
      breakDurationMs: getValidBreakDuration(source.breakDurationMs),
      focusStats: normalizeFocusStats(source.focusStats),
      coffeeBrewMode: brewMode.id,
      coffeeBrewLabel: typeof source.coffeeBrewLabel === "string" && source.coffeeBrewLabel.trim()
        ? source.coffeeBrewLabel
        : brewMode.label,
      coffeeDurationMs,
      coffeePausedRemainingMs: getValidRemaining(source.coffeePausedRemainingMs, coffeeDurationMs)
    };
  }

  function getBrewMode(modeId) {
    return BREW_MODES[modeId] || DEFAULT_BREW_MODE;
  }

  function normalizeFocusStats(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      sessionsCompleted: getNonNegativeInteger(source.sessionsCompleted),
      minutesProtected: getNonNegativeInteger(source.minutesProtected),
      cupsFinished: getNonNegativeInteger(source.cupsFinished)
    };
  }

  function getNonNegativeInteger(value) {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }

  function getValidDuration(value) {
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_SETTINGS.coffeeDurationMs;
  }

  function getValidBreakDuration(value) {
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_SETTINGS.breakDurationMs;
  }

  function getValidRemaining(value, durationValue) {
    const duration = getValidDuration(durationValue);
    return Number.isFinite(value) ? Math.max(0, Math.min(value, duration)) : duration;
  }

  function formatTime(milliseconds) {
    const totalSeconds = Math.ceil(Math.max(0, milliseconds) / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }
})();
