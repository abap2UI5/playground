// What the two Config tabs were last set to.
//
// The checkers themselves know nothing about this. registry.mjs and
// abap2ui5-lint.mjs hold a configuration and validate one; keeping it between
// visits is a decision about this page, and it lives here with the rest of
// what the page remembers.
//
// Three rules, and each is the answer to a way this could go wrong:
//
//   - a stored setting is validated exactly like a typed one, and silently
//     dropped when it no longer makes sense. An old deploy could have stored a
//     rule abaplint has since retired, and "the playground will not start" is a
//     bad answer to that;
//   - a setting that equals the default is forgotten rather than stored. The
//     curated lists are meant to move between deploys, and somebody who pressed
//     Reset should get the new list rather than a frozen copy of the old one;
//   - an embedded playground restores neither. A demo in somebody's
//     documentation has to read the same to every reader - the same reason it
//     never restores a draft.
import { abaplintDefaults, onAbaplintSettingsRejected, useAbaplintSettings } from "../editor/registry.mjs";
import { applyLinterSettings, linterDefaults } from "../editor/abap2ui5-lint.mjs";
import { readStoredJson, removeStored, writeStoredJson } from "./storage.mjs";

const ABAPLINT_KEY = "abap2ui5-playground:abaplint";
const LINTER_KEY = "abap2ui5-playground:abap2ui5-lint";

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Keeps what was applied, or forgets it when it is the default again.
function keep(key, settings, defaults) {
  if (same(settings, defaults)) removeStored(key);
  else writeStoredJson(key, settings);
}

export const keepAbaplintSettings = (settings) => keep(ABAPLINT_KEY, settings, abaplintDefaults());
export const keepLinterSettings = (settings) => keep(LINTER_KEY, settings, linterDefaults());

// Restores both, as far as each can be restored. Called from boot( ) before the
// corpus is fetched: abaplint's half decides how the corpus is parsed, and
// restoring it afterwards would parse nine hundred objects twice.
export function restoreCheckerSettings() {
  restore(ABAPLINT_KEY, useAbaplintSettings);
  restore(LINTER_KEY, applyLinterSettings);
  // A rule abaplint has retired is only found out by the registry worker when
  // it builds - the page cannot know the rule list before then. It says so
  // through this, and the setting is dropped the same way a malformed one is.
  onAbaplintSettingsRejected(() => removeStored(ABAPLINT_KEY));
}

function restore(key, use) {
  const stored = readStoredJson(key);
  if (stored === undefined) return;
  try {
    use(stored);
  } catch {
    // A rule that has been retired, a release that is no longer known. The
    // defaults are a better answer than refusing to start, and the setting is
    // dropped so this is not asked again on every visit.
    removeStored(key);
  }
}
