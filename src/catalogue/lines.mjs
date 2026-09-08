// A line of the printed class is an address, and a click on its number is
// how a reader takes one: #L42, or #L42-L58 with Shift for a passage. The
// marked lines, the hint that names them, the button that copies the link -
// the script every sample page used to carry inline, as one module for all of
// them now (page-entry.mjs). Behaviour for behaviour the same, so the tests in
// tests/sample-pages.spec.js are the pin.
export function setUpLines() {
    var pre = document.querySelector(".source-body");
    if (!pre) return;
    var lines = pre.querySelectorAll(".ln");
    if (!lines.length) return;
    pre.classList.add("live");

    var hint = document.querySelector(".source-hint");
    var copy = document.querySelector(".source-copy");
    var HINT = hint ? hint.textContent : "";
    var COPY = copy ? copy.textContent : "";
    /* [0-9] rather than the shorthand: this script is written inside a
       template literal, where a backslash is an escape before it is
       anything else - the class would arrive in the page as "d+" and
       match nothing. (It did.) */
    var HASH = /^#L([0-9]+)(?:-L([0-9]+))?$/;
    /* The line a shift-click extends from: the last one picked on its own. */
    var anchor = 0;

    /* The gutter is not fifty tab stops (see above). */
    var gutter = document.querySelectorAll(".ln > a");
    for (var gi = 0; gi < gutter.length; gi++) gutter[gi].tabIndex = -1;

    var picked = function () {
      var m = HASH.exec(location.hash);
      if (!m) return null;
      var a = Number(m[1]);
      var b = m[2] === undefined ? a : Number(m[2]);
      return { from: Math.min(a, b), to: Math.max(a, b) };
    };

    var say = function (text) { if (hint) { hint.textContent = text; hint.hidden = false; } };

    var mark = function (scroll) {
      for (var i = 0; i < lines.length; i++) lines[i].classList.remove("is-marked");
      var range = picked();
      if (copy) copy.hidden = range === null;
      if (range === null) { say(HINT); return; }
      var first = null;
      for (var n = range.from; n <= range.to; n++) {
        var el = document.getElementById("L" + n);
        if (!el) continue;
        el.classList.add("is-marked");
        if (first === null) first = el;
      }
      /* A long class is printed as far as its first 900 lines and no further,
         so a link into what was cut has to be answered by saying so rather
         than by silently highlighting nothing. */
      if (first === null) {
        say("Line " + range.from + " is not on this page — the first " + lines.length + " lines are printed.");
        return;
      }
      say(range.from === range.to ? "Line " + range.from : "Lines " + range.from + "–" + range.to);
      if (scroll) first.scrollIntoView({ block: "center" });
    };

    pre.addEventListener("click", function (e) {
      var number = e.target && e.target.closest ? e.target.closest(".ln > a") : null;
      if (!number || e.metaKey || e.ctrlKey) return;
      var line = Number(String(number.getAttribute("href")).slice(2));
      if (!line) return;
      var hash = "#L" + line;
      if (e.shiftKey && anchor) hash = "#L" + Math.min(anchor, line) + "-L" + Math.max(anchor, line);
      else anchor = line;
      e.preventDefault();
      history.replaceState(null, "", hash);
      mark(false);
    });

    addEventListener("hashchange", function () {
      var range = picked();
      if (range) anchor = range.from;
      mark(true);
    });

    if (copy) {
      copy.addEventListener("click", function () {
        var done = function (text) {
          copy.textContent = text;
          setTimeout(function () { copy.textContent = COPY; }, 2000);
        };
        try {
          navigator.clipboard.writeText(location.href).then(
            function () { done("Link copied"); },
            function () { done("Copy it from the address bar"); });
        } catch (e) { done("Copy it from the address bar"); }
      });
    }

    var start = picked();
    if (start) anchor = start.from;
    mark(start !== null);
}
