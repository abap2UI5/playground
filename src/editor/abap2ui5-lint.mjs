// The abap2UI5 linter, next to abaplint.
//
// The two answer different questions and neither replaces the other. abaplint
// answers "does this ABAP compile" - types, syntax, whether the method exists.
// This one answers "does the view this code builds actually work": it
// reconstructs the XML out of the z2ui5_cl_ui5_view_builder chain without
// running a line of ABAP, and checks it against the UI5 release the app is
// meant for.
//
// That catches the class of mistake the playground otherwise cannot show at
// all - a control or a property that does not exist in the target release, an
// icon that is in no icon font. Those compile, and at run time they render
// nothing and log nothing: the reader sees a gap where a button should be and
// goes looking in the wrong place.
//
// The findings carry the same `severity` names as the config file, and the
// same rule names, so a message here is the message CI would print.
import { checkAbapSource } from "@abap2ui5/linter";
import { applyFixes, isFixable } from "@abap2ui5/linter/fix";

// The floor abap2UI5 holds its own shipped apps to (abap2ui5lint.jsonc), and
// therefore the one an example copied out of the playground has to clear. A
// higher floor here would quietly bless a control that breaks on exactly the
// systems that floor exists for.
//
// `ui5` is the name the Config tab shows, because that is what a reader is
// choosing - the UI5 release their app has to work on. The linter's own option
// for it is `minUi5`, and settingsFor( ) below is where the two meet.
const DEFAULTS = { ui5: "1.71", distribution: "openui5" };

// The rule's card on the linter's rules page - what it means, how severe it
// is, the same code fixed. A finding that carries `url` itself is believed
// (the linter sets one on every finding from 0.7 on); an older one gets the
// page's anchor, which is the rule id.
export const RULES_PAGE = "https://abap2ui5.github.io/linter/";
export const ruleUrl = (finding) => finding.url ?? `${RULES_PAGE}#${finding.type}`;

let settings = { ...DEFAULTS };

export const linterSettings = () => ({ ...settings });
export const linterDefaults = () => ({ ...DEFAULTS });

// What a settings object has to be. Shared by Apply and by the restore below,
// so a stored setting gets the same scrutiny a typed one does.
function validated(next) {
  if (!/^\d+\.\d+$/.test(next?.ui5 ?? "")) {
    throw new Error(`${next?.ui5} is not a UI5 release, which looks like 1.71 or 1.120.`);
  }
  if (!["openui5", "sapui5"].includes(next?.distribution)) {
    throw new Error(`distribution is openui5 or sapui5, not ${next?.distribution}.`);
  }
  return { ui5: next.ui5, distribution: next.distribution };
}

// Applies an edited configuration. Cheap, unlike abaplint's: the linter holds
// no parsed corpus, so the next keystroke simply asks it again. Throws what
// validated( ) throws, which is the sentence the Config tab shows.
export function applyLinterSettings(next) {
  settings = validated(next);
}

// The settings in the shape the linter takes them.
//
// The release option is called `minUi5` there and `ui5` here, and getting that
// wrong is silent in the worst way: an unknown key is simply ignored, so the
// linter kept its own default floor while the Config tab reported "applied"
// and the number of problems next to it did not move. It was passed as `ui5`
// until this was noticed, which means the release in that tab had never once
// changed what was checked.
const settingsFor = (s) => ({ minUi5: s.ui5, distribution: s.distribution });

// Everything the linter has to say about one source. Never throws: a rule that
// falls over on unusual input must not take the editor's diagnostics with it,
// and the file being typed into is unusual input by definition.
export function findingsFor(source) {
  try {
    const result = checkAbapSource(source, settingsFor(settings));
    // A class that builds no view has nothing for this linter to say. Reporting
    // that as a finding would put a message on every helper class.
    if (!result.usesBuilder) return [];
    return result.findings ?? [];
  } catch {
    return [];
  }
}


// Which of a set of findings this linter can repair itself. Not all of them:
// an icon that does not exist has no correct replacement to guess at, while a
// missing namespace declaration or a chain that has drifted out of the house
// layout has exactly one right answer.
//
// Takes findings rather than a source, because both callers already have them:
// the editor's one analysis pass has just asked findingsFor( ), and asking it
// again from here was a second reconstruction of the same builder chain.
export function fixableAmong(findings) {
  return findings.filter(isFixable);
}

// Repairs what can be repaired, and says how much. `deferred` counts fixes that
// overlapped one already applied - they are not lost, they are simply for the
// next press, which is why the caller runs this until it stops changing things.
export function applyLinterFixes(source) {
  const fixable = fixableAmong(findingsFor(source));
  if (fixable.length === 0) return { source, fixed: 0 };
  const { output, applied } = applyFixes(source, fixable);
  return { source: output, fixed: applied };
}
