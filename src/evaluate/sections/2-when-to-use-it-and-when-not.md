## When to use it, and when not

abap2UI5 is one way to put a UI5 interface on ABAP. RAP with Fiori Elements
is another, freestyle UI5 with OData a third, and all three run side by side
in the same launchpad. Written so that a team can disagree with a specific
line rather than with a feeling:

**Use abap2UI5 when**

- **The team is ABAP.** No JavaScript, no UI5 tooling, no Business
  Application Studio to set up. An app is one class, written, debugged,
  transported and unit-tested like every other class.
- **The system is older than RAP.** NetWeaver 7.02 to 7.4x have no RAP and
  a Fiori stack that is expensive to add. abap2UI5 runs there from the same
  source it runs on ABAP Cloud, so an app written on 7.31 today moves to
  S/4HANA unchanged.
- **The screen is yours, not SAP's.** Tools, cockpits, monitors, admin
  consoles, anything that used to be a report or a module pool. The moment
  a screen is a dashboard with a chart and a custom form, a Fiori Elements
  template becomes the thing you fight.
- **You do not want a deployment pipeline.** No BSP upload, no approuter, no
  MTA. The ABAP system serves the frontend; an abapGit pull is the
  installation.
- **You replace SAP GUI screens one at a time.** Selection screens, lists and
  transactions become browser apps without rewriting the logic behind them.

**Use RAP and Fiori Elements when**

- **The service is the product.** Other consumers, a mobile app, an
  integration, SAP's own apps, need the OData service anyway. RAP gives you
  the service and the UI from one model; abap2UI5 gives you a UI and no
  service.
- **The screen is a standard floorplan and should stay one.** List report,
  object page, worklist, with SAP's draft handling and flexible column layout
  as SAP ships and maintains them. Fiori Elements tracks every UI5 release
  for you; a hand-built screen is yours to keep current.
- **The data is large and lives behind paging.** Fiori Elements pages, sorts
  and filters through OData on the server. In abap2UI5 the table a view
  binds travels with the model; thousands of rows are routine, millions are
  the app's job to page.
- **Offline, or a native mobile SDK, is a requirement.** abap2UI5 is a
  roundtrip to the ABAP system on every interaction. It has a mobile shell
  for camera, barcode and location; it has no offline store.
- **A frontend team should own the frontend.** The app is one ABAP class;
  that is the point, and it means there is no frontend project for a
  separate team to own, and no place for heavy client-side behavior.
- **The organization has standardized on it.** A clean-core guideline that
  names RAP as the extensibility model is a decision already taken.
  abap2UI5 passes the ABAP Cloud checks, but it is not SAP's programming
  model, and a review board will say so.

The common answer is not either. Standard transactional screens as Fiori
Elements, the tools and cockpits around them as abap2UI5, both as tiles in
the same launchpad with navigation between them. What it costs either way:

| | abap2UI5 | RAP + Fiori Elements |
|---|---|---|
| Skills | ABAP, and a reading knowledge of the UI5 control API | ABAP, CDS, RAP, annotations, and someone who can debug the Fiori Elements template |
| First screen | One class, minutes | Data model, behavior definition, service, Fiori project, deploy: a day when everything is set up |
| Custom UI | Any UI5 control, 1:1, from ABAP | Extension points; past them, a freestyle UI5 project |
| Upgrade | The framework is a transport; the public API is held by a snapshot and deprecations are tracked | SAP's; the template follows the UI5 release |
| Reuse by other consumers | None, there is no service | The OData service, by anything |
| Runs on | NetWeaver 7.02 to ABAP Cloud, UI5 1.71 to 2.x | 7.5x and later for RAP, ABAP Cloud for the full model |
| License | MIT, no per-user cost | Part of the platform license |

→ *[On-Stack or Side-by-Side](https://abap2ui5.github.io/docs/advanced/insights/30-on-stack-or-side-by-side)
and [One App, Many Systems](https://abap2ui5.github.io/docs/advanced/insights/31-one-app-many-systems) are
the deployment scenarios in detail*
