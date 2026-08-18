// Live abap2UI5 demos in a documentation page.
//
// Drop this script into a page and mark up a demo as an empty element:
//
//   <div class="abap2ui5-demo"
//        data-src="https://raw.githubusercontent.com/.../z2ui5_cl_demo.clas.abap"
//        data-height="520"></div>
//   <script src="https://abap2ui5.github.io/test-live/embed/abap2ui5-embed.js"></script>
//
// Nothing loads until the reader asks for it. That is the whole point of this
// file: a playground instance is a complete ABAP runtime plus an abaplint parse
// of nine hundred sources - a second or two of processor and a few hundred
// megabytes, per demo. Ten of them booting because somebody scrolled past would
// make the documentation page the slowest thing in the manual. So each demo is
// a button until it is clicked, and then it is a playground.
//
// Attributes, all optional except one of data-src / data-code:
//
//   data-src     URL of an ABAP file, or several separated by whitespace; the
//                first is the app. Same rule as the playground's ?src=.
//   data-code    ABAP source inline, for a demo that lives only in this page.
//   data-view    "app" for the running app on its own, without the editor.
//   data-height  starting height in pixels (default 520, or 320 for view=app,
//                which then grows to fit what the app rendered).
//   data-label   the text on the button (default "Run this example").
//   data-origin  where the playground is served from, if not this script's own.
(function () {
  "use strict";

  const SOURCE = "abap2ui5-playground";
  const script = document.currentScript;

  // The playground lives wherever this file was served from - so a fork that
  // publishes its own copy gets its own playground without editing anything.
  const defaultOrigin = script ? new URL("../", script.src).href : "/";

  async function playgroundUrl(el) {
    const base = el.dataset.origin || defaultOrigin;
    const url = new URL(base, window.location.href);
    url.searchParams.set("embed", "1");
    if (el.dataset.view === "app") url.searchParams.set("view", "app");
    for (const src of (el.dataset.src || "").split(/\s+/).filter(Boolean)) {
      url.searchParams.append("src", new URL(src, window.location.href).href);
    }
    // Inline code travels in the fragment, in exactly the format the
    // playground's own Share button writes, so nothing has to be hosted for it.
    if (el.dataset.code) url.hash = await encodeCode(el.dataset.code);
    return url.href;
  }

  // The fragment format, which the playground defines: one version character,
  // then base64url of the deflate-raw of a JSON array of files. Writing
  // anything else here would not fail loudly - the playground treats a fragment
  // it cannot read as somebody else's link and quietly opens its own sample,
  // so a documentation page would silently show the wrong code.
  async function encodeCode(code) {
    const files = [{ name: "zcl_playground.clas.abap", source: code }];
    const payload = new TextEncoder().encode(JSON.stringify(files));
    const deflated = new Uint8Array(
      await new Response(
        new Blob([payload]).stream().pipeThrough(new CompressionStream("deflate-raw")),
      ).arrayBuffer(),
    );
    let binary = "";
    for (const b of deflated) binary += String.fromCharCode(b);
    return "2" + btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  async function mount(el) {
    if (el.dataset.mounted) return;
    el.dataset.mounted = "1";

    const appOnly = el.dataset.view === "app";
    const height = Number(el.dataset.height) || (appOnly ? 320 : 520);

    const frame = document.createElement("iframe");
    frame.src = await playgroundUrl(el);
    frame.title = el.dataset.label || "abap2UI5 example";
    frame.style.cssText = `width:100%;height:${height}px;border:0;display:block;transition:height .2s`;
    frame.setAttribute("allow", "clipboard-write");

    el.replaceChildren(frame);

    // Only app-only demos are resized. With an editor beside it the height is
    // whatever the page decided the editor deserves, and no message from inside
    // improves on that.
    if (!appOnly) return;
    window.addEventListener("message", (e) => {
      if (e.source !== frame.contentWindow) return;
      const data = e.data;
      if (!data || data.source !== SOURCE) return;
      if (data.type === "height" && Number.isFinite(data.height)) {
        frame.style.height = `${Math.max(120, Math.min(1200, data.height))}px`;
      }
    });
  }

  function placeholder(el) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "abap2ui5-demo-start";
    button.textContent = el.dataset.label || "Run this example";
    button.addEventListener("click", () => mount(el));
    el.replaceChildren(button);
  }

  function setUp(root) {
    for (const el of (root || document).querySelectorAll(".abap2ui5-demo:not([data-mounted])")) {
      // data-auto="1" for the page that is only about this one demo.
      if (el.dataset.auto === "1") mount(el);
      else placeholder(el);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setUp());
  } else {
    setUp();
  }

  // Documentation frameworks that swap pages without reloading (Docusaurus,
  // VitePress and friends) need the new page's demos picked up.
  window.abap2ui5Embed = { setUp };
})();
