"! The tests of %CLASS%. A file named <class>.clas.testclasses.abap
"! beside the class holds its local test classes, exactly as abapGit keeps
"! them - and Run runs them here, before the app, in this browser.
CLASS ltcl_with_tax DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.

  PRIVATE SECTION.
    DATA cut TYPE REF TO %CLASS%.

    METHODS setup.
    METHODS nineteen_percent FOR TESTING.
    METHODS rounds_to_whole_units FOR TESTING.
    METHODS zero_percent_changes_nothing FOR TESTING.

ENDCLASS.


CLASS ltcl_with_tax IMPLEMENTATION.

  METHOD setup.

    cut = NEW #( ).

  ENDMETHOD.


  METHOD nineteen_percent.

    cl_abap_unit_assert=>assert_equals(
      act = cut->with_tax( net = 100 percent = 19 )
      exp = 119 ).

  ENDMETHOD.


  METHOD rounds_to_whole_units.

    " 7% of 10 is 0.7, which rounds up to a unit.
    cl_abap_unit_assert=>assert_equals(
      act = cut->with_tax( net = 10 percent = 7 )
      exp = 11 ).

  ENDMETHOD.


  METHOD zero_percent_changes_nothing.

    cl_abap_unit_assert=>assert_equals(
      act = cut->with_tax( net = 42 percent = 0 )
      exp = 42 ).

  ENDMETHOD.

ENDCLASS.
