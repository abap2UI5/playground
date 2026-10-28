REPORT zr2c_linked_report.

PARAMETERS p_name TYPE c LENGTH 20 DEFAULT 'abap2UI5'.

START-OF-SELECTION.
  WRITE: / 'Hello', p_name.
  WRITE: / 'converted in the browser'.
