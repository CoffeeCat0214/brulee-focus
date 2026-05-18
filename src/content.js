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
    coffeeRunning: false,
    coffeeStartedAt: null,
    coffeeSessionId: null,
    completedCoffeeSessionId: null,
    blockedDomains: [],
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

  const SIZE_MAP = {
    small: 64,
    medium: 88,
    large: 116
  };

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

            resolve({
              ...DEFAULT_SETTINGS,
              ...stored,
              size: SIZE_MAP[stored.size] ? stored.size : DEFAULT_SETTINGS.size,
              blockedDomains: normalizeBlockedDomains(stored.blockedDomains),
              breakDurationMs: getValidBreakDuration(stored.breakDurationMs),
              focusStats: normalizeFocusStats(stored.focusStats),
              coffeeDurationMs: getValidDuration(stored.coffeeDurationMs),
              coffeePausedRemainingMs: getValidRemaining(
                stored.coffeePausedRemainingMs,
                stored.coffeeDurationMs
              )
            });
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

          settings = {
            ...settings,
            ...Object.fromEntries(
              Object.entries(changes).map(([key, change]) => [key, change.newValue])
            ),
            blockedDomains: normalizeBlockedDomains(
              changes.blockedDomains?.newValue ?? settings.blockedDomains
            ),
            breakDurationMs: getValidBreakDuration(
              changes.breakDurationMs?.newValue ?? settings.breakDurationMs
            ),
            focusStats: normalizeFocusStats(changes.focusStats?.newValue ?? settings.focusStats)
          };

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
    cat.title = "CoffeeCat";
    cat.setAttribute("aria-label", "CoffeeCat browser buddy");
    const buddyImage = getExtensionUrl("assets/coffeecat-buddy.png");
    cat.innerHTML = `
      <img class="cat-art" src="${buddyImage}" alt="">
      <span class="coffee-meter" aria-hidden="true">
        <span class="coffee-steam steam-a"></span>
        <span class="coffee-steam steam-b"></span>
        <span class="glass-mug">
          <span class="coffee-fill"></span>
        </span>
      </span>
      <span class="purr-bubble">prr</span>
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
        --cat-scale: 1;
        --fur: #7a4b31;
        --fur-dark: #4a2b1d;
        --cream: #ffe2b8;
        --coffee: #3a2117;
        --cup: #f5f1e8;
        --accent: #d97b40;
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
          drop-shadow(0 8px 0 rgba(74, 43, 29, 0.12))
          drop-shadow(0 10px 18px rgba(74, 43, 29, 0.22));
        transform-origin: center bottom;
      }

      .coffee-cat.is-sipping .cat-art {
        animation: sip 650ms steps(2, end);
      }

      .coffee-cat.is-purring .cat-art {
        animation: purr 90ms steps(2, end) infinite;
      }

      .coffee-cat.is-purring .purr-bubble {
        opacity: 1;
        transform: translateY(-10px);
      }

      .coffee-cat.is-napping .cat-art {
        transform: translateY(2px) scaleY(0.98);
        filter:
          drop-shadow(0 8px 0 rgba(74, 43, 29, 0.12))
          drop-shadow(0 10px 18px rgba(74, 43, 29, 0.18))
          saturate(0.92);
      }

      .coffee-meter {
        position: absolute;
        right: -16%;
        bottom: 3%;
        z-index: 3;
        width: 43%;
        height: 43%;
        pointer-events: none;
        image-rendering: pixelated;
      }

      .glass-mug {
        position: absolute;
        left: 6%;
        right: 23%;
        bottom: 0;
        height: 66%;
        border: 3px solid var(--fur-dark);
        border-top-width: 4px;
        border-radius: 5px 5px 8px 8px;
        background:
          linear-gradient(#fffdf8, #fff3e4),
          linear-gradient(90deg, rgba(255, 255, 255, 0.78) 0 13%, transparent 13%),
          linear-gradient(90deg, transparent 0 73%, rgba(170, 205, 212, 0.42) 73% 86%, transparent 86%),
          rgba(255, 253, 248, 0.68);
        background-blend-mode: normal, screen, normal, normal;
        box-sizing: border-box;
        filter:
          drop-shadow(0 3px 0 rgba(74, 43, 29, 0.12))
          drop-shadow(0 5px 8px rgba(74, 43, 29, 0.16));
      }

      .glass-mug::before {
        content: "";
        position: absolute;
        left: 9%;
        right: 9%;
        top: 9%;
        height: 7%;
        border-top: 2px solid rgba(74, 43, 29, 0.35);
        border-radius: 50%;
        z-index: 2;
      }

      .glass-mug::after {
        content: "";
        position: absolute;
        right: -46%;
        top: 25%;
        width: 44%;
        height: 45%;
        border: 3px solid var(--fur-dark);
        border-left: 0;
        border-radius: 0 8px 8px 0;
        box-sizing: border-box;
      }

      .coffee-fill {
        position: absolute;
        left: 7%;
        right: 7%;
        bottom: 7%;
        height: 78%;
        border-radius: 3px 3px 6px 6px;
        background:
          linear-gradient(90deg, rgba(255, 255, 255, 0.26) 0 16%, transparent 16%),
          linear-gradient(rgba(184, 101, 42, 0.34), rgba(184, 101, 42, 0) 12%),
          linear-gradient(#6f3518, #32170d);
        box-shadow:
          inset 4px 0 0 rgba(255, 255, 255, 0.22),
          inset -2px 0 0 rgba(30, 14, 8, 0.24),
          0 -1px 0 rgba(255, 190, 116, 0.42);
        transform: scaleY(1);
        transform-origin: center bottom;
        transition: transform 220ms linear, opacity 180ms ease;
      }

      .coffee-fill::before {
        content: "";
        position: absolute;
        left: 8%;
        right: 8%;
        top: 0;
        height: 1px;
        border-radius: 999px;
        background: rgba(255, 206, 143, 0.5);
        box-shadow: 0 1px 0 rgba(45, 21, 12, 0.45);
      }

      .coffee-steam {
        position: absolute;
        bottom: 67%;
        width: 4px;
        height: 22%;
        border-left: 3px solid rgba(217, 123, 64, 0.72);
        opacity: 0.82;
        animation: steam 2.8s steps(3, end) infinite;
      }

      .steam-a {
        left: 28%;
      }

      .steam-b {
        left: 52%;
        animation-delay: 650ms;
      }

      .coffee-meter.is-paused .coffee-steam,
      .coffee-meter.is-empty .coffee-steam {
        opacity: 0;
      }

      .coffee-meter.is-empty .coffee-fill {
        opacity: 0.35;
      }

      .coffee-meter.is-paused .glass-mug {
        opacity: 0.78;
      }

      .purr-bubble {
        position: absolute;
        left: 5%;
        top: 3%;
        padding: 3px 5px;
        border: 3px solid var(--fur-dark);
        border-radius: 5px;
        background: #fff8ef;
        color: var(--fur-dark);
        font: 700 10px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        letter-spacing: 0;
        opacity: 0;
        transform: translateY(0);
        transition: opacity 120ms ease, transform 260ms steps(3, end);
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
        0% { transform: translateY(6px); opacity: 0; }
        30% { opacity: 0.7; }
        100% { transform: translateY(-8px); opacity: 0; }
      }

      @media (prefers-reduced-motion: reduce) {
        .coffee-cat,
        .cat-art,
        .coffee-cat.is-purring .cat-art {
          animation: none;
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

  function updateCoffeeMeter() {
    const meter = cat?.querySelector(".coffee-meter");
    const fillElement = cat?.querySelector(".coffee-fill");
    if (!meter || !fillElement) return;

    const duration = getValidDuration(settings.coffeeDurationMs);
    const remaining = getCoffeeRemaining(settings);
    const fill = Math.max(0, Math.min(1, remaining / duration));

    fillElement.style.transform = `scaleY(${fill.toFixed(4)})`;
    meter.classList.toggle("is-empty", remaining <= 0);
    meter.classList.toggle("is-paused", !settings.coffeeRunning);

    if (settings.coffeeRunning && remaining <= 0) {
      completeFocusSession();
    }

    renderBreakOverlay();
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
    const shouldShow = settings.enabled && settings.breakRunning && isCurrentDomainBlocked();
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
    const duration = getValidDuration(settings.coffeeDurationMs);
    settings = {
      ...settings,
      coffeeRunning: false,
      coffeeStartedAt: null,
      coffeePausedRemainingMs: duration,
      breakRunning: false,
      breakStartedAt: null,
      snoozeUsedForSession: false,
      snoozeSessionRunning: false
    };
    saveSettings({
      coffeeRunning: false,
      coffeeStartedAt: null,
      coffeePausedRemainingMs: duration,
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

  function isCurrentDomainBlocked() {
    const hostname = window.location.hostname.toLowerCase();
    return normalizeBlockedDomains(settings.blockedDomains).some((domain) => {
      return hostname === domain || hostname.endsWith(`.${domain}`);
    });
  }

  function normalizeBlockedDomains(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(normalizeDomain).filter(Boolean))];
  }

  function normalizeDomain(value) {
    if (typeof value !== "string") return "";
    return value
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]
      .replace(/[^a-z0-9.-]/g, "");
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
