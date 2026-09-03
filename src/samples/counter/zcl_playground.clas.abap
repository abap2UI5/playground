CLASS zcl_playground DEFINITION PUBLIC CREATE PUBLIC.

  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.

    DATA count   TYPE i.
    DATA history TYPE string.

  PROTECTED SECTION.
    DATA client TYPE REF TO z2ui5_if_client.
    METHODS view_display.

ENDCLASS.


CLASS zcl_playground IMPLEMENTATION.

  METHOD z2ui5_if_app~main.

    me->client = client.

    " check_on_init( ) implies check_on_navigated( ) - the framework raises both
    " on an instance's first main( ) - so this one condition covers the first
    " render and every return from another app.
    IF client->check_on_navigated( ).
      view_display( ).
      RETURN.
    ENDIF.

    " Every press is a roundtrip: the state lives in this instance, is stored as
    " a draft between roundtrips, and comes back for the next one. Nothing about
    " it is in the browser.
    CASE client->get_event( ).
      WHEN `UP`.
        count = count + 1.
      WHEN `DOWN`.
        count = count - 1.
      WHEN `RESET`.
        CLEAR count.
    ENDCASE.

    history = |{ history }{ COND #( WHEN history IS NOT INITIAL THEN ` -> ` ) }{ count }|.

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
            )->a( n = `title` v = `Counter` ).

    page->tag( `Title`
        )->a( n = `id`    v = `txtCount`
        )->a( n = `text`  v = client->_bind( count )
        )->a( n = `level` v = `H1` ).

    page->tag( `Button`
        )->a( n = `id`    v = `btnUp`
        )->a( n = `text`  v = `+`
        )->a( n = `type`  v = `Emphasized`
        )->a( n = `press` v = client->_event( `UP` ) ).

    page->tag( `Button`
        )->a( n = `id`    v = `btnDown`
        )->a( n = `text`  v = `-`
        )->a( n = `press` v = client->_event( `DOWN` ) ).

    page->tag( `Button`
        )->a( n = `id`    v = `btnReset`
        )->a( n = `text`  v = `reset`
        )->a( n = `press` v = client->_event( `RESET` ) ).

    page->tag( `Text`
        )->a( n = `id`   v = `txtHistory`
        )->a( n = `text` v = client->_bind( history ) ).

    client->view_display( view->stringify( ) ).

  ENDMETHOD.

ENDCLASS.
