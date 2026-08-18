// Node's Buffer, for the browser.
//
// The transpiled standard library reaches for Buffer in the places where ABAP
// crosses between characters and bytes: cl_abap_char_utilities builds its
// MAXCHAR/MINCHAR constants from hex in a class constructor (so this is needed
// before any application code runs at all), cl_abap_conv_in_ce/out_ce convert
// between encodings, and cl_http_utility does base64.
//
// esbuild injects this module's `Buffer` wherever the bundle references the
// free variable, which is exactly what a Node runtime would have provided.
export { Buffer } from "buffer";
