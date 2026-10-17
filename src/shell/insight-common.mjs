// What every tab of the panel under the editor shares with the panel itself.
//
// Each tab is a module of its own (insight-problems.mjs, insight-outline.mjs
// and the rest) that draws its view as a node and knows nothing of the strip,
// the folding or the resizing - that is insight.mjs, the panel's core. A tab
// still has to ask two things of the core: which tab is in front, so that
// news about it (a roundtrip landing, an outline arriving) is drawn only
// when somebody can see it, and to be drawn again. Those come through here
// rather than by importing insight.mjs, which imports every tab: the core
// hands its answers over once, in setUpInsight( ), and a tab reads them.
let core = {
  view: () => undefined,
  render: () => {},
  update: () => {},
};

// Called once by the panel's core with its own three answers.
export function connectPanel(next) {
  core = next;
}

// The tab in front, by its data-insight name.
export const openTab = () => core.view();

// Draws the open tab again - in place, keeping the reader's scroll and focus
// when it is the same tab (render( ) in insight.mjs).
export const redraw = () => core.render();

// Draws the open tab again only if it is one of these: news about a tab
// that is not in front waits until somebody opens it.
export function redrawIf(...views) {
  if (views.includes(core.view())) core.render();
}

// The problems changed outside the editor's own change handler (a Fix them, a
// checker reconfigured) - the same entry the page uses, updateInsight( ).
export const problemsChanged = (problems) => core.update(problems);

// The one-line sentence a tab draws when it has nothing to show.
export function empty(text) {
  const p = document.createElement("p");
  p.className = "insight-empty";
  p.textContent = text;
  return p;
}

// A heading over a block of text in the panel - a title and, at its right
// hand end, the buttons that act on the block (Copy, Clear, Edit). Five tabs
// draw one, and they are meant to read as the same thing.
export function blockHead(text, ...buttons) {
  const head = document.createElement("div");
  head.className = "log-head";
  const title = document.createElement("span");
  title.className = "log-title";
  title.textContent = text;
  head.append(title, ...buttons);
  return head;
}
