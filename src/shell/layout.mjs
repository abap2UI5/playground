// The two things the page does with its own shape: a draggable split at desk
// width, and tabs when there is not enough of it.

const STORAGE_KEY = "abap2ui5-playground:split";
const MIN = 20;
const MAX = 80;

export function setUpSplitter() {
  const panes = document.getElementById("panes");
  const splitter = document.getElementById("splitter");

  const apply = (percent) => {
    const clamped = Math.min(MAX, Math.max(MIN, percent));
    panes.style.setProperty("--left", `${clamped}%`);
    return clamped;
  };

  const stored = Number(localStorage.getItem(STORAGE_KEY));
  if (Number.isFinite(stored) && stored > 0) apply(stored);

  const percentFromEvent = (e) => {
    const box = panes.getBoundingClientRect();
    return ((e.clientX - box.left) / box.width) * 100;
  };

  splitter.addEventListener("pointerdown", (e) => {
    splitter.setPointerCapture(e.pointerId);
    splitter.classList.add("is-dragging");
    panes.classList.add("is-dragging");
  });

  splitter.addEventListener("pointermove", (e) => {
    if (!splitter.hasPointerCapture(e.pointerId)) return;
    apply(percentFromEvent(e));
  });

  const stop = (e) => {
    if (!splitter.hasPointerCapture?.(e.pointerId)) return;
    splitter.releasePointerCapture(e.pointerId);
    splitter.classList.remove("is-dragging");
    panes.classList.remove("is-dragging");
    localStorage.setItem(STORAGE_KEY, String(apply(percentFromEvent(e))));
  };
  splitter.addEventListener("pointerup", stop);
  splitter.addEventListener("pointercancel", stop);

  // The split is a control, so it answers the keyboard as one.
  splitter.addEventListener("keydown", (e) => {
    const step = e.key === "ArrowLeft" ? -2 : e.key === "ArrowRight" ? 2 : 0;
    if (step === 0) return;
    e.preventDefault();
    const current = parseFloat(getComputedStyle(panes).getPropertyValue("--left")) || 50;
    localStorage.setItem(STORAGE_KEY, String(apply(current + step)));
  });
}

// On a narrow screen the two panes share the space instead of splitting it.
// The tab strip is invisible at desk width, so this is wired unconditionally
// and simply never used there.
//
// `appOnly` is not an optimisation. ?view=app has ONE pane, and the narrow
// layout's job is to bring one of two to the front - it brought the editor,
// which app-only mode has hidden in CSS, and hid the app behind it. The result
// was an empty box: no editor because the mode says so, no app because a tab
// nobody can see says so. And 820px is not an edge case here, it is the normal
// case - the reading column of a documentation page is narrower than that, so
// every embedded demo on every page was blank.
export function setUpTabs(appOnly = false) {
  if (appOnly) return { show: () => {} };

  const tabs = [...document.querySelectorAll(".tab")];
  const wide = window.matchMedia("(min-width: 821px)");

  // Brings one pane to the front. At desk width both are on screen side by
  // side, so this only records which tab would be active and leaves the panes
  // alone - hiding the editor because somebody picked a sample would be a
  // strange thing for a wide window to do.
  const show = (which) => {
    for (const tab of tabs) tab.classList.toggle("is-active", tab.dataset.pane === which);
    if (wide.matches) return;
    document.getElementById("pane-left").hidden = which !== "left";
    document.getElementById("pane-right").hidden = which !== "right";
  };

  for (const tab of tabs) tab.addEventListener("click", () => show(tab.dataset.pane));

  // Leaving the narrow layout must not leave a pane hidden behind it.
  const reset = () => {
    if (wide.matches) {
      document.getElementById("pane-left").hidden = false;
      document.getElementById("pane-right").hidden = false;
    } else {
      show(tabs.find((t) => t.classList.contains("is-active"))?.dataset.pane ?? "left");
    }
  };
  wide.addEventListener("change", reset);
  reset();

  return { show };
}
