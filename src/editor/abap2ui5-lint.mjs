// The abap2UI5 linter, next to abaplint - the page's side.
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
//
// The linter itself runs in the registry worker (src/editor/lint-core.mjs),
// where abaplint runs, and answers in the same analysis message the page
// asks abaplint with (`analyse` in registry.mjs): it used to run on this
// thread over every open file on every keystroke pause, and on a phone that
// was the better part of the pause. What is left here is what the page
// decides - the settings, validated here and told to the worker - and what
// the page prints: the link to a rule's card.
import { loadLinter as loadInWorker, useLinterSettings } from "./registry.mjs";

// Resolves when the worker has the linter's chunk - the moment boot( ) throws
// the kept analysis away and asks again, because every answer before it said
// "no findings". The worker asks for the chunk the moment it starts; this is
// the page waiting on that, not starting it. The settings the page holds go
// first - the defaults, or what restoreCheckerSettings( ) put back - so a
// worker that is never told anything else lints at the floor, not at the
// linter's own; messages to a worker arrive in the order they were sent.
export function loadLinter() {
  useLinterSettings(settingsFor(settings)).catch(() => {});
  return loadInWorker();
}

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
// no parsed corpus, so the next analysis simply asks it again - the worker
// drops its memo when it is told. Throws what validated( ) throws, which is
// the sentence the Config tab shows. The message to the worker is heard: a
// worker that has died is reported by the boot, not by a Config tab.
export function applyLinterSettings(next) {
  settings = validated(next);
  useLinterSettings(settingsFor(settings)).catch(() => {});
}

// The settings in the shape the linter takes them.
//
// The release option is called `minUi5` there and `ui5` here, and getting that
// wrong is silent in the worst way: an unknown key is simply ignored, so the
// linter kept its own default floor while the Config tab reported "applied"
// and the number of problems next to it did not move. It was passed as `ui5`
// until this was noticed, which means the release in that tab had never once
// changed what was checked.
//
// Three of the linter's file-format rules are switched off, because what they
// guard is a file abapGit serialises and the buffer here is not one yet: a
// line ending in blanks is what every Enter leaves behind mid-typing, Monaco
// adds no final newline, and whether the buffer holds CRs depends on what was
// pasted into it. The one way out of the
// playground that IS such a file - the abapGit zip - already does all three
// on the way out (normalisedSource( ) in src/shell/export.mjs), so a warning
// here would be about something that can no longer reach a repository.
// byte-order-mark stays on: the export does not strip one.
const FILE_FORMAT_RULES_THE_EXPORT_NORMALISES = {
  "trailing-whitespace": false,
  "crlf-line-ending": false,
  "missing-final-newline": false,
};

const settingsFor = (s) => ({
  minUi5: s.ui5,
  distribution: s.distribution,
  rules: FILE_FORMAT_RULES_THE_EXPORT_NORMALISES,
});
