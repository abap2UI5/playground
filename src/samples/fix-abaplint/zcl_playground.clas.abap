CLASS zcl_playground DEFINITION PUBLIC CREATE PUBLIC.

  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.

    DATA name TYPE string.

  PROTECTED SECTION.
    " declared, never implemented - abaplint stops Run over it, and the fix
    " under Problems writes the implementation
    METHODS on_event.

ENDCLASS.

CLASS zcl_playground IMPLEMENTATION.

  METHOD z2ui5_if_app~main.

    IF client->check_on_event( ).
      on_event( ).
      RETURN.
    ENDIF.

    IF client->check_on_init( ) = abap_false.
      RETURN.
    ENDIF.

    DATA(view) = z2ui5_cl_ui5_view_builder=>factory(
        )->ele( n = `View` ns = `mvc`
            )->a( n = `xmlns`     v = `sap.m`
            )->a( n = `xmlns:mvc` v = `sap.ui.core.mvc` ).

    view->ele( `Page`
        )->a( n = `title` v = `abaplint: a method with no implementation`
        )->tag( `Input`
            )->a( n = `id`    v = `inpName`
            )->a( n = `value` v = client->_bind( name ) ).

    client->view_display( view->stringify( ) ).

  ENDMETHOD.

ENDCLASS.
