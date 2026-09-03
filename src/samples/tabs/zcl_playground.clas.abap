CLASS zcl_playground DEFINITION PUBLIC CREATE PUBLIC.

  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.

    TYPES:
      BEGIN OF ty_note,
        title TYPE string,
        body  TYPE string,
      END OF ty_note.

    DATA t_note   TYPE STANDARD TABLE OF ty_note WITH EMPTY KEY.
    DATA draft    TYPE string.
    DATA selected TYPE string.

  PROTECTED SECTION.
    DATA client TYPE REF TO z2ui5_if_client.
    METHODS view_display.

ENDCLASS.


CLASS zcl_playground IMPLEMENTATION.

  METHOD z2ui5_if_app~main.

    me->client = client.

    IF client->check_on_init( ).
      t_note = VALUE #( ( title = `First note`  body = `abap2UI5 keeps the state on the server` )
                        ( title = `Second note` body = `and the frontend stays thin` ) ).
      selected = `list`.
      view_display( ).
      RETURN.
    ENDIF.

    IF client->check_on_navigated( ).
      view_display( ).
      RETURN.
    ENDIF.

    CASE client->get_event( ).
      WHEN `ADD`.
        IF draft IS NOT INITIAL.
          INSERT VALUE #( title = |Note { lines( t_note ) + 1 }| body = draft ) INTO TABLE t_note.
          CLEAR draft.
          selected = `list`.
        ENDIF.
      WHEN `TAB`.
        " a client-resolved argument: the frontend fills $key from the event
        selected = client->get_event_arg( 1 ).
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
            )->a( n = `title` v = `Notes` ).

    DATA(bar) = page->ele( `IconTabBar`
        )->a( n = `id`             v = `tabBar`
        )->a( n = `selectedKey`    v = client->_bind( selected )
        )->a( n = `select`         v = client->_event( val = `TAB` t_arg = VALUE #( ( `\${$parameters>/key}` ) ) )
        )->a( n = `expandable`     v = `false` ).

    DATA(items) = bar->ele( `items` ).

    DATA(list_tab) = items->ele( `IconTabFilter`
        )->a( n = `key`   v = `list`
        )->a( n = `text`  v = `Notes`
        )->a( n = `icon`  v = `sap-icon://list`
        )->ele( `content` ).

    DATA(list) = list_tab->ele( `List`
        )->a( n = `id`    v = `lstNotes`
        )->a( n = `items` v = client->_bind( t_note ) ).
    list->ele( `items`
        )->ele( `StandardListItem`
            )->a( n = `title`       v = `{TITLE}`
            )->a( n = `description` v = `{BODY}` ).

    DATA(new_tab) = items->ele( `IconTabFilter`
        )->a( n = `key`  v = `new`
        )->a( n = `text` v = `New`
        )->a( n = `icon` v = `sap-icon://add`
        )->ele( `content` ).

    new_tab->tag( `TextArea`
        )->a( n = `id`     v = `inpDraft`
        )->a( n = `value`  v = client->_bind( draft )
        )->a( n = `rows`   v = `4`
        )->a( n = `width`  v = `100%` ).
    new_tab->tag( `Button`
        )->a( n = `id`    v = `btnAdd`
        )->a( n = `text`  v = `add note`
        )->a( n = `type`  v = `Emphasized`
        )->a( n = `press` v = client->_event( `ADD` ) ).

    client->view_display( view->stringify( ) ).

  ENDMETHOD.

ENDCLASS.
