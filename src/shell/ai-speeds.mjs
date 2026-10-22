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
