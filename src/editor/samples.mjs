import { MAIN_FILE } from "./files.mjs";

// The catalogue the sample menu offers.
//
// Ordered by what each one adds: the first is the smallest app that does
// something, the last uses a value help, a popup and a table together. Every
// sample is one class called ZCL_PLAYGROUND, because that is what the playground
// compiles and starts, and every one is checked by tests/samples.spec.js - a
// sample that no longer runs is a broken promise, not a stale file.

const HELLO = `CLASS zcl_playground DEFINITION PUBLIC CREATE PUBLIC.

  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.

    DATA name     TYPE string.
    DATA greeting TYPE string.

  PROTECTED SECTION.
    DATA client TYPE REF TO z2ui5_if_client.
    METHODS view_display.

ENDCLASS.


CLASS zcl_playground IMPLEMENTATION.

  METHOD z2ui5_if_app~main.

    me->client = client.

    IF client->check_on_init( ) = abap_true.
      name = \`World\`.
      view_display( ).
      RETURN.
    ENDIF.

    IF client->check_on_navigated( ) = abap_true.
      view_display( ).
      RETURN.
    ENDIF.

    CASE client->get_event( ).
      WHEN \`GREET\`.
        greeting = |Hello { name }!|.
        client->message_toast_display( greeting ).
      WHEN \`CLEAR\`.
        CLEAR: name, greeting.
    ENDCASE.

  ENDMETHOD.


  METHOD view_display.

    DATA(view) = z2ui5_cl_ui5_view_builder=>factory(
        )->ele( n = \`View\` ns = \`mvc\`
            )->a( n = \`xmlns\`        v = \`sap.m\`
            )->a( n = \`xmlns:mvc\`    v = \`sap.ui.core.mvc\`
            )->a( n = \`displayBlock\` v = \`true\`
            )->a( n = \`height\`       v = \`100%\` ).

    DATA(page) = view->ele( \`Shell\`
        )->ele( \`Page\`
            )->a( n = \`title\` v = \`Hello abap2UI5\` ).

    page->tag( \`Input\`
        )->a( n = \`id\`          v = \`inpName\`
        )->a( n = \`value\`       v = client->_bind( name )
        )->a( n = \`placeholder\` v = \`your name\` ).

    page->tag( \`Button\`
        )->a( n = \`id\`    v = \`btnGreet\`
        )->a( n = \`text\`  v = \`say hello\`
        )->a( n = \`type\`  v = \`Emphasized\`
        )->a( n = \`press\` v = client->_event( \`GREET\` ) ).

    page->tag( \`Button\`
        )->a( n = \`id\`    v = \`btnClear\`
        )->a( n = \`text\`  v = \`clear\`
        )->a( n = \`press\` v = client->_event( \`CLEAR\` ) ).

    page->tag( \`Text\`
        )->a( n = \`id\`   v = \`txtGreeting\`
        )->a( n = \`text\` v = client->_bind( greeting ) ).

    client->view_display( view->stringify( ) ).

  ENDMETHOD.

ENDCLASS.
`;

