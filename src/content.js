(function coffeeCatContent() {
  const ROOT_ID = "coffeecat-root";
  const DEFAULT_SETTINGS = {
    enabled: true,
    size: "medium",
    position: null,
    coffeeDurationMs: 25 * 60 * 1000,
    coffeePausedRemainingMs: 25 * 60 * 1000,
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
          if (chrome.runtime.lastError) {
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
        });
      } catch {
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
      });
    } catch {
      removeExistingRoot();
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
      return "";
    }
  }

  function saveSettings(nextSettings) {
    try {
      chrome.storage.sync.set(nextSettings);
    } catch {
      removeExistingRoot();
    }
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
    const idleImage = getExtensionUrl("assets/coffeecat-idle.png");
    const mugFrames = [
      getExtensionUrl("assets/mugs/mug-1-full.png"),
      getExtensionUrl("assets/mugs/mug-2-80.png"),
      getExtensionUrl("assets/mugs/mug-3-60.png"),
      getExtensionUrl("assets/mugs/mug-4-40.png"),
      getExtensionUrl("assets/mugs/mug-5-20.png"),
      getExtensionUrl("assets/mugs/mug-6-empty.png")
    ];
    cat.innerHTML = `
      <img class="cat-art" src="${idleImage}" alt="">
      <span class="coffee-meter" aria-hidden="true">
        <img
          class="coffee-meter-frame"
          src="${mugFrames[0]}"
          data-frame-0="${mugFrames[0]}"
          data-frame-1="${mugFrames[1]}"
          data-frame-2="${mugFrames[2]}"
          data-frame-3="${mugFrames[3]}"
          data-frame-4="${mugFrames[4]}"
          data-frame-5="${mugFrames[5]}"
          alt=""
        >
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
        right: -21%;
        bottom: -10%;
        z-index: 3;
        display: block;
        width: 52%;
        height: 52%;
        pointer-events: none;
        image-rendering: pixelated;
      }

      .coffee-meter-frame {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: contain;
        image-rendering: pixelated;
        filter:
          drop-shadow(0 5px 0 rgba(74, 43, 29, 0.1))
          drop-shadow(0 8px 12px rgba(74, 43, 29, 0.18));
      }

      .coffee-meter.is-paused .coffee-meter-frame {
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

      .head {
        left: 20%;
        top: 22%;
        width: 58%;
        height: 50%;
        border: 4px solid var(--fur-dark);
        border-radius: 8px;
        background: var(--fur);
        box-shadow: inset 0 -8px 0 rgba(0, 0, 0, 0.12);
      }

      .ear {
        top: 11%;
        width: 20%;
        height: 22%;
        border: 4px solid var(--fur-dark);
        background: var(--fur);
        transform: rotate(45deg);
      }

      .ear-left {
        left: 18%;
      }

      .ear-right {
        right: 22%;
      }

      .eye {
        top: 34%;
        width: 8px;
        height: 8px;
        background: #15100d;
        border-radius: 2px;
        animation: blink 5.5s steps(1, end) infinite;
      }

      .eye-left {
        left: 28%;
      }

      .eye-right {
        right: 28%;
      }

      .muzzle {
        left: 38%;
        top: 49%;
        width: 24%;
        height: 18%;
        background: var(--cream);
        border: 3px solid var(--fur-dark);
        border-radius: 4px;
      }

      .muzzle::after {
        content: "";
        position: absolute;
        left: 50%;
        top: 38%;
        width: 5px;
        height: 5px;
        background: var(--fur-dark);
        transform: translateX(-50%);
      }

      .whisker {
        top: 55%;
        width: 20%;
        height: 3px;
        background: var(--fur-dark);
      }

      .whisker-left {
        left: 4%;
      }

      .whisker-right {
        right: 4%;
      }

      .cup {
        left: 51%;
        top: 58%;
        width: 30%;
        height: 26%;
        border: 4px solid var(--fur-dark);
        border-radius: 4px 4px 8px 8px;
        background: var(--cup);
      }

      .coffee {
        left: 8%;
        right: 8%;
        top: 16%;
        height: 5px;
        background: var(--coffee);
      }

      .handle {
        right: -16px;
        top: 26%;
        width: 16px;
        height: 14px;
        border: 4px solid var(--fur-dark);
        border-left: 0;
        border-radius: 0 8px 8px 0;
      }

      .tail {
        left: 6%;
        top: 50%;
        width: 24%;
        height: 18%;
        border: 5px solid var(--fur-dark);
        border-right: 0;
        border-radius: 12px 0 0 12px;
        background: transparent;
      }

      .steam {
        top: 31%;
        width: 6px;
        height: 16px;
        border-left: 3px solid var(--accent);
        opacity: 0.72;
        animation: steam 2.8s steps(3, end) infinite;
      }

      .steam-one {
        left: 59%;
      }

      .steam-two {
        left: 69%;
        animation-delay: 700ms;
      }

      @keyframes bob {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-3px); }
      }

      @keyframes blink {
        0%, 92%, 100% { transform: scaleY(1); }
        94%, 96% { transform: scaleY(0.18); }
      }

      @keyframes sip {
        0%, 100% { transform: rotate(0deg); }
        45%, 65% { transform: rotate(-4deg) translateY(-3px); }
      }

      @keyframes purr {
        0%, 100% { transform: translateX(0); }
        50% { transform: translateX(1px); }
      }

      @keyframes tail-purr {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-2px); }
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
    const frame = cat?.querySelector(".coffee-meter-frame");
    if (!meter || !frame) return;

    const duration = getValidDuration(settings.coffeeDurationMs);
    const remaining = getCoffeeRemaining(settings);
    const fill = Math.max(0, Math.min(1, remaining / duration));
    const frameIndex = Math.min(5, Math.floor((1 - fill) * 6));

    frame.src = frame.dataset[`frame-${frameIndex}`];
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
