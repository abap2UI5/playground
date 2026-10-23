## The problem it answers

Every SAP system has screens nobody shipped: the cockpit for one team, the
monitor for one process, the selection screen with a result list that used to
be a report with an ALV. They are not standard floorplans, so Fiori Elements
does not cover them; they are not worth a frontend project, an OData service
and a deployment pipeline, so they stay in SAP GUI, in a spreadsheet, or on
paper. And on a system older than S/4HANA, RAP is not there to build them
with at all.

abap2UI5 is the shorter path for exactly these screens. An app is one ABAP
class, written in ADT or SE80, transported like any other class, and it
renders as a UI5 app in the browser, in the Fiori launchpad, or on a mobile
device. There is no service, no frontend project and nothing to deploy. The
rest of this page is what that costs and what it does not.

→ *[In a Nutshell](https://abap2ui5.github.io/docs/get_started/about) is the technical picture of how the
framework works, for the architect who wants to see the roundtrip*
