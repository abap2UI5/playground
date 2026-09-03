CLASS zcl_playground DEFINITION PUBLIC CREATE PUBLIC.

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

    IF client->check_on_init( ).
      t_flight = VALUE #(
          ( carrier = `LH` connid = `0400` city_to = `New York`  seats = 385 )
          ( carrier = `LH` connid = `0402` city_to = `San Francisco` seats = 385 )
          ( carrier = `AA` connid = `0017` city_to = `San Francisco` seats = 280 )
          ( carrier = `UA` connid = `0941` city_to = `Frankfurt`  seats = 300 ) ).
      view_display( ).
      RETURN.
    ENDIF.

    IF client->check_on_navigated( ).
      view_display( ).
      RETURN.
    ENDIF.

    CASE client->get_event( ).
      WHEN `COUNT`.
        " the selected flag arrives from the frontend on the rows the user ticked
        DATA(lt_picked) = t_flight.
        DELETE lt_picked WHERE selected = abap_false.
        summary = |{ lines( lt_picked ) } of { lines( t_flight ) } selected, | &&
                  |{ REDUCE i( INIT s = 0 FOR row IN lt_picked NEXT s = s + row-seats ) } seats|.
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
            )->a( n = `title` v = `Flights` ).

    DATA(tab) = page->ele( `Table`
        )->a( n = `id`    v = `tabFlights`
        )->a( n = `items` v = client->_bind( t_flight )
        )->a( n = `mode`  v = `MultiSelect` ).

    DATA(cols) = tab->ele( `columns` ).
    cols->ele( `Column` )->ele( `Text` )->a( n = `text` v = `Carrier` ).
    cols->ele( `Column` )->ele( `Text` )->a( n = `text` v = `Connection` ).
    cols->ele( `Column` )->ele( `Text` )->a( n = `text` v = `Destination` ).
    cols->ele( `Column` )->ele( `Text` )->a( n = `text` v = `Seats` ).

    " a row template binds by column name in braces - never as a path literal
    DATA(row) = tab->ele( `items`
        )->ele( `ColumnListItem`
            )->a( n = `selected` v = `{SELECTED}` ).
    row->ele( `cells`
        )->tag( `Text` )->a( n = `text` v = `{CARRIER}`
        )->tag( `Text` )->a( n = `text` v = `{CONNID}`
        )->tag( `Text` )->a( n = `text` v = `{CITY_TO}`
        )->tag( `Text` )->a( n = `text` v = `{SEATS}` ).

    page->tag( `Button`
        )->a( n = `id`    v = `btnCount`
        )->a( n = `text`  v = `count selection`
        )->a( n = `type`  v = `Emphasized`
        )->a( n = `press` v = client->_event( `COUNT` ) ).

    page->tag( `Text`
        )->a( n = `id`   v = `txtSummary`
        )->a( n = `text` v = client->_bind( summary ) ).

    client->view_display( view->stringify( ) ).

  ENDMETHOD.

ENDCLASS.
