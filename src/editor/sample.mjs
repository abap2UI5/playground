// What the editor holds when the playground opens.
//
// Small on purpose: it has to fit on screen next to the app it produces, and it
// has to show the four things every abap2UI5 app is made of - the interface, the
// lifecycle dispatch in main( ), a view built with the builder, and data bound
// both ways.
export const DEFAULT_SOURCE = `CLASS zcl_playground DEFINITION PUBLIC CREATE PUBLIC.

  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.

    DATA name     TYPE string.
    DATA greeting TYPE string.

  PROTECTED SECTION.
    DATA client TYPE REF TO z2ui5_if_client.
    METHODS view_display.

ENDCLASS.


CLASS zcl_playground IMPLEMENTATION.

  METHOD z2ui5_if_app~main.

    me->client = client.

    IF client->check_on_init( ) IS NOT INITIAL.
      name = \`World\`.
      view_display( ).
      RETURN.
    ENDIF.

    IF client->check_on_navigated( ) IS NOT INITIAL.
      view_display( ).
      RETURN.
    ENDIF.

    CASE client->get_event( ).
      WHEN \`GREET\`.
        greeting = |Hello { name }!|.
        client->message_toast_display( greeting ).
      WHEN \`CLEAR\`.
        CLEAR: name, greeting.
    ENDCASE.

  ENDMETHOD.


  METHOD view_display.

    DATA(view) = z2ui5_cl_ui5_view_builder=>factory(
        )->ele( n = \`View\` ns = \`mvc\`
            )->a( n = \`xmlns\`        v = \`sap.m\`
            )->a( n = \`xmlns:mvc\`    v = \`sap.ui.core.mvc\`
            )->a( n = \`displayBlock\` v = \`true\`
            )->a( n = \`height\`       v = \`100%\` ).

    DATA(page) = view->ele( \`Shell\`
        )->ele( \`Page\`
            )->a( n = \`title\` v = \`Hello abap2UI5\` ).

    page->tag( \`Input\`
        )->a( n = \`id\`          v = \`inpName\`
        )->a( n = \`value\`       v = client->_bind( name )
        )->a( n = \`placeholder\` v = \`your name\` ).

    page->tag( \`Button\`
        )->a( n = \`id\`    v = \`btnGreet\`
        )->a( n = \`text\`  v = \`say hello\`
        )->a( n = \`type\`  v = \`Emphasized\`
        )->a( n = \`press\` v = client->_event( \`GREET\` ) ).

    page->tag( \`Button\`
        )->a( n = \`id\`    v = \`btnClear\`
        )->a( n = \`text\`  v = \`clear\`
        )->a( n = \`press\` v = client->_event( \`CLEAR\` ) ).

    page->tag( \`Text\`
        )->a( n = \`id\`   v = \`txtGreeting\`
        )->a( n = \`text\` v = client->_bind( greeting ) ).

    client->view_display( view->stringify( ) ).

  ENDMETHOD.

ENDCLASS.
`;
