// The two bits of chrome every other module needs: the status line in the bar,
// and the output panel that carries anything longer than a line.

const statusEl = () => document.getElementById("status");

export function setStatus(text, isError = false) {
  const el = statusEl();
  el.textContent = text;
  el.classList.toggle("error", isError);
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
