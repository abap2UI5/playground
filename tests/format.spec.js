import { test, expect } from "@playwright/test";
import { addNamedFile, getSource, open, setSource } from "./helpers.mjs";

// Format - the { } in the bar, and Shift+Alt+F, which are one implementation:
// abaplint's layout fixes and then its pretty printer, over every file that is
// open (formatFiles( ) in src/editor/registry-core.mjs).
//
// It used to be the pretty printer alone, on the file on screen, which meant
// indentation and keyword case and nothing else: a trailing space, a tab, a
// double space, a `endcase .`, two statements sharing a line all survived a
// press of Format. What is deliberately NOT on the rule list is held here too,
// because it is the half that would make Format unusable: nothing on it may
// reflow an abap2UI5 builder chain, and nothing on it may change what the code
// does.

// Everything the strengthened formatter is supposed to pick up, in one class:
// lower-case keywords and wrong indentation (the pretty printer's own half),
// then a tab, a double space, trailing whitespace, a space before the full
// stop, a colon with no space after it, and two statements on one line.
const MESSY = `class zcl_playground definition public create public.
public section.
interfaces z2ui5_if_app.
data:name type string,
count type i.
protected section.
data client type ref to z2ui5_if_client.
endclass.

class zcl_playground implementation.
method z2ui5_if_app~main.
me->client = client.
if client->check_on_init( ) = abap_true.
\tname = \`world\`.
count = 0. count = count + 1 .
endif.
client->view_display( \`<Shell><Page title="\` && name && \`"/></Shell>\` ).
endmethod.
endclass.
`;

test("Format lays out what the pretty printer alone left alone", async ({ page }) => {
  await open(page);
  await setSource(page, MESSY);
  await page.locator("#format").click();
  await expect(page.locator("#status")).toHaveText(/formatted 1 file/);

  const out = await getSource(page);

  // The pretty printer's own half: keywords up, bodies indented.
  expect(out).toContain("CLASS zcl_playground DEFINITION PUBLIC CREATE PUBLIC.");
  expect(out).toContain("  PUBLIC SECTION.\n    INTERFACES z2ui5_if_app.");

  // And the half it never did: no tab, no line ending in whitespace, no
  // double space, no space in front of the full stop, a space after the
  // colon of a chain, and one statement to a line.
  expect(out, "a tab is not indentation").not.toContain("\t");
  expect(out, "no line ends in whitespace").not.toMatch(/[ \t]+\n/);
  expect(out).toContain("DATA: name TYPE string,");
  expect(out).toContain("count = count + 1.");
  expect(out).toMatch(/count = 0\.\n\s+count = count \+ 1\./);

  // It is one edit, so it comes back the way an autofix comes back.
  await page.locator("#undo").click();
  expect(await getSource(page)).toBe(MESSY);
});

test("Format leaves an abap2UI5 builder chain exactly as it is", async ({ page }) => {
  // The rule list is chosen around this: `align_parameters`,
  // `line_break_multiple_parameters` and `keep_single_parameter_on_one_line`
  // all have fixes, and all three take `)->a( n = ... v = ... )` and break it
  // into two lines apiece. A formatter that reformats the house style is one
  // nobody presses twice, so none of them is on it.
  await open(page);
  const chain = await getSource(page);
  expect(chain).toContain(")->a(");

  await page.locator("#format").click();
  await expect(page.locator("#status")).toHaveText("already formatted");
  expect(await getSource(page)).toBe(chain);
});

test("Format formats every file that is open, not just the one on screen", async ({ page }) => {
  // A class and its test include are one piece of work. Formatting the half
  // somebody happens to be looking at is the kind of half-done that has to be
  // noticed to be finished.
  await open(page);
  await addNamedFile(page, "zcl_other.clas.abap");
  await setSource(
    page,
    "class zcl_other definition public create public.\npublic section.\nmethods hello.\nendclass.\n\n"
      + "class zcl_other implementation.\nmethod hello.\nendmethod.\nendclass.\n",
    "zcl_other.clas.abap",
  );
  await setSource(page, MESSY);

  await page.locator("#format").click();
  await expect(page.locator("#status")).toHaveText(/formatted 2 files/);

  const other = await getSource(page, "zcl_other.clas.abap");
  expect(other).toContain("CLASS zcl_other DEFINITION PUBLIC CREATE PUBLIC.");
  expect(other).toContain("    METHODS hello.");
});

test("Shift+Alt+F is the same formatter, on the file it is pressed in", async ({ page }) => {
  // Monaco's own binding, through the document formatting provider - which
  // used to run the pretty printer alone and now runs what the button runs.
  // Two ways in with two ideas of what formatting means is a bug somebody
  // finds by pressing the other one.
  await open(page);
  await setSource(page, MESSY);
  // Clicked into, not focused: Monaco listens on a hidden textarea, and a
  // key pressed at a document that has not given the editor the caret goes
  // nowhere in particular.
  await page.locator(".monaco-editor").first().click();
  await page.keyboard.press("Shift+Alt+F");

  await expect
    .poll(async () => await getSource(page), { timeout: 30000 })
    .toContain("CLASS zcl_playground DEFINITION PUBLIC CREATE PUBLIC.");
  const out = await getSource(page);
  expect(out).not.toContain("\t");
  expect(out).toContain("count = count + 1.");
});