const TABLE = `CLASS zcl_playground DEFINITION PUBLIC CREATE PUBLIC.

  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.

    TYPES:
      BEGIN OF ty_flight,
        carrier  TYPE string,
        connid   TYPE string,
        city_to  TYPE string,
        seats    TYPE i,
        selected TYPE abap_bool,
      END OF ty_flight.

    DATA t_flight  TYPE STANDARD TABLE OF ty_flight WITH EMPTY KEY.
    DATA summary   TYPE string.

  PROTECTED SECTION.
    DATA client TYPE REF TO z2ui5_if_client.
    METHODS view_display.

ENDCLASS.


CLASS zcl_playground IMPLEMENTATION.

  METHOD z2ui5_if_app~main.

    me->client = client.

    IF client->check_on_init( ) = abap_true.
      t_flight = VALUE #(
          ( carrier = \`LH\` connid = \`0400\` city_to = \`New York\`  seats = 385 )
          ( carrier = \`LH\` connid = \`0402\` city_to = \`San Francisco\` seats = 385 )
          ( carrier = \`AA\` connid = \`0017\` city_to = \`San Francisco\` seats = 280 )
          ( carrier = \`UA\` connid = \`0941\` city_to = \`Frankfurt\`  seats = 300 ) ).
      view_display( ).
      RETURN.
    ENDIF.

    IF client->check_on_navigated( ) = abap_true.
      view_display( ).
      RETURN.
    ENDIF.

    CASE client->get_event( ).
      WHEN \`COUNT\`.
        " the selected flag arrives from the frontend on the rows the user ticked
        DATA(lt_picked) = t_flight.
        DELETE lt_picked WHERE selected = abap_false.
        summary = |{ lines( lt_picked ) } of { lines( t_flight ) } selected, | &&
                  |{ REDUCE i( INIT s = 0 FOR row IN lt_picked NEXT s = s + row-seats ) } seats|.
    ENDCASE.

  ENDMETHOD.


  METHOD view_display.

    DATA(view) = z2ui5_cl_ui5_view_builder=>factory(
        )->ele( n = \`View\` ns = \`mvc\`
            )->a( n = \`xmlns\`        v = \`sap.m\`
            )->a( n = \`xmlns:mvc\`    v = \`sap.ui.core.mvc\`
            )->a( n = \`displayBlock\` v = \`true\`
            )->a( n = \`height\`       v = \`100%\` ).

    DATA(page) = view->ele( \`Shell\`
        )->ele( \`Page\`
            )->a( n = \`title\` v = \`Flights\` ).

    DATA(tab) = page->ele( \`Table\`
        )->a( n = \`id\`    v = \`tabFlights\`
        )->a( n = \`items\` v = client->_bind( t_flight )
        )->a( n = \`mode\`  v = \`MultiSelect\` ).

    DATA(cols) = tab->ele( \`columns\` ).
    cols->ele( \`Column\` )->ele( \`Text\` )->a( n = \`text\` v = \`Carrier\` ).
    cols->ele( \`Column\` )->ele( \`Text\` )->a( n = \`text\` v = \`Connection\` ).
    cols->ele( \`Column\` )->ele( \`Text\` )->a( n = \`text\` v = \`Destination\` ).
    cols->ele( \`Column\` )->ele( \`Text\` )->a( n = \`text\` v = \`Seats\` ).

    " a row template binds by column name in braces - never as a path literal
    DATA(row) = tab->ele( \`items\`
        )->ele( \`ColumnListItem\`
            )->a( n = \`selected\` v = \`{SELECTED}\` ).
    row->ele( \`cells\`
        )->tag( \`Text\` )->a( n = \`text\` v = \`{CARRIER}\`
        )->tag( \`Text\` )->a( n = \`text\` v = \`{CONNID}\`
        )->tag( \`Text\` )->a( n = \`text\` v = \`{CITY_TO}\`
        )->tag( \`Text\` )->a( n = \`text\` v = \`{SEATS}\` ).

    page->tag( \`Button\`
        )->a( n = \`id\`    v = \`btnCount\`
        )->a( n = \`text\`  v = \`count selection\`
        )->a( n = \`type\`  v = \`Emphasized\`
        )->a( n = \`press\` v = client->_event( \`COUNT\` ) ).

    page->tag( \`Text\`
        )->a( n = \`id\`   v = \`txtSummary\`
        )->a( n = \`text\` v = client->_bind( summary ) ).

    client->view_display( view->stringify( ) ).

  ENDMETHOD.

ENDCLASS.
`;

