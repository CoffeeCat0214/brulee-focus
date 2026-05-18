const DEFAULT_SETTINGS = {
  enabled: true,
  size: "medium",
  position: null
};

const enabledInput = document.getElementById("enabled");
const sizeSelect = document.getElementById("size");
const resetButton = document.getElementById("reset-position");

chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
  enabledInput.checked = Boolean(settings.enabled);
  sizeSelect.value = ["small", "medium", "large"].includes(settings.size)
    ? settings.size
    : DEFAULT_SETTINGS.size;
});

enabledInput.addEventListener("change", () => {
  chrome.storage.sync.set({ enabled: enabledInput.checked });
});

sizeSelect.addEventListener("change", () => {
  chrome.storage.sync.set({ size: sizeSelect.value });
});

resetButton.addEventListener("click", () => {
  chrome.storage.sync.set({ position: null });
});
