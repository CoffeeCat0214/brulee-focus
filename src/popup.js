const DEFAULT_SETTINGS = {
  enabled: true,
  size: "medium",
  position: null,
  coffeeDurationMs: 25 * 60 * 1000,
  coffeePausedRemainingMs: 25 * 60 * 1000,
  coffeeRunning: false,
  coffeeStartedAt: null,
  coffeeSessionId: null,
  completedCoffeeSessionId: null,
  blockedDomains: [],
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

const enabledInput = document.getElementById("enabled");
const sizeSelect = document.getElementById("size");
const resetButton = document.getElementById("reset-position");
const timerDisplay = document.getElementById("timer-display");
const timerStatus = document.getElementById("timer-status");
const timerToggle = document.getElementById("timer-toggle");
const timerRefill = document.getElementById("timer-refill");
const progressFill = document.getElementById("coffee-progress-fill");
const gatekeeperStatus = document.getElementById("gatekeeper-status");
const domainForm = document.getElementById("domain-form");
const blockedDomainInput = document.getElementById("blocked-domain");
const blockedList = document.getElementById("blocked-list");
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
  renderGatekeeper();
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

  timerDisplay.textContent = formatTime(remaining);
  progressFill.style.transform = `scaleY(${fill.toFixed(4)})`;
  progressFill.style.opacity = remaining <= 0 ? "0.35" : "1";
  timerToggle.textContent = settings.coffeeRunning && remaining > 0 ? "Pause" : "Start";

  if (settings.coffeeRunning && remaining <= 0) {
    completeFocusSession();
  }

  if (settings.breakRunning) {
    timerStatus.textContent = "break time";
  } else if (remaining <= 0) {
    timerStatus.textContent = "empty cup";
  } else if (settings.coffeeRunning) {
    timerStatus.textContent = "brewing focus";
  } else if (remaining < duration) {
    timerStatus.textContent = "paused";
  } else {
    timerStatus.textContent = "ready to brew";
  }
}

function renderGatekeeper() {
  const domains = normalizeBlockedDomains(settings.blockedDomains);
  gatekeeperStatus.textContent = domains.length
    ? `${domains.length} protected ${domains.length === 1 ? "domain" : "domains"}`
    : "add distracting domains";
  blockedList.textContent = "";

  if (!domains.length) {
    const empty = document.createElement("span");
    empty.className = "domain-chip";
    empty.textContent = "no domains yet";
    blockedList.append(empty);
    return;
  }

  domains.forEach((domain) => {
    const chip = document.createElement("span");
    chip.className = "domain-chip";
    chip.textContent = domain;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.setAttribute("aria-label", `Remove ${domain}`);
    removeButton.textContent = "x";
    removeButton.addEventListener("click", () => removeBlockedDomain(domain));

    chip.append(removeButton);
    blockedList.append(chip);
  });
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

domainForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const domain = normalizeDomain(blockedDomainInput.value);
  if (!domain) return;

  const blockedDomains = normalizeBlockedDomains([...settings.blockedDomains, domain]);
  blockedDomainInput.value = "";
  chrome.storage.sync.set({ blockedDomains });
});

timerToggle.addEventListener("click", () => {
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
    coffeeRunning: true,
    coffeeStartedAt: Date.now() - (duration - nextRemaining),
    coffeePausedRemainingMs: nextRemaining,
    coffeeSessionId,
    breakRunning: false,
    breakStartedAt: null,
    snoozeUsedForSession: false,
    snoozeSessionRunning: false
  });
});

timerRefill.addEventListener("click", () => {
  const duration = getValidDuration(settings.coffeeDurationMs);
  chrome.storage.sync.set({
    coffeeRunning: false,
    coffeeStartedAt: null,
    coffeePausedRemainingMs: duration,
    breakRunning: false,
    breakStartedAt: null,
    snoozeUsedForSession: false,
    snoozeSessionRunning: false
  });
});

function removeBlockedDomain(domain) {
  const blockedDomains = normalizeBlockedDomains(settings.blockedDomains).filter(
    (blockedDomain) => blockedDomain !== domain
  );
  chrome.storage.sync.set({ blockedDomains });
}

function completeFocusSession() {
  if (!settings.coffeeSessionId || settings.completedCoffeeSessionId === settings.coffeeSessionId) {
    return;
  }

  const duration = getValidDuration(settings.coffeeDurationMs);
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
    breakRunning: true,
    breakStartedAt: Date.now(),
    snoozeSessionRunning: false,
    focusStats
  };

  chrome.storage.sync.set({
    coffeeRunning: false,
    coffeeStartedAt: null,
    coffeePausedRemainingMs: 0,
    completedCoffeeSessionId: settings.coffeeSessionId,
    breakRunning: true,
    breakStartedAt: settings.breakStartedAt,
    snoozeSessionRunning: false,
    focusStats
  });
}

function normalizeSettings(source) {
  return {
    ...DEFAULT_SETTINGS,
    ...source,
    blockedDomains: normalizeBlockedDomains(source.blockedDomains),
    breakDurationMs: getValidBreakDuration(source.breakDurationMs),
    focusStats: normalizeFocusStats(source.focusStats),
    coffeeDurationMs: getValidDuration(source.coffeeDurationMs),
    coffeePausedRemainingMs: getValidRemaining(
      source.coffeePausedRemainingMs,
      source.coffeeDurationMs
    )
  };
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
