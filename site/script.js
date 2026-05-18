const demoFill = document.getElementById("demo-fill");
let startedAt = Date.now();
const cycleMs = 9000;

function renderDemoCup() {
  const elapsed = (Date.now() - startedAt) % cycleMs;
  const progress = 1 - elapsed / cycleMs;
  demoFill.style.transform = `scaleY(${Math.max(0.04, progress).toFixed(4)})`;
  window.requestAnimationFrame(renderDemoCup);
}

renderDemoCup();
