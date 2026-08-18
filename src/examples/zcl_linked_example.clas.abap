" Served as a static file so a link like
"   ?src=examples/zcl_linked_example.clas.abap
" can be followed, and so there is a worked example of what a linkable ABAP
" file looks like: one global class, named after its file.
CLASS zcl_linked_example DEFINITION PUBLIC CREATE PUBLIC.

  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.

    DATA note TYPE string.

  PROTECTED SECTION.
    DATA client TYPE REF TO z2ui5_if_client.

ENDCLASS.


CLASS zcl_linked_example IMPLEMENTATION.

  METHOD z2ui5_if_app~main.

    me->client = client.

    IF client->check_on_init( ) IS INITIAL AND client->check_on_navigated( ) IS INITIAL.
      RETURN.
    ENDIF.

    note = `This class was fetched from a URL, not typed here.`.

    DATA(view) = z2ui5_cl_ui5_view_builder=>factory(
        )->ele( n = `View` ns = `mvc`
            )->a( n = `xmlns`        v = `sap.m`
            )->a( n = `xmlns:mvc`    v = `sap.ui.core.mvc`
            )->a( n = `displayBlock` v = `true`
            )->a( n = `height`       v = `100%` ).

    DATA(page) = view->ele( `Shell`
        )->ele( `Page`
            )->a( n = `title` v = `Linked example` ).

    page->tag( `Text`
        )->a( n = `id`   v = `txtNote`
        )->a( n = `text` v = client->_bind( note ) ).

    client->view_display( view->stringify( ) ).

  ENDMETHOD.

ENDCLASS.
