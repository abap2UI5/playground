// One app frame as a transport for the AI: a request parked for the frame to
// send, and every answer the frame got, observed. Shared by the AI Pilot
// (src/shell/pilot.mjs, one driver per tab) and the AI Studio
// (src/shell/chat.mjs, one for Run's frame), so that both rooms can let
// Claude operate the app the same way (src/shell/ai-operator.mjs).
//
// How a request goes out: `drive( )` parks it and asks the frame to send a
// roundtrip (a "call" to frontend-bridge.js, frame-link.mjs); the frames'
// roundtrip( ) in agent-hooks.mjs takes the parked body (`take( )`) and sends
// IT to the framework in place of the frame's own, and the answer goes both to
// the frame, which renders it, and to the promise `drive( )` answered. How an
// answer comes in: main.mjs hands every answer the frame got to `saw( )`, the
// reader's own clicks included; `observe( )` is the mirror's ear, and what
// arrived before there was one is kept for it (a few dozen answers at most -
// a timer app before the chunk landed is not worth more memory than that).
const EARLY_MAX = 50;

export function createDriver() {
  let request = null;
  const early = [];
  let observer = null;
  return {
    /** main.mjs, in the bridge's roundtrip( ): the parked request, taken. */
    take() {
      const taken = request;
      if (!taken) return null;
      request = null;
      taken.settled();
      return taken;
    },
    /** main.mjs, after every answer the framework gave this frame. */
    saw(body, response) {
      if (observer) {
        observer(body, response);
        return;
      }
      early.push([body, response]);
      if (early.length > EARLY_MAX) early.shift();
    },
    /** The mirror's ear - told what arrived before it, first. */
    observe(fn) {
      observer = fn;
      for (const [body, response] of early.splice(0)) fn(body, response);
    },
    /*
     * One request, sent by the frame so that it renders the answer. `frameApi`
     * answers the frame's handle (frameApi( ) in frame-link.mjs), or nothing;
     * its roundtrip( ) answers - a promise, now that the frame is asked by
     * message - whether the frame sent it. Answers what the
     * framework answered ({ status, body }), or rejects when the frame cannot
     * send - no app in it, or a frontend that no longer has what
     * frontend-bridge.js reaches for.
     */
    drive(frameApi, body) {
      return new Promise((resolve, reject) => {
        const gaveUp = setTimeout(() => {
          if (request?.body !== body) return;
          request = null;
          reject(new Error("the app did not send the roundtrip - restart_app starts it again"));
        }, 15000);
        const parked = { body, resolve, reject, settled: () => clearTimeout(gaveUp) };
        request = parked;
        const refused = () => {
          // Only while it is still parked: a frame that sent the request and
          // then reported a failure has already had it taken.
          if (request !== parked) return;
          clearTimeout(gaveUp);
          request = null;
          reject(new Error("the app could not be updated - it is not running (restart_app starts it)"));
        };
        let asked;
        try {
          asked = frameApi()?.roundtrip();
        } catch {
          asked = false;
        }
        Promise.resolve(asked).then(
          (sent) => {
            if (sent !== true) refused();
          },
          refused,
        );
      });
    },
    /** The frame is gone: a step still parked for it is refused. */
    close() {
      request?.reject(new Error("the app was closed"));
      request = null;
    },
  };
}
