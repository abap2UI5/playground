CLASS zcl_playground DEFINITION PUBLIC CREATE PUBLIC.

  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.

    DATA name TYPE string.

ENDCLASS.

CLASS zcl_playground IMPLEMENTATION.

  METHOD z2ui5_if_app~main.

    IF client->check_on_init( ) = abap_false.
      RETURN.
    ENDIF.

    " xmlns:mvc and xmlns:form are missing - the Fix button adds them
    DATA(view) = z2ui5_cl_ui5_view_builder=>factory(
        )->ele( n = `View` ns = `mvc`
            )->a( n = `xmlns` v = `sap.m` ).

    DATA(page) = view->ele( `Page`
        )->a( n = `title` v = `abap2UI5 lint: a namespace nobody declared` ).

    page->ele( n = `SimpleForm` ns = `form`
        )->ele( n = `content` ns = `form`
            )->tag( `Input`
                )->a( n = `id`    v = `inpName`
                )->a( n = `value` v = client->_bind( name ) ).

    client->view_display( view->stringify( ) ).

  ENDMETHOD.

ENDCLASS.
