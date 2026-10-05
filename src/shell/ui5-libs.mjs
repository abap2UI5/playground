// Which UI5 library a control ships in.
//
// The sample repositories publish what their views BUILD - control names, out
// of the abap2UI5 linter - and deliberately stop there. Mapping a name to a
// library is one UI5 taxonomy question, and three repositories each answering
// it would be three copies of the table below, drifting apart quietly. It
// belongs here instead, because this is where the question is actually asked:
// UI5_LIBRARIES beside it is the closed set this site carries, and "does this
// sample render here" is that set against this mapping.
//
// The namespace is NOT the library, which is the only reason this is a table
// and not a split on the last dot: sap.ui.layout.form.SimpleForm ships in
// sap.ui.layout, sap.ui.model.type.Date in sap.ui.core. So the longest known
// prefix wins, and everything else under sap.ui. falls back to sap.ui.core -
// there is no library called sap.ui.model or sap.ui.base for a facet to offer.
//
// z2ui5.cc.* is not a UI5 library at all: those are abap2UI5's own custom
// controls, shipped with the framework's frontend, so they are wherever
// abap2UI5 is - including here.
import { UI5_LIBRARIES } from "./ui5-libraries.mjs";

// SAPUI5-only. None of these can be in an OpenUI5 build. One list, read twice
// below - it used to be written out twice, and the second copy still carried
// sap.ui.mdc, which is OpenUI5 (Apache-2.0) since 1.80, so its samples were
// told they need SAPUI5 when all they need is a library this build lacks.
const SAPUI5_ONLY_LIBS = [
  "sap.ui.comp", "sap.suite.ui.commons", "sap.suite.ui.microchart",
  "sap.suite.ui.generic", "sap.ui.vk", "sap.ui.vbm", "sap.viz", "sap.gantt",
  "sap.ndc", "sap.ushell", "sap.collaboration", "sap.ui.generic",
  "sap.ui.richtexteditor", "sap.ui.export", "sap.fe",
  "sap.chart", "sap.ca.ui", "sap.me", "sap.ui.vtm", "sap.ovp",
];

// Every library a control in the three corpora can come from. The ones this
// site carries come from UI5_LIBRARIES so the two cannot disagree; the rest
// are here to be NAMED - a reader filtering for sap.ui.comp deserves to see
// the ports that use it, told that they need SAPUI5, rather than to see
// nothing.
const OTHER_LIBS = [
  ...SAPUI5_ONLY_LIBS,
  // OpenUI5 libraries this build does not carry.
  "sap.ui.commons", "sap.ui.suite", "sap.ui.ux3", "sap.ui.webc.main",
  "sap.ui.webc.fiori", "sap.ui.mdc", "sap.ui.fl",
  // abap2UI5's own custom controls.
  "z2ui5.cc",
];

const KNOWN = [...new Set([...UI5_LIBRARIES, ...OTHER_LIBS])]
  .sort((a, b) => b.length - a.length);

/** The library a control ships in. Longest known prefix wins. */
export const libraryOf = (control) =>
  KNOWN.find((lib) => control === lib || control.startsWith(`${lib}.`))
  || (control.startsWith("sap.ui.") ? "sap.ui.core" : control.split(".").slice(0, -1).join("."));

/** Libraries only SAPUI5 carries - the reason a port cannot run here that is
 *  not "this build happens not to include it". */
const SAPUI5_ONLY = new Set(SAPUI5_ONLY_LIBS);

export const isSapui5Only = (library) => SAPUI5_ONLY.has(library);

/** Does this site carry the library? z2ui5.cc is abap2UI5's own, so yes. */
export const isCarried = (library) =>
  UI5_LIBRARIES.includes(library) || library.startsWith("z2ui5.");

/** Compare two dotted UI5 versions numerically ("1.9" < "1.71" < "1.120"). */
export function cmpVersion(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}