const FORM = `CLASS zcl_playground DEFINITION PUBLIC CREATE PUBLIC.

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

    IF client->check_on_init( ) = abap_true OR client->check_on_navigated( ) = abap_true.
      view_display( ).
      RETURN.
    ENDIF.

    CASE client->get_event( ).
      WHEN \`SUBMIT\`.
        " Validation is ABAP, not a frontend formatter: the app is the only
        " place that knows what a valid entry is.
        IF first_name IS INITIAL OR last_name IS INITIAL.
          client->message_box_display( text = \`First and last name are required\`
                                       type = \`error\` ).
          RETURN.
        ENDIF.
        IF email NS \`@\`.
          client->message_box_display( text = \`That does not look like an email address\`
                                       type = \`warning\` ).
          RETURN.
        ENDIF.
        result = |Registered { first_name } { last_name } ({ email })|.
        client->message_toast_display( \`Saved\` ).
    ENDCASE.

  ENDMETHOD.


  METHOD view_display.

    DATA(view) = z2ui5_cl_ui5_view_builder=>factory(
        )->ele( n = \`View\` ns = \`mvc\`
            )->a( n = \`xmlns\`        v = \`sap.m\`
            )->a( n = \`xmlns:mvc\`    v = \`sap.ui.core.mvc\`
            )->a( n = \`xmlns:form\`   v = \`sap.ui.layout.form\`
            )->a( n = \`displayBlock\` v = \`true\`
            )->a( n = \`height\`       v = \`100%\` ).

    DATA(page) = view->ele( \`Shell\`
        )->ele( \`Page\`
            )->a( n = \`title\` v = \`Registration\` ).

    DATA(cont) = page->ele( n = \`SimpleForm\` ns = \`form\`
        )->a( n = \`title\`       v = \`Your details\`
        )->a( n = \`editable\`    v = \`true\`
        )->a( n = \`layout\`      v = \`ResponsiveGridLayout\`
        )->ele( n = \`content\` ns = \`form\` ).

    cont->tag( \`Label\` )->a( n = \`text\` v = \`First name\` ).
    cont->tag( \`Input\`
        )->a( n = \`id\`    v = \`inpFirst\`
        )->a( n = \`value\` v = client->_bind( first_name ) ).

    cont->tag( \`Label\` )->a( n = \`text\` v = \`Last name\` ).
    cont->tag( \`Input\`
        )->a( n = \`id\`    v = \`inpLast\`
        )->a( n = \`value\` v = client->_bind( last_name ) ).

    cont->tag( \`Label\` )->a( n = \`text\` v = \`Email\` ).
    cont->tag( \`Input\`
        )->a( n = \`id\`    v = \`inpMail\`
        )->a( n = \`value\` v = client->_bind( email ) ).

    page->tag( \`Button\`
        )->a( n = \`id\`    v = \`btnSubmit\`
        )->a( n = \`text\`  v = \`register\`
        )->a( n = \`type\`  v = \`Emphasized\`
        )->a( n = \`press\` v = client->_event( \`SUBMIT\` ) ).

    page->tag( \`Text\`
        )->a( n = \`id\`   v = \`txtResult\`
        )->a( n = \`text\` v = client->_bind( result ) ).

    client->view_display( view->stringify( ) ).

  ENDMETHOD.

ENDCLASS.
`;

const POPUP = `CLASS zcl_playground DEFINITION PUBLIC CREATE PUBLIC.

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

    IF client->check_on_init( ) = abap_true.
      status = \`nothing deleted yet\`.
      view_display( ).
      RETURN.
    ENDIF.

    " A popup is an app of its own: it is called with nav_app_call and hands
    " control back, which arrives here as a navigated roundtrip - not as an
    " event. That is why check_on_navigated( ) is part of every dispatcher.
    IF client->check_on_navigated( ) = abap_true.
      DATA(popup) = CAST z2ui5_cl_pop_to_confirm( client->get_app( client->get( )-s_draft-id_prev_app ) ).
      IF popup IS BOUND.
        status = COND #( WHEN popup->result( ) = abap_true
                         THEN \`deleted\`
                         ELSE \`kept\` ).
      ENDIF.
      view_display( ).
      RETURN.
    ENDIF.

    CASE client->get_event( ).
      WHEN \`DELETE\`.
        client->nav_app_call( z2ui5_cl_pop_to_confirm=>factory(
            i_question_text = \`Delete this record?\`
            i_title         = \`Please confirm\` ) ).
    ENDCASE.

  ENDMETHOD.


  METHOD view_display.

    DATA(view) = z2ui5_cl_ui5_view_builder=>factory(
        )->ele( n = \`View\` ns = \`mvc\`
            )->a( n = \`xmlns\`        v = \`sap.m\`
            )->a( n = \`xmlns:mvc\`    v = \`sap.ui.core.mvc\`
            )->a( n = \`displayBlock\` v = \`true\`
            )->a( n = \`height\`       v = \`100%\` ).

    DATA(page) = view->ele( \`Shell\`
        )->ele( \`Page\`
            )->a( n = \`title\` v = \`Confirm before deleting\` ).

    page->tag( \`Button\`
        )->a( n = \`id\`    v = \`btnDelete\`
        )->a( n = \`text\`  v = \`delete\`
        )->a( n = \`type\`  v = \`Reject\`
        )->a( n = \`press\` v = client->_event( \`DELETE\` ) ).

    page->tag( \`Text\`
        )->a( n = \`id\`   v = \`txtStatus\`
        )->a( n = \`text\` v = client->_bind( status ) ).

    client->view_display( view->stringify( ) ).

  ENDMETHOD.

ENDCLASS.
`;

