CLASS zcl_dbg_calls DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    DATA mo_other TYPE REF TO zcl_dbg_calls.
    METHODS go.
    METHODS take IMPORTING iv TYPE i OPTIONAL.
    CLASS-METHODS stat IMPORTING iv TYPE i OPTIONAL.
ENDCLASS.

CLASS zcl_dbg_calls IMPLEMENTATION.
  METHOD go.
    take( 1 ).
    me->take( iv = 2 ).
    mo_other = NEW #( ).
    mo_other->take(
      iv = 3 ).
    zcl_dbg_calls=>stat( ).
    CALL METHOD take EXPORTING iv = 4.
    DATA(lo) = NEW zcl_dbg_calls( ).
    lo->take( ).
    CLEAR lo.
    FREE lo.
    RETURN.
  ENDMETHOD.

  METHOD take.
  ENDMETHOD.

  METHOD stat.
  ENDMETHOD.
ENDCLASS.
