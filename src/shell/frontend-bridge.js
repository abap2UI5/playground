/* The one change the playground makes to the abap2UI5 frontend.
 *
 * The frontend talks to its backend by POSTing JSON to its own URL and reading
 * JSON back (app/webapp/core/Server.js). There is no backend here, so this
 * replaces window.fetch for exactly that one request and hands the body to the
 * transpiled framework running in the page that owns this iframe. Everything
 * else - UI5 modules, themes, images - goes to the network untouched.
 *
 * Loaded as a plain script before the UI5 bootstrap, so the redirect is in place
 * before the component can send anything.
 */
(function () {
  "use strict";

  // `checkLocal` is the frontend's own flag for "the page was served by the
  // backend", which makes it POST to window.location.href instead of the
  // manifest's data source. That is what the backend GET page sets, and it is
  // true here in the sense that matters: the answer comes from this origin.
  window.z2ui5 = window.z2ui5 || {};
  window.z2ui5.checkLocal = true;

  var nativeFetch = window.fetch.bind(window);
  var self = new URL(window.location.href);

  function isRoundtrip(url, method) {
    return method === "POST" && url.origin === self.origin && url.pathname === self.pathname;
  }

  function playground() {
    // Same origin by construction, so this is a direct object reference and not
    // postMessage. If the frontend is opened on its own it is not a playground
    // at all, and saying so beats a TypeError from a missing property.
    var host = window.parent !== window ? window.parent.__z2ui5Playground : undefined;
    if (!host) {
      throw new Error(
        "This page is the abap2UI5 frontend and has no backend of its own. " +
          "Open the playground instead - it runs the framework and answers this frame.",
      );
    }
    return host;
  }

  window.fetch = async function (input, init) {
    var method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
    var href = typeof input === "string" ? input : input.url;
    var url = new URL(href, window.location.href);

    if (!isRoundtrip(url, method)) {
      return nativeFetch(input, init);
    }

    var body = (init && init.body) || (typeof input === "object" ? await input.text() : "");
    if (typeof body !== "string") {
      body = await new Response(body).text();
    }

    var result = await playground().roundtrip(body);
    return new Response(result.body, {
      status: result.status,
      statusText: result.reason,
      headers: {
        // What the ABAP handler sets for the same responses on a real system:
        // JSON for a roundtrip, plain text for an error body.
        "content-type": result.status >= 400 ? "text/plain; charset=UTF-8" : "application/json; charset=UTF-8",
      },
    });
  };
})();
