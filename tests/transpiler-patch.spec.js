import { test, expect } from "@playwright/test";
import { control, MAIN_CLASS, open, setSource } from "./helpers.mjs";

// The shim in tools/patch-transpiler-returning.mjs, proved where it matters:
// through the transpiler this page runs in the reader's browser, against the
// real framework, on the two shapes the shim has to tell apart.
//
// abap2UI5's `follow_up_action( )` is two calls in one and decides between them
// on `result IS SUPPLIED`: consumed in a view attribute it returns the
// roundtrip-free handler, called as a statement it queues an action onto the
// response. Unpatched, the transpiler answered that predicate false for both,
// so every view-wired handler reached the browser as the empty string and fired
// as a follow-up on the first response instead - which on the sample pages read
// as a toast saying `${$source>/text} has been activated` before anything had
// been clicked.

const wired = `CLASS ${MAIN_CLASS} DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.
  PROTECTED SECTION.
    DATA client TYPE REF TO z2ui5_if_client.
    METHODS view_display.
ENDCLASS.
CLASS ${MAIN_CLASS} IMPLEMENTATION.
  METHOD z2ui5_if_app~main.
    me->client = client.
    IF client->check_on_navigated( ).
      view_display( ).
    ENDIF.
  ENDMETHOD.
  METHOD view_display.
    DATA(view) = z2ui5_cl_ui5_view_builder=>factory(
        )->ele( n = \`View\` ns = \`mvc\`
            )->a( n = \`xmlns\`     v = \`sap.m\`
            )->a( n = \`xmlns:mvc\` v = \`sap.ui.core.mvc\` ).
    DATA(page) = view->ele( \`Page\`
        )->a( n = \`title\` v = \`Wired\` ).
    page->tag( \`Link\`
        )->a( n = \`id\`    v = \`lnkWire\`
        )->a( n = \`text\`  v = \`Products\`
        )->a( n = \`press\` v = client->follow_up_action(
                  val   = client->cs_event-control_global
                  t_arg = VALUE #( ( \`MESSAGE_TOAST\` ) ( \`show\` ) ( \`{0} has been activated\` ) ( \`\${$source>/text}\` ) ) ) ).
    client->view_display( view->stringify( ) ).
  ENDMETHOD.
ENDCLASS.`;

const queued = `CLASS ${MAIN_CLASS} DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.
  PROTECTED SECTION.
    DATA client TYPE REF TO z2ui5_if_client.
    METHODS view_display.
ENDCLASS.
CLASS ${MAIN_CLASS} IMPLEMENTATION.
  METHOD z2ui5_if_app~main.
    me->client = client.
    IF client->check_on_navigated( ).
      view_display( ).
      client->follow_up_action(
          val   = client->cs_event-control_global
          t_arg = VALUE #( ( \`MESSAGE_BOX\` ) ( \`information\` ) ( \`queued at start\` ) ) ).
    ENDIF.
  ENDMETHOD.
  METHOD view_display.
    DATA(view) = z2ui5_cl_ui5_view_builder=>factory(
        )->ele( n = \`View\` ns = \`mvc\`
            )->a( n = \`xmlns\`     v = \`sap.m\`
            )->a( n = \`xmlns:mvc\` v = \`sap.ui.core.mvc\` ).
    view->ele( \`Page\`
        )->a( n = \`title\` v = \`Queued\` ).
    client->view_display( view->stringify( ) ).
  ENDMETHOD.
ENDCLASS.`;

async function run(page, source) {
  await open(page);
  await setSource(page, source);
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("running", { timeout: 60000 });
}

test("a view-wired follow_up_action runs in the browser, with its binding resolved", async ({ page }) => {
  await run(page, wired);
  await expect(page.frameLocator("#app").getByText("Wired")).toBeVisible();

  // Unpatched this link carries press="" and nothing happens on the click,
  // while the toast has already come and gone before it, saying the binding.
  await control(page, "lnkWire").click();
  await expect(page.frameLocator("#app").locator(".sapMMessageToast")).toHaveText(
    "Products has been activated",
  );
});

test("a follow_up_action called as a statement still queues onto the response", async ({ page }) => {
  await run(page, queued);

  // The other half of the same predicate: nothing consumes this result, so it
  // must stay a follow-up action and arrive without anything being clicked.
  await expect(page.frameLocator("#app").getByText("queued at start")).toBeVisible();
});
