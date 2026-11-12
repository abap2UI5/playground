CLASS zcl_dbg_gaps DEFINITION PUBLIC FINAL CREATE PUBLIC.

  PUBLIC SECTION.
    TYPES: BEGIN OF ty_s_opt,
             flag TYPE abap_bool,
             name TYPE string,
           END OF ty_s_opt.
    METHODS run
      IMPORTING iv_in         TYPE i
      RETURNING VALUE(rv_out) TYPE string.
    METHODS take
      IMPORTING iv_text       TYPE string
                is_opt        TYPE ty_s_opt OPTIONAL
      RETURNING VALUE(ro_me)  TYPE REF TO zcl_dbg_gaps.
    DATA mv_text TYPE string.

  PROTECTED SECTION.
  PRIVATE SECTION.
ENDCLASS.


CLASS zcl_dbg_gaps IMPLEMENTATION.

  METHOD run.
    TYPES ty_count TYPE i.
    DATA lv_count TYPE ty_count.

    " a comment on a line of its own
    lv_count = iv_in.
    take( `a`
        " a comment between two links of a chain
        )->take( `b` ).
    take( COND #( WHEN lv_count = 1
                  THEN `one`
                  ELSE `many` ) ).
    take( iv_text = `c`
          is_opt  = VALUE #( flag = abap_true
                             name = `n` ) ).
    rv_out = mv_text.
  ENDMETHOD.

  METHOD take.
    mv_text = mv_text && iv_text.
    ro_me = me.
  ENDMETHOD.
ENDCLASS.
