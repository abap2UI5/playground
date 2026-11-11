CLASS zcl_dbg_shapes DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_row,
             id   TYPE i,
             name TYPE string,
           END OF ty_row.
    TYPES ty_rows TYPE STANDARD TABLE OF ty_row WITH EMPTY KEY.
    DATA mv_count TYPE i.
    DATA mt_rows TYPE ty_rows.
    CLASS-DATA gv_calls TYPE i.
    CLASS-METHODS class_constructor.
    CLASS-METHODS twice IMPORTING iv TYPE i RETURNING VALUE(rv) TYPE i.
    METHODS constructor.
    METHODS run IMPORTING iv_in TYPE i RETURNING VALUE(rv_out) TYPE i.
    METHODS branches IMPORTING iv TYPE i EXPORTING ev TYPE string CHANGING cv TYPE i.
    METHODS nothing.
  PRIVATE SECTION.
    METHODS helper IMPORTING iv TYPE i RETURNING VALUE(rv) TYPE i.
ENDCLASS.

CLASS zcl_dbg_shapes IMPLEMENTATION.
  METHOD class_constructor.
    gv_calls = 0.
  ENDMETHOD.

  METHOD twice.
    gv_calls = gv_calls + 1.
    rv = iv * 2.
  ENDMETHOD.

  METHOD constructor.
    mv_count = 1.
  ENDMETHOD.

  METHOD run.
    DATA lt_tab TYPE STANDARD TABLE OF i WITH EMPTY KEY.
    DATA: lv_sum TYPE i,
          lv_text TYPE string.
    FIELD-SYMBOLS <lv> TYPE i.
    DO 3 TIMES.
      APPEND sy-index TO lt_tab.
    ENDDO.
    LOOP AT lt_tab ASSIGNING <lv>.
      lv_sum = lv_sum + helper( <lv> ).
    ENDLOOP.
    DATA(lv_inline) = lv_sum * 2. lv_text = |sum { lv_sum }|.
    WHILE lv_inline > 100.
      lv_inline = lv_inline - 100.
    ENDWHILE.
    IF lv_inline > 5.
      BREAK-POINT.
      rv_out = lv_inline.
    ELSEIF lv_inline = 3.
      rv_out = 3.
    ELSE.
      rv_out = 0.
    ENDIF.
    CASE rv_out.
      WHEN 0.
        rv_out = 1.
      WHEN OTHERS.
        rv_out = rv_out + 1.
    ENDCASE.
    TRY.
        rv_out = rv_out / 0.
      CATCH cx_sy_zerodivide INTO DATA(lx).
        mv_count = 2.
      CLEANUP.
        mv_count = 3.
    ENDTRY.
    APPEND VALUE #( id = 1 name = `one` ) TO mt_rows.
    WRITE: / lv_text, / lv_sum.
    IF iv_in < 0.
      RAISE EXCEPTION TYPE cx_sy_zerodivide.
    ENDIF.
    rv_out = rv_out + twice( 1 ).
  ENDMETHOD.

  METHOD branches.
    cv = cv + iv.
    ev = |{ cv }|.
  ENDMETHOD.

  METHOD nothing.
  ENDMETHOD.

  METHOD helper.
    rv = iv * 2.
  ENDMETHOD.
ENDCLASS.
