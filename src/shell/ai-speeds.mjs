// @ts-check
// How much the reader trades speed for care - the select in both chat headers
// (chat-ui.mjs writes its options from here; ai-common.mjs asks before every
// request). The model is the reader's choice, not this page's: Balanced is the
// default and stays on Opus 5.5 at the effort that model defaults to; Thorough
// lets it think longer; Fast is Sonnet 5.5, which answers sooner.
//
// A module of its own, with no SDK in it, so the shell can write the options
// without the agent chunk: the labels stood in index.html twice and here once,
// and a model bump had to be remembered in three places.
export const SPEEDS = {
  fast: { model: "claude-sonnet-5-5", effort: "medium", label: "Fast · Sonnet 5.5" },
  balanced: { model: "claude-opus-5-5", effort: "medium", label: "Balanced · Opus 5.5" },
  thorough: { model: "claude-opus-5-5", effort: "high", label: "Thorough · Opus 5.5" },
};
export const DEFAULT_SPEED = "balanced";

// What a token costs, in dollars per million, from Anthropic's price list -
// an estimate for the header, not a bill: a plan's rates, a cache write (a
// quarter more than fresh input) and a cache read (a tenth) are the parts
// that move. Beside SPEEDS on purpose: a model bump there and its price here
// are one change, and tests/node/ai-speeds.test.mjs fails on a model in
// SPEEDS without a price, which the header would show as no dollars at all.
// PRICES_AS_OF is the date the usage tooltip names; change it with them.
export const PRICES_AS_OF = "October 2026";
export const PRICES = {
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
};
