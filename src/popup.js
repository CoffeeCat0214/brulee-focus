/* Session shape, brew table and time maths are shared with the service worker
   and the content script; see the header of src/settings.js. This file owns the
   popup's presentation and its actions, and nothing about what a session is. */
const {
  DEFAULT_SETTINGS,
  SIZE_MAP,
  formatTime,
  getBrewMode,
  getCoffeeRemaining,
  getValidDuration,
  normalizeSettings
} = globalThis.BRULEE;

const COFFEE_RENDER_INTERVAL_MS = 250;
const SIZES = Object.keys(SIZE_MAP);
// Liquid travel in SVG user units. The liquid group translates down by
// (1 - progress) * this to drain.
//
// Sourced from the generator rather than typed here: the same number sets the
// sprite's drain range in the content script, and a literal in this file would
// silently desync from the cup's actual geometry the first time it changed.
const CUP_INTERIOR_HEIGHT = globalThis.BRULEE_MUG.SVG.interiorHeight;

const paneFocus = document.getElementById("pane-focus");
const paneSettings = document.getElementById("pane-settings");
const openSettingsButton = document.getElementById("open-settings");
const closeSettingsButton = document.getElementById("close-settings");
const enabledInput = document.getElementById("enabled");
const resetButton = document.getElementById("reset-position");
const timerDisplay = document.getElementById("timer-display");
const timerStatus = document.getElementById("timer-status");
const timerToggle = document.getElementById("timer-toggle");
const timerRefill = document.getElementById("timer-refill");
const progressFill = document.getElementById("coffee-progress-fill");
const brewDeck = document.getElementById("brew-deck");
const brewOptions = Array.from(document.querySelectorAll(".brew-option"));
const brewLockNote = document.getElementById("brew-lock-note");
const brewDetailCopy = document.getElementById("brew-detail-copy");
const sizeDeck = document.getElementById("size-deck");
const sizeOptions = Array.from(document.querySelectorAll(".size-option"));

let settings = { ...DEFAULT_SETTINGS };
let renderTimer = null;

/* Every DOM write below is guarded by one of these. The popup ticks 4x/sec;
   writing unconditionally is what made the old brew-detail live region
   announce continuously under a screen reader. */
const painted = {
  time: null,
  fill: null,
  drained: null,
  toggleLabel: null,
  refillHidden: null,
  status: null,
  modeKey: null,
  size: null
};

chrome.storage.local.get(DEFAULT_SETTINGS, (stored) => {
  settings = normalizeSettings(stored);
  renderSettings();

  // Suppress the segmented-thumb transition on first paint. The popup
  // remounts every time it opens, so without this the thumb visibly slides
  // in from index 0 on every single open.
  requestAnimationFrame(() => {
    brewDeck.classList.remove("no-anim");
    sizeDeck.classList.remove("no-anim");
  });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;

  settings = normalizeSettings({
    ...settings,
    ...Object.fromEntries(
      Object.entries(changes).map(([key, change]) => [key, change.newValue])
    )
  });
  renderSettings();
});

function renderSettings() {
  enabledInput.checked = Boolean(settings.enabled);
  renderSize();
  renderCoffeeTimer();
  syncTicker();
}

/* The interval exists only to advance a running clock. Idle is the common
   case, and storage.onChanged already covers externally-driven updates. */
function syncTicker() {
  const shouldTick = Boolean(settings.coffeeRunning);

  if (shouldTick && renderTimer === null) {
    renderTimer = window.setInterval(renderCoffeeTimer, COFFEE_RENDER_INTERVAL_MS);
  } else if (!shouldTick && renderTimer !== null) {
    window.clearInterval(renderTimer);
    renderTimer = null;
  }
}

function renderCoffeeTimer() {
  const duration = getValidDuration(settings.coffeeDurationMs);
  const remaining = getCoffeeRemaining(settings);
  const fill = Math.max(0, Math.min(1, remaining / duration));
  const activeMode = getBrewMode(settings.coffeeBrewMode);
  const selectionLocked = settings.coffeeRunning || (remaining < duration && remaining > 0);

  write("time", formatTime(remaining), (value) => {
    timerDisplay.textContent = value;
  });

  // Translate the liquid group inside its clip rather than scaling or resizing
  // it: the 1px crema rect rides along at a constant 1px instead of being
  // squashed by the same transform that moves the surface.
  write("fill", ((1 - fill) * CUP_INTERIOR_HEIGHT).toFixed(4), (value) => {
    progressFill.style.transform = `translateY(${value}px)`;
  });

  write("drained", remaining <= 0, (value) => {
    progressFill.style.opacity = value ? "0.35" : "1";
  });

  const toggleLabel = settings.coffeeRunning && remaining > 0
    ? "Pause"
    : remaining < duration && remaining > 0
      ? "Resume"
      : "Start";
  write("toggleLabel", toggleLabel, (value) => {
    timerToggle.textContent = value;
  });

  // Hide Refill when it would do nothing, rather than graying it out.
  write("refillHidden", remaining >= duration, (value) => {
    timerRefill.hidden = value;
  });

  write("status", getStatusText(activeMode, remaining, duration), (value) => {
    timerStatus.textContent = value;
  });

  renderBrewSelector(activeMode, selectionLocked);
}

/* Deliberately does not repeat the brew label: the selected segment already
   names the mode directly below this caption. */
function getStatusText(activeMode, remaining, duration) {
  if (settings.breakRunning) return "break time";
  if (remaining <= 0) return "complete";
  if (settings.coffeeRunning) return activeMode.status;
  if (remaining < duration) return "paused";
  return "ready to brew";
}