const TABS = `CLASS zcl_playground DEFINITION PUBLIC CREATE PUBLIC.

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

    IF client->check_on_init( ) = abap_true.
      t_note = VALUE #( ( title = \`First note\`  body = \`abap2UI5 keeps the state on the server\` )
                        ( title = \`Second note\` body = \`and the frontend stays thin\` ) ).
      selected = \`list\`.
      view_display( ).
      RETURN.
    ENDIF.

    IF client->check_on_navigated( ) = abap_true.
      view_display( ).
      RETURN.
    ENDIF.

    CASE client->get_event( ).
      WHEN \`ADD\`.
        IF draft IS NOT INITIAL.
          INSERT VALUE #( title = |Note { lines( t_note ) + 1 }| body = draft ) INTO TABLE t_note.
          CLEAR draft.
          selected = \`list\`.
        ENDIF.
      WHEN \`TAB\`.
        " a client-resolved argument: the frontend fills $key from the event
        selected = client->get_event_arg( 1 ).
    ENDCASE.

  ENDMETHOD.


  METHOD view_display.

    DATA(view) = z2ui5_cl_ui5_view_builder=>factory(
        )->ele( n = \`View\` ns = \`mvc\`
            )->a( n = \`xmlns\`        v = \`sap.m\`
            )->a( n = \`xmlns:mvc\`    v = \`sap.ui.core.mvc\`
            )->a( n = \`displayBlock\` v = \`true\`
            )->a( n = \`height\`       v = \`100%\` ).

    DATA(page) = view->ele( \`Shell\`
        )->ele( \`Page\`
            )->a( n = \`title\` v = \`Notes\` ).

    DATA(bar) = page->ele( \`IconTabBar\`
        )->a( n = \`id\`             v = \`tabBar\`
        )->a( n = \`selectedKey\`    v = client->_bind( selected )
        )->a( n = \`select\`         v = client->_event( val = \`TAB\` t_arg = VALUE #( ( \`\\\${$parameters>/key}\` ) ) )
        )->a( n = \`expandable\`     v = \`false\` ).

    DATA(items) = bar->ele( \`items\` ).

    DATA(list_tab) = items->ele( \`IconTabFilter\`
        )->a( n = \`key\`   v = \`list\`
        )->a( n = \`text\`  v = \`Notes\`
        )->a( n = \`icon\`  v = \`sap-icon://list\`
        )->ele( \`content\` ).

    DATA(list) = list_tab->ele( \`List\`
        )->a( n = \`id\`    v = \`lstNotes\`
        )->a( n = \`items\` v = client->_bind( t_note ) ).
    list->ele( \`items\`
        )->ele( \`StandardListItem\`
            )->a( n = \`title\`       v = \`{TITLE}\`
            )->a( n = \`description\` v = \`{BODY}\` ).

    DATA(new_tab) = items->ele( \`IconTabFilter\`
        )->a( n = \`key\`  v = \`new\`
        )->a( n = \`text\` v = \`New\`
        )->a( n = \`icon\` v = \`sap-icon://add\`
        )->ele( \`content\` ).

    new_tab->tag( \`TextArea\`
        )->a( n = \`id\`     v = \`inpDraft\`
        )->a( n = \`value\`  v = client->_bind( draft )
        )->a( n = \`rows\`   v = \`4\`
        )->a( n = \`width\`  v = \`100%\` ).
    new_tab->tag( \`Button\`
        )->a( n = \`id\`    v = \`btnAdd\`
        )->a( n = \`text\`  v = \`add note\`
        )->a( n = \`type\`  v = \`Emphasized\`
        )->a( n = \`press\` v = client->_event( \`ADD\` ) ).

    client->view_display( view->stringify( ) ).

  ENDMETHOD.

ENDCLASS.
`;

