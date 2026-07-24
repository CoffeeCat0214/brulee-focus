const { FILL_WINDOW, DRAIN_RANGE } = globalThis.COFFEECAT_MUG;

const demoCup = document.querySelector(".demo-cup");
const demoFill = document.getElementById("demo-fill");

// Place the clip window from the generated geometry rather than hand-tuned
// percentages. The liquid sprite is drawn on the full mug canvas, so it is
// sized back up to the cup box and offset to cancel the window's own inset --
// the same arithmetic as the extension's content script.
demoCup.style.setProperty("--win-x", `${FILL_WINDOW.x}%`);
demoCup.style.setProperty("--win-y", `${FILL_WINDOW.y}%`);
demoCup.style.setProperty("--win-w", `${FILL_WINDOW.width}%`);
demoCup.style.setProperty("--win-h", `${FILL_WINDOW.height}%`);
demoCup.style.setProperty("--win-r", `${FILL_WINDOW.bottomRadius}%`);
demoCup.style.setProperty("--liq-w", `${10000 / FILL_WINDOW.width}%`);
demoCup.style.setProperty("--liq-h", `${10000 / FILL_WINDOW.height}%`);
demoCup.style.setProperty("--liq-x", `${(-FILL_WINDOW.x * 100) / FILL_WINDOW.width}%`);
demoCup.style.setProperty("--liq-y", `${(-FILL_WINDOW.y * 100) / FILL_WINDOW.height}%`);

const startedAt = Date.now();
const cycleMs = 9000;

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// Draws one frame of the drain at the given fill (1 = full cup, 0 = empty).
function paint(fill) {
  // Translate, never scale -- the sprite carries its own surface ellipse and
  // crema at a fixed thickness. Matches content.js and popup.js.
  demoFill.style.transform = `translateY(${((1 - fill) * DRAIN_RANGE).toFixed(4)}%)`;
}

let frame = 0;

function renderDemoCup() {
  const elapsed = (Date.now() - startedAt) % cycleMs;
  paint(Math.max(0.04, 1 - elapsed / cycleMs));
  frame = window.requestAnimationFrame(renderDemoCup);
}

// The loop used to run forever: off-screen, in background tabs, and for
// visitors who asked for reduced motion. It is decoration, so it should cost
// nothing when nobody is watching it.
function sync() {
  window.cancelAnimationFrame(frame);
  frame = 0;

  if (reduceMotion.matches) {
    // A still cup, held at a readable level rather than mid-drain.
    paint(0.62);
    return;
  }

  if (!document.hidden) {
    renderDemoCup();
  }
}

document.addEventListener("visibilitychange", sync);
reduceMotion.addEventListener("change", sync);
sync();
