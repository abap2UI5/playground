CLASS zcl_pg_hello DEFINITION PUBLIC CREATE PUBLIC.

  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.

    DATA name     TYPE string.
    DATA greeting TYPE string.

  PROTECTED SECTION.
    DATA client TYPE REF TO z2ui5_if_client.
    METHODS view_display.
  PRIVATE SECTION.
ENDCLASS.


CLASS zcl_pg_hello IMPLEMENTATION.

  METHOD z2ui5_if_app~main.

    me->client = client.

    IF client->check_on_init( ).
      name = `World`.
      view_display( ).
      RETURN.
    ENDIF.

    IF client->check_on_navigated( ).
      view_display( ).
      RETURN.
    ENDIF.

    CASE client->get_event( ).
      WHEN `GREET`.
        greeting = |Hello { name }!|.
        client->message_toast_display( |Hello { name }!| ).
      WHEN `CLEAR`.
        CLEAR: name, greeting.
    ENDCASE.

  ENDMETHOD.


  METHOD view_display.

    DATA(view) = z2ui5_cl_ui5_view_builder=>factory(
        )->ele( n = `View` ns = `mvc`
            )->a( n = `xmlns`        v = `sap.m`
            )->a( n = `xmlns:mvc`    v = `sap.ui.core.mvc`
            )->a( n = `displayBlock` v = `true`
            )->a( n = `height`       v = `100%` ).

    DATA(page) = view->ele( `Shell`
        )->ele( `Page`
            )->a( n = `title` v = `abap2UI5 Playground` ).

    page->tag( `Input`
        )->a( n = `id`          v = `inpName`
        )->a( n = `value`       v = client->_bind( name )
        )->a( n = `placeholder` v = `your name` ).

    page->tag( `Button`
        )->a( n = `id`    v = `btnGreet`
        )->a( n = `text`  v = `say hello`
        )->a( n = `type`  v = `Emphasized`
        )->a( n = `press` v = client->_event( `GREET` ) ).

    page->tag( `Button`
        )->a( n = `id`    v = `btnClear`
        )->a( n = `text`  v = `clear`
        )->a( n = `press` v = client->_event( `CLEAR` ) ).

    page->tag( `Text`
        )->a( n = `id`   v = `txtGreeting`
        )->a( n = `text` v = client->_bind( greeting ) ).

    client->view_display( view->stringify( ) ).

  ENDMETHOD.

ENDCLASS.
