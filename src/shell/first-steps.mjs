// The hint strip a first visit gets over the editor: four things worth
// trying, each a button that does it or points at it, and a way to close it
// for good. A chunk, asked for by guides.mjs only when it is wanted.
//
// It hangs off a zero-height anchor between the editor and the panel and is
// drawn upwards from there, over the editor's last lines - so appearing and
// going costs the editor no pixel of height. Pushing the editor down by a
// row, a second or two after it had been laid out, moved the code under the
// reader's eye at the one moment they were reading it for the first time.
//
// Closed is stored (`close`, through storage.mjs, which answers rather than
// throws); a page that cannot store it shows the strip again next time, which
// is the worst that can happen and not worth more than that. Everything else
// it needs of the page is handed in by guides.mjs, which says why.

// The catalogue's size, rounded down, as of the pin: a number that is still
// true after a sample or two is dropped upstream. samples/apps.json has the
// exact count, and it is 100 KB this strip does not need.
const SAMPLE_COUNT = "800+";

export function showFirstSteps({ openSamples, showView, focusLine, source, close: closed }) {
  const editor = document.getElementById("editor");
  if (!editor || document.getElementById("first-steps")) return;

  const anchor = document.createElement("div");
  anchor.className = "first-steps-anchor";
  const strip = document.createElement("section");
  strip.id = "first-steps";
  strip.className = "first-steps";
  strip.setAttribute("aria-label", "First steps");

  const lead = document.createElement("span");
  lead.className = "first-steps-lead";
  lead.textContent = "New here? Try:";

  const list = document.createElement("ul");
  list.className = "first-steps-list";
  // Each label twice, the long and the short, and the stylesheet shows the
  // one the editor's width has room for (a container query on the anchor):
  // one line at every width is the point of a strip, and the editor is half
  // of a desk and all of a phone.
  const item = (step, [long, short], title, act, kbd = "") => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.step = step;
    const said = (text, className) => {
      const s = document.createElement("span");
      s.className = className;
      s.textContent = text;
      return s;
    };
    b.append(said(long, "is-long"), said(short, "is-short"));
    if (kbd) {
      const k = document.createElement("kbd");
      k.textContent = kbd;
      k.className = "is-long";
      b.append(" ", k);
    }
    b.title = title;
    b.addEventListener("click", act);
    li.append(b);
    list.append(li);
  };

  item(
    "run",
    ["Change the code and press Run", "Edit, then Run"],
    "Put the caret in the code - change a text, then press Run or Ctrl+Enter",
    () => {
      // The caret on the line that titles the page, where a change shows at
      // once in the app; the first line where there is no such line.
      const at = source().split("\n").findIndex((l) => /`title`|\btitle\s*=/i.test(l));
      focusLine(at + 1 || 1);
      point("run");
    },
    "Ctrl+Enter",
  );
  item("auto", ["Turn on Auto", "Turn on Auto"], "Run every change as it is typed - the Auto switch beside Run", () => {
    const auto = document.getElementById("autorun");
    // A switch: pressed only when it is off, so the hint never turns it off.
    if (auto?.getAttribute("aria-checked") === "false") auto.click();
    point("autorun");
  });
  item("view", ["Edit the view in the View tab", "Edit the view"], "The view the app sent, in the panel under the code - edit it there", () => showView());
  const browse = `Browse ${SAMPLE_COUNT} samples`;
  item("samples", [browse, browse], "The samples browser: the learning path first, then every catalogued sample", () => openSamples());

  const close = document.createElement("button");
  close.type = "button";
  close.className = "ghost first-steps-close";
  close.textContent = "✕";
  close.title = "Close - it does not come back";
  close.setAttribute("aria-label", "Close the first steps");

  const dismiss = () => {
    closed();
    const hadFocus = strip.contains(document.activeElement);
    anchor.remove();
    // The focus was on the button that just went away; the editor is where
    // the strip was, and where a keyboard would want to be next.
    if (hadFocus) editor.querySelector("textarea, [contenteditable]")?.focus();
  };
  close.addEventListener("click", dismiss);
  strip.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    dismiss();
  });

  strip.append(lead, list, close);
  anchor.append(strip);
  editor.after(anchor);
}

// A ring around a control in the bar for a moment: the hint names it, this
// shows where it is. On a phone Auto lives in the toolbar's menu, where the
// ring is not seen - the switch has been pressed either way.
function point(id) {
  const target = document.getElementById(id);
  if (!target) return;
  target.classList.remove("is-pointed");
  void target.offsetWidth;
  target.classList.add("is-pointed");
  setTimeout(() => target.classList.remove("is-pointed"), 1600);
}
