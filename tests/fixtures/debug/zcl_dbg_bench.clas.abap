CLASS zcl_dbg_bench DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS loop IMPORTING iv_times TYPE i RETURNING VALUE(rv) TYPE i.
    METHODS calls IMPORTING iv_times TYPE i RETURNING VALUE(rv) TYPE i.
  PRIVATE SECTION.
    METHODS one IMPORTING iv TYPE i RETURNING VALUE(rv) TYPE i.
ENDCLASS.

CLASS zcl_dbg_bench IMPLEMENTATION.
  METHOD loop.
    DATA lt TYPE STANDARD TABLE OF i WITH EMPTY KEY.
    DO iv_times TIMES.
      rv = rv + sy-index.
      IF rv > 1000000.
        rv = 0.
      ENDIF.
      APPEND rv TO lt.
    ENDDO.
  ENDMETHOD.

  METHOD calls.
    DO iv_times TIMES.
      rv = rv + one( sy-index ).
    ENDDO.
  ENDMETHOD.

  METHOD one.
    rv = iv MOD 7.
  ENDMETHOD.
ENDCLASS.