const COUNTER = `CLASS zcl_playground DEFINITION PUBLIC CREATE PUBLIC.

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

    IF client->check_on_init( ) = abap_true OR client->check_on_navigated( ) = abap_true.
      view_display( ).
      RETURN.
    ENDIF.

    " Every press is a roundtrip: the state lives in this instance, is stored as
    " a draft between roundtrips, and comes back for the next one. Nothing about
    " it is in the browser.
    CASE client->get_event( ).
      WHEN \`UP\`.
        count = count + 1.
      WHEN \`DOWN\`.
        count = count - 1.
      WHEN \`RESET\`.
        CLEAR count.
    ENDCASE.

    history = |{ history }{ COND #( WHEN history IS NOT INITIAL THEN \` -> \` ) }{ count }|.

  ENDMETHOD.


  METHOD view_display.

    DATA(view) = z2ui5_cl_ui5_view_builder=>factory(
        )->ele( n = \`View\` ns = \`mvc\`
            )->a( n = \`xmlns\`        v = \`sap.m\`
            )->a( n = \`xmlns:mvc\`    v = \`sap.ui.core.mvc\`
            )->a( n = \`displayBlock\` v = \`true\`
            )->a( n = \`height\`       v = \`100%\` ).

    DATA(page) = view->ele( \`Shell\`
        )->ele( \`Page\`
            )->a( n = \`title\` v = \`Counter\` ).

    page->tag( \`Title\`
        )->a( n = \`id\`    v = \`txtCount\`
        )->a( n = \`text\`  v = client->_bind( count )
        )->a( n = \`level\` v = \`H1\` ).

    page->tag( \`Button\`
        )->a( n = \`id\`    v = \`btnUp\`
        )->a( n = \`text\`  v = \`+\`
        )->a( n = \`type\`  v = \`Emphasized\`
        )->a( n = \`press\` v = client->_event( \`UP\` ) ).

    page->tag( \`Button\`
        )->a( n = \`id\`    v = \`btnDown\`
        )->a( n = \`text\`  v = \`-\`
        )->a( n = \`press\` v = client->_event( \`DOWN\` ) ).

    page->tag( \`Button\`
        )->a( n = \`id\`    v = \`btnReset\`
        )->a( n = \`text\`  v = \`reset\`
        )->a( n = \`press\` v = client->_event( \`RESET\` ) ).

    page->tag( \`Text\`
        )->a( n = \`id\`   v = \`txtHistory\`
        )->a( n = \`text\` v = client->_bind( history ) ).

    client->view_display( view->stringify( ) ).

  ENDMETHOD.

ENDCLASS.
`;

