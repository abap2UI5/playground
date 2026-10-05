// What the site's two AI chats share - the AI Studio (src/shell/ai-agent.mjs)
// and the AI Pilot (src/shell/pilot-agent.mjs): which model answers at which
// speed, and how a failed request is said. Both chunks import the Anthropic
// SDK, which esbuild therefore splits into a chunk of its own, and this goes
// with it; tools/build-site.mjs keeps all of it out of the service worker's
// precache, read off the module graph.
import Anthropic from "@anthropic-ai/sdk";

// How much the reader trades speed for care - the chat header's select. The
// model is the reader's choice, not this page's: Balanced is the default and
// stays on Opus 5.5 at the effort that model defaults to; Thorough lets it
// think longer; Fast is Sonnet 5.5, which answers sooner.
export const SPEEDS = {
  thorough: { model: "claude-opus-5-5", effort: "high", label: "Thorough · Opus 5.5" },
  balanced: { model: "claude-opus-5-5", effort: "medium", label: "Balanced · Opus 5.5" },
  fast: { model: "claude-sonnet-5-5", effort: "medium", label: "Fast · Sonnet 5.5" },
};
export const DEFAULT_SPEED = "balanced";

// A failed request, as the chat says it. `key` marks the one failure the
// reader answers by entering another key; everything else is said and the
// conversation stays where it was.
export function explainError(err) {
  if (err instanceof Anthropic.APIUserAbortError) return { text: "Stopped.", stopped: true };
  // A stream that broke off: the SDK says so in a plain AnthropicError (no
  // status), which fell through to its raw text.
  if (!(err instanceof Anthropic.APIError) && (err instanceof Anthropic.AnthropicError || err instanceof TypeError)
      && /network|Failed to fetch|ended without|Unexpected event order|terminated|aborted/i.test(String(err.message))) {
    return { text: "The connection to api.anthropic.com dropped mid-answer - check the connection and send again." };
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return { text: "The API key was not accepted. Enter a valid Anthropic API key.", key: true };
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return { text: `This key may not use the model - try another speed in the header, or another key: ${err.message}`, key: true };
  }
  if (err instanceof Anthropic.RateLimitError) return { text: "Rate limited - wait a moment and send again." };
  if (err instanceof Anthropic.BadRequestError && /anthropic-workspace-id/.test(err.message)) {
    return {
      text:
        "This key is not tied to a workspace, so the API needs to be told which one to use. Enter the workspace ID " +
        "(wrkspc_…, in the Console under Settings → Workspaces) in the key form - or create a key inside a workspace.",
      key: true,
      workspace: true,
    };
  }
  if (err instanceof Anthropic.BadRequestError) return { text: `The request was refused: ${err.message}` };
  if (err instanceof Anthropic.APIConnectionError) {
    return { text: "api.anthropic.com could not be reached - check the connection, or whether a proxy or extension blocks it." };
  }
  if (err instanceof Anthropic.APIError) return { text: `The API answered ${err.status ?? "with an error"}: ${err.message}` };
  return { text: String(err?.message ?? err) };
}

// The catalogue this site already publishes for its samples page and the
// samples browser - same origin, so the service worker has it after a first
// visit. The source of a sample comes from raw.githubusercontent.com, the
// host ?src= links already read from.

const str = (v) => (typeof v === "string" ? v : undefined);

let index;
async function loadIndex() {
  if (!index) {
    index = fetch("samples/apps.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`samples/apps.json answered ${r.status}`))))
      .catch((e) => {
        index = undefined;
        throw e;
      });
  }
  return index;
}

function entriesOf(data) {
  const names = data.controls || [];
  return (data.entries || [])
    .filter((e) => typeof e.raw === "string" && typeof e.class === "string")
    .map((e) => {
      const controls = (e.controls || []).map((i) => names[i]).filter(Boolean);
      return {
        class: e.class.toLowerCase(),
        title: str(e.title) ?? e.class,
        summary: str(e.summary) ?? str(e.note) ?? "",
        raw: e.raw,
        runs: e.runs === true,
        controls,
        haystack: `${e.title} ${e.note ?? ""} ${e.summary ?? ""} ${e.class} ${e.group ?? ""} ${(e.keywords || []).join(" ")} ${controls.join(" ")}`.toLowerCase(),
      };
    });
}

/** The catalogue's entries, shaped for the tools that search it - the
 *  studio's search_samples and read_sample, the Pilot's find_apps and
 *  open_app. */
export async function catalogueEntries() {
  return entriesOf(await loadIndex());
}
