import { test, expect } from "@playwright/test";
import { MAIN_CLASS, open, setSource } from "./helpers.mjs";

// The State tab: the app's attributes after each roundtrip, read off the
// instance in the runtime worker (src/runtime/app-state.mjs), with what
// changed since the roundtrip before marked - src/shell/insight-state.mjs.
//
// The app the page opens on binds NAME to an input and writes GREETING on a
// press of Greet: one attribute the reader changes, one the app does.

const row = (page, name) => page.locator(".state-row").filter({ has: page.locator(".state-name", { hasText: new RegExp(`^${name}$`) }) });

test("the State tab shows the app's attributes and marks what a roundtrip changed", async ({ page }) => {
  await open(page);
  await page.locator('[data-insight="state"]').click();

  // After the app start: the class, its attributes with their types, and
  // nothing marked - there is nothing before it to compare with.
  await expect(page.locator(".state .log-title")).toContainText(`${MAIN_CLASS.toUpperCase()} after #1 app start`);
  await expect(row(page, "name").locator(".state-value")).toHaveText("World");
  await expect(row(page, "name").locator(".state-type")).toHaveText("string");
  await expect(row(page, "greeting").locator(".state-value")).toHaveText("initial");
  // A reference is named, not followed; a protected attribute says so.
  await expect(row(page, "client").locator(".state-value")).toHaveText(/^→ Z2UI5_CL_UI5_CLIENT/i);
  await expect(row(page, "client").locator(".state-type")).toHaveText("ref to z2ui5_if_client · protected");
  await expect(page.locator(".state-row.is-changed")).toHaveCount(0);

  // Typed into the input and Greet pressed: both attributes changed, and
  // the tab - open all along - followed the roundtrip by itself.
  const frame = page.frameLocator("#app");
  await frame.getByRole("textbox").first().fill("Trace");
  await frame.getByRole("button", { name: "Greet" }).click();
  await expect(page.locator(".state .log-title")).toContainText("after #2 GREET · 2 changes since #1", { timeout: 30000 });
  await expect(row(page, "name")).toHaveClass(/is-changed/);
  await expect(row(page, "name").locator(".state-value")).toHaveText("Trace changed");
  await expect(row(page, "greeting")).toHaveClass(/is-changed/);
  await expect(row(page, "greeting").locator(".state-value")).toContainText("Hello Trace!");
  await expect(row(page, "client")).not.toHaveClass(/is-changed/);

  // A Run starts it over, with the roundtrips.
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });
  await expect(page.locator(".state .log-title")).toContainText("after #1 app start");
  await expect(row(page, "name").locator(".state-value")).toHaveText("World");
  await expect(page.locator(".state-row.is-changed")).toHaveCount(0);
});

test("structures and tables open a level at a time, and a change inside opens its way", async ({ page }) => {
  await open(page);
  const source = `CLASS ${MAIN_CLASS} DEFINITION PUBLIC.
  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.
    TYPES: BEGIN OF ty_item,
             id    TYPE i,
             label TYPE string,
           END OF ty_item.
    DATA items   TYPE STANDARD TABLE OF ty_item WITH EMPTY KEY.
    DATA current TYPE ty_item.
    DATA long    TYPE string.
ENDCLASS.

CLASS ${MAIN_CLASS} IMPLEMENTATION.
  METHOD z2ui5_if_app~main.
    IF client->check_on_init( ).
      DO 30 TIMES.
        INSERT VALUE #( id = sy-index label = |item { sy-index }| ) INTO TABLE items.
      ENDDO.
      long = repeat( val = \`x\` occ = 500 ).
      client->view_display( z2ui5_cl_ui5_view_builder=>factory(
          )->ele( n = \`View\` ns = \`mvc\`
              )->a( n = \`xmlns\`     v = \`sap.m\`
              )->a( n = \`xmlns:mvc\` v = \`sap.ui.core.mvc\`
          )->ele( \`Page\`
              )->tag( \`Button\`
                  )->a( n = \`id\`    v = \`pick\`
                  )->a( n = \`text\`  v = \`Pick\`
                  )->a( n = \`press\` v = client->_event( \`PICK\` )
          )->stringify( ) ).
    ELSEIF client->check_on_event( \`PICK\` ).
      current = items[ 3 ].
    ENDIF.
  ENDMETHOD.
ENDCLASS.
`;
  await setSource(page, source);
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });
  await page.locator('[data-insight="state"]').click();

  // A table says how many rows it holds and starts closed; opened, it shows
  // the first twenty and says how many more there are.
  await expect(row(page, "items").locator(".state-value")).toHaveText("30 rows");
  await expect(row(page, "items")).toHaveAttribute("aria-expanded", "false");
  await row(page, "items").locator(".state-toggle").click();
  await expect(row(page, "\\[1\\]")).toHaveCount(1);
  await expect(page.locator(".state-more")).toHaveText("… 10 more not shown");
  // A long string is cut, and says how long it is.
  await expect(row(page, "long").locator(".state-value")).toContainText("… (500 characters)");

  // The structure the event filled opens by itself, its fields marked.
  await page.frameLocator("#app").locator('[id$="--pick"]').click();
  await expect(row(page, "current")).toHaveAttribute("aria-expanded", "true", { timeout: 30000 });
  await expect(row(page, "label")).toHaveClass(/is-changed/);
  await expect(row(page, "label").locator(".state-value")).toHaveText("item 3 changed");
});
