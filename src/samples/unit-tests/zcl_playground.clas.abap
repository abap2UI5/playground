CLASS zcl_playground DEFINITION PUBLIC CREATE PUBLIC.

  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.

    DATA amount   TYPE i.
    DATA rate     TYPE i.
    DATA total    TYPE string.

    "! The logic under test: a percentage, rounded to whole units.
    METHODS with_tax
      IMPORTING
        net           TYPE i
        percent       TYPE i
      RETURNING
        VALUE(result) TYPE i.

  PROTECTED SECTION.
    DATA client TYPE REF TO z2ui5_if_client.
    METHODS view_display.

ENDCLASS.


CLASS zcl_playground IMPLEMENTATION.

  METHOD with_tax.

    result = net + ( net * percent + 50 ) DIV 100.

  ENDMETHOD.


  METHOD z2ui5_if_app~main.

    me->client = client.

    IF client->check_on_init( ).
      amount = 100.
      rate   = 19.
      view_display( ).
      RETURN.
    ENDIF.

    IF client->check_on_navigated( ).
      view_display( ).
      RETURN.
    ENDIF.

    CASE client->get_event( ).
      WHEN `CALC`.
        total = |{ with_tax( net = amount percent = rate ) }|.
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
            )->a( n = `title` v = `Unit tests run before the app` ).

    page->tag( `Input`
        )->a( n = `id`    v = `inpAmount`
        )->a( n = `value` v = client->_bind( amount ) ).

    page->tag( `Input`
        )->a( n = `id`    v = `inpRate`
        )->a( n = `value` v = client->_bind( rate ) ).

    page->tag( `Button`
        )->a( n = `id`    v = `btnCalc`
        )->a( n = `text`  v = `with tax`
        )->a( n = `type`  v = `Emphasized`
        )->a( n = `press` v = client->_event( `CALC` ) ).

    page->tag( `Text`
        )->a( n = `id`   v = `txtTotal`
        )->a( n = `text` v = client->_bind( total ) ).

    client->view_display( view->stringify( ) ).

  ENDMETHOD.

ENDCLASS.
