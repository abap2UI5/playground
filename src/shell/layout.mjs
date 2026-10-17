// The things the page does with its own shape: a draggable split at desk
// width, and tabs when there is not enough of it - and the toolbar's menu,
// which holds what its one row on a phone has no room for.
import { readStored, writeStored } from "./storage.mjs";

const STORAGE_KEY = "abap2ui5-playground:split";
const MIN = 20;
const MAX = 80;

export function setUpSplitter() {
  const panes = document.getElementById("panes");
  const splitter = document.getElementById("splitter");

  const apply = (percent) => {
    const clamped = Math.min(MAX, Math.max(MIN, percent));
    panes.style.setProperty("--left", `${clamped}%`);
    // A focusable separator owes a screen reader its value.
    splitter.setAttribute("aria-valuenow", String(Math.round(clamped)));
    return clamped;
  };

  const stored = Number(readStored(STORAGE_KEY));
  if (Number.isFinite(stored) && stored > 0) apply(stored);

  const percentFromEvent = (e) => {
    const box = panes.getBoundingClientRect();
    return ((e.clientX - box.left) / box.width) * 100;
  };

  splitter.addEventListener("pointerdown", (e) => {
    /* The primary button only: a right click opens the context menu, whose
       pointerup never arrives here, and the page stayed in its dragging state
       - no selection, the resize cursor - until the splitter was touched again. */
    if (e.button !== 0 || !e.isPrimary) return;
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
    // A cancelled pointer carries no position worth trusting (often 0, 0):
    // what the last move applied is what is kept.
    const percent = e.type === "pointercancel"
      ? parseFloat(getComputedStyle(panes).getPropertyValue("--left"))
      : apply(percentFromEvent(e));
    if (Number.isFinite(percent)) writeStored(STORAGE_KEY, String(percent));
  };
  splitter.addEventListener("pointerup", stop);
  splitter.addEventListener("pointercancel", stop);

  // The split is a control, so it answers the keyboard as one.
  splitter.addEventListener("keydown", (e) => {
    const step = e.key === "ArrowLeft" ? -2 : e.key === "ArrowRight" ? 2 : 0;
    if (step === 0) return;
    e.preventDefault();
    const current = parseFloat(getComputedStyle(panes).getPropertyValue("--left")) || 50;
    writeStored(STORAGE_KEY, String(apply(current + step)));
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
  // The one query the stylesheet and the panel use (max-width: 820px), negated,
  // rather than a min-width one pixel up: a fractional viewport - 125% zoom
  // puts 1026 device pixels at 820.8 - matched neither, and the CSS drew the
  // desk split while this hid a pane as if the page were narrow.
  const narrow = window.matchMedia("(max-width: 820px)");
  const wide = { get matches() { return !narrow.matches; }, addEventListener: (type, fn) => narrow.addEventListener(type, fn) };

  // Brings one pane to the front. At desk width both are on screen side by
  // side, so this only records which tab would be active and leaves the panes
  // alone - hiding the editor because somebody picked a sample would be a
  // strange thing for a wide window to do.
  const show = (which) => {
    for (const tab of tabs) {
      const active = tab.dataset.pane === which;
      tab.classList.toggle("is-active", active);
      // The class is what it looks like; this is what it is. Without it a
      // screen reader reads two tabs and cannot say which one is open.
      tab.setAttribute("aria-selected", String(active));
    }
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

// The toolbar on a phone: one row, and the rest one tap away.
//
// At desk width the workbench is one row with room to spare. On a 390px phone
// it wrapped to two, with the About button alone on the second - together
// with the project's bar and the tab strip, more than a third of the screen
// was chrome before the editor or the app had any of it. So below the same
// 820px at which the split turns into tabs, the controls marked
// `data-overflow` in index.html - Format, Auto, and everything right of the
// status line - move into a menu behind the row's last button, and the row
// keeps Undo, Redo, Samples, Run and the status line. MOVED, not copied: the
// same elements with the same ids and listeners, so nothing else on the page
// knows where they are, and the order a keyboard meets them in is the order
// on screen at either width. Until this runs the stylesheet keeps them off
// the phone's row, so the row does not first wrap and then snap back.
export function setUpToolbarMenu() {
  const toggle = document.getElementById("toolbar-more");
  const menu = document.getElementById("toolbar-menu");
  if (!toggle || !menu) return;
  const narrow = window.matchMedia("(max-width: 820px)");
  // Each control's place in the row, held by an empty comment before it, so
  // it goes back exactly where it was.
  const places = [...document.querySelectorAll(".toolbar > [data-overflow]")].map((control) => {
    const mark = document.createComment("");
    control.before(mark);
    return { control, mark };
  });

  const close = ({ focus = false } = {}) => {
    if (menu.hidden) return;
    menu.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    if (focus) toggle.focus();
  };
  const place = () => {
    close();
    for (const { control, mark } of places) {
      if (narrow.matches) menu.append(control);
      else mark.after(control);
    }
  };
  narrow.addEventListener("change", place);
  place();

  toggle.addEventListener("click", () => {
    const opening = menu.hidden;
    menu.hidden = !opening;
    toggle.setAttribute("aria-expanded", String(opening));
  });
  // Closed the ways a menu is expected to close: a click anywhere else, a
  // click into the app frame (no click in this document - the window losing
  // the focus to a frame of its own is what it looks like from here), and
  // Escape, which hands the focus back to the button.
  document.addEventListener("click", (e) => {
    if (!toggle.contains(e.target) && !menu.contains(e.target)) close();
  });
  addEventListener("blur", () => {
    if (document.activeElement?.tagName === "IFRAME") close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close({ focus: menu.contains(document.activeElement) });
  });
  // And once something in it is chosen - a dialog, a new tab, the status line
  // saying what Format did, which the open menu would cover. Not after Auto:
  // a switch whose new state is the thing worth seeing.
  menu.addEventListener("click", (e) => {
    const chosen = e.target instanceof Element ? e.target.closest("button, a") : null;
    if (chosen && chosen.id !== "autorun") close();
  });
}
