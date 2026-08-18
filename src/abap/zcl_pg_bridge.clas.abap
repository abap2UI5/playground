CLASS zcl_pg_bridge DEFINITION PUBLIC FINAL CREATE PUBLIC.

  PUBLIC SECTION.

    "! One abap2UI5 roundtrip, with the browser standing in for the ICF.
    "!
    "! On a real system z2ui5_cl_ui5_http_handler=>main( ) reads the request off
    "! an if_http_server and writes the answer back to it. There is no server
    "! object here and nothing to write to, but the framework's request handling
    "! does not need one: _main( ) is a class method over a plain structure in
    "! and a plain structure out. So the playground hands it the JSON the
    "! frontend POSTed and returns what comes back.
    "!
    "! Everything the ICF layer adds around it is either irrelevant on a static
    "! page (compression, stateful sessions, the sap-contextid header dance) or
    "! already guaranteed by it: the CSRF gate exists to reject a cross-origin
    "! POST, and here there is no origin to cross - the request never leaves the
    "! browser.
    "!
    "! @parameter iv_body | the POST body, i.e. { "value": { ... } }
    "! @parameter result | body, status code and reason, as the handler built them
    CLASS-METHODS post
      IMPORTING
        !iv_body      TYPE string
      RETURNING
        VALUE(result) TYPE z2ui5_cl_ui5_http_handler=>ty_s_http_res.

  PROTECTED SECTION.
  PRIVATE SECTION.
ENDCLASS.


CLASS zcl_pg_bridge IMPLEMENTATION.

  METHOD post.

    DATA(ls_req) = VALUE z2ui5_cl_ui5_http_handler=>ty_s_http_req(
        method = `POST`
        path   = `/`
        body   = iv_body ).

    result = z2ui5_cl_ui5_http_handler=>_main( ls_req ).

  ENDMETHOD.

ENDCLASS.
