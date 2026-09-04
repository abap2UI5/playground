// ABAP in the editor to JavaScript the runtime can execute - the page's side.
//
// The compile itself runs in the registry worker (src/editor/transpile-core.mjs,
// which explains the trick that makes it cost milliseconds rather than the
// twenty seconds a whole-registry transpile would), because that is where the
// registry is. What comes back is the JavaScript for each of the user's
// objects, in an order the runtime can define them in; what is thrown carries
// the transpiler's message and, as `problems`, the lines it named.
export { compile } from "./registry.mjs";
