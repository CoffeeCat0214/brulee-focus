/* The one definition of what a CoffeeCat session is.
 *
 * Four surfaces need it: the background service worker (which owns session
 * completion), the content script (float + intermission), the popup, and the
 * screenshot harnesses. Before this file existed, the defaults, the brew table,
 * the remaining-time maths and the stats normalisation were copy-pasted between
 * content.js and popup.js -- two copies that had to be kept in step by hand, and
 * a test that could only check that the same storage *keys* appeared in both.
 * Adding the service worker would have made three.
 *
 * Loaded as a plain script that assigns a global, exactly like the generated
 * src/mug-geometry.js next to it. Not an ES module, because the same file has to
 * be reachable three different ways: a manifest content_scripts entry, a <script>
 * tag in the popup, and importScripts() in a classic service worker. A global is
 * the one shape all three accept without a build step, and this repo has no build
 * step on purpose.
 *
 * Everything here is pure. No chrome.* calls: storage access differs per surface
 * (the worker awaits promises, the content script wraps callbacks in its own
 * error handling), and mixing I/O in would force all three into one style.
 */

(function coffeeCatSettings(scope) {
  const FOCUS_DURATION_MS = 25 * 60 * 1000;
  const BREAK_DURATION_MS = 5 * 60 * 1000;

  /* Modes differ by duration only. The intermission used to be per-mode, which
     meant three of the four modes ended in silence -- the timer expired and
     nothing on screen said so. Every finished session ends in one now, so the
     flag that used to gate it is gone rather than set to true four times.

     `status` and `copy` are read only by the popup. They live here anyway
     because a mode whose duration and whose description disagree is the exact
     drift this file exists to prevent, and the five minutes quoted in `copy` is
     BREAK_DURATION_MS above. Do not add copy you cannot point at an
     implementation for -- test_brew_modes_match_markup enforces that. */
  const BREW_MODES = Object.freeze({
    espresso: Object.freeze({
      id: "espresso",
      label: "Espresso Shot",
      durationMs: 25 * 60 * 1000,
      status: "espresso focus",
      copy: "25 minutes, then a five-minute intermission."
    }),
    "slow-pour": Object.freeze({
      id: "slow-pour",
      label: "Slow Pour",
      durationMs: 45 * 60 * 1000,
      status: "slow pour focus",
      copy: "45 minutes, then a five-minute intermission."
    }),
    "cold-brew": Object.freeze({
      id: "cold-brew",
      label: "Cold Brew",
      durationMs: 90 * 60 * 1000,
      status: "deep cold brew",
      copy: "90 minutes, then a five-minute intermission."
    }),
    decaf: Object.freeze({
      id: "decaf",
      label: "Decaf",
      durationMs: 15 * 60 * 1000,
      status: "gentle decaf",
      copy: "15 minutes, then a five-minute intermission."
    })
  });

  const DEFAULT_BREW_MODE = BREW_MODES.espresso;

  const SIZE_MAP = Object.freeze({
    small: 64,
    medium: 88,
    large: 116
  });

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    size: "medium",
    position: null,
    coffeeDurationMs: FOCUS_DURATION_MS,
    coffeePausedRemainingMs: FOCUS_DURATION_MS,
    coffeeBrewMode: "espresso",
    coffeeBrewLabel: "Espresso Shot",
    coffeeRunning: false,
    coffeeStartedAt: null,
    coffeeSessionId: null,
    completedCoffeeSessionId: null,
    /* The intermission's state. These three keep the older "break" name on
       purpose: they are persisted, so renaming them means a migration and an
       orphaned key in every existing install, and nobody can see a storage key.
       The rule is that "intermission" names what is on screen and "break" names
       what is in storage. */
    breakRunning: false,
    breakStartedAt: null,
    breakDurationMs: BREAK_DURATION_MS,
    focusStats: Object.freeze({
      sessionsCompleted: 0,
      minutesProtected: 0,
      cupsFinished: 0
    })
  });

  function getBrewMode(modeId) {
    return BREW_MODES[modeId] || DEFAULT_BREW_MODE;
  }

  function getNonNegativeInteger(value) {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
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

  function normalizeFocusStats(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      sessionsCompleted: getNonNegativeInteger(source.sessionsCompleted),
      minutesProtected: getNonNegativeInteger(source.minutesProtected),
      cupsFinished: getNonNegativeInteger(source.cupsFinished)
    };
  }

  /* Anything read out of storage goes through this before it is trusted.
     Storage is user-writable in practice (devtools, a synced value from an older
     build, a half-applied write), and every consumer divides by a duration. */
  function normalizeSettings(source) {
    const input = source && typeof source === "object" ? source : {};
    const brewMode = getBrewMode(input.coffeeBrewMode);
    const coffeeDurationMs = getValidDuration(input.coffeeDurationMs);
    return {
      ...DEFAULT_SETTINGS,
      ...input,
      size: SIZE_MAP[input.size] ? input.size : DEFAULT_SETTINGS.size,
      breakDurationMs: getValidBreakDuration(input.breakDurationMs),
      focusStats: normalizeFocusStats(input.focusStats),
      coffeeBrewMode: brewMode.id,
      coffeeBrewLabel: typeof input.coffeeBrewLabel === "string" && input.coffeeBrewLabel.trim()
        ? input.coffeeBrewLabel
        : brewMode.label,
      coffeeDurationMs,
      coffeePausedRemainingMs: getValidRemaining(input.coffeePausedRemainingMs, coffeeDurationMs)
    };
  }

  /* Derived from timestamps, never counted down in a variable. That is what lets
     four surfaces agree without talking to each other, and what makes the clock
     survive a service worker being torn down mid-session. */
  function getCoffeeRemaining(source) {
    const duration = getValidDuration(source.coffeeDurationMs);
    const pausedRemaining = getValidRemaining(source.coffeePausedRemainingMs, duration);

    if (!source.coffeeRunning || !Number.isFinite(source.coffeeStartedAt)) {
      return pausedRemaining;
    }

    return Math.max(0, duration - (Date.now() - source.coffeeStartedAt));
  }

  function getBreakRemaining(source) {
    const duration = getValidBreakDuration(source.breakDurationMs);
    if (!source.breakRunning || !Number.isFinite(source.breakStartedAt)) {
      return duration;
    }

    return Math.max(0, duration - (Date.now() - source.breakStartedAt));
  }

  /* The storage patch that ends a focus session and opens the intermission.
     Returned rather than written so the caller decides where it goes -- the
     service worker writes it, and it is the only thing that does.
     Null when this session has already been completed: completedCoffeeSessionId
     is what makes completion idempotent across worker restarts. */
  function buildCompletionPatch(settings) {
    if (!settings.coffeeSessionId || settings.completedCoffeeSessionId === settings.coffeeSessionId) {
      return null;
    }

    const duration = getValidDuration(settings.coffeeDurationMs);
    const stats = normalizeFocusStats(settings.focusStats);

    return {
      coffeeRunning: false,
      coffeeStartedAt: null,
      coffeePausedRemainingMs: 0,
      completedCoffeeSessionId: settings.coffeeSessionId,
      breakRunning: true,
      breakStartedAt: Date.now(),
      focusStats: {
        sessionsCompleted: stats.sessionsCompleted + 1,
        minutesProtected: stats.minutesProtected + Math.round(duration / 60000),
        cupsFinished: stats.cupsFinished + 1
      }
    };
  }

  function formatTime(milliseconds) {
    const totalSeconds = Math.ceil(Math.max(0, milliseconds) / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  scope.COFFEECAT = Object.freeze({
    BREW_MODES,
    DEFAULT_BREW_MODE,
    DEFAULT_SETTINGS,
    SIZE_MAP,
    buildCompletionPatch,
    formatTime,
    getBreakRemaining,
    getBrewMode,
    getCoffeeRemaining,
    getNonNegativeInteger,
    getValidBreakDuration,
    getValidDuration,
    getValidRemaining,
    normalizeFocusStats,
    normalizeSettings
  });
})(globalThis);
