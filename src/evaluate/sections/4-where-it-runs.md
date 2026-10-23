## Where it runs

```
Browser                          SAP system (the only server)
───────────────────────────      ────────────────────────────────────────────
generic UI5 shell, loaded   ───▶ ICF node → abap2UI5 handler → your app class
once; no app code of its         SAP logon, authorization objects, sy-uname
own                              app state in one table, per user
```

The browser runs a generic UI5 shell, the same for every app. App code never
leaves the system; the browser receives the view and the data the app chose
to bind. There is one HTTP endpoint, an ICF node, and nothing else listens.
No middleware, no extra server, no BTP subscription, no frontend deployment.

- **Systems:** S/4HANA Public Cloud and BTP ABAP Environment (ABAP for
  Cloud), S/4HANA Private Cloud and on-premise, and NetWeaver 7.02 or later.
- **UI5:** the frontend is UI5 itself, 1.71 to 2.x. By default it loads from
  the public CDN; a productive installation points it at the UI5 the system
  already ships, which is what a system without internet access uses.
- **Where an app appears:** a browser tab, a Fiori launchpad tile, SAP Build
  Work Zone, Microsoft Teams, Microsoft Excel, a native app on iOS and
  Android, or embedded in a UI5 app of your own.

What Basis does, all of it: pull the package with abapGit, create the ICF
node and put an authorization object on it, change the four production
defaults in the user exit (UI5 source, error details, the Content Security
Policy, the node authorization), and optionally switch on the monitor. There
is no job to schedule and no schema to migrate on upgrade.

→ *More on [Productive Usage](https://abap2ui5.github.io/docs/configuration/productive_usage),
[UI5 Versions](https://abap2ui5.github.io/docs/configuration/ui5_versions),
[Performance](https://abap2ui5.github.io/docs/configuration/performance) and
[Integration](https://abap2ui5.github.io/docs/integration/)*
