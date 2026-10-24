// @ts-check
// An app from a table: the class the "→ App" button writes from a table
// definition of the reader's own (src/editor/tables.mjs) - a list of the rows,
// and a dialog to add, change and delete one, every line of it ordinary
// abap2UI5 the reader goes on editing.
//
// What it writes is held to what the framework's own apps are held to: the
// lifecycle as one IF/ELSEIF chain with the navigated arm, the view through
// z2ui5_cl_ui5_view_builder in the house layout (one call per line, four
// spaces a level, `)->` at the start, the attribute values aligned), public
// attributes for bound data only, and only sap.m controls and icons the oldest
// supported UI5 has. tests/node/app-from-table.test.mjs holds it to the
// linter's house layout; tests/app-from-table.spec.js runs it with abaplint
// and the linter in the panel, adds a row, changes it and deletes it.
//
// Plain: no DOM, no abaplint - the page and the Node tests both read it.
import { readTable } from "./tables.mjs";

/** @typedef {{ name: string, key: boolean, datatype: string, leng: number, decimals: number, rollname: string }} Field */

/** The fields of a definition, with what the generator needs of each. */
function fieldsOf(text) {
  const out = [];
  const field = /<DD03P>([\s\S]*?)<\/DD03P>/g;
  for (let m = field.exec(text); m; m = field.exec(text)) {
    const tag = (t) => new RegExp(`<${t}>\\s*([^<]*?)\\s*</${t}>`).exec(m[1])?.[1] ?? "";
    const name = tag("FIELDNAME").toUpperCase();
    if (!name || name.startsWith(".")) continue;
    out.push({
      name,
      key: tag("KEYFLAG") === "X",
      datatype: tag("DATATYPE").toUpperCase(),
      leng: Number(tag("LENG") || 0),
      decimals: Number(tag("DECIMALS") || 0),
      rollname: tag("ROLLNAME").toUpperCase(),
    });
  }
  return out;
}

const NUMERIC = new Set(["INT1", "INT2", "INT4", "INT8", "DEC", "CURR", "QUAN", "FLTP", "D16D", "D34D"]);

/** "PRODUCT_ID" -> "Product Id": the column and label text, until the reader writes their own. */
const label = (name) => name.toLowerCase().split("_").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

/** The ABAP text of a backquoted string literal. */
const lit = (s) => `\`${String(s).replace(/`/g, "``")}\``;