const NAV_HUB = `CLASS zcl_playground DEFINITION PUBLIC CREATE PUBLIC.

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

    IF client->check_on_init( ) = abap_true.
      view_display( ).
      RETURN.
    ENDIF.

    " The called app hands control back, and that arrives here as a navigated
    " roundtrip - not as an event. Reading its result means reading the app
    " instance the framework kept for us.
    IF client->check_on_navigated( ) = abap_true.
      DATA(detail) = CAST zcl_detail( client->get_app( client->get( )-s_draft-id_prev_app ) ).
      IF detail IS BOUND.
        picked = detail->chosen.
      ENDIF.
      view_display( ).
      RETURN.
    ENDIF.

    CASE client->get_event( ).
      WHEN \`PICK\`.
        client->nav_app_call( NEW zcl_detail( ) ).
    ENDCASE.

  ENDMETHOD.


  METHOD view_display.

    DATA(view) = z2ui5_cl_ui5_view_builder=>factory(
        )->ele( n = \`View\` ns = \`mvc\`
            )->a( n = \`xmlns\`        v = \`sap.m\`
            )->a( n = \`xmlns:mvc\`    v = \`sap.ui.core.mvc\`
            )->a( n = \`displayBlock\` v = \`true\`
            )->a( n = \`height\`       v = \`100%\` ).

    DATA(page) = view->ele( \`Shell\`
        )->ele( \`Page\`
            )->a( n = \`title\` v = \`Hub\` ).

    page->tag( \`Button\`
        )->a( n = \`id\`    v = \`btnPick\`
        )->a( n = \`text\`  v = \`choose a colour\`
        )->a( n = \`type\`  v = \`Emphasized\`
        )->a( n = \`press\` v = client->_event( \`PICK\` ) ).

    page->tag( \`Text\`
        )->a( n = \`id\`   v = \`txtPicked\`
        )->a( n = \`text\` v = client->_bind( picked ) ).

    client->view_display( view->stringify( ) ).

  ENDMETHOD.

ENDCLASS.
`;

const NAV_DETAIL = `CLASS zcl_detail DEFINITION PUBLIC CREATE PUBLIC.

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

    IF client->check_on_init( ) = abap_true.
      view_display( ).
      RETURN.
    ENDIF.

    CASE client->get_event( ).
      WHEN \`RED\` OR \`GREEN\` OR \`BLUE\`.
        chosen = client->get_event( ).
        client->nav_app_leave( ).
      WHEN \`BACK\`.
        client->nav_app_leave( ).
    ENDCASE.

  ENDMETHOD.


  METHOD view_display.

    DATA(view) = z2ui5_cl_ui5_view_builder=>factory(
        )->ele( n = \`View\` ns = \`mvc\`
            )->a( n = \`xmlns\`        v = \`sap.m\`
            )->a( n = \`xmlns:mvc\`    v = \`sap.ui.core.mvc\`
            )->a( n = \`displayBlock\` v = \`true\`
            )->a( n = \`height\`       v = \`100%\` ).

    DATA(page) = view->ele( \`Shell\`
        )->ele( \`Page\`
            )->a( n = \`title\`      v = \`Pick one\`
            )->a( n = \`showNavButton\` v = \`true\`
            )->a( n = \`navButtonPress\` v = client->_event( \`BACK\` ) ).

    page->tag( \`Button\`
        )->a( n = \`id\`    v = \`btnRed\`
        )->a( n = \`text\`  v = \`RED\`
        )->a( n = \`press\` v = client->_event( \`RED\` ) ).

    page->tag( \`Button\`
        )->a( n = \`id\`    v = \`btnGreen\`
        )->a( n = \`text\`  v = \`GREEN\`
        )->a( n = \`press\` v = client->_event( \`GREEN\` ) ).

    page->tag( \`Button\`
        )->a( n = \`id\`    v = \`btnBlue\`
        )->a( n = \`text\`  v = \`BLUE\`
        )->a( n = \`press\` v = client->_event( \`BLUE\` ) ).

    client->view_display( view->stringify( ) ).

  ENDMETHOD.

ENDCLASS.
`;

