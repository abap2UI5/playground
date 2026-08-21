// What an abap2UI5 app can reach. A view names its controls at runtime, so
// there is no way to derive this from the code - a library that is not here is
// a control that will not render. sap.ui.core and sap.m are what the frontend's
// manifest declares; the rest are the libraries abap2UI5's own samples use.
//
// One list, two readers, and they must agree: tools/build-ui5.mjs builds
// exactly these libraries into dist/app, and the examples browser
// (src/shell/examples.mjs) keeps catalogue entries whose library is not here
// out of its menu - offering one would be offering a control that cannot load.
//
// sap.ui.integration carries the integration cards and sap.ui.codeeditor the
// ABAP/JS editor control, added for the samples-controls catalogue. What is
// still missing after that is SAPUI5-only - sap.suite.*, sap.ui.comp, sap.viz,
// sap.gantt - and cannot be added to an OpenUI5 build at all.
export const UI5_LIBRARIES = [
  "sap.ui.core",
  "sap.m",
  "sap.f",
  "sap.ui.layout",
  "sap.ui.table",
  "sap.ui.unified",
  "sap.tnt",
  "sap.uxap",
  "sap.ui.integration",
  "sap.ui.codeeditor",
  "themelib_sap_horizon",
];
