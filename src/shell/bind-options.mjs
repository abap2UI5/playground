// @ts-check
// What a property in the View tab's Properties sheet can be bound to: the
// app class's public attributes, read off its definition - the attributes
// abap2UI5 can bind, since `client->_bind( )` takes a public attribute of the
// app - and the ABAP that binds one, in the shape the chain already uses.
//
// Step 3 of the visual builder (docs/concepts/visual-builder.md in
// abap2UI5/abap2UI5): bind instead of type. Read off the text, as
// deep-link.mjs reads a class's neighbours - no registry, no worker - and
// pure, so tests/node holds it.
import { withoutComments } from "./chain-read.mjs";

/** @typedef {{ name: string, type: string, table: boolean }} Attribute */

/**
 * The public instance attributes of the first class defined in `source`, in
 * the order they are declared: `DATA x TYPE …` and the chained `DATA: a TYPE
 * …, b TYPE …`. CLASS-DATA is left out (it binds the same, but the guide
 * never does it), and so is everything after PROTECTED or PRIVATE SECTION.
 * @param {string} source
 * @returns {Attribute[]}
 */
export function publicAttributes(source) {
  const code = withoutComments(source);
  const definition = /\bCLASS\s+\w+\s+DEFINITION\b[\s\S]*?\bENDCLASS\s*\./i.exec(code)?.[0];
  if (!definition) return [];
  const publicPart = /\bPUBLIC\s+SECTION\s*\.([\s\S]*?)(?:\b(?:PROTECTED|PRIVATE)\s+SECTION\s*\.|\bENDCLASS\s*\.)/i.exec(definition)?.[1] ?? "";
  const out = [];
  // Statement by statement: a chained DATA is one statement with commas.
  for (const statement of publicPart.split(".")) {
    const m = /^\s*DATA\s*(:?)\s*([\s\S]*)$/i.exec(statement);
    if (!m) continue;
    const parts = m[1] === ":" ? m[2].split(",") : [m[2]];
    for (const part of parts) {
      const d = /^\s*([a-z_]\w*)\s+(TYPE|LIKE)\s+([\s\S]+?)\s*$/i.exec(part);
      if (!d) continue;
      const type = d[3].replace(/\s+/g, " ").replace(/\s+READ-ONLY$/i, "");
      // REF TO is an object, not a value to show; a binding needs data.
      if (/^REF\s+TO\b/i.test(type)) continue;
      out.push({ name: d[1].toLowerCase(), type, table: /\bTABLE\s+OF\b|^t{1,2}_|_t(ab)?$/i.test(type) || /^(STANDARD|SORTED|HASHED)\b/i.test(type) });
    }
  }
  return out;
}

/**
 * What the chain calls the client by - `client`, `me->client`, `mo_client` -
 * read off a `->_bind`, `->_event` or `->_bind_edit` that is already there;
 * `client` when there is none.
 * @param {string} source
 */
export function clientOf(source) {
  return /([a-z_]\w*(?:->[a-z_]\w*)?)->_(?:bind|bind_edit|event|event_client)\s*\(/i.exec(withoutComments(source))?.[1] ?? "client";
}

/**
 * The ABAP that binds `attribute`: one-way for showing it, `_bind_edit` for
 * a property the user types into (an Input's value, a CheckBox's selected).
 * @param {string} client
 * @param {string} attribute
 * @param {boolean} editable
 */
export const bindingAbap = (client, attribute, editable) => `${client}->${editable ? "_bind_edit" : "_bind"}( ${attribute} )`;

// The properties a user changes by typing or ticking: bound with _bind_edit
// by default, so what they type reaches the attribute.
const EDITED = new Set(["value", "selected", "selectedKey", "dateValue", "state", "pressed", "checked"]);
/** Whether a binding of `property` is one the user writes back through. */
export const editableByDefault = (property) => EDITED.has(property);

// An event's name as the sheet takes it: what check_on_event( ) compares
// against, upper case by the framework's own habit.
export const EVENT_NAME = /^[A-Z][A-Z0-9_]{0,29}$/;

/** The ABAP that raises `event`. */
export const eventAbap = (client, event) => `${client}->_event( \`${event}\` )`;

/**
 * The source with an empty arm for `event` in main( ): an
 * `ELSEIF <client>->check_on_event( \`EVENT\` ).` before the ENDIF of the IF
 * that dispatches on check_on_init / check_on_event / check_on_navigated -
 * the lifecycle chain's own place, at its indentation, with an empty line
 * for the developer to fill. Nothing when the arm is there already; a
 * sentence when there is no such IF to put it in.
 * @param {string} source
 * @param {string} client
 * @param {string} event
 * @returns {{ ok: true, source: string } | { ok: false, why: string }}
 */
export function withEventArm(source, client, event) {
  const code = withoutComments(source);
  const handled = new RegExp(`check_on_event\\(\\s*\`${event}\`\\s*\\)`, "i");
  if (handled.test(code)) return { ok: true, source };
  const main = /METHOD\s+z2ui5_if_app~main\s*\.([\s\S]*?)\bENDMETHOD\s*\./i.exec(code);
  const why = `Add an arm for ${event} to main( ) yourself: ELSEIF ${client}->check_on_event( \`${event}\` ).`;
  if (!main) return { ok: false, why };
  const bodyStart = main.index + main[0].indexOf(main[1]);
  const body = main[1];
  // The dispatching IF: the first line of main( ) that tests check_on_*.
  const lines = body.split("\n");
  let offset = 0;
  let depth = -1;
  let ifIndent;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStart = offset;
    offset += line.length + 1;
    if (ifIndent === undefined) {
      const m = /^(\s*)IF\s+.*->check_on_(?:init|event|navigated)\b/i.exec(line);
      if (m) {
        ifIndent = m[1];
        depth = 0;
      }
      continue;
    }
    // Nested IFs inside the arms are skipped by counting.
    if (/^\s*IF\b/i.test(line)) depth += 1;
    else if (/^\s*ENDIF\s*\./i.test(line)) {
      if (depth === 0) {
        const eol = source.includes("\r\n") ? "\r\n" : "\n";
        const at = bodyStart + lineStart;
        const arm = `${ifIndent}ELSEIF ${client}->check_on_event( \`${event}\` ).${eol}${eol}`;
        return { ok: true, source: source.slice(0, at) + arm + source.slice(at) };
      }
      depth -= 1;
    }
  }
  return { ok: false, why };
}
