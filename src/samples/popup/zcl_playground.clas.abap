CLASS zcl_playground DEFINITION PUBLIC CREATE PUBLIC.

  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.

    DATA status TYPE string.

  PROTECTED SECTION.
    DATA client TYPE REF TO z2ui5_if_client.
    METHODS view_display.

ENDCLASS.


CLASS zcl_playground IMPLEMENTATION.

  METHOD z2ui5_if_app~main.

    me->client = client.

    IF client->check_on_init( ).
      status = `nothing deleted yet`.
      view_display( ).
      RETURN.
    ENDIF.

    " A popup is an app of its own: it is called with nav_app_call and hands
    " control back, which arrives here as a navigated roundtrip - not as an
    " event. That is why check_on_navigated( ) is part of every dispatcher.
    IF client->check_on_navigated( ).
      DATA(popup) = CAST z2ui5_cl_pop_to_confirm( client->get_app( client->get( )-s_draft-id_prev_app ) ).
      IF popup IS BOUND.
        status = COND #( WHEN popup->result( ) = abap_true
                         THEN `deleted`
                         ELSE `kept` ).
      ENDIF.
      view_display( ).
      RETURN.
    ENDIF.

    CASE client->get_event( ).
      WHEN `DELETE`.
        client->nav_app_call( z2ui5_cl_pop_to_confirm=>factory(
            i_question_text = `Delete this record?`
            i_title         = `Please confirm` ) ).
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
            )->a( n = `title` v = `Confirm before deleting` ).

    page->tag( `Button`
        )->a( n = `id`    v = `btnDelete`
        )->a( n = `text`  v = `delete`
        )->a( n = `type`  v = `Reject`
        )->a( n = `press` v = client->_event( `DELETE` ) ).

    page->tag( `Text`
        )->a( n = `id`   v = `txtStatus`
        )->a( n = `text` v = client->_bind( status ) ).

    client->view_display( view->stringify( ) ).

  ENDMETHOD.

ENDCLASS.
