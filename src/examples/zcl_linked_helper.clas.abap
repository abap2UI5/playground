" The second half of the linkable example: a class the app calls, so a link
" with two ?src= parameters has something to demonstrate.
CLASS zcl_linked_helper DEFINITION PUBLIC CREATE PUBLIC.

  PUBLIC SECTION.
    CLASS-METHODS shout
      IMPORTING
        !val          TYPE string
      RETURNING
        VALUE(result) TYPE string.

  PROTECTED SECTION.
  PRIVATE SECTION.
ENDCLASS.


CLASS zcl_linked_helper IMPLEMENTATION.

  METHOD shout.
    result = |{ to_upper( val ) }!|.
  ENDMETHOD.

ENDCLASS.
