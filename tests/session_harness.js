/* Behavioural test for the focus-session state machine.
 *
 * Run by tests/test_extension_integrity.py under JavaScriptCore, concatenated
 * after tests/session_mocks.js, src/settings.js and src/background.js. Prints one
 * line per outcome and exits non-zero on the first failure.
 *
 * Everything else in the suite is static analysis: it reads the sources as text
 * and checks that the right names appear in the right files. That catches drift,
 * and it caught the duplicated brew table, but it cannot tell you whether
 * completing a session increments the stats exactly once, or whether a duplicate
 * alarm delivery double-counts it. Those are the questions that matter for the
 * one piece of logic in this extension with any state in it, and they are
 * answerable without a browser: src/settings.js is pure and src/background.js
 * touches exactly three chrome.* surfaces, all mocked in session_mocks.js.
 */

/* ── Helpers ─────────────────────────────────────────────────────────── */

const MINUTE = 60 * 1000;

function reset(initial) {
  store = { ...initial };
  alarms = {};
  writes = 0;
}

/* Drain the microtask queue until nothing is left to run.
 *
 * Every mock resolves synchronously, so there are no timers to wait on -- but
 * "no timers" is not "one turn". A completion write fires storage.onChanged,
 * which starts a SECOND reconcile that interleaves with the first, and each of
 * them awaits a storage read and two alarm calls. Draining a fixed small number
 * of turns reads as a product bug (an alarm that was merely not armed yet looks
 * exactly like an alarm that was never armed), so drain generously instead. */
async function settle() {
  for (let turn = 0; turn < 200; turn += 1) {
    await Promise.resolve();
  }
}

function startedSession({ durationMs = 25 * MINUTE, elapsedMs = 0, stats } = {}) {
  return {
    coffeeRunning: true,
    coffeeStartedAt: NOW - elapsedMs,
    coffeeDurationMs: durationMs,
    coffeePausedRemainingMs: durationMs,
    coffeeSessionId: "session-1",
    completedCoffeeSessionId: null,
    breakRunning: false,
    breakStartedAt: null,
    focusStats: stats || { sessionsCompleted: 0, minutesProtected: 0, cupsFinished: 0 }
  };
}

async function main() {
  const FOCUS_ALARM = "brulee-focus-end";
  const BREAK_ALARM = "brulee-break-end";

  /* ── A running session schedules exactly one alarm, at its real expiry ── */
  scenario = "running session schedules its expiry";
  reset(startedSession({ elapsedMs: 5 * MINUTE }));
  await globalThis.__onStartup();
  await settle();
  check("alarm names", Object.keys(alarms), [FOCUS_ALARM]);
  check("fires 20 minutes out", alarms[FOCUS_ALARM] - NOW, 20 * MINUTE);
  check("nothing written yet", writes, 0);

  /* ── Expiry completes the session once ─────────────────────────────── */
  scenario = "expiry completes the session";
  reset(startedSession({ elapsedMs: 5 * MINUTE }));
  await globalThis.__onStartup();
  await settle();
  NOW += 20 * MINUTE;
  await globalThis.__fireAlarm({ name: FOCUS_ALARM });
  await settle();
  check("focus stopped", store.coffeeRunning, false);
  check("intermission opened", store.breakRunning, true);
  check("intermission dated now", store.breakStartedAt, NOW);
  check("session marked complete", store.completedCoffeeSessionId, "session-1");
  check("stats", store.focusStats, {
    sessionsCompleted: 1,
    minutesProtected: 25,
    cupsFinished: 1
  });
  check("break alarm armed", alarms[BREAK_ALARM] - NOW, 5 * MINUTE);
  checkThat("focus alarm cleared", !(FOCUS_ALARM in alarms));

  /* ── A duplicate alarm delivery must not double-count ──────────────── */
  scenario = "duplicate alarm delivery is idempotent";
  const afterFirst = clone(store.focusStats);
  const writesAfterFirst = writes;
  await globalThis.__fireAlarm({ name: FOCUS_ALARM });
  await settle();
  await globalThis.__fireAlarm({ name: FOCUS_ALARM });
  await settle();
  check("stats unchanged", store.focusStats, afterFirst);
  check("no further writes", writes, writesAfterFirst);

  /* ── A lost alarm still completes, on the next thing that wakes us ──
     This is the case the old design got wrong in the other direction: with no
     page open nothing ticked and the session simply never ended. Here the alarm
     never fires at all and startup settles it. */
  scenario = "already-expired session completes without its alarm";
  reset(startedSession({ elapsedMs: 40 * MINUTE }));
  await globalThis.__onInstalled();
  await settle();
  check("focus stopped", store.coffeeRunning, false);
  check("intermission opened", store.breakRunning, true);
  check("counted once", store.focusStats.sessionsCompleted, 1);

  /* ── Pausing clears the alarm ──────────────────────────────────────── */
  scenario = "pausing clears the expiry alarm";
  reset(startedSession({ elapsedMs: 5 * MINUTE }));
  await globalThis.__onStartup();
  await settle();
  checkThat("armed while running", FOCUS_ALARM in alarms);
  await chrome.storage.local.set({
    coffeeRunning: false,
    coffeeStartedAt: null,
    coffeePausedRemainingMs: 20 * MINUTE
  });
  await settle();
  checkThat("cleared while paused", !(FOCUS_ALARM in alarms));
  check("not completed", store.completedCoffeeSessionId, null);

  /* ── The intermission ends on its own alarm ────────────────────────── */
  scenario = "intermission expiry clears the stored flag";
  reset({
    coffeeRunning: false,
    breakRunning: true,
    breakStartedAt: NOW,
    breakDurationMs: 5 * MINUTE
  });
  await globalThis.__onStartup();
  await settle();
  check("break alarm armed", alarms[BREAK_ALARM] - NOW, 5 * MINUTE);
  NOW += 5 * MINUTE;
  await globalThis.__fireAlarm({ name: BREAK_ALARM });
  await settle();
  check("break cleared", store.breakRunning, false);
  check("start time cleared", store.breakStartedAt, null);
  checkThat("break alarm cleared", !(BREAK_ALARM in alarms));

  /* ── Non-timing writes must not rearm anything ─────────────────────
     Dragging the cat writes a position several times a second. Rescheduling on
     that would clear and recreate the alarm on every pointer move. */
  scenario = "dragging the cat does not touch the alarms";
  reset(startedSession({ elapsedMs: 5 * MINUTE }));
  await globalThis.__onStartup();
  await settle();
  const armedAt = alarms[FOCUS_ALARM];
  NOW += 1000;
  await chrome.storage.local.set({ position: { x: 10, y: 20 } });
  await settle();
  check("alarm untouched", alarms[FOCUS_ALARM], armedAt);

  /* ── A session with no id is not a session ─────────────────────────
     coffeeSessionId is what makes completion idempotent. Without one there is
     nothing to mark complete, so stats must not move. */
  scenario = "expired session with no id does not count";
  reset({
    coffeeRunning: true,
    coffeeStartedAt: NOW - 40 * MINUTE,
    coffeeDurationMs: 25 * MINUTE,
    coffeeSessionId: null,
    focusStats: { sessionsCompleted: 0, minutesProtected: 0, cupsFinished: 0 }
  });
  await globalThis.__onStartup();
  await settle();
  check("stats untouched", store.focusStats.sessionsCompleted, 0);

  if (failures.length) {
    print(`FAIL (${failures.length})`);
    for (const failure of failures) print("  " + failure);
    throw new Error(`${failures.length} session assertions failed`);
  }
  print("OK session state machine");
}

main();
