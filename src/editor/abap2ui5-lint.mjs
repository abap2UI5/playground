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

// The floor abap2UI5 holds its own shipped apps to (abap2ui5lint.jsonc), and
// therefore the one an example copied out of the playground has to clear. A
// higher floor here would quietly bless a control that breaks on exactly the
// systems that floor exists for.
const UI5 = "1.71";
const DISTRIBUTION = "openui5";

// Everything the linter has to say about one source. Never throws: a rule that
// falls over on unusual input must not take the editor's diagnostics with it,
// and the file being typed into is unusual input by definition.
export function findingsFor(source) {
  try {
    const result = checkAbapSource(source, { ui5: UI5, distribution: DISTRIBUTION });
    // A class that builds no view has nothing for this linter to say. Reporting
    // that as a finding would put a message on every helper class.
    if (!result.usesBuilder) return [];
    return result.findings ?? [];
  } catch {
    return [];
  }
}

