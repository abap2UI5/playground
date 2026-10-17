import { test, expect } from "@playwright/test";
import { MAIN_CLASS, MAIN_FILE, getSource, open, openFiles, setSource } from "./helpers.mjs";

// A database table of the reader's own (src/editor/tables.mjs): "+ table"
// puts a definition and its rows into the file set, abaplint knows the table,
// and every Run creates it in the in-memory database with those rows -
// afresh, so what an app inserted is gone at the next Run.

// An app that SELECTs from the starter table, shows the second row and how
// many there are, and inserts one more on a press of its button.
const APP = `CLASS ${MAIN_CLASS} DEFINITION PUBLIC.

  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.

    DATA products TYPE STANDARD TABLE OF zproducts WITH EMPTY KEY.
    DATA second   TYPE string.
    DATA count    TYPE i.

  PRIVATE SECTION.
    METHODS read.

ENDCLASS.


CLASS ${MAIN_CLASS} IMPLEMENTATION.

  METHOD z2ui5_if_app~main.

    IF client->check_on_init( ).
      read( ).
      DATA(view) = z2ui5_cl_ui5_view_builder=>factory(
          )->ele( n = \`View\` ns = \`mvc\`
              )->a( n = \`xmlns\`     v = \`sap.m\`
              )->a( n = \`xmlns:mvc\` v = \`sap.ui.core.mvc\` ).
      view->ele( \`Page\`
          )->tag( \`Text\`
              )->a( n = \`id\`   v = \`second\`
              )->a( n = \`text\` v = client->_bind( second )
          )->tag( \`Text\`
              )->a( n = \`id\`   v = \`count\`
              )->a( n = \`text\` v = client->_bind( count )
          )->tag( \`Button\`
              )->a( n = \`id\`    v = \`add\`
              )->a( n = \`text\`  v = \`Add\`
              )->a( n = \`press\` v = client->_event( \`ADD\` ) ).
      client->view_display( view->stringify( ) ).
    ELSEIF client->check_on_event( \`ADD\` ).
      DATA(row) = VALUE zproducts( product_id = \`P999\` name = \`Cable\` price = '5.00' stock = 1 ).
      INSERT zproducts FROM @row.
      read( ).
      client->view_model_update( ).
    ENDIF.

  ENDMETHOD.


  METHOD read.

    SELECT * FROM zproducts INTO TABLE @products ORDER BY product_id.
    count = lines( products ).
    DATA(row) = products[ 2 ].
    second = |{ row-name } in { row-category } at { row-price }, { row-stock } in stock|.

  ENDMETHOD.

ENDCLASS.
`;

test("+ table adds a table with rows, abaplint knows it, and a Run SELECTs from it afresh", async ({ page }) => {
  await open(page);

  await page.locator(".file-add-table").click();
  expect(await openFiles(page)).toEqual([MAIN_FILE, "zproducts.tabl.xml", "zproducts.tabu.json"]);
  await expect(page.locator(".file-tab.is-active")).toContainText("zproducts.tabl.xml");
  expect(await getSource(page, "zproducts.tabl.xml")).toContain("<TABNAME>ZPRODUCTS</TABNAME>");
  expect(await getSource(page, "zproducts.tabu.json")).toContain('"product_id": "P002"');

  await setSource(page, APP);
  // Known to abaplint: the SELECT, the TYPE and the VALUE all check - an
  // unknown table would be an error, and Run refuses to start on one.
  await page.locator('[data-insight="problems"]').click();
  await expect(page.locator("#problem-count")).not.toHaveClass(/is-error/);
  await expect(page.locator(".insight-body")).not.toContainText(/zproducts/i);

  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });
  const frame = page.frameLocator("#app");
  await expect(frame.locator('[id$="--second"]')).toHaveText("Monitor 27 in Displays at 249.50, 30 in stock", { timeout: 30000 });
  await expect(frame.locator('[id$="--count"]')).toHaveText("5");

  // The app writes to its table, and reads its own row back...
  await frame.locator('[id$="--add"]').click();
  await expect(frame.locator('[id$="--count"]')).toHaveText("6", { timeout: 30000 });

  // ...and a Run starts from the rows in the file again.
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });
  await expect(frame.locator('[id$="--count"]')).toHaveText("5", { timeout: 30000 });

  // The rows are the file's: changed there, changed at the next Run.
  const rows = await getSource(page, "zproducts.tabu.json");
  await setSource(page, rows.replace('"Monitor 27"', '"Monitor 32"'), "zproducts.tabu.json");
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });
  await expect(frame.locator('[id$="--second"]')).toHaveText(/^Monitor 32 in Displays/, { timeout: 30000 });
});

test("a broken seed file is a problem at its line, and closing the table takes its rows with it", async ({ page }) => {
  await open(page);
  await page.locator(".file-add-table").click();

  await setSource(page, '[\n  { "product_id": "P001" },\n  { "product_id": ["P002"] }\n]\n', "zproducts.tabu.json");
  await page.locator('[data-insight="problems"]').click();
  await expect(page.locator(".insight-body")).toContainText("Row 2, PRODUCT_ID: a value is a string or a number, not a list.");

  // A field with no type is reported here rather than handed to abaplint,
  // which would throw on it.
  const xml = await getSource(page, "zproducts.tabl.xml");
  await setSource(page, xml.replace(/<DATATYPE>INT4<\/DATATYPE>/, ""), "zproducts.tabl.xml");
  await expect(page.locator(".insight-body")).toContainText("STOCK has no type");

  // Rows that are JSON but do not fit their columns are said by the Run, with
  // the row and the field, under ABAP's own conversion rules.
  await setSource(page, xml, "zproducts.tabl.xml");
  await setSource(page, '[\n  { "product_id": "P001", "price": "cheap" }\n]\n', "zproducts.tabu.json");
  await page.locator("#run").click();
  await expect(page.locator(".log-body")).toContainText('row 1: "cheap" does not fit PRICE', { timeout: 60000 });

  await page.locator('.file-close[data-close="zproducts.tabl.xml"]').click();
  expect(await openFiles(page)).toEqual([MAIN_FILE]);
});
