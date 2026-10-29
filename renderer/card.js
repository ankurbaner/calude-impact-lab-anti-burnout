// Renderer for the recovery card. Pure presentation: it receives a content
// object from the main process and draws it. It has no access to Node, the
// filesystem, or anything about the screen — only the bridge in preload.ts.

/**
 * Measure the drawn card and ask the main process to fit the window to it.
 * Card copy varies in length, so a fixed window height either clips the
 * buttons on long cards or leaves dead space on short ones.
 */
const reportHeight = () => {
  const card = document.querySelector(".card");
  if (!card) return;
  const body = document.body;
  const padding =
    parseFloat(getComputedStyle(body).paddingTop) +
    parseFloat(getComputedStyle(body).paddingBottom);
  // Round up: a fractional shortfall still produces a scrollbar.
  window.burnout.reportHeight(Math.ceil(card.getBoundingClientRect().height + padding));
};

/**
 * Render card content into the DOM.
 * @param {object} content - The CardContent object from the main process.
 */
const render = (content) => {
  const meta = document.getElementById("meta");
  const chip = document.getElementById("chip");
  const heading = document.getElementById("heading");
  const steps = document.getElementById("steps");
  const footnote = document.getElementById("footnote");

  const stretch = content.stretchMinutes;
  const today = content.todayMinutes;
  meta.textContent =
    today > stretch
      ? `at the screen ${stretch} min · today ${today} min`
      : `at the screen ${stretch} min`;

  chip.textContent =
    content.band === "eyes"
      ? "eyes"
      : content.band === "eyes-posture"
        ? "eyes + posture"
        : "eyes + posture + water";

  heading.textContent = content.heading;

  steps.replaceChildren();
  for (const step of content.steps) {
    const li = document.createElement("li");
    const icon = document.createElement("span");
    icon.className = "icon";
    icon.textContent = step.icon;
    const text = document.createElement("span");
    text.textContent = step.text;
    li.append(icon, text);
    steps.append(li);
  }

  if (content.footnote) {
    footnote.textContent = content.footnote;
    footnote.hidden = false;
  } else {
    footnote.hidden = true;
  }

  // Fonts can settle a frame after layout, so measure on the next frame.
  requestAnimationFrame(reportHeight);
};

document.getElementById("done").addEventListener("click", () => window.burnout.done());
document.getElementById("snooze").addEventListener("click", () => window.burnout.snooze());

window.burnout.onContent(render);
