const { FILL_WINDOW, DRAIN_RANGE } = globalThis.COFFEECAT_MUG;

const demoCup = document.querySelector(".demo-cup");
const demoFill = document.getElementById("demo-fill");
const navToggle = document.querySelector(".nav-toggle");
const siteNav = document.getElementById("site-nav");

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

/* ---------- Mobile navigation ----------
   The section spine is useful on a long page, so mobile keeps it as a small
   disclosure instead of removing orientation altogether. */

function setNavOpen(open) {
  siteNav.classList.toggle("is-open", open);
  navToggle.setAttribute("aria-expanded", String(open));
}

navToggle.addEventListener("click", () => {
  setNavOpen(navToggle.getAttribute("aria-expanded") !== "true");
});

for (const link of siteNav.querySelectorAll("a")) {
  link.addEventListener("click", () => setNavOpen(false));
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setNavOpen(false);
});

/* ---------- Scroll reveal ----------
   The one piece of motion both reference sites lean on. Kept deliberately
   small -- 12px and 600ms -- because an obvious fade-up on every element is
   its own kind of tell.

   The hidden state is applied from here rather than from styles.css on
   purpose. As a static rule, `[data-reveal] { opacity: 0 }` hands anyone
   without JS -- or anyone whose JS fails -- a blank page. Applied from script,
   the markup is visible by default and only ever hidden by code that is
   already running and can therefore also un-hide it. */

const revealTargets = Array.from(document.querySelectorAll("[data-reveal]"));

function show(el) {
  el.classList.remove("is-hidden");
  el.classList.add("is-revealed");
}

if ("IntersectionObserver" in window && !reduceMotion.matches) {
  for (const el of revealTargets) {
    el.classList.add("is-hidden");
  }

  const observer = new IntersectionObserver(
    (entries, self) => {
      // Stagger within the batch, not against a global clock: a section that
      // scrolls into view as a unit should cascade, but a single element
      // arriving on its own should not sit waiting for a queue.
      let step = 0;

      for (const entry of entries) {
        if (!entry.isIntersecting) continue;

        // Unobserve immediately -- this fires once per element, and leaving
        // the observer live means re-entering the viewport re-runs it.
        self.unobserve(entry.target);
        window.setTimeout(show, step * 60, entry.target);
        step += 1;
      }
    },
    // The bottom inset holds the reveal until the element is properly on
    // screen rather than clipping the viewport edge.
    { rootMargin: "0px 0px -8% 0px", threshold: 0.1 }
  );

  for (const el of revealTargets) {
    observer.observe(el);
  }

  // Turning on reduced motion mid-visit must not strand whatever has not been
  // revealed yet at opacity 0.
  reduceMotion.addEventListener("change", () => {
    if (!reduceMotion.matches) return;

    observer.disconnect();

    for (const el of revealTargets) {
      el.classList.remove("is-hidden");
    }
  });
}
