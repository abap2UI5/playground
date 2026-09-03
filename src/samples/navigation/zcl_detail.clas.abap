CLASS zcl_detail DEFINITION PUBLIC CREATE PUBLIC.

  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.

    " Public, so the app that called this one can read the answer after
    " control comes back.
    DATA chosen TYPE string.

  PROTECTED SECTION.
    DATA client TYPE REF TO z2ui5_if_client.
    METHODS view_display.

ENDCLASS.


CLASS zcl_detail IMPLEMENTATION.

  METHOD z2ui5_if_app~main.

    me->client = client.

    IF client->check_on_init( ).
      view_display( ).
      RETURN.
    ENDIF.

    CASE client->get_event( ).
      WHEN `RED` OR `GREEN` OR `BLUE`.
        chosen = client->get_event( ).
        client->nav_app_leave( ).
      WHEN `BACK`.
        client->nav_app_leave( ).
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
            )->a( n = `title`      v = `Pick one`
            )->a( n = `showNavButton` v = `true`
            )->a( n = `navButtonPress` v = client->_event( `BACK` ) ).

    page->tag( `Button`
        )->a( n = `id`    v = `btnRed`
        )->a( n = `text`  v = `RED`
        )->a( n = `press` v = client->_event( `RED` ) ).

    page->tag( `Button`
        )->a( n = `id`    v = `btnGreen`
        )->a( n = `text`  v = `GREEN`
        )->a( n = `press` v = client->_event( `GREEN` ) ).

    page->tag( `Button`
        )->a( n = `id`    v = `btnBlue`
        )->a( n = `text`  v = `BLUE`
        )->a( n = `press` v = client->_event( `BLUE` ) ).

    client->view_display( view->stringify( ) ).

  ENDMETHOD.

ENDCLASS.
