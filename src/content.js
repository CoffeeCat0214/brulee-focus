(function coffeeCatContent() {
  const ROOT_ID = "coffeecat-root";
  const INTERMISSION_ROOT_ID = "coffeecat-intermission-root";
  const COFFEE_RENDER_INTERVAL_MS = 250;

  // What a session is, shared with the service worker and the popup so the
  // three cannot disagree about a duration or about how remaining time is
  // derived. Loaded as a content script ahead of this one; see the manifest and
  // the header of src/settings.js.
  const {
    DEFAULT_SETTINGS,
    SIZE_MAP,
    formatTime,
    getBreakRemaining,
    getBrewMode,
    getCoffeeRemaining,
    getNonNegativeInteger,
    getValidBreakDuration,
    getValidDuration,
    normalizeSettings
  } = globalThis.COFFEECAT;

  // Covers the purr bubble's gap and tail, which sit outside its own box.
  const BUBBLE_EDGE_SLACK_PX = 8;

  // Emitted by tools/render_mug.py and loaded as a content script ahead of this
  // one (see manifest). It is the single source of truth for where the liquid
  // sits inside the glass and how far it travels -- the popup and the marketing
  // site read the same object, which is what stops the three surfaces drifting
  // into three different cups again.
  const { FILL_WINDOW, DRAIN_RANGE, SVG } = globalThis.COFFEECAT_MUG;

  // The intermission's vector cup, matching the popup's hero markup. Derived
  // from the generated geometry rather than copied out of popup.html:
  //   rx  = half the fill window's width (the interior ellipse)
  //   ry  = rim centre minus the fill window's top, i.e. the interior ellipse's
  //         vertical radius
  // The one number that is not derivable is the optical inset: how far below the
  // rim a full cup's surface sits. A surface exactly on the rim line reads as an
  // overfilled cup.
  const CUP_SURFACE_INSET = 1.2;
  const CUP_SURFACE_Y = SVG.rim.cy + CUP_SURFACE_INSET;
  const CUP_INTERIOR_RX = FILL_WINDOW.width / 2;
  const CUP_INTERIOR_RY = SVG.rim.cy - FILL_WINDOW.y;

  // Both shadow roots read shared.css, so their tokens cannot disagree with the
  // popup's. Fetched once and cached: an intermission mounting five minutes
  // after the float costs nothing.
  const SHARED_SHEET = "src/shared.css";
  const FLOAT_SHEET = "src/float.css";
  const INTERMISSION_SHEET = "src/intermission.css";
  const sheetCache = new Map();

  let settings = { ...DEFAULT_SETTINGS };
  let root = null;
  let intermissionRoot = null;
  let intermissionShadow = null;
  let shadow = null;
  let cat = null;
  let intermissionFill = null;
  let intermissionKeyHandler = null;
  let dragState = null;
  let moodTimer = null;
  let coffeeTimer = null;
  let audioContext = null;

  init();

  async function init() {
    if (!hasExtensionContext()) {
      removeExistingRoot();
      return;
    }

    settings = await loadSettings();
    if (settings.enabled) {
      await mount();
    }

    watchSettings();
  }

  // The CSS used to be two template literals in this file, which meant a stray
  // backtick in a comment could silently truncate a stylesheet and no editor
  // or parser would say so. It is now two real files, adopted as constructed
  // stylesheets rather than injected as <link>: a <link> inside a shadow root
  // paints the tree unstyled for a frame, and one of these trees covers the
  // whole viewport.
  //
  // The cost of the trade is that styling is now async, so both callers await
  // this before attaching their root to the document. Only the very first
  // float mount can actually wait, and it is already behind document_idle.
  async function loadSheet(path) {
    const cached = sheetCache.get(path);
    if (cached) return cached;

    const pending = (async () => {
      const response = await fetch(getExtensionUrl(path));
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(await response.text());
      return sheet;
    })();

    // Cache the promise, not the sheet: two roots mounting in the same tick
    // must not each start a fetch.
    sheetCache.set(path, pending);
    return pending;
  }

  function loadSheets(paths) {
    return Promise.all(paths.map(loadSheet));
  }

  function loadSettings() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(DEFAULT_SETTINGS, (stored) => {
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

  // Async only because of the stylesheet fetch. Errors are swallowed the same
  // way every chrome.* call in this file swallows them: an extension reload
  // mid-fetch is normal, and the right response is to leave the page clean
  // rather than to raise on someone else's site.
  async function mount() {
    removeExistingRoot();

    let sheets;
    try {
      sheets = await loadSheets([SHARED_SHEET, FLOAT_SHEET]);
    } catch {
      handleInvalidatedContext();
      return;
    }

    // Two mounts can race across that await: watchSettings() calls mount()
    // whenever a change arrives and finds no root, and `root` is not assigned
    // until below. Whoever arrives second would otherwise leave the first
    // cat orphaned in the document.
    removeExistingRoot();

    root = document.createElement("div");
    root.id = ROOT_ID;
    shadow = root.attachShadow({ mode: "closed" });
    shadow.adoptedStyleSheets = sheets;
    shadow.append(buildCat());
    document.documentElement.appendChild(root);

    applySettings();
    startCoffeeTimer();
    scheduleMood();
  }

  function removeExistingRoot() {
    document.getElementById(ROOT_ID)?.remove();
    document.getElementById(INTERMISSION_ROOT_ID)?.remove();
  }

  function watchSettings() {
    try {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        try {
          if (areaName !== "local") return;

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
          renderIntermission();
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
      return Boolean(chrome?.runtime?.id && chrome?.storage?.local);
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
      chrome.storage.local.set(nextSettings);
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
    dragState = null;

    if (root) {
      root.remove();
    }
    if (intermissionRoot) {
      intermissionRoot.remove();
    }

    root = null;
    intermissionRoot = null;
    intermissionShadow = null;
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

  // Places the sprite's clip window from the generated geometry. These used to
  // be interpolated straight into the stylesheet string; with the CSS in a real
  // file they travel as custom properties instead, which is the same route
  // site/script.js already uses for the same numbers under the same names.
  // Hand-writing them into float.css would be a second copy of generated
  // geometry, which is the drift the generator exists to prevent.
  function applyMugGeometry(style) {
    style.setProperty("--win-x", `${FILL_WINDOW.x}%`);
    style.setProperty("--win-y", `${FILL_WINDOW.y}%`);
    style.setProperty("--win-w", `${FILL_WINDOW.width}%`);
    style.setProperty("--win-h", `${FILL_WINDOW.height}%`);
    style.setProperty("--win-r", `${FILL_WINDOW.bottomRadius}%`);
    // The liquid sprite is drawn on the full mug canvas, so it is sized back up
    // to the meter box and offset to cancel the window's own inset. That keeps
    // it in register with the vessel at every fill level.
    style.setProperty("--liq-w", `${10000 / FILL_WINDOW.width}%`);
    style.setProperty("--liq-h", `${10000 / FILL_WINDOW.height}%`);
    style.setProperty("--liq-x", `${(-FILL_WINDOW.x * 100) / FILL_WINDOW.width}%`);
    style.setProperty("--liq-y", `${(-FILL_WINDOW.y * 100) / FILL_WINDOW.height}%`);
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
    applyMugGeometry(root.style);

    if (settings.position && Number.isFinite(settings.position.x) && Number.isFinite(settings.position.y)) {
      moveTo(settings.position.x, settings.position.y);
    } else {
      root.style.left = "auto";
      root.style.top = "auto";
      root.style.right = "24px";
      root.style.bottom = "24px";
    }

    updateCoffeeMeter();
    renderIntermission();
  }

  function startCoffeeTimer() {
    window.clearInterval(coffeeTimer);
    updateCoffeeMeter();
    coffeeTimer = window.setInterval(updateCoffeeMeter, COFFEE_RENDER_INTERVAL_MS);
  }

  // Pure paint. This tick used to also *end* the session when it saw the clock
  // hit zero, which meant every open tab raced to write the same completion
  // patch and a browser with no http/https tab open never ended a session at
  // all. src/background.js owns that now. What survives here is derivation:
  // remaining time comes from the stored timestamps, so this stays correct
  // between the worker's writes without being told anything.
  function updateCoffeeMeter() {
    const duration = getValidDuration(settings.coffeeDurationMs);
    const remaining = getCoffeeRemaining(settings);

    renderIntermission();
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

  // Called from the coffee tick, so this runs every COFFEE_RENDER_INTERVAL_MS
  // for as long as the float is mounted. That is what drives the countdown and
  // the refilling cup; the intermission used to also arm a 1000ms interval of
  // its own, which this tick cleared and re-armed before it could ever fire.
  //
  // The expiry term is derived, not written. An expired intermission has to stop
  // being drawn here or the next tick would just mount it again -- but the
  // *stored* breakRunning flag is the service worker's to clear, the same way
  // ending a focus session is. Every open tab writing "the break is over" was
  // the same thundering herd the completion write used to be.
  function renderIntermission() {
    const shouldShow = settings.enabled
      && settings.breakRunning
      && getBreakRemaining(settings) > 0;
    if (!shouldShow) {
      removeIntermission();
      return;
    }

    if (!intermissionRoot) {
      mountIntermission();
      return;
    }

    updateIntermission();
  }

  // Split out of renderIntermission() because adopting the stylesheets is async,
  // and renderIntermission() is called from a synchronous render tick.
  async function mountIntermission() {
    let sheets;
    try {
      sheets = await loadSheets([SHARED_SHEET, INTERMISSION_SHEET]);
    } catch {
      handleInvalidatedContext();
      return;
    }

    // The intermission can end while that fetch is in flight, and two storage changes
    // can both arrive before `intermissionRoot` is assigned.
    if (!settings.enabled || !settings.breakRunning || intermissionRoot) return;

    intermissionRoot = document.createElement("div");
    intermissionRoot.id = INTERMISSION_ROOT_ID;
    intermissionShadow = intermissionRoot.attachShadow({ mode: "closed" });
    intermissionShadow.adoptedStyleSheets = sheets;
    intermissionShadow.append(buildIntermission());
    document.documentElement.appendChild(intermissionRoot);

    // Escape ends the intermission. It no longer blocks the page, so this is
    // the keyboard equivalent of choosing Snooze and walking away from it.
    // Capture phase because plenty of pages stop Escape on the way up.
    intermissionKeyHandler = (event) => {
      if (event.key === "Escape") endBreak();
    };
    window.addEventListener("keydown", intermissionKeyHandler, true);

    updateIntermission();
  }

  function removeIntermission() {
    if (intermissionKeyHandler) {
      window.removeEventListener("keydown", intermissionKeyHandler, true);
      intermissionKeyHandler = null;
    }
    if (intermissionRoot) {
      intermissionRoot.remove();
    }
    intermissionRoot = null;
    intermissionShadow = null;
    intermissionFill = null;
  }

  // The popup's hero, rebuilt: cup, time, caption, and a two-choice action
  // group, in that order at those sizes on the same left spine (see the panel
  // notes in src/intermission.css). The kicker, the <h1> and the message
  // paragraph that used to sit here are gone -- four competing text blocks
  // left the panel with no focal point, and a top-level heading injected into
  // an arbitrary page also pollutes that page's heading outline.
  function buildIntermission() {
    const overlay = document.createElement("section");
    overlay.className = "intermission";
    overlay.setAttribute("aria-label", "CoffeeCat intermission");
    overlay.innerHTML = `
      <div class="coffee-rise" aria-hidden="true">
        <span class="coffee-wave wave-a"></span>
        <span class="coffee-wave wave-b"></span>
      </div>
      <div class="intermission-panel">
        ${buildCupMarkup()}
        <strong class="time-display" id="intermission-countdown">${formatTime(getBreakRemaining(settings))}</strong>
        <!-- role="status" so it announces itself once on mount, the way
             the popup's #timer-status does. It carries the announcement rather
             than the countdown because the countdown's text changes every tick
             and a live region on that would talk over everything. -->
        <p class="intermission-caption" role="status">intermission</p>
        <div class="intermission-actions">
          <button class="button-primary" id="intermission-refill" type="button">Refill coffee</button>
          <p class="intermission-choice-note">Not ready for another session?</p>
          <button class="button-secondary" id="intermission-snooze" type="button">Snooze</button>
        </div>
        <p class="intermission-stats" id="intermission-stats" hidden></p>
      </div>
    `;

    intermissionFill = overlay.querySelector("#intermission-progress-fill");
    overlay.querySelector("#intermission-refill")?.addEventListener("click", refillCoffee);
    overlay.querySelector("#intermission-snooze")?.addEventListener("click", endBreak);
    return overlay;
  }

  // The same cup the popup draws, from the same generated geometry. Built here
  // rather than pasted in as path strings so this does not become a fourth
  // hand-maintained copy of the vessel: tools/render_mug.py emits the paths into
  // src/mug-geometry.js and every surface reads them from there.
  //
  // The ids are scoped to this shadow root, so they cannot collide with the
  // popup's or with anything on the host page.
  function buildCupMarkup() {
    return `
      <svg class="cup" viewBox="${SVG.viewBox}" aria-hidden="true">
        <defs>
          <clipPath id="intermission-cup-interior">
            <path d="${SVG.interior}"></path>
          </clipPath>
          <linearGradient id="intermission-coffee-liquid" x1="0" y1="0" x2="0" y2="1">
            <stop class="liquid-top" offset="0"></stop>
            <stop class="liquid-bottom" offset="1"></stop>
          </linearGradient>
        </defs>

        <path class="cup-handle" d="${SVG.handle}"></path>
        <path class="cup-wall" d="${SVG.body}"></path>

        <g clip-path="url(#intermission-cup-interior)">
          <g class="cup-liquid" id="intermission-progress-fill">
            <rect x="0" y="${CUP_SURFACE_Y}" width="100" height="90" fill="url(#intermission-coffee-liquid)"></rect>
            <ellipse class="cup-crema" cx="${SVG.rim.cx}" cy="${CUP_SURFACE_Y}" rx="${CUP_INTERIOR_RX}" ry="${CUP_INTERIOR_RY}"></ellipse>
          </g>
        </g>

        <path class="cup-body" d="${SVG.body}"></path>
      </svg>
    `;
  }

  function updateIntermission() {
    if (!intermissionShadow || !settings.breakRunning) return;

    const remaining = getBreakRemaining(settings);

    // Expiry only takes the panel off screen; renderIntermission() is what keeps
    // it off, and src/background.js is what clears the stored flag.
    if (remaining <= 0) {
      removeIntermission();
      return;
    }

    const countdown = intermissionShadow.querySelector("#intermission-countdown");
    if (countdown) countdown.textContent = formatTime(remaining);

    paintIntermissionCup(remaining);

    const stats = intermissionShadow.querySelector("#intermission-stats");
    if (stats) {
      const summary = formatFocusSummary(settings.focusStats);
      stats.textContent = summary;
      stats.hidden = !summary;
    }
  }

  // The inverse of the popup's drain: this cup refills as the intermission runs,
  // the same object carries both halves of the cycle. Translate, never scale --
  // the crema ellipse has to ride along at a constant thickness rather than
  // being squashed by the transform that moves it.
  function paintIntermissionCup(remaining) {
    if (!intermissionFill) return;

    const duration = getValidBreakDuration(settings.breakDurationMs);
    const fill = Math.max(0, Math.min(1, 1 - remaining / duration));
    intermissionFill.style.transform = `translateY(${((1 - fill) * SVG.interiorHeight).toFixed(4)}px)`;
  }

  // One quiet line, not a panel. The popup carries no stats block at all, and
  // three stacked figures were competing with the countdown for the same job.
  function formatFocusSummary(stats) {
    const cups = getNonNegativeInteger(stats?.cupsFinished);
    const minutes = getNonNegativeInteger(stats?.minutesProtected);
    if (!cups && !minutes) return "";

    return `${cups} ${cups === 1 ? "cup" : "cups"}, ${minutes} ${minutes === 1 ? "minute" : "minutes"} protected`;
  }

  function refillCoffee() {
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
      breakStartedAt: null
    };
    saveSettings({
      coffeeRunning: false,
      coffeeStartedAt: null,
      coffeePausedRemainingMs: duration,
      coffeeDurationMs: duration,
      coffeeBrewMode: activeMode.id,
      coffeeBrewLabel: activeMode.label,
      breakRunning: false,
      breakStartedAt: null
    });
    removeIntermission();
  }

  function endBreak() {
    settings = {
      ...settings,
      breakRunning: false,
      breakStartedAt: null
    };
    saveSettings({
      breakRunning: false,
      breakStartedAt: null
    });
    removeIntermission();
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

})();
