const DEFAULT_SETTINGS = {
  enabled: true,
  size: "medium",
  position: null,
  coffeeDurationMs: 25 * 60 * 1000,
  coffeePausedRemainingMs: 25 * 60 * 1000,
  coffeeBrewMode: "espresso",
  coffeeBrewLabel: "Espresso Shot",
  coffeeBreakOnComplete: false,
  coffeeRunning: false,
  coffeeStartedAt: null,
  coffeeSessionId: null,
  completedCoffeeSessionId: null,
  breakRunning: false,
  breakStartedAt: null,
  breakDurationMs: 5 * 60 * 1000,
  snoozeUsedForSession: false,
  snoozeSessionRunning: false,
  focusStats: {
    sessionsCompleted: 0,
    minutesProtected: 0,
    cupsFinished: 0
  }
};
const COFFEE_RENDER_INTERVAL_MS = 250;
const SIZES = ["small", "medium", "large"];
// Height of the cup's clipped interior in SVG user units. The liquid group
// translates down by (1 - progress) * this to drain.
const CUP_INTERIOR_HEIGHT = 55;

/* Every string here must be checkable against the code in this repo. Earlier
   versions carried fields describing a per-mode background-audio system and
   named characters, none of which exist: the only sound path is playPurr() in
   content.js, and there is a single cat image. `copy` therefore states
   duration and break behaviour only — both are fields on this same object.
   test_brew_modes_match_markup enforces this; do not add copy you cannot
   point at an implementation for. */
const BREW_MODES = {
  espresso: {
    id: "espresso",
    label: "Espresso Shot",
    durationMs: 25 * 60 * 1000,
    breakOnComplete: false,
    status: "espresso focus",
    copy: "25 minutes, straight through."
  },
  "slow-pour": {
    id: "slow-pour",
    label: "Slow Pour",
    durationMs: 45 * 60 * 1000,
    breakOnComplete: true,
    status: "slow pour focus",
    copy: "45 minutes, then a 5-minute coffee flood."
  },
  "cold-brew": {
    id: "cold-brew",
    label: "Cold Brew",
    durationMs: 90 * 60 * 1000,
    breakOnComplete: false,
    status: "deep cold brew",
    copy: "90 minutes. Deep work, no interruptions."
  },
  decaf: {
    id: "decaf",
    label: "Decaf",
    durationMs: 15 * 60 * 1000,
    breakOnComplete: false,
    status: "gentle decaf",
    copy: "15 minutes. A low-pressure start."
  }
};
const DEFAULT_BREW_MODE = BREW_MODES.espresso;

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
const statSessions = document.getElementById("stat-sessions");
const statMinutes = document.getElementById("stat-minutes");
const statCups = document.getElementById("stat-cups");

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
  size: null,
  stats: null
};

chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
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
  if (areaName !== "sync") return;

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
  renderStats();
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

  if (settings.coffeeRunning && remaining <= 0) {
    completeFocusSession();
  }
}

/* Deliberately does not repeat the brew label — the selected segment already
   names the mode directly below this caption. */
function getStatusText(activeMode, remaining, duration) {
  if (settings.breakRunning) return "break time";
  if (remaining <= 0) return "complete";
  if (settings.coffeeRunning) return activeMode.status;
  if (remaining < duration) return "paused";
  return "ready to brew";
}

/* Mode copy only changes when the mode or the lock state does — not 4x/sec. */
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

