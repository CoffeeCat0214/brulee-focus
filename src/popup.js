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
const BREW_MODES = {
  espresso: {
    id: "espresso",
    label: "Espresso Shot",
    durationMs: 25 * 60 * 1000,
    breakOnComplete: false,
    status: "espresso focus",
    copy: "Fast, contained focus with Misu watching the door.",
    breakLabel: "No break",
    ambient: "Quiet cafe hum",
    cat: "Misu keeps watch"
  },
  "slow-pour": {
    id: "slow-pour",
    label: "Slow Pour",
    durationMs: 45 * 60 * 1000,
    breakOnComplete: true,
    status: "slow pour focus",
    copy: "A longer brew with a softer landing and a real reset at the end.",
    breakLabel: "5 min flood",
    ambient: "Rain sounds",
    cat: "Brulee naps nearby"
  },
  "cold-brew": {
    id: "cold-brew",
    label: "Cold Brew",
    durationMs: 90 * 60 * 1000,
    breakOnComplete: false,
    status: "deep cold brew",
    copy: "Deep work mode for closing the cafe and staying with one hard thing.",
    breakLabel: "Cafe closed",
    ambient: "Low room tone",
    cat: "No interruptions"
  },
  decaf: {
    id: "decaf",
    label: "Decaf",
    durationMs: 15 * 60 * 1000,
    breakOnComplete: false,
    status: "gentle decaf",
    copy: "A low-pressure start when momentum matters more than intensity.",
    breakLabel: "No break",
    ambient: "Soft start",
    cat: "No judgment"
  }
};
const DEFAULT_BREW_MODE = BREW_MODES.espresso;

const enabledInput = document.getElementById("enabled");
const sizeSelect = document.getElementById("size");
const resetButton = document.getElementById("reset-position");
const timerDisplay = document.getElementById("timer-display");
const timerStatus = document.getElementById("timer-status");
const timerToggle = document.getElementById("timer-toggle");
const timerRefill = document.getElementById("timer-refill");
const progressFill = document.getElementById("coffee-progress-fill");
const brewDeck = document.getElementById("brew-deck");
const brewOptions = Array.from(document.querySelectorAll(".brew-option"));
const brewDetailTitle = document.getElementById("brew-detail-title");
const brewDetailCopy = document.getElementById("brew-detail-copy");
const brewDetailBreak = document.getElementById("brew-detail-break");
const brewDetailAmbient = document.getElementById("brew-detail-ambient");
const brewDetailCat = document.getElementById("brew-detail-cat");
const statSessions = document.getElementById("stat-sessions");
const statMinutes = document.getElementById("stat-minutes");
const statCups = document.getElementById("stat-cups");

let settings = { ...DEFAULT_SETTINGS };
let renderTimer = null;

chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
  settings = normalizeSettings(stored);
  renderSettings();
  startRenderTimer();
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
  sizeSelect.value = ["small", "medium", "large"].includes(settings.size)
    ? settings.size
    : DEFAULT_SETTINGS.size;

  renderCoffeeTimer();
  renderStats();
}

function startRenderTimer() {
  window.clearInterval(renderTimer);
  renderCoffeeTimer();
  renderTimer = window.setInterval(renderCoffeeTimer, COFFEE_RENDER_INTERVAL_MS);
}

function renderCoffeeTimer() {
  const duration = getValidDuration(settings.coffeeDurationMs);
  const remaining = getCoffeeRemaining(settings);
  const fill = Math.max(0, Math.min(1, remaining / duration));
  const activeMode = getBrewMode(settings.coffeeBrewMode);

  timerDisplay.textContent = formatTime(remaining);
  progressFill.style.transform = `scaleY(${fill.toFixed(4)})`;
  progressFill.style.opacity = remaining <= 0 ? "0.35" : "1";
  timerToggle.textContent = settings.coffeeRunning && remaining > 0
    ? "Pause"
    : remaining < duration && remaining > 0
      ? "Resume"
      : "Start";
  renderBrewSelector(activeMode, remaining, duration);

  if (settings.coffeeRunning && remaining <= 0) {
    completeFocusSession();
  }

  if (settings.breakRunning) {
    timerStatus.textContent = "break time";
  } else if (remaining <= 0) {
    timerStatus.textContent = `${settings.coffeeBrewLabel} complete`;
  } else if (settings.coffeeRunning) {
    timerStatus.textContent = activeMode.status;
  } else if (remaining < duration) {
    timerStatus.textContent = `${settings.coffeeBrewLabel} paused`;
  } else {
    timerStatus.textContent = `ready for ${settings.coffeeBrewLabel}`;
  }
}

function renderBrewSelector(activeMode, remaining, duration) {
  const selectionLocked = settings.coffeeRunning || (remaining < duration && remaining > 0);
  brewDeck.classList.toggle("is-locked", selectionLocked);
  brewOptions.forEach((option) => {
    const isSelected = option.dataset.brewMode === activeMode.id;
    option.setAttribute("aria-pressed", String(isSelected));
    option.disabled = selectionLocked;
  });

  brewDetailTitle.textContent = activeMode.label;
  brewDetailCopy.textContent = activeMode.copy;
  brewDetailBreak.textContent = activeMode.breakLabel;
  brewDetailAmbient.textContent = activeMode.ambient;
  brewDetailCat.textContent = activeMode.cat;
}

function renderStats() {
  statSessions.textContent = String(settings.focusStats.sessionsCompleted);
  statMinutes.textContent = String(settings.focusStats.minutesProtected);
  statCups.textContent = String(settings.focusStats.cupsFinished);
}

enabledInput.addEventListener("change", () => {
  chrome.storage.sync.set({ enabled: enabledInput.checked });
});

sizeSelect.addEventListener("change", () => {
  chrome.storage.sync.set({ size: sizeSelect.value });
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

brewOptions.forEach((option) => {
  option.addEventListener("click", () => {
    selectBrewMode(option.dataset.brewMode);
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
