## What you keep

The decision everything else follows from: an abap2UI5 app is code, not
configuration. One ABAP class per app, no designer, no generated artifacts,
no tables that describe a screen. That is what makes it govern itself:

| | abap2UI5 | A tool that stores apps as configuration |
|---|---|---|
| What an app is | An ABAP class | Entries in the tool's tables, read by its runtime |
| Where a change is made | In the development system, in ADT or SE80 | Wherever the tool's designer is open, possibly production |
| How a change travels | A transport, like any class | The tool's own export, or a customizing transport |
| How a change is reviewed | As a code diff: in abapGit, a pull request or the transport | In the tool's designer, if it shows a history at all |
| What a debugger shows | Your code | The tool's runtime interpreting your configuration |
| What happens if the tool goes away | The classes stay; they are plain ABAP | The apps go with it |

So abap2UI5 needs no rule of its own. Every rule that already applies to
ABAP, naming conventions, code review, ATC, the four-eyes principle on
transports, applies to an app without any change. A system closed for
repository changes is closed for abap2UI5 apps.

- **Authentication is SAP's.** No user store, no token, no session concept
  of its own. A request that reaches an app has passed SAP logon.
- **Authorization is two gates.** The authorization object on the ICF node,
  as for any service, and the app's own authority checks in its code, the
  same way a transaction or a report does them. The framework adds no
  central check on purpose.
- **Data changes are your code's.** An app posts a document by calling the
  same BAPIs, function modules or RAP actions any other ABAP program calls,
  so change documents, application logs and the authority checks behind
  them apply unchanged.
- **Every roundtrip can be logged.** A monitor interface receives, for each
  request, the user, the app, the event, the timings and any error. It is
  off until an installation switches it on.
- **Clean core.** abap2UI5 uses released APIs only, passes the ABAP Cloud
  checks and runs in ABAP Cloud, on S/4HANA and on BTP, from the same source
  that runs on NetWeaver 7.02. It modifies nothing in the SAP standard.

The price is that someone has to write ABAP. There is no click-together
designer for business users, on purpose: a designer would put a second kind
of app definition next to the code, and that second kind is exactly what the
table above has to govern separately.

→ *More on [Security](https://abap2ui5.github.io/docs/configuration/security) and
[Authorization](https://abap2ui5.github.io/docs/configuration/authorization), and the
[security model](https://github.com/abap2UI5/abap2UI5/blob/main/docs/security.md)
a security review starts from: what the framework guarantees, and which test
holds the code to each guarantee*
