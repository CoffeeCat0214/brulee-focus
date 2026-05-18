const DEFAULT_SETTINGS = {
  enabled: true,
  size: "medium",
  position: null,
  coffeeDurationMs: 25 * 60 * 1000,
  coffeePausedRemainingMs: 25 * 60 * 1000,
  coffeeRunning: false,
  coffeeStartedAt: null
};

const enabledInput = document.getElementById("enabled");
const sizeSelect = document.getElementById("size");
const resetButton = document.getElementById("reset-position");
const timerDisplay = document.getElementById("timer-display");
const timerStatus = document.getElementById("timer-status");
const timerToggle = document.getElementById("timer-toggle");
const timerRefill = document.getElementById("timer-refill");
const progressFill = document.getElementById("coffee-progress-fill");

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
}

function startRenderTimer() {
  window.clearInterval(renderTimer);
  renderCoffeeTimer();
  renderTimer = window.setInterval(renderCoffeeTimer, 1000);
}

function renderCoffeeTimer() {
  const duration = getValidDuration(settings.coffeeDurationMs);
  const remaining = getCoffeeRemaining(settings);
  const fill = Math.max(0, Math.min(1, remaining / duration));

  timerDisplay.textContent = formatTime(remaining);
  progressFill.style.transform = `scaleY(${fill.toFixed(3)})`;
  progressFill.style.opacity = remaining <= 0 ? "0.35" : "1";
  timerToggle.textContent = settings.coffeeRunning && remaining > 0 ? "Pause" : "Start";

  if (remaining <= 0) {
    timerStatus.textContent = "empty cup";
  } else if (settings.coffeeRunning) {
    timerStatus.textContent = "brewing focus";
  } else if (remaining < duration) {
    timerStatus.textContent = "paused";
  } else {
    timerStatus.textContent = "ready to brew";
  }
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
  chrome.storage.sync.set({
    coffeeRunning: true,
    coffeeStartedAt: Date.now() - (duration - nextRemaining),
    coffeePausedRemainingMs: nextRemaining
  });
});

timerRefill.addEventListener("click", () => {
  const duration = getValidDuration(settings.coffeeDurationMs);
  chrome.storage.sync.set({
    coffeeRunning: false,
    coffeeStartedAt: null,
    coffeePausedRemainingMs: duration
  });
});

function normalizeSettings(source) {
  return {
    ...DEFAULT_SETTINGS,
    ...source,
    coffeeDurationMs: getValidDuration(source.coffeeDurationMs),
    coffeePausedRemainingMs: getValidRemaining(
      source.coffeePausedRemainingMs,
      source.coffeeDurationMs
    )
  };
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

function formatTime(milliseconds) {
  const totalSeconds = Math.ceil(Math.max(0, milliseconds) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
