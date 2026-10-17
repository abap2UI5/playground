// "Run it here" under a sample page's title (tools/sample-pages.mjs).
//
// The link is a plain `#run-it-here`, so with the script blocked it still does
// the half that matters - it takes the reader to the demo box a screen or more
// further down. With the script, it also presses the box's start button, which
// src/embed/abap2ui5-embed.js put there: a reader who said "run it" has said
// it, and arriving at a second button that asks the same question is a press
// for nothing. The default jump is left alone, so the address bar and Back
// behave the way they do for every other anchor on the page.
export function setUpRunJump() {
  const jump = document.querySelector("a.run-jump");
  if (!jump) return;
  jump.addEventListener("click", () => {
    /* Once mounted, the button is gone and the frame is there: the jump is
     * all that is left to do, and the browser does it. */
    const start = document.querySelector(".abap2ui5-demo .abap2ui5-demo-start");
    if (start instanceof HTMLButtonElement) start.click();
  });
}
