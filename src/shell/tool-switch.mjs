// @ts-check
// The four abap2UI5 tools - the Playground, the Layout Editor, the AI App
// Builder and the AI Agent - and the switch between them. Every one of them
// wears the same bar: the mark, "abap2UI5", and the tool's name in the accent.
// That name is a menu (a <details>, so it opens and closes on its own) that
// lists all four, the one on screen marked, so a reader in any of them sees
// that they are one family and can get to the others from where they are.
// abap2UI5/layout-editor carries the same list in its index.html; change the
// two together.
//
// The links are relative where the tool is on this deployment: ai/index.html
// and pilot/index.html carry `<base href="../">`, so "ai/" resolves to the
// same address from all three documents.

/** @type {{ id: string, name: string, href: string, blurb: string }[]} */
export const TOOLS = [
  { id: "playground", name: "Playground", href: "./", blurb: "Write ABAP in the browser and watch the app run beside it." },
  { id: "layout", name: "Layout Editor", href: "https://abap2ui5.github.io/layout-editor/", blurb: "Design a UI5 view by drag and drop, then export it as an ABAP class." },
  { id: "ai", name: "AI App Builder", href: "ai/", blurb: "Describe the app you need. The AI writes it; you download it for abapGit." },
  { id: "pilot", name: "AI Agent", href: "pilot/", blurb: "Let the AI operate a running app. Describe the task and watch it work." },
];

/** Fills every `details.tool-switch` on the page with the list, and closes
 *  them the two ways a menu is expected to close and a <details> does not: a
 *  click anywhere outside it (or into the app frame) and Escape. */
export function setUpToolSwitch() {
  const switches = /** @type {HTMLDetailsElement[]} */ ([...document.querySelectorAll("details.tool-switch")]);
  if (!switches.length) return;
  for (const sw of switches) {
    const here = sw.dataset.tool;
    const menu = document.createElement("nav");
    menu.className = "tool-menu";
    menu.setAttribute("aria-label", "abap2UI5 tools");
    const head = document.createElement("span");
    head.className = "tool-menu-head";
    head.textContent = "abap2UI5 tools";
    menu.append(head);
    for (const tool of TOOLS) {
      const a = document.createElement("a");
      a.href = tool.href;
      a.target = "_self";
      a.dataset.tool = tool.id;
      const name = document.createElement("b");
      name.textContent = tool.name;
      const blurb = document.createElement("span");
      blurb.textContent = tool.blurb;
      a.append(name, blurb);
      if (tool.id === here) {
        a.setAttribute("aria-current", "page");
        // The tool on screen: going to it again would only reload the page
        // and throw away what is on it.
        a.addEventListener("click", (e) => {
          e.preventDefault();
          sw.open = false;
        });
      }
      menu.append(a);
    }
    sw.append(menu);
  }
  const closeAll = (/** @type {EventTarget | null} */ target) => {
    for (const sw of switches) if (sw.open && !(target instanceof Node && sw.contains(target))) sw.open = false;
  };
  document.addEventListener("click", (e) => closeAll(e.target));
  addEventListener("blur", () => {
    if (document.activeElement?.tagName === "IFRAME") closeAll(null);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const open = switches.find((sw) => sw.open);
    if (!open) return;
    open.open = false;
    open.querySelector("summary")?.focus();
  });
}
