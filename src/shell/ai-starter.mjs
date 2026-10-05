// The class the AI Studio starts on: the smallest abap2UI5 app there is, the
// interface implemented and main( ) empty - the shape the reader and Claude
// build on. Untouched it is nothing to run yet (main.mjs skips the first run,
// the stage's window bar says "your app"), and the first class Claude writes
// under another name takes its place (writeFile( ) in ai-agent.mjs).
export const AI_FILE = "zcl_app.clas.abap";

export const AI_STARTER = `CLASS zcl_app DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.
ENDCLASS.

CLASS zcl_app IMPLEMENTATION.
  METHOD z2ui5_if_app~main.
  ENDMETHOD.
ENDCLASS.
`;

// Blank, or the starter as it was handed out - whitespace aside, so an editor
// trimming a trailing newline does not make it somebody's work.
export function isUntouchedStarter(file) {
  const source = file.source.trim();
  return source === "" || (file.name === AI_FILE && source === AI_STARTER.trim());
}
