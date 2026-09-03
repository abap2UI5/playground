CLASS zcl_playground DEFINITION PUBLIC CREATE PUBLIC.

  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.

    DATA first_name TYPE string.
    DATA last_name  TYPE string.
    DATA email      TYPE string.
    DATA result     TYPE string.

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

    CASE client->get_event( ).
      WHEN `SUBMIT`.
        " Validation is ABAP, not a frontend formatter: the app is the only
        " place that knows what a valid entry is.
        IF first_name IS INITIAL OR last_name IS INITIAL.
          client->message_box_display( text = `First and last name are required`
                                       type = `error` ).
          RETURN.
        ENDIF.
        IF email NS `@`.
          client->message_box_display( text = `That does not look like an email address`
                                       type = `warning` ).
          RETURN.
        ENDIF.
        result = |Registered { first_name } { last_name } ({ email })|.
        client->message_toast_display( `Saved` ).
    ENDCASE.

  ENDMETHOD.


  METHOD view_display.

    DATA(view) = z2ui5_cl_ui5_view_builder=>factory(
        )->ele( n = `View` ns = `mvc`
            )->a( n = `xmlns`        v = `sap.m`
            )->a( n = `xmlns:mvc`    v = `sap.ui.core.mvc`
            )->a( n = `xmlns:form`   v = `sap.ui.layout.form`
            )->a( n = `displayBlock` v = `true`
            )->a( n = `height`       v = `100%` ).

    DATA(page) = view->ele( `Shell`
        )->ele( `Page`
            )->a( n = `title` v = `Registration` ).

    DATA(cont) = page->ele( n = `SimpleForm` ns = `form`
        )->a( n = `title`       v = `Your details`
        )->a( n = `editable`    v = `true`
        )->a( n = `layout`      v = `ResponsiveGridLayout`
        )->ele( n = `content` ns = `form` ).

    cont->tag( `Label` )->a( n = `text` v = `First name` ).
    cont->tag( `Input`
        )->a( n = `id`    v = `inpFirst`
        )->a( n = `value` v = client->_bind( first_name ) ).

    cont->tag( `Label` )->a( n = `text` v = `Last name` ).
    cont->tag( `Input`
        )->a( n = `id`    v = `inpLast`
        )->a( n = `value` v = client->_bind( last_name ) ).

    cont->tag( `Label` )->a( n = `text` v = `Email` ).
    cont->tag( `Input`
        )->a( n = `id`    v = `inpMail`
        )->a( n = `value` v = client->_bind( email ) ).

    page->tag( `Button`
        )->a( n = `id`    v = `btnSubmit`
        )->a( n = `text`  v = `register`
        )->a( n = `type`  v = `Emphasized`
        )->a( n = `press` v = client->_event( `SUBMIT` ) ).

    page->tag( `Text`
        )->a( n = `id`   v = `txtResult`
        )->a( n = `text` v = client->_bind( result ) ).

    client->view_display( view->stringify( ) ).

  ENDMETHOD.

ENDCLASS.
