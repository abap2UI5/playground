// The two bits of chrome every other module needs: the status line in the bar,
// and the output panel that carries anything longer than a line.
import { announceStatus } from "./embed.mjs";

const statusEl = () => document.getElementById("status");

export function setStatus(text, isError = false) {
  const el = statusEl();
  el.textContent = text;
  el.classList.toggle("error", isError);
  // An embedded playground hides most of its bar, so the page around it is
  // where a reader would look for this. Sent from here rather than from the
  // callers, so a status that is set anywhere is a status that travels.
  announceStatus(text, isError);
}

export function showOutput(title, body) {
  document.getElementById("output-title").textContent = title;
  document.getElementById("output-body").textContent = body;
  document.getElementById("output").hidden = false;
}

export function hideOutput() {
  document.getElementById("output").hidden = true;
}

document.addEventListener("click", (e) => {
  if (e.target.id === "output-close") hideOutput();
});
