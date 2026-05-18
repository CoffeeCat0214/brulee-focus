(function coffeeCatContent() {
  const ROOT_ID = "coffeecat-root";
  const FOCUS_DURATION_MS = 25 * 60 * 1000;
  const DEFAULT_SETTINGS = {
    enabled: true,
    size: "medium",
    position: null,
    coffeeDurationMs: FOCUS_DURATION_MS,
    coffeePausedRemainingMs: FOCUS_DURATION_MS,
    coffeeRunning: false,
    coffeeStartedAt: null
  };

  const SIZE_MAP = {
    small: 64,
    medium: 88,
    large: 116
  };

  let settings = { ...DEFAULT_SETTINGS };
  let root = null;
  let shadow = null;
  let cat = null;
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
            )
          };

          if (!settings.enabled) {
            unmount();
            return;
          }

          if (!root) mount();
          applySettings();
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
    dragState = null;

    if (root) {
      root.remove();
    }

    root = null;
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
          linear-gradient(rgba(244, 174, 94, 0.55), rgba(244, 174, 94, 0) 20%),
          linear-gradient(#8f481d, #32170d);
        box-shadow:
          inset 4px 0 0 rgba(255, 255, 255, 0.22),
          inset -2px 0 0 rgba(30, 14, 8, 0.24),
          0 -2px 0 rgba(244, 174, 94, 0.7);
        transform: scaleY(1);
        transform-origin: center bottom;
        transition: transform 360ms steps(24, end), opacity 180ms ease;
      }

      .coffee-fill::before {
        content: "";
        position: absolute;
        left: 8%;
        right: 8%;
        top: 0;
        height: 3px;
        border-radius: 999px;
        background: rgba(255, 198, 124, 0.78);
        box-shadow: 0 1px 0 rgba(45, 21, 12, 0.32);
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
  }

  function startCoffeeTimer() {
    window.clearInterval(coffeeTimer);
    updateCoffeeMeter();
    coffeeTimer = window.setInterval(updateCoffeeMeter, 1000);
  }

  function updateCoffeeMeter() {
    const meter = cat?.querySelector(".coffee-meter");
    const fillElement = cat?.querySelector(".coffee-fill");
    if (!meter || !fillElement) return;

    const duration = getValidDuration(settings.coffeeDurationMs);
    const remaining = getCoffeeRemaining(settings);
    const fill = Math.max(0, Math.min(1, remaining / duration));

    fillElement.style.transform = `scaleY(${fill.toFixed(3)})`;
    meter.classList.toggle("is-empty", remaining <= 0);
    meter.classList.toggle("is-paused", !settings.coffeeRunning);
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

  function getValidDuration(value) {
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_SETTINGS.coffeeDurationMs;
  }

  function getValidRemaining(value, durationValue) {
    const duration = getValidDuration(durationValue);
    return Number.isFinite(value) ? Math.max(0, Math.min(value, duration)) : duration;
  }
})();