/** Lines `)->a( n = ... v = ... )` with the `v =` / `b =` column aligned (rule 5 of the house layout). */
function attrs(indent, list) {
  const width = Math.max(...list.map(([n]) => n.length + 2));
  return list.map(([n, value, kind = "v"]) => `${indent})->a( n = ${`\`${n}\``.padEnd(width)} ${kind} = ${value}`);
}

/**
 * The class for a table, under a name the file set does not hold yet - or what
 * stands in the way.
 *
 * @param {string} tableText the .tabl.xml
 * @param {string[]} existing the names of the files open now
 * @returns {{ file?: { name: string, source: string }, className?: string, problem?: string }}
 */
export function appFromTable(tableText, existing = []) {
  const { name, problems } = readTable(tableText);
  if (problems.length) return { problem: `The table is not whole yet - ${problems[0].message}` };
  const table = String(name).toLowerCase();
  const fields = fieldsOf(tableText).filter((f) => f.name !== "MANDT");
  if (!fields.length) return { problem: `${name} has no fields to show beside its client.` };
  const hasClient = fieldsOf(tableText).some((f) => f.name === "MANDT");

  const taken = new Set(existing.map((n) => n.toLowerCase()));
  let className = `zcl_${table}_app`.slice(0, 30);
  for (let n = 2; taken.has(`${className}.clas.abap`); n++) className = `zcl_${table}_app${n}`.slice(0, 30);

  const title = text(tableText) || label(table);
  const source = classSource({ className, table, title, fields, hasClient });
  return { file: { name: `${className}.clas.abap`, source }, className };
}

const text = (xml) => /<DDTEXT>\s*([^<]*?)\s*<\/DDTEXT>/.exec(xml)?.[1] ?? "";

/** @param {{ className: string, table: string, title: string, fields: Field[], hasClient: boolean }} o */
function classSource({ className, table, title, fields, hasClient }) {
  const keys = fields.filter((f) => f.key);
  const keyNames = (keys.length ? keys : fields.slice(0, 1)).map((f) => f.name.toLowerCase());

  // The columns of the list, then the action column.
  const columns = [...fields.map((f) => label(f.name)), ""].flatMap((t, i, all) => [
    `        )->ele( \`Column\``,
    ...(t === "" ? [`            )->a( n = \`hAlign\` v = \`End\``] : [`            )->tag( \`Text\``, `                )->a( n = \`text\` v = ${lit(t)}`]),
    ...(i < all.length - 1 ? [`        )->end(`] : []),
  ]);
  const cells = fields.map((f) => [
    `                )->tag( \`Text\``,
    `                    )->a( n = \`text\` v = ${lit(`{${f.name}}`)}`,
  ]).flat();

  // One label and one input per field; a key is fixed once the row exists.
  const inputs = fields.map((f) => {
    const field = f.name.toLowerCase();
    const list = [["value", `client->_bind( ms_row-${field} )`]];
    if (NUMERIC.has(f.datatype)) list.push(["type", "`Number`"]);
    if (f.key) list.push(["editable", "mv_new", "b"]);
    if (f.leng > 0 && !NUMERIC.has(f.datatype) && f.datatype !== "STRG") list.push(["maxLength", lit(String(f.leng))]);
    return [
      `    form->tag( \`Label\``,
      `        )->a( n = \`text\` v = ${lit(label(f.name))}`,
      ...(f.key ? [`        )->a( n = \`required\` v = \`true\``] : []),
      `        )->tag( \`Input\``,
      ...attrs("            ", list).map((l, i, all) => (i === all.length - 1 ? `${l} ).` : l)),
      "",
    ];
  }).flat();

  const keyCheck = keyNames.map((k) => `ms_row-${k} IS INITIAL`).join(" OR ");
  // DELETE by the key in a WHERE, not FROM a work area: the playground's
  // transpiler drops the work area, and DELETE dbtab FROM wa deletes every row.
  const whereKey = keyNames.map((k, i) => `${i ? "\n            AND " : ""}${k} = @row-${k}`).join("");

  return `"! ${title} - an app for the table ${table.toUpperCase()}, written by the
"! playground's App from table. A list of the rows, and a dialog to add,
"! change and delete one; everything below is ordinary abap2UI5 to go on with.
CLASS ${className} DEFINITION PUBLIC.

  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.

    DATA mt_rows TYPE STANDARD TABLE OF ${table} WITH EMPTY KEY.
    DATA ms_row TYPE ${table}.
    DATA mv_new TYPE abap_bool.

  PROTECTED SECTION.
    DATA client TYPE REF TO z2ui5_if_client.

    METHODS on_event.
    METHODS view_display.
    METHODS popup_row.
    METHODS rows_read.
    METHODS row_save.
    METHODS row_of
      IMPORTING
        index         TYPE string
      RETURNING
        VALUE(result) TYPE ${table}.

  PRIVATE SECTION.
ENDCLASS.


CLASS ${className} IMPLEMENTATION.


  METHOD z2ui5_if_app~main.

    me->client = client.

    " Who may see and change these rows is this class's to decide: an
    " AUTHORITY-CHECK here, before anything is read, is where it goes.
    IF client->check_on_init( ).
      rows_read( ).
      view_display( ).
    ELSEIF client->check_on_navigated( ).
      view_display( ).
    ELSEIF client->check_on_event( ).
      on_event( ).
    ENDIF.

  ENDMETHOD.


  METHOD on_event.

    CASE client->get_event( ).

      WHEN \`ADD\`.
        CLEAR ms_row.
        mv_new = abap_true.
        popup_row( ).

      WHEN \`EDIT\`.
        ms_row = row_of( client->get_event_arg( ) ).
        mv_new = abap_false.
        popup_row( ).

      WHEN \`DELETE\`.
        DATA(row) = row_of( client->get_event_arg( ) ).
        DELETE FROM ${table} WHERE ${whereKey}.
        COMMIT WORK AND WAIT.
        rows_read( ).
        client->message_toast_display( \`Deleted.\` ).

      WHEN \`SAVE\`.
        row_save( ).

      WHEN \`CANCEL\`.
        client->popup_destroy( ).

    ENDCASE.

  ENDMETHOD.


  METHOD rows_read.

    SELECT * FROM ${table} INTO TABLE @mt_rows ORDER BY PRIMARY KEY.

  ENDMETHOD.


  METHOD row_of.

    " The row's index in the list, as the pressed button's binding context
    " says it - counted from 0 there, from 1 here.
    DATA(line) = CONV i( index ) + 1.
    READ TABLE mt_rows INTO result INDEX line.

  ENDMETHOD.


  METHOD row_save.

    IF ${keyCheck}.
      client->message_box_display( text = \`Fill in the key fields first.\` type = \`error\` ).
      RETURN.
    ENDIF.
${hasClient ? `
    ms_row-mandt = sy-mandt.` : ""}
    IF mv_new = abap_true.
      INSERT ${table} FROM @ms_row.
    ELSE.
      UPDATE ${table} FROM @ms_row.
    ENDIF.
    IF sy-subrc <> 0.
      client->message_box_display( text = \`The row could not be saved - is the key already taken?\` type = \`error\` ).
      RETURN.
    ENDIF.

    " abap2UI5 rolls back what an app leaves uncommitted at the end of a roundtrip.
    COMMIT WORK AND WAIT.
    client->popup_destroy( ).
    rows_read( ).
    client->message_toast_display( \`Saved.\` ).

  ENDMETHOD.


  METHOD view_display.

    DATA(view) = z2ui5_cl_ui5_view_builder=>factory(
        )->ele( n = \`View\` ns = \`mvc\`
            )->a( n = \`displayBlock\` v = \`true\`
            )->a( n = \`height\`       v = \`100%\`
            )->a( n = \`xmlns\`        v = \`sap.m\`
            )->a( n = \`xmlns:mvc\`    v = \`sap.ui.core.mvc\` ).
    DATA(page) = view->ele( \`Shell\`
        )->ele( \`Page\`
            )->a( n = \`title\`          v = ${lit(title)}
            )->a( n = \`showNavButton\`  b = client->check_app_prev_stack( )
            )->a( n = \`navButtonPress\` v = client->_event_nav_app_leave( ) ).

    DATA(tab) = page->ele( \`Table\`
        )->a( n = \`items\`      v = client->_bind( mt_rows )
        )->a( n = \`noDataText\` v = \`No rows yet - add the first one.\` ).

    tab->ele( \`headerToolbar\`
        )->ele( \`OverflowToolbar\`
            )->tag( \`Title\`
                )->a( n = \`text\` v = ${lit(`${title} (${table.toUpperCase()})`)}
            )->tag( \`ToolbarSpacer\`
            )->tag( \`Button\`
                )->a( n = \`text\`  v = \`Add\`
                )->a( n = \`icon\`  v = \`sap-icon://add\`
                )->a( n = \`type\`  v = \`Emphasized\`
                )->a( n = \`press\` v = client->_event( \`ADD\` ) ).

    tab->ele( \`columns\`
${columns.join("\n")} ).

    tab->ele( \`items\`
        )->ele( \`ColumnListItem\`
            )->ele( \`cells\`
${cells.join("\n")}
                )->ele( \`HBox\`
                    )->a( n = \`justifyContent\` v = \`End\`
                    )->tag( \`Button\`
                        )->a( n = \`icon\`    v = \`sap-icon://edit\`
                        )->a( n = \`tooltip\` v = \`Change\`
                        )->a( n = \`type\`    v = \`Transparent\`
                        )->a( n = \`press\`   v = client->_event(
                            val = \`EDIT\`
                            arg = \`$event.oSource.getBindingContext().getPath().split('/').pop()\` )
                    )->tag( \`Button\`
                        )->a( n = \`icon\`    v = \`sap-icon://delete\`
                        )->a( n = \`tooltip\` v = \`Delete\`
                        )->a( n = \`type\`    v = \`Transparent\`
                        )->a( n = \`press\`   v = client->_event(
                            val = \`DELETE\`
                            arg = \`$event.oSource.getBindingContext().getPath().split('/').pop()\` ) ).

    client->view_display( view->stringify( ) ).

  ENDMETHOD.


  METHOD popup_row.

    DATA(popup) = z2ui5_cl_ui5_view_builder=>factory(
        )->ele( n = \`FragmentDefinition\` ns = \`core\`
            )->a( n = \`xmlns\`      v = \`sap.m\`
            )->a( n = \`xmlns:core\` v = \`sap.ui.core\` ).
    DATA(dialog) = popup->ele( \`Dialog\`
        )->a( n = \`title\`        v = COND #( WHEN mv_new = abap_true THEN \`Add a row\` ELSE \`Change the row\` )
        )->a( n = \`contentWidth\` v = \`28rem\` ).

    DATA(form) = dialog->ele( \`VBox\`
        )->a( n = \`class\` v = \`sapUiSmallMargin\` ).

${inputs.join("\n")}
    dialog->ele( \`buttons\`
        )->tag( \`Button\`
            )->a( n = \`text\`  v = \`Save\`
            )->a( n = \`type\`  v = \`Emphasized\`
            )->a( n = \`press\` v = client->_event( \`SAVE\` )
        )->tag( \`Button\`
            )->a( n = \`text\`  v = \`Cancel\`
            )->a( n = \`press\` v = client->_event( \`CANCEL\` ) ).

    client->popup_display( popup->stringify( ) ).

  ENDMETHOD.
ENDCLASS.
`;
}
