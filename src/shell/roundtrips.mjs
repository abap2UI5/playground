// What went over the wire - except that here there is no wire.
//
// Every request the app frame would have POSTed to a backend passes through
// this page on its way to the transpiled framework (see frontend-bridge.js
// and the bridge in main.mjs), which makes the playground the one place
// where the whole conversation between an abap2UI5 frontend and its app can
// be watched without a proxy: the event the frontend named, the model delta
// it sent, the view the app answered with, how long the ABAP took. A binding
// that does not update, an event that never arrives, a popup that is not
// shown - all of them are visible here before they are explicable anywhere
// else, and this is what the Roundtrips tab in the panel lists.
//
// The list is kept in memory only, started afresh by every Run (a run is a
// fresh database and a fresh frame, and the roundtrips of the last one would
// describe an app that is gone), and bounded, because an app with a timer
// can produce one every second for as long as the tab is open.
const LIMIT = 200;

let entries = [];
const listeners = new Set();

export const roundtripList = () => entries;
export const onRoundtrip = (fn) => listeners.add(fn);

function notify() {
  for (const fn of listeners) fn(entries);
}

export function clearRoundtrips() {
  entries = [];
  notify();
}

// Records one roundtrip: the JSON the frontend sent, what the framework
// answered, and the milliseconds in between. Both bodies are kept as they
// were and parsed here for the summary; a body that is not JSON - a dump,
// which the framework answers as plain text with a 500 - is kept as text.
export function recordRoundtrip({ request, response, ms }) {
  const req = parse(request);
  const res = parse(response.body);
  const entry = {
    n: entries.length + 1,
    at: new Date(),
    ms: Math.round(ms),
    status: response.status,
    request: req ?? request,
    response: res ?? response.body,
    ...summarise(req, res, response.status),
  };
  entries.push(entry);
  if (entries.length > LIMIT) entries.shift();
  notify();
  return entry;
}

function parse(text) {
  try {
    return typeof text === "string" ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

// What a row says: the event that caused the roundtrip, and what the answer
// did. Read off the wire format Server.js documents - S_FRONT.EVENT and
// T_EVENT_ARG on the way in, MODEL and S_FRONT.S_ACTION on the way out. An
// action list entry is [target, method, ...args]; the ones that carry a
// view (VIEW_SLOTS display <slot> <xml>) are the ones worth naming, and the
// XML is kept aside for the detail.
function summarise(req, res, status) {
  const front = req?.value?.S_FRONT ?? {};
  const event = front.EVENT || (front.ID ? "(navigation)" : "app start");
  const args = Array.isArray(front.T_EVENT_ARG) ? front.T_EVENT_ARG.map(String) : [];
  const sent = Object.keys(req?.value?.MODEL ?? {});

  const did = [];
  const views = [];
  if (status >= 400) {
    did.push(`${status} ${status === 500 ? "dump" : "error"}`);
  } else if (res) {
    const actions = res.S_FRONT?.S_ACTION ?? {};
    for (const action of actions.T_SYSTEM ?? []) {
      if (!Array.isArray(action)) continue;
      const [target, method, ...rest] = action;
      if (target === "VIEW_SLOTS" && method === "display") {
        did.push(`view ${rest[0]}`);
        if (typeof rest[1] === "string") views.push({ slot: String(rest[0]), xml: rest[1] });
      } else {
        did.push([target, method, rest.find((r) => typeof r === "string")].filter(Boolean).join(" "));
      }
    }
    for (const action of actions.T_CUSTOM ?? []) {
      if (Array.isArray(action)) did.push(String(action[0] ?? "custom"));
      else if (typeof action === "string") did.push("custom JS");
    }
    if (res.MODEL && typeof res.MODEL === "object") did.push(`model ${Object.keys(res.MODEL).length} field${Object.keys(res.MODEL).length === 1 ? "" : "s"}`);
  }
  return { event, args, sent, did, views };
}
