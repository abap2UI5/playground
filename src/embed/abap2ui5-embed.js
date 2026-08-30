// Live abap2UI5 demos in a documentation page.
//
// Drop this script into a page and mark up a demo as an empty element:
//
//   <div class="abap2ui5-demo"
//        data-src="https://raw.githubusercontent.com/.../z2ui5_cl_demo.clas.abap"
//        data-height="520"></div>
//   <script src="https://abap2ui5.github.io/playground/embed/abap2ui5-embed.js"></script>
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
//
// Two functions on `window.abap2ui5Embed`:
//
//   setUp(root)  pick up the demos in `root` (or the whole document). Call it
//                after each navigation in a framework that swaps pages without
//                reloading - Docusaurus, VitePress and friends.
//   url(opts)    the playground URL for `{ src, code, view, origin }`, for a
//                page that wants its own "open this in the playground" link
//                rather than a frame. It is what mounting uses, so a link built
//                with it cannot disagree with what the frame shows.
(function () {
  "use strict";

  const SOURCE = "abap2ui5-playground";
  const script = document.currentScript;

  // The playground lives wherever this file was served from - so a fork that
  // publishes its own copy gets its own playground without editing anything.
  const defaultOrigin = script ? new URL("../", script.src).href : "/";

  // The URL of a playground showing this. Everything the loader does is in a
  // URL, so this is also the whole of it: `window.abap2ui5Embed.url({ code })`
  // is what a page links when it wants "open this in the playground" next to
  // its own Run button, and it cannot get the fragment format wrong by writing
  // it itself.
  async function playgroundUrl({ src, code, view, origin }) {
    const url = new URL(origin || defaultOrigin, window.location.href);
    url.searchParams.set("embed", "1");
    if (view === "app") url.searchParams.set("view", "app");
    for (const one of (src || "").split(/\s+/).filter(Boolean)) {
      url.searchParams.append("src", new URL(one, window.location.href).href);
    }
    // Inline code travels in the fragment, in exactly the format the
    // playground's own Share button writes, so nothing has to be hosted for it.
    if (code) url.hash = await encodeCode(code);
    return url.href;
  }

  const urlFor = (el) => playgroundUrl({
    src: el.dataset.src,
    code: el.dataset.code,
    view: el.dataset.view,
    origin: el.dataset.origin,
  });

  // What the ABAP has to be called. abapGit names a file after the object in
  // it, abaplint reads the object's name back out of that file name, and the
  // playground refuses the pair when they disagree - "zcl_playground.clas.abap
  // has to declare ZCL_PLAYGROUND, not Z2UI5_CL_SAMPLE_TAB". So the name is
  // read from the source rather than fixed here: `data-code` is for the ABAP a
  // page already prints, and a documentation page prints a class under the name
  // its reader is meant to create, not under ours. The fallback only ever
  // applies to a fence that declares nothing, which the playground reports for
  // itself.
  function fileNameFor(code) {
    const declared = /^\s*(?:CLASS|INTERFACE)\s+([a-zA-Z_]\w*)\s+(?:DEFINITION|PUBLIC)/im.exec(code);
    const kind = /^\s*INTERFACE\s/im.test(code) && !/^\s*CLASS\s/im.test(code) ? "intf" : "clas";
    return `${(declared?.[1] || "zcl_playground").toLowerCase()}.${kind}.abap`;
  }

  // The fragment format, which the playground defines: one version character,
  // then base64url of the deflate-raw of a JSON array of files. Writing
  // anything else here would not fail loudly - the playground treats a fragment
  // it cannot read as somebody else's link and quietly opens its own sample,
  // so a documentation page would silently show the wrong code.
  async function encodeCode(code) {
    const files = [{ name: fileNameFor(code), source: code }];
    const payload = new TextEncoder().encode(JSON.stringify(files));
    const deflated = new Uint8Array(
      await new Response(
        new Blob([payload]).stream().pipeThrough(new CompressionStream("deflate-raw")),
      ).arrayBuffer(),
    );
    // A block at a time rather than a character at a time - the same reason
    // src/shell/share.mjs does it, and the same 0x8000 block, which stays well
    // under the argument-count limit spreading the whole array would hit.
    const parts = [];
    for (let i = 0; i < deflated.length; i += 0x8000) {
      parts.push(String.fromCharCode.apply(null, deflated.subarray(i, i + 0x8000)));
    }
    return "2" + btoa(parts.join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  async function mount(el) {
    if (el.dataset.mounted) return;
    el.dataset.mounted = "1";

    const appOnly = el.dataset.view === "app";
    const height = Number(el.dataset.height) || (appOnly ? 320 : 520);

    const frame = document.createElement("iframe");
    frame.src = await urlFor(el);
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
  window.abap2ui5Embed = { setUp, url: playgroundUrl };
})();
