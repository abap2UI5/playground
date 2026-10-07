/* What the playground changes about the abap2UI5 frontend.
 *
 * The frontend talks to its backend by POSTing JSON to its own URL and reading
 * JSON back (app/webapp/core/Server.js). There is no backend here, so this
 * replaces window.fetch for exactly that one request and hands the body to the
 * transpiled framework running in the page that owns this iframe. Everything
 * else - UI5 modules, themes, images - goes to the network untouched.
 *
 * It also keeps this frame from taking the focus while that page has a dialog
 * open, for the reason at the second patch below.
 *
 * Loaded as a plain script before the UI5 bootstrap, so the redirect is in place
 * before the component can send anything.
 */
(function () {
  "use strict";

  // The frontend sends its roundtrips to this frame's own URL - the one
  // request the fetch below takes over - because the component is started
  // with `checkLocal: true`, the frontend's flag for "the page was served by
  // the backend", which makes it POST to window.location.href instead of the
  // manifest's data source. This script used to set that flag, as
  // `window.z2ui5.checkLocal`. abap2UI5#2777 removed the window.z2ui5 global:
  // the frontend keeps its state per component now (component.ctx.state), and
  // Component.init( ) reads checkLocal from its component data and from
  // nowhere else. So the flag is passed the way the backend's own GET page
  // passes it, as componentData in the data-settings ComponentSupport creates
  // the component from - written into the frame's index.html at build time by
  // patchFrontend( ) in tools/build-ui5.mjs. Nothing here reads the
  // frontend's state either: what the playground records of a roundtrip is
  // what passes through the fetch below.

  var nativeFetch = window.fetch.bind(window);
  var self = new URL(window.location.href);

  // The frontend refuses to send a roundtrip while navigator.onLine is false
  // ("No internet connection! Please reconnect to the server"), which is the
  // right thing to do in front of a server and the wrong thing here: the
  // backend is the page around this frame, and it is reachable with the
  // cable pulled out. Which is exactly the case the installed playground is
  // for - see the manifest in the shell's index.html and the service worker
  // that keeps every asset - so the frame is always online, as far as the
  // one question the frontend asks is concerned.
  try {
    Object.defineProperty(navigator, "onLine", { get: function () { return true; }, configurable: true });
  } catch (e) {
    // A navigator that will not have the property redefined keeps the
    // browser's answer, and the frontend's alert with it.
  }

  function isRoundtrip(url, method) {
    return method === "POST" && url.origin === self.origin && url.pathname === self.pathname;
  }

  // Same origin by construction, so this is a direct object reference and not
  // postMessage. Undefined when the frontend is opened on its own, and also in
  // the moment before the playground has its runtime - so every caller has to
  // cope with not getting one.
  function host() {
    return window.parent !== window ? window.parent.__z2ui5Playground : undefined;
  }

  function playground() {
    // If the frontend is opened on its own it is not a playground at all, and
    // saying so beats a TypeError from a missing property.
    var host_ = host();
    if (!host_) {
      throw new Error(
        "This page is the abap2UI5 frontend and has no backend of its own. " +
          "Open the playground instead - it runs the framework and answers this frame.",
      );
    }
    return host_;
  }

  // UI5 focuses a control every time it finishes rendering, and it does that in
  // this document. `showModal()` in the page around us cannot prevent it: a
  // modal dialog makes the rest of ITS document inert, and this is a document
  // of its own. So a render that settles while the playground has a dialog
  // open takes the focus out of that dialog and puts it in here, where the
  // dialog cannot see it. Everything typed then goes to the app: the search
  // box in the examples browser looks focused and stays empty, and Escape
  // never reaches the dialog, so it cannot be closed from the keyboard at all.
  //
  // Chasing the focus back afterwards does not fix it - whatever was typed in
  // the meantime is already gone - so the frame gives up taking it instead,
  // for exactly as long as the shell has a dialog open. An app somebody is
  // actually working in is unaffected: no dialog is open over it then, and
  // this is the frontend's own focus() the rest of the time.
  var nativeFocus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function () {
    var host_ = host();
    if (host_ && typeof host_.dialogOpen === "function" && host_.dialogOpen()) return;
    return nativeFocus.apply(this, arguments);
  };

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

    // Its own address goes along, which names the Run it belongs to (?run=):
    // the old app is still alive for the moment between a new Run resetting
    // the database and the new frame document arriving.
    var result = await playground().roundtrip(body, window.location.href);
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

  // The AI Pilot (src/shell/pilot.mjs) operates the app in this frame, and
  // the reader watches it do so: these are the three things it needs of the
  // frontend, and the one place the playground reaches into it rather than
  // only through the fetch above. Everything is looked up when called, never
  // kept, and every miss answers false - a frontend that moved its modules
  // makes the Pilot say "the app on screen could not be updated", which
  // tests/pilot.spec.js holds, rather than break the playground.
  //
  //   roundtrip()           a roundtrip the frontend sends as if a control had
  //                         fired: busy, timers cancelled, the answer rendered
  //                         by its own code. The BODY is the Pilot's, put in
  //                         its place by the page (main.mjs) - this only makes
  //                         the frontend ask, so that it renders what comes back.
  //   frontend(args)        a frontend-only wire, e.g. closing the popup
  //                         (["CONTROL_GLOBAL","VIEW_SLOTS","destroy","POPUP"])
  //   fill(slot, path, v)   a value typed into a field without an event: set in
  //                         the slot's model and marked changed, the way typing
  //                         marks it, so the next event carries it
  //   slots()               the slots that hold a view now
  //   busy()                whether a roundtrip is still being answered or
  //                         rendered - the Pilot reads the screen only after.
  //                         An app's first answer is rendered without the
  //                         frontend ever saying busy, so a frame whose main
  //                         view is not there yet counts as busy too
  function frontend() {
    var require_ = window.sap && sap.ui && sap.ui.require;
    if (!require_) return null;
    var Component = require_("sap/ui/core/Component");
    var Server = require_("z2ui5/core/Server");
    var ViewSlots = require_("z2ui5/core/ViewSlots");
    if (!Component || !Server || !ViewSlots) return null;
    var component;
    if (Component.registry && typeof Component.registry.filter === "function") {
      component = Component.registry.filter(function (c) {
        return c.ctx && c.ctx.state;
      })[0];
    }
    if (!component && Component.getComponentById) component = Component.getComponentById("container-z2ui5");
    if (!component || !component.ctx || !component.ctx.state) return null;
    return { ctx: component.ctx, Server: Server, ViewSlots: ViewSlots };
  }

  // A file dropped on the app, on a page that takes files (the AI Pilot's,
  // see dropFiles in main.mjs): handed to that page rather than left to the
  // browser, which opens a file dropped where nobody took it in a tab of its
  // own. Listened for on the window, after the app's own controls had their
  // turn - a drop an upload control took (preventDefault) stays the app's.
  function isFileDrag(e) {
    var types = e.dataTransfer && e.dataTransfer.types;
    return Boolean(types && Array.prototype.indexOf.call(types, "Files") !== -1);
  }
  function takesFiles() {
    var host_ = host();
    return host_ && typeof host_.dropFiles === "function" ? host_ : null;
  }
  window.addEventListener("dragover", function (e) {
    if (e.defaultPrevented || !isFileDrag(e) || !takesFiles()) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  });
  window.addEventListener("drop", function (e) {
    var host_ = takesFiles();
    if (e.defaultPrevented || !isFileDrag(e) || !host_) return;
    e.preventDefault();
    host_.dropFiles(Array.prototype.slice.call(e.dataTransfer.files));
  });

  // The topmost view that is open - the one whose model a request of the
  // Pilot's carries, as the frontend's own event from it would.
  function topSlot(f) {
    var keys = ["POPOVER", "POPUP", "MAIN"];
    for (var i = 0; i < keys.length; i++) {
      var view = f.ViewSlots.getView(f.ctx, keys[i]);
      if (view) return { key: keys[i], view: view, model: f.ViewSlots.trackedModel(view) || view.getModel() };
    }
    return null;
  }

  // The paths the Pilot's next request carries: the values it typed (fill)
  // and the reader's own unsent edits it took over (pending), each on its
  // model. The frontend marks what a request carried in View1.eB - which the
  // Pilot's roundtrip goes around - and clears exactly those paths when the
  // answer comes (Server._clearSentPaths). Without this, every path the
  // Pilot ever typed stayed "changed": put back over the backend's answer
  // after every roundtrip (a field the app cleared after ADD still showed
  // the value), and sent again with the reader's next click.
  var carried = null;
  function carry(model, path) {
    if (!carried || carried.model !== model) carried = { model: model, paths: {} };
    carried.paths[path] = true;
  }

  window.__z2ui5PlaygroundPilot = {
    roundtrip: function () {
      var f = frontend();
      if (!f) return false;
      var state = f.ctx.state;
      if (carried && carried.model && typeof carried.model.getProperty === "function") {
        var sent = new Map();
        for (var path in carried.paths) sent.set(path, carried.model.getProperty(path));
        carried.model._z2ui5SentValues = sent;
        state.oSentModel = carried.model;
      }
      carried = null;
      var Lib = sap.ui.require("z2ui5/core/Lib");
      if (Lib && Lib.cancelPendingTimers) Lib.cancelPendingTimers(f.ctx);
      state.isBusy = true;
      var BusyIndicator = sap.ui.require("sap/ui/core/BusyIndicator");
      if (BusyIndicator) BusyIndicator.show(0);
      f.Server.roundtrip(f.ctx, { ID: state.oResponse && state.oResponse.ID });
      return true;
    },
    frontend: function (args) {
      var f = frontend();
      var controller = f && f.ViewSlots.getController(f.ctx, "MAIN");
      if (!controller || typeof controller.eF !== "function") return false;
      controller.eF.apply(controller, args);
      return true;
    },
    fill: function (slot, path, value) {
      var f = frontend();
      var view = f && f.ViewSlots.getView(f.ctx, slot);
      var model = view && (f.ViewSlots.trackedModel(view) || view.getModel());
      if (!model || typeof model.setProperty !== "function") return false;
      model.setProperty(path, value);
      f.ViewSlots.markChanged(view, path);
      carry(model, path);
      return true;
    },
    // What the reader typed in the topmost view and has not sent yet - the
    // values a click of theirs would carry. Only read here: what the Pilot's
    // session took of them is handed back through carry( ) - a value it
    // could not take (a field it does not show as editable) stays the
    // reader's, pending, and goes with their next click.
    pending: function () {
      var f = frontend();
      var top = f && topSlot(f);
      var changed = top && top.model && top.model._z2ui5ChangedPaths;
      if (!changed || changed.size === 0) return {};
      var values = {};
      changed.forEach(function (path) {
        var value = top.model.getProperty(path);
        if (value === undefined || (value !== null && typeof value === "object")) return;
        values[path] = value;
      });
      return values;
    },
    // The reader's pending paths the Pilot's next request carries.
    carry: function (paths) {
      var f = frontend();
      var top = f && topSlot(f);
      if (!top || !top.model || !Array.isArray(paths)) return false;
      paths.forEach(function (path) {
        carry(top.model, path);
      });
      return true;
    },
    busy: function () {
      var f = frontend();
      return Boolean(f && (f.ctx.state.isBusy || !f.ViewSlots.getView(f.ctx, "MAIN")));
    },
    slots: function () {
      var f = frontend();
      if (!f) return null;
      return f.ViewSlots.slots
        .map(function (s) {
          return s.key;
        })
        .filter(function (key) {
          return Boolean(f.ViewSlots.getView(f.ctx, key));
        });
    },
  };

  // A LEAK IN UI5, worked around here until it is fixed there. sap.m.Shell's
  // init attaches a Theming "applied" listener (a bound function) and its exit
  // never detaches it - so every Shell a view_display destroys stays in that
  // listener list, and with it the models propagated to it: the whole data
  // model of every roundtrip. Every sample puts a Shell at its root, and a
  // timer app with a 500-row list grew the page by about 80 KB a roundtrip
  // until the next Run (OpenUI5 1.152, sap/m/Shell.js init/exit).
  //
  // The patch keeps the handler Shell.init attaches and detaches it in exit.
  // It is applied once the app itself has loaded sap/m/Shell - the one-argument
  // sap.ui.require only probes, it loads nothing, so the frame's requests stay
  // exactly what the app asks for. Checked every 100 ms for a minute: an app
  // with no Shell costs a few hundred no-op probes.
  function patchShellLeak() {
    var require = window.sap && window.sap.ui && window.sap.ui.require;
    var Shell = typeof require === "function" ? require("sap/m/Shell") : undefined;
    var Theming = Shell ? require("sap/ui/core/Theming") : undefined;
    if (!Shell || !Theming || Shell.prototype.__playgroundDetaches) return Boolean(Shell && Theming);
    var init = Shell.prototype.init;
    var exit = Shell.prototype.exit;
    Shell.prototype.init = function () {
      var self = this;
      var attach = Theming.attachApplied;
      Theming.attachApplied = function (fn) {
        self.__playgroundThemeApplied = fn;
        return attach.apply(Theming, arguments);
      };
      try {
        return init ? init.apply(this, arguments) : undefined;
      } finally {
        Theming.attachApplied = attach;
      }
    };
    Shell.prototype.exit = function () {
      if (this.__playgroundThemeApplied) {
        Theming.detachApplied(this.__playgroundThemeApplied);
        this.__playgroundThemeApplied = undefined;
      }
      return exit ? exit.apply(this, arguments) : undefined;
    };
    Shell.prototype.__playgroundDetaches = true;
    return true;
  }
  var shellProbes = 0;
  var shellTimer = setInterval(function () {
    if (patchShellLeak() || ++shellProbes > 600) clearInterval(shellTimer);
  }, 100);
})();