// Two samples that are deliberately WRONG, one per checker, so the Fix button
// has something to do the moment somebody wants to see what it does. Both are
// small: the point is the repair, not the app.
//
// This one is abaplint's. A method is declared and never implemented, which is
// an error, so Run is blocked - there is nothing to start. The fix writes the
// empty implementation and the app starts. `on_event` is the method on purpose:
// the first render never calls it, so the empty body the fix leaves behind is
// the right body, and the app that comes up is a working one rather than a
// blank page.
const FIX_ABAPLINT = `CLASS zcl_playground DEFINITION PUBLIC CREATE PUBLIC.

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

    IF client->check_on_event( ) = abap_true.
      on_event( ).
      RETURN.
    ENDIF.

    IF client->check_on_init( ) = abap_false.
      RETURN.
    ENDIF.

    DATA(view) = z2ui5_cl_ui5_view_builder=>factory(
        )->ele( n = \`View\` ns = \`mvc\`
            )->a( n = \`xmlns\`     v = \`sap.m\`
            )->a( n = \`xmlns:mvc\` v = \`sap.ui.core.mvc\` ).

    view->ele( \`Page\`
        )->a( n = \`title\` v = \`abaplint: a method with no implementation\`
        )->tag( \`Input\`
            )->a( n = \`id\`    v = \`inpName\`
            )->a( n = \`value\` v = client->_bind( name ) ).

    client->view_display( view->stringify( ) ).

  ENDMETHOD.

ENDCLASS.`;

// And this one is the abap2UI5 linter's. The view uses two namespace prefixes
// it never declares, which is valid ABAP - abaplint has nothing to say - so Run
// goes ahead and UI5 then looks for a control called SimpleForm in sap.m, does
// not find it, and terminates the app. A loading failure, not a rendering one.
const FIX_ABAP2UI5 = `CLASS zcl_playground DEFINITION PUBLIC CREATE PUBLIC.

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
        )->ele( n = \`View\` ns = \`mvc\`
            )->a( n = \`xmlns\` v = \`sap.m\` ).

    DATA(page) = view->ele( \`Page\`
        )->a( n = \`title\` v = \`abap2UI5 lint: a namespace nobody declared\` ).

    page->ele( n = \`SimpleForm\` ns = \`form\`
        )->ele( n = \`content\` ns = \`form\`
            )->tag( \`Input\`
                )->a( n = \`id\`    v = \`inpName\`
                )->a( n = \`value\` v = client->_bind( name ) ).

    client->view_display( view->stringify( ) ).

  ENDMETHOD.

ENDCLASS.`;

// One file each, unless the sample is about more than one object.
const one = (source) => [{ name: MAIN_FILE, source }];

export const SAMPLES = [
  { id: "hello", title: "Hello world", note: "input, button, binding", files: one(HELLO) },
  { id: "counter", title: "Counter", note: "state across roundtrips", files: one(COUNTER) },
  { id: "table", title: "Table with selection", note: "internal table, row template", files: one(TABLE) },
  { id: "form", title: "Form and validation", note: "message box, layout library", files: one(FORM) },
  { id: "tabs", title: "Tabs and a list", note: "event arguments, growing table", files: one(TABS) },
  { id: "popup", title: "Confirmation popup", note: "nav_app_call, on-navigated", files: one(POPUP) },
  {
    id: "navigation",
    title: "Two apps",
    note: "nav_app_call between your own classes",
    files: [
      { name: MAIN_FILE, source: NAV_HUB },
      { name: "zcl_detail.clas.abap", source: NAV_DETAIL },
    ],
  },
  // `startsBroken` says this sample does not come up running, which is its
  // point. The tests read it and drive the repair instead of the app - so the
  // promise that every sample in the menu works still holds, it just means
  // something different for these two.
  {
    id: "fix-abaplint",
    title: "Quick fix: abaplint",
    note: "a method with no implementation - Run is blocked until it is fixed",
    files: one(FIX_ABAPLINT),
    startsBroken: "blocked",
  },
  {
    id: "fix-abap2ui5",
    title: "Quick fix: abap2UI5 lint",
    note: "an undeclared namespace - it runs, and the control never loads",
    files: one(FIX_ABAP2UI5),
    startsBroken: "runs",
  },
];

export const DEFAULT_SAMPLE = SAMPLES[0];
export const DEFAULT_FILES = DEFAULT_SAMPLE.files;

export const sampleById = (id) => SAMPLES.find((s) => s.id === id);
