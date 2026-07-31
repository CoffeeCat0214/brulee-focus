/* The only thing that ends a focus session.
 *
 * Why this file exists
 * --------------------
 * Completion used to happen wherever it was first noticed. Every mounted
 * content script ran a 250ms tick, and each one that saw the clock hit zero
 * wrote the completion patch itself. Two consequences, both bad:
 *
 *   1. N open tabs meant N near-simultaneous writes of the same patch, each of
 *      which woke every other tab's storage listener. It converged, but it was a
 *      thundering herd against a quota'd API for a once-per-25-minutes event.
 *
 *   2. With no http/https tab open, nothing was ticking, so the session simply
 *      never ended. The cup you started before switching to a chrome:// page
 *      stayed "running" until you happened to land on a normal page again, and
 *      only then did the intermission appear -- late, and dated from whenever
 *      the timer had actually expired.
 *
 * chrome.alarms is the fix for both: one owner, and it fires whether or not any
 * page is open. The content script and the popup now render the clock and
 * nothing else. They still *derive* remaining time from the same timestamps, so
 * they stay correct between alarms without needing to be told anything.
 *
 * Service worker lifetimes
 * ------------------------
 * This worker is evicted after ~30s idle and restarted on the next event, so it
 * holds no state. Everything it needs is in storage, and the clock is derived
 * from timestamps rather than counted down, which means an eviction mid-session
 * costs nothing. Alarms survive eviction; they do NOT reliably survive an
 * extension update or a browser restart, which is what reconcile() on
 * onStartup/onInstalled is for.
 *
 * reconcile() is also the safety net for a lost alarm generally: it completes
 * an already-expired session immediately rather than waiting for a fire that may
 * never come. Idempotence comes from completedCoffeeSessionId, checked inside
 * buildCompletionPatch(), so running it twice is harmless.
 */

importScripts("settings.js");

const {
  buildCompletionPatch,
  getBreakRemaining,
  getCoffeeRemaining,
  normalizeSettings,
  DEFAULT_SETTINGS
} = globalThis.COFFEECAT;

const FOCUS_ALARM = "coffeecat-focus-end";
const BREAK_ALARM = "coffeecat-break-end";

/* Keys that can change when the alarm should. Storage also carries position,
   size and enabled, and rescheduling on those would rearm the alarm every time
   someone drags the cat across the page. */
const TIMING_KEYS = [
  "coffeeRunning",
  "coffeeStartedAt",
  "coffeeDurationMs",
  "coffeeSessionId",
  "breakRunning",
  "breakStartedAt",
  "breakDurationMs"
];

async function readSettings() {
  return normalizeSettings(await chrome.storage.local.get(DEFAULT_SETTINGS));
}

/* Bring the alarms in line with what storage says, and settle anything that has
   already expired. The single entry point: every event below funnels here rather
   than each deciding for itself what to schedule. */
async function reconcile() {
  let settings = await readSettings();

  if (settings.coffeeRunning && getCoffeeRemaining(settings) <= 0) {
    const patch = buildCompletionPatch(settings);
    if (patch) {
      await chrome.storage.local.set(patch);
      settings = { ...settings, ...patch };
    }
  }

  if (settings.breakRunning && getBreakRemaining(settings) <= 0) {
    await chrome.storage.local.set({ breakRunning: false, breakStartedAt: null });
    settings = { ...settings, breakRunning: false, breakStartedAt: null };
  }

  await scheduleAlarm(FOCUS_ALARM, settings.coffeeRunning, getCoffeeRemaining(settings));
  await scheduleAlarm(BREAK_ALARM, settings.breakRunning, getBreakRemaining(settings));
}

/* `when` rather than `delayInMinutes`: the expiry is an absolute instant derived
   from a stored timestamp, and converting it to a relative delay only to have
   Chrome convert it back loses precision for no reason. */
async function scheduleAlarm(name, shouldRun, remainingMs) {
  await chrome.alarms.clear(name);
  if (!shouldRun || remainingMs <= 0) return;
  chrome.alarms.create(name, { when: Date.now() + remainingMs });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== FOCUS_ALARM && alarm.name !== BREAK_ALARM) return;
  // reconcile() re-reads storage and re-checks expiry rather than trusting that
  // the alarm firing means the thing it was set for is still true. The session
  // may have been paused, refilled or switched between the alarm being set and
  // it firing, in which case the right answer is to do nothing and rearm.
  reconcile();
});

chrome.runtime.onInstalled.addListener(reconcile);
chrome.runtime.onStartup.addListener(reconcile);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (!TIMING_KEYS.some((key) => key in changes)) return;
  reconcile();
});
