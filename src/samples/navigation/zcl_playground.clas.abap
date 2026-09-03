CLASS zcl_playground DEFINITION PUBLIC CREATE PUBLIC.

  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.

    DATA picked TYPE string.

  PROTECTED SECTION.
    DATA client TYPE REF TO z2ui5_if_client.
    METHODS view_display.

ENDCLASS.


CLASS zcl_playground IMPLEMENTATION.

  METHOD z2ui5_if_app~main.

    me->client = client.

    IF client->check_on_init( ).
      view_display( ).
      RETURN.
    ENDIF.

    " The called app hands control back, and that arrives here as a navigated
    " roundtrip - not as an event. Reading its result means reading the app
    " instance the framework kept for us.
    IF client->check_on_navigated( ).
      DATA(detail) = CAST zcl_detail( client->get_app( client->get( )-s_draft-id_prev_app ) ).
      IF detail IS BOUND.
        picked = detail->chosen.
      ENDIF.
      view_display( ).
      RETURN.
    ENDIF.

    CASE client->get_event( ).
      WHEN `PICK`.
        client->nav_app_call( NEW zcl_detail( ) ).
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
            )->a( n = `title` v = `Hub` ).

    page->tag( `Button`
        )->a( n = `id`    v = `btnPick`
        )->a( n = `text`  v = `choose a colour`
        )->a( n = `type`  v = `Emphasized`
        )->a( n = `press` v = client->_event( `PICK` ) ).

    page->tag( `Text`
        )->a( n = `id`   v = `txtPicked`
        )->a( n = `text` v = client->_bind( picked ) ).

    client->view_display( view->stringify( ) ).

  ENDMETHOD.

ENDCLASS.