function renderStats() {
  const stats = settings.focusStats;
  write("stats", `${stats.sessionsCompleted}|${stats.minutesProtected}|${stats.cupsFinished}`, () => {
    statSessions.textContent = String(stats.sessionsCompleted);
    statMinutes.textContent = String(stats.minutesProtected);
    statCups.textContent = String(stats.cupsFinished);
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
  chrome.storage.sync.set({ size: option.dataset.size });
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
  chrome.storage.sync.set({ enabled: enabledInput.checked });
});

resetButton.addEventListener("click", () => {
  chrome.storage.sync.set({ position: null });
});

timerToggle.addEventListener("click", () => {
  const activeMode = getBrewMode(settings.coffeeBrewMode);
  const duration = getValidDuration(settings.coffeeDurationMs);
  const remaining = getCoffeeRemaining(settings);

  if (settings.coffeeRunning && remaining > 0) {
    chrome.storage.sync.set({
      coffeeRunning: false,
      coffeeStartedAt: null,
      coffeePausedRemainingMs: remaining
    });
    return;
  }

  const nextRemaining = remaining || duration;
  const coffeeSessionId = `${Date.now()}-${Math.round(Math.random() * 100000)}`;
  chrome.storage.sync.set({
    coffeeBrewMode: activeMode.id,
    coffeeBrewLabel: activeMode.label,
    coffeeBreakOnComplete: activeMode.breakOnComplete,
    coffeeRunning: true,
    coffeeStartedAt: Date.now() - (duration - nextRemaining),
    coffeePausedRemainingMs: nextRemaining,
    coffeeSessionId,
    completedCoffeeSessionId: null,
    breakRunning: false,
    breakStartedAt: null,
    snoozeUsedForSession: false,
    snoozeSessionRunning: false
  });
});

timerRefill.addEventListener("click", () => {
  const activeMode = getBrewMode(settings.coffeeBrewMode);
  const duration = activeMode.durationMs;
  chrome.storage.sync.set({
    coffeeRunning: false,
    coffeeStartedAt: null,
    coffeePausedRemainingMs: duration,
    coffeeDurationMs: duration,
    coffeeBrewMode: activeMode.id,
    coffeeBrewLabel: activeMode.label,
    coffeeBreakOnComplete: activeMode.breakOnComplete,
    breakRunning: false,
    breakStartedAt: null,
    snoozeUsedForSession: false,
    snoozeSessionRunning: false
  });
});

function selectBrewMode(modeId) {
  const mode = getBrewMode(modeId);
  if (settings.coffeeRunning) return;

  const remaining = getCoffeeRemaining(settings);
  const currentDuration = getValidDuration(settings.coffeeDurationMs);
  if (remaining < currentDuration && remaining > 0) return;

  chrome.storage.sync.set({
    coffeeDurationMs: mode.durationMs,
    coffeePausedRemainingMs: mode.durationMs,
    coffeeBrewMode: mode.id,
    coffeeBrewLabel: mode.label,
    coffeeBreakOnComplete: mode.breakOnComplete,
    coffeeRunning: false,
    coffeeStartedAt: null,
    coffeeSessionId: null,
    completedCoffeeSessionId: null,
    breakRunning: false,
    breakStartedAt: null,
    snoozeUsedForSession: false,
    snoozeSessionRunning: false
  });
}

function completeFocusSession() {
  if (!settings.coffeeSessionId || settings.completedCoffeeSessionId === settings.coffeeSessionId) {
    return;
  }

  const duration = getValidDuration(settings.coffeeDurationMs);
  const shouldBreak = Boolean(settings.coffeeBreakOnComplete);
  const focusStats = settings.snoozeSessionRunning
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
    breakRunning: shouldBreak,
    breakStartedAt: shouldBreak ? Date.now() : null,
    snoozeSessionRunning: false,
    focusStats
  };

  chrome.storage.sync.set({
    coffeeRunning: false,
    coffeeStartedAt: null,
    coffeePausedRemainingMs: 0,
    completedCoffeeSessionId: settings.coffeeSessionId,
    breakRunning: shouldBreak,
    breakStartedAt: settings.breakStartedAt,
    snoozeSessionRunning: false,
    focusStats
  });

  syncTicker();
}

function normalizeSettings(source) {
  const brewMode = getBrewMode(source.coffeeBrewMode);
  const coffeeDurationMs = getValidDuration(source.coffeeDurationMs);
  return {
    ...DEFAULT_SETTINGS,
    ...source,
    breakDurationMs: getValidBreakDuration(source.breakDurationMs),
    focusStats: normalizeFocusStats(source.focusStats),
    coffeeBrewMode: brewMode.id,
    coffeeBrewLabel: typeof source.coffeeBrewLabel === "string" && source.coffeeBrewLabel.trim()
      ? source.coffeeBrewLabel
      : brewMode.label,
    coffeeBreakOnComplete: typeof source.coffeeBreakOnComplete === "boolean"
      ? source.coffeeBreakOnComplete
      : brewMode.breakOnComplete,
    coffeeDurationMs,
    coffeePausedRemainingMs: getValidRemaining(
      source.coffeePausedRemainingMs,
      coffeeDurationMs
    )
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
