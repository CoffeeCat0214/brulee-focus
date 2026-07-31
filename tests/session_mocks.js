/* Mocks and clock for tests/session_harness.js.
 *
 * Concatenated AHEAD of src/settings.js and src/background.js so the worker's
 * first line -- importScripts("settings.js") -- has something to call, and so
 * chrome.* exists by the time background.js registers its listeners at load.
 * See the harness for what any of this is for.
 */

const failures = [];
let scenario = "(none)";

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) failures.push(`${scenario}: ${label}\n    expected ${b}\n    actual   ${a}`);
}

function checkThat(label, condition) {
  if (!condition) failures.push(`${scenario}: ${label}`);
}

/* ── Clock ───────────────────────────────────────────────────────────────
   The whole design derives remaining time from timestamps rather than counting
   down, which is exactly what makes it testable: moving time is a variable
   assignment, not a wait. */
let NOW = 1_700_000_000_000;
Date.now = () => NOW;

/* ── chrome mock ─────────────────────────────────────────────────────── */

let store = {};
let alarms = {};
let changeListeners = [];
let writes = 0;

function clone(value) {
  // Mirrors what chrome.storage actually does to values on the way in and out.
  // A Date or an undefined survives an in-memory object and does not survive
  // storage, so the mock must not be kinder than the real thing.
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

globalThis.chrome = {
  storage: {
    local: {
      async get(defaults) {
        const out = { ...clone(defaults) };
        for (const key of Object.keys(store)) out[key] = clone(store[key]);
        return out;
      },
      async set(patch) {
        writes += 1;
        const changes = {};
        for (const [key, value] of Object.entries(patch)) {
          changes[key] = { oldValue: clone(store[key]), newValue: clone(value) };
          store[key] = clone(value);
        }
        // Real listeners fire asynchronously, after set() resolves.
        for (const listener of changeListeners.slice()) listener(changes, "local");
      }
    },
    onChanged: {
      addListener(fn) {
        changeListeners.push(fn);
      }
    }
  },
  alarms: {
    async clear(name) {
      delete alarms[name];
    },
    create(name, options) {
      alarms[name] = options.when;
    },
    onAlarm: {
      addListener(fn) {
        globalThis.__fireAlarm = fn;
      }
    }
  },
  runtime: {
    onInstalled: { addListener(fn) { globalThis.__onInstalled = fn; } },
    onStartup: { addListener(fn) { globalThis.__onStartup = fn; } }
  }
};

/* background.js opens with importScripts("settings.js"). The harness loads both
   files itself (see the Python side), so this is a no-op that exists only so the
   worker's real first line does not throw. */
globalThis.importScripts = () => {};