/* Mode copy only changes when the mode or the lock state does, not 4x/sec. */
function renderBrewSelector(activeMode, selectionLocked) {
  write("modeKey", `${activeMode.id}|${selectionLocked}`, () => {
    brewDetailCopy.textContent = activeMode.copy;

    brewOptions.forEach((option) => {
      option.disabled = selectionLocked;
    });
    brewLockNote.hidden = !selectionLocked;

    selectSegment(
      brewDeck,
      brewOptions,
      brewOptions.findIndex((option) => option.dataset.brewMode === activeMode.id)
    );
  });
}

function renderSize() {
  const size = SIZES.includes(settings.size) ? settings.size : DEFAULT_SETTINGS.size;
  write("size", size, (value) => {
    selectSegment(sizeDeck, sizeOptions, SIZES.indexOf(value));
  });
}

function write(key, value, apply) {
  if (painted[key] === value) return;
  painted[key] = value;
  apply(value);
}

/* ── Segmented control ─────────────────────────────────────────────────
   One-of-N selection is a radiogroup, not N independent toggles. The old
   aria-pressed markup announced as four separate switches. */

function selectSegment(deck, items, activeIndex) {
  const index = activeIndex < 0 ? 0 : activeIndex;
  deck.style.setProperty("--seg-index", String(index));
  items.forEach((item, itemIndex) => {
    const isActive = itemIndex === index;
    item.setAttribute("aria-checked", String(isActive));
    item.tabIndex = isActive ? 0 : -1;
  });
}

function setupSegmentedKeys(items, onSelect) {
  items.forEach((item, index) => {
    item.addEventListener("click", () => onSelect(item));

    item.addEventListener("keydown", (event) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      if (step === undefined && event.key !== "Home" && event.key !== "End") return;

      event.preventDefault();
      const enabled = items.filter((candidate) => !candidate.disabled);
      if (enabled.length === 0) return;

      let next;
      if (event.key === "Home") {
        next = enabled[0];
      } else if (event.key === "End") {
        next = enabled[enabled.length - 1];
      } else {
        const position = enabled.indexOf(items[index]);
        next = enabled[(position + step + enabled.length) % enabled.length];
      }

      next.focus();
      onSelect(next);
    });
  });
}

setupSegmentedKeys(brewOptions, (option) => selectBrewMode(option.dataset.brewMode));
setupSegmentedKeys(sizeOptions, (option) => {
  chrome.storage.local.set({ size: option.dataset.size });
});

/* ── Panes ─────────────────────────────────────────────────────────────── */

function showPane(name) {
  const toSettings = name === "settings";
  paneFocus.classList.toggle("is-active", !toSettings);
  paneSettings.classList.toggle("is-active", toSettings);
  paneFocus.inert = toSettings;
  paneSettings.inert = !toSettings;
  (toSettings ? closeSettingsButton : openSettingsButton).focus();
}

openSettingsButton.addEventListener("click", () => showPane("settings"));
closeSettingsButton.addEventListener("click", () => showPane("focus"));

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && paneSettings.classList.contains("is-active")) {
    event.preventDefault();
    showPane("focus");
  }
});

/* ── Actions ───────────────────────────────────────────────────────────── */

enabledInput.addEventListener("change", () => {
  chrome.storage.local.set({ enabled: enabledInput.checked });
});

resetButton.addEventListener("click", () => {
  chrome.storage.local.set({ position: null });
});

timerToggle.addEventListener("click", () => {
  const activeMode = getBrewMode(settings.coffeeBrewMode);
  const duration = getValidDuration(settings.coffeeDurationMs);
  const remaining = getCoffeeRemaining(settings);

  if (settings.coffeeRunning && remaining > 0) {
    chrome.storage.local.set({
      coffeeRunning: false,
      coffeeStartedAt: null,
      coffeePausedRemainingMs: remaining
    });
    return;
  }

  const nextRemaining = remaining || duration;
  const coffeeSessionId = `${Date.now()}-${Math.round(Math.random() * 100000)}`;
  chrome.storage.local.set({
    coffeeBrewMode: activeMode.id,
    coffeeBrewLabel: activeMode.label,
    coffeeRunning: true,
    coffeeStartedAt: Date.now() - (duration - nextRemaining),
    coffeePausedRemainingMs: nextRemaining,
    coffeeSessionId,
    completedCoffeeSessionId: null,
    breakRunning: false,
    breakStartedAt: null
  });
});

timerRefill.addEventListener("click", () => {
  const activeMode = getBrewMode(settings.coffeeBrewMode);
  const duration = activeMode.durationMs;
  chrome.storage.local.set({
    coffeeRunning: false,
    coffeeStartedAt: null,
    coffeePausedRemainingMs: duration,
    coffeeDurationMs: duration,
    coffeeBrewMode: activeMode.id,
    coffeeBrewLabel: activeMode.label,
    breakRunning: false,
    breakStartedAt: null
  });
});

function selectBrewMode(modeId) {
  const mode = getBrewMode(modeId);
  if (settings.coffeeRunning) return;

  const remaining = getCoffeeRemaining(settings);
  const currentDuration = getValidDuration(settings.coffeeDurationMs);
  if (remaining < currentDuration && remaining > 0) return;

  chrome.storage.local.set({
    coffeeDurationMs: mode.durationMs,
    coffeePausedRemainingMs: mode.durationMs,
    coffeeBrewMode: mode.id,
    coffeeBrewLabel: mode.label,
    coffeeRunning: false,
    coffeeStartedAt: null,
    coffeeSessionId: null,
    completedCoffeeSessionId: null,
    breakRunning: false,
    breakStartedAt: null
  });
}
