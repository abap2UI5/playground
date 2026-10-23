## The objections

The questions a review board raises, with the honest answer to each.

**It is an open-source project. What if the maintainers stop?**
The installed version keeps running, the source is in your system in full,
readable and changeable, and the apps stay ordinary ABAP classes. Nothing is
called at runtime that is not in your system, apart from the UI5 library,
which you can host yourself. A build renamed into your own namespace is one
workflow run ([Namespaces, Renaming](https://abap2ui5.github.io/docs/advanced/renaming)).

**Is this another UI5 wrapper that will not survive the next UI5 release?**
The frontend is UI5 itself, not a copy of it, and every merge is run in the
browser on the oldest supported release and on UI5 2.x. Releases are tagged
and listed ([Release Notes](https://abap2ui5.github.io/docs/resources/changelog)); what is on its way out is
announced and tracked until removal ([Deprecations](https://abap2ui5.github.io/docs/resources/deprecations)),
and the public API apps use is held by a snapshot, so a change to it fails
the framework's own pull request.

**Every click is a roundtrip. Is that fast enough?**
A roundtrip is one HTTP POST carrying only what changed, served by the ABAP
stack that already serves everything else. For the screens this page is
about, worklists, forms, cockpits, it is the same round trip a SAP GUI
screen makes, in a browser. What it is not built for is a real-time
collaborative editor or an app that holds its state offline
([Performance](https://abap2ui5.github.io/docs/configuration/performance)).

**Our clean-core guideline names RAP. Where does this leave us?**
Side by side. abap2UI5 passes the ABAP Cloud checks and modifies nothing in
the standard, so it is clean core in the technical sense, but it is not
SAP's programming model. The usual outcome is a scope: standard
transactional screens in RAP, the tools around them in abap2UI5, both in one
launchpad.

**Who is accountable when something breaks?**
Your developer, for the app, the same as for any class in the system; the
community, for the framework, on a best-effort basis; a commercial partner,
if you sign one. Security reports are acknowledged within three business
days ([Security](https://abap2ui5.github.io/docs/configuration/security)).

**Is anybody actually running this in production?**
Yes, see below. And every release is tested against Standard ABAP and ABAP
Cloud, downported and linted against NetWeaver 7.02, and run in the browser
on the oldest and the newest supported UI5 release
([verified on](https://github.com/abap2UI5/abap2UI5/blob/main/docs/verified-on.md)).
