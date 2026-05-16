(function coffeeCatContent() {
  const ROOT_ID = "coffeecat-root";
  const DEFAULT_SETTINGS = {
    enabled: true,
    size: "medium",
    position: null
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

  init();

  async function init() {
    settings = await loadSettings();
    if (settings.enabled) {
      mount();
    }

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
  }

  function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
        resolve({
          ...DEFAULT_SETTINGS,
          ...stored,
          size: SIZE_MAP[stored.size] ? stored.size : DEFAULT_SETTINGS.size
        });
      });
    });
  }

  function mount() {
    if (document.getElementById(ROOT_ID)) return;

    root = document.createElement("div");
    root.id = ROOT_ID;
    shadow = root.attachShadow({ mode: "closed" });
    shadow.append(buildStyles(), buildCat());
    document.documentElement.appendChild(root);

    applySettings();
    scheduleMood();
  }

  function unmount() {
    window.clearTimeout(moodTimer);
    moodTimer = null;
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
    cat.innerHTML = `
      <span class="steam steam-one"></span>
      <span class="steam steam-two"></span>
      <span class="ear ear-left"></span>
      <span class="ear ear-right"></span>
      <span class="head">
        <span class="eye eye-left"></span>
        <span class="eye eye-right"></span>
        <span class="muzzle"></span>
        <span class="whisker whisker-left"></span>
        <span class="whisker whisker-right"></span>
      </span>
      <span class="cup">
        <span class="coffee"></span>
        <span class="handle"></span>
      </span>
      <span class="tail"></span>
    `;

    cat.addEventListener("pointerdown", startDrag);
    cat.addEventListener("click", sip);
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
      }

      .coffee-cat:active {
        cursor: grabbing;
      }

      .coffee-cat.is-sipping .cup {
        animation: sip 650ms steps(2, end);
      }

      .coffee-cat.is-napping .eye {
        height: 3px;
        transform: translateY(4px);
      }

      .head,
      .ear,
      .cup,
      .tail,
      .steam,
      .muzzle,
      .eye,
      .whisker,
      .coffee,
      .handle {
        position: absolute;
        box-sizing: border-box;
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
        45%, 65% { transform: rotate(-12deg) translate(-6px, -4px); }
      }

      @keyframes steam {
        0% { transform: translateY(6px); opacity: 0; }
        30% { opacity: 0.7; }
        100% { transform: translateY(-8px); opacity: 0; }
      }

      @media (prefers-reduced-motion: reduce) {
        .coffee-cat,
        .eye,
        .steam {
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

    chrome.storage.sync.set({ position: settings.position });
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

  function sip() {
    if (!cat || dragState?.moved) return;

    cat.classList.remove("is-napping");
    cat.classList.add("is-sipping");
    window.setTimeout(() => {
      cat?.classList.remove("is-sipping");
    }, 700);
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
