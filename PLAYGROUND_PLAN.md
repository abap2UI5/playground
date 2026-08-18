# abap2UI5 Browser-Playground — Arbeitsplan

Ziel: Ein Playground als statische GitHub Page in diesem Repo (test-live).
Links ein Monaco-Editor mit abaplint (Diagnostik, Completion), rechts die
laufende abap2UI5-App. Der ABAP-Code wird im Browser mit dem
abaplint-Transpiler nach JavaScript übersetzt und komplett clientseitig
ausgeführt — kein Server, kein SAP-System. Vorbild: https://playground.abaplint.org/

Dieses Dokument ist die Arbeitsvorlage: Jede AI-Session nimmt sich die
nächste offene Aufgabe (oberste unerledigte Checkbox der niedrigsten
offenen Phase), erledigt sie inklusive Abnahmekriterien, hakt sie hier ab
und committet Code + Plan-Update zusammen.

---

## Arbeitsregeln für AI-Sessions

- **Branch:** Entwickelt wird auf `claude/abap2ui5-playground-huhjyw`
  (test-live). Push mit `git push -u origin claude/abap2ui5-playground-huhjyw`.
  Keinen Pull Request anlegen, außer der Mensch bittet darum.
- **Eine Aufgabe pro Commit-Serie.** Aufgabe abschließen heißt: Code, Test
  bzw. Nachweis der Abnahmekriterien, Checkbox in diesem Dokument abhaken,
  gegebenenfalls "Erkenntnisse"-Abschnitt der Phase ergänzen.
- **Nichts raten, nachlesen.** Die Referenz-Implementierung ist der
  `node/`-Ordner im Repo `abap2ui5/abap2ui5` (gleiche Session-Scope). Dort
  ist die komplette Transpiler-Pipeline produktiv: `node/setup/abap_transpile.json`,
  `node/setup/setup.mjs` (sql.js/SQLite-Bootstrap), `node/srv/express.mjs` +
  `node/srv/zcl_sicf.clas.abap` (HTTP-Einstieg), `package.json`-Scripts
  `downport` und `auto_transpile` (Downport-Rezept).
- **Versionen pinnen.** Alle abaplint-Pakete (`@abaplint/transpiler`,
  `@abaplint/runtime`, `@abaplint/database-sqlite`, `@abaplint/monaco`,
  `@abaplint/core`) und der abap2UI5-Stand (Commit-SHA) werden exakt
  gepinnt. Bumps sind eigene, bewusste Commits.
- **Fehlschläge dokumentieren.** Wenn eine Aufgabe an einem harten Hindernis
  scheitert (z. B. eine Runtime-API ist doch Node-only), wird das im
  "Erkenntnisse"-Abschnitt festgehalten und die Aufgabe umformuliert statt
  still übersprungen.
- **Alles statisch.** Endergebnis jeder Phase muss ohne Server außer GitHub
  Pages funktionieren. Kein Backend, keine API-Keys, keine Laufzeit-Downloads
  außer UI5-CDN.

## Architektur-Zielbild

```
GitHub Pages (statisch, aus dist/)
│
├── index.html            Playground-Shell: Splitter, Toolbar, Run-Button
├── editor/               Monaco + @abaplint/monaco, abaplint im Web Worker
│                         Registry enthält die (downgeporteten) Framework-Quellen
├── runtime/
│   ├── framework.mjs     Build-zeitlich transpiliertes abap2UI5 + open-abap-core
│   ├── init.mjs          initializeABAP() + sql.js-Setup (Schema + Inserts)
│   └── fetch-shim.mjs    fetch-ICF-Shim: POST-Body → if_http_extension →
│                         z2ui5_cl_ui5_http_handler → JSON-Response
├── app/                  abap2UI5-UI5-Frontend (webapp aus build/cloud),
│                         läuft im iframe, UI5-Core vom CDN,
│                         window.fetch der Backend-URL wird auf den Shim umgebogen
└── samples/              Beispielklassen (Quelle: abap2UI5-Demos)
```

Roundtrip zur Laufzeit: Editor → Run → Web Worker (Downport-Fixes +
Transpile der Nutzerklasse gegen die Registry) → Blob-Modul importieren →
Klasse in `abap.Classes` registrieren → iframe (neu) laden → das UI5-Frontend
POSTet per `fetch()` → Shim ruft den transpilierten HTTP-Handler → JSON zurück
→ App rendert. Zustand (Drafts) liegt in sql.js im Speicher.

Bereits verifizierte Fakten (Analyse 2026-08-18):

- abap2UI5 wird in CI vollständig transpiliert und läuft unter Node
  (`npm run downport && npm run auto_transpile && npm run unit`).
- `@abaplint/database-sqlite` basiert auf sql.js (WASM) → browserfähig.
- Das UI5-Frontend spricht mit dem Backend ausschließlich über
  `fetch(url, {method: "POST"})` mit JSON-Body (`core/Server.js`) —
  zustandslose Roundtrips, ideal zum Abfangen.
- `@abaplint/monaco` existiert und wird gepflegt (Monaco = VS-Code-Editor);
  playground.abaplint.org beweist Transpiler + Runtime + Editor im Browser.
- Einstiegspunkt Backend: `if_http_extension` → `z2ui5_cl_ui5_http_handler=>factory( server )->main( )`
  (siehe `node/srv/zcl_sicf.clas.abap`); unter Node adaptiert der kleine
  `express-icf-shim` darauf — der fetch-Shim macht dasselbe mit Fake-req/res.

---

## Phase 0 — Repo-Grundgerüst und Deployment-Skelett

Ziel: test-live kann bauen und nach GitHub Pages deployen, bevor es
irgendetwas Fachliches gibt. Damit ist der Deploy-Weg nie der Blocker.

- [x] **P0.1 npm-Grundgerüst.** `package.json` mit gepinnten devDependencies
  (`@abaplint/cli`, `@abaplint/transpiler-cli`, `@abaplint/runtime`,
  `@abaplint/database-sqlite`, `@abaplint/monaco`, `monaco-editor`, esbuild
  oder vite als Bundler), `.gitignore` (node_modules, dist, deps, output),
  `README.md`-Abschnitt "Playground" mit Architektur-Kurzfassung und Link auf
  dieses Dokument.
  *Abnahme:* `npm ci && npm run build` läuft lokal durch (build darf zunächst
  nur eine leere `dist/index.html` erzeugen).
- [x] **P0.2 Pages-Workflow.** GitHub Action `.github/workflows/pages.yml`:
  bei Push auf den Default-Branch `npm ci && npm run build`, `dist/` als
  Pages-Artefakt deployen (actions/deploy-pages). Zusätzlich ein
  `check.yml`, der auf jedem Branch `npm run build` + spätere Tests fährt.
  *Abnahme:* Workflow-Datei ist syntaktisch valide (actionlint oder
  `node -e` YAML-Parse); im Workflow-Log eines Branch-Laufs ist der
  Build grün. (Pages-Aktivierung selbst macht der Mensch im Repo-Setting —
  im README als TODO für den Menschen vermerken.)
- [x] **P0.3 Pinning-Script.** `tools/fetch-deps.mjs` nach dem Vorbild von
  `abap2ui5/node/setup/fetch-deps.mjs`: pinnt per SHA die Klone von
  `abap2ui5/abap2ui5`, `open-abap/open-abap-core` und
  `abapedia/steampunk-2305-api-intersect-702` unter `deps/` (gitignored).
  *Abnahme:* zweimaliger Lauf ist idempotent (~no-op beim zweiten Mal),
  `--print-latest` zeigt Upstream-HEADs.

## Phase 1 — Framework-Bundle: abap2UI5 transpiliert für den Browser

Ziel: Das komplette Framework + open-abap-core liegt als ein statisches
ESM-Bundle vor und lässt sich in einer Browser-Umgebung initialisieren.
Das ist die Portierung von `node/output` + `setup.mjs` in den Browser.

- [ ] **P1.1 Downport + Transpile im Build.** Build-Script
  `tools/build-framework.mjs`: kopiert `deps/abap2ui5/src` nach
  `build/downport/`, wendet das Downport-Rezept aus dem abap2UI5-`package.json`
  an (`abaplint --fix` mit der 702-Config, plus die dortigen `syfixes`/
  `strip_trailing_ws`-Ersetzungen), legt eine an
  `node/setup/abap_transpile.json` angelehnte Transpile-Config an
  (libs = gepinnte deps, `write_unit_tests: false`, gleiche `skip`-Liste
  soweit relevant) und ruft `abap_transpile` auf.
  *Abnahme:* `build/output/` enthält `init.mjs` und die `.clas.mjs`-Module;
  ein Node-Smoke-Test (`node -e "import('./build/output/init.mjs')"` mit dem
  sqlite-Setup aus P1.2) wirft keinen Fehler.
- [ ] **P1.2 Browser-Setup für die Datenbank.** `src/runtime/db-setup.mjs`:
  Adaption von `node/setup/setup.mjs` — sql.js so laden, dass es im Browser
  funktioniert (WASM-Datei `sql-wasm.wasm` mit nach `dist/` kopieren und
  per `locateFile` auflösen), dann Schema + Inserts ausführen.
  *Abnahme:* Unit-Test (Node reicht, sql.js verhält sich identisch), der
  `setup()` ausführt und danach eine SELECT auf eine z2ui5-Tabelle absetzt.
- [ ] **P1.3 Bundling.** `npm run build:framework` bündelt `build/output/*`
  + Runtime + db-setup mit esbuild zu `dist/runtime/framework.mjs`
  (ESM, ein File oder wenige Chunks). Auf Node-only-Importe prüfen
  (`fs`, `path`, `child_process` dürfen im Bundle nicht landen bzw. müssen
  gestubbt sein — esbuild `platform: 'browser'` deckt das auf).
  *Abnahme:* Bundle-Build grün; ein Headless-Browser-Test (Playwright,
  Chromium ist im Container unter `/opt/pw-browsers/chromium` vorinstalliert)
  lädt eine Testseite, ruft `initializeABAP()` + DB-Setup auf und meldet Erfolg.
  Bundle-Größe im README notieren.
- [ ] **P1.4 Erkenntnisse festhalten.** Abschnitt "Erkenntnisse Phase 1"
  unten ergänzen: Welche Module mussten gestubbt werden, wie groß ist das
  Bundle, wie lange dauert `initializeABAP()` im Browser.

## Phase 2 — fetch-ICF-Shim: ein Roundtrip ohne UI

Ziel: Ein POST-Body wie ihn das UI5-Frontend schickt geht rein, die
JSON-Antwort des Frameworks kommt raus — komplett im Browser, noch ohne UI5.
Das ist die riskanteste Einzelkomponente; deshalb isoliert und zuerst.

- [ ] **P2.1 Shim implementieren.** `src/runtime/fetch-shim.mjs`: baut
  Fake-`req`/`res`-Objekte im Stil von express (Methode, URL, Header,
  Body als Uint8Array; res sammelt Status/Header/Body) und ruft damit den
  transpilierten Einstieg auf — entweder über die transpilierte
  `cl_express_icf_shim` (open-abap/express-icf-shim, liegt als gepinnte dep
  vor) mit `{req, res, class: "ZCL_SICF"}` oder, falls die zu express-lastig
  ist, direkt über eine eigene Implementierung der `if_http_*`-Fakes nach
  deren Vorbild. Eine `zcl_sicf`-Kopie (aus `node/srv/`) wird mittranspiliert.
  Export: `async function handleRoundtrip(bodyString): Promise<{status, body}>`.
  *Abnahme:* Unit-Test in Node gegen das Bundle.
- [ ] **P2.2 App-Start-Roundtrip als Test.** Eine Demoklasse (z. B.
  `zcl_tst_focus` aus `node/srv/` oder eine minimale eigene
  `z2ui5_if_app`-Klasse) mittranspilieren. Test: den App-Start-POST-Body
  nachbauen (Wire-Format ist in `app/webapp/core/Server.js` von abap2UI5
  dokumentiert: `{ "value": { "S_FRONT": { "APP_START": ..., ... } } }` —
  exakte Felder dort nachlesen, nicht raten) und prüfen, dass die Antwort
  gültiges JSON mit XML-View-Inhalt ist.
  *Abnahme:* Playwright-Headless-Test: Seite lädt Bundle, feuert
  `handleRoundtrip` mit App-Start-Body, Response enthält die erwartete View;
  ein zweiter Roundtrip mit der Draft-ID aus der ersten Antwort (Event)
  funktioniert ebenfalls → beweist, dass die Draft-Persistenz via sql.js trägt.
- [ ] **P2.3 Session-Reset.** Funktion `resetSession()`: DB neu aufsetzen
  (oder Draft-Tabellen leeren), damit "Run" im Playground immer frisch startet.
  *Abnahme:* Test — Roundtrip, Reset, alte Draft-ID ist danach ungültig,
  neuer App-Start funktioniert.

## Phase 3 — UI5-Frontend im iframe: erste sichtbare App

Ziel: Rechts rendert eine echte abap2UI5-App, noch mit fest eingebauter
Beispielklasse (Editor kommt in Phase 4/5).

- [ ] **P3.1 Frontend statisch hosten.** `deps/abap2ui5/build/cloud/app/webapp`
  nach `dist/app/` übernehmen; `index.html` so anpassen, dass
  `sap-ui-core.js` vom UI5-CDN geladen wird (`https://ui5.sap.com/<gepinnte
  Version>/resources/sap-ui-core.js`) und Theme/Bootstrap unverändert bleiben.
  *Abnahme:* iframe lädt ohne 404s (Playwright: keine failed requests außer
  erwartbaren optionalen Ressourcen).
- [ ] **P3.2 fetch-Interception im iframe.** Injektionsscript, das VOR dem
  UI5-Bootstrap läuft und `window.fetch` nur für die Backend-URL
  (`AppState`-`url` des Frontends — nachlesen, wie sie konfiguriert wird)
  auf `parent.handleRoundtrip` umbiegt; alle anderen fetches unverändert.
  Same-origin (gleiche GitHub Page), also kein CORS-Thema.
  *Abnahme:* Playwright-Test: Playground-Seite mit iframe lädt, die fest
  verdrahtete Demoklasse rendert sichtbar (Selektor auf ein UI5-Control),
  ein Klick löst einen Event-Roundtrip aus und die UI reagiert.
- [ ] **P3.3 Reload-Zyklus.** `runApp(className)`: Session-Reset + iframe
  neu laden + Startklasse setzen (wie abap2UI5 die Startklasse bestimmt —
  URL-Parameter/Config — im Frontend nachlesen und dokumentieren).
  *Abnahme:* Test ruft `runApp` zweimal hintereinander auf, beide Male
  rendert die App frisch.

## Phase 4 — Editor: Monaco + abaplint

Ziel: Links ein Editor mit VS-Code-Gefühl — Live-Diagnostik, Completion,
Hover, Pretty Printer — gegen die echten Framework-Definitionen.

- [ ] **P4.1 Monaco einbetten.** Monaco-Editor in der Shell, ABAP-Sprach-ID,
  Light/Dark folgt dem System. Bundling beachten (Monaco braucht seine
  Worker; mit esbuild/vite das dokumentierte Monaco-Setup verwenden).
  *Abnahme:* Editor rendert, ABAP-Beispieltext mit Grund-Highlighting.
- [ ] **P4.2 abaplint-Worker + Registry.** Web Worker mit `@abaplint/core`:
  Registry enthält die downgeporteten Framework-Quellen aus dem Build
  (als JSON-Manifest `dist/editor/registry.json` mitliefern) plus die
  Nutzerdatei. abaplint-Konfiguration: Syntax-Target passend zum Transpiler
  (702-Downport-Ziel), Regeln moderat (Syntaxfehler ja, Stil-Nörgelei nein).
  *Abnahme:* Headless-Test — absichtlicher Syntaxfehler in der Nutzerdatei
  erzeugt eine Diagnostik mit korrekter Zeile; Referenz auf
  `z2ui5_cl_ui5_view_builder` ohne Fehler (beweist, dass die Registry die
  Framework-Definitionen kennt).
- [ ] **P4.3 @abaplint/monaco verdrahten.** Diagnostik als Marker,
  Completion, Hover, Format-Aktion (Pretty Printer) über `@abaplint/monaco`
  anbinden (API im Paket nachlesen; Vorbild ist der abaplint-Playground).
  *Abnahme:* Playwright-Test: Tippen von `z2ui5_cl_` liefert
  Completion-Vorschläge; kaputter Code zeigt rote Marker.

## Phase 5 — Live-Transpile: der eigentliche Playground-Kern

Ziel: Der Code aus dem Editor läuft nach "Run" rechts als App.

- [ ] **P5.1 Downport der Nutzerklasse im Worker.** Die gleichen
  abaplint-Fix-Regeln wie im Build (P1.1), aber programmatisch auf die eine
  Nutzerdatei angewandt (abaplint `applyFixes`-API). Moderne Syntax
  (Inline-Deklarationen, String-Templates, VALUE #) muss danach 702-tauglich
  sein.
  *Abnahme:* Unit-Test mit einer Klasse voller moderner Syntax → Downport-
  Ergebnis kompiliert im Transpiler.
- [ ] **P5.2 Einzelobjekt-Transpile.** `@abaplint/transpiler` im Worker:
  transpiliert NUR die Nutzerklasse gegen die volle Registry (Framework als
  Kontext, aber nicht neu ausgeben — API dafür im Transpiler nachlesen;
  falls es kein Einzelobjekt-API gibt: alles transpilieren und nur das
  Nutzer-Modul verwenden, Performance messen und dokumentieren).
  *Abnahme:* Test — Ausgabe ist ein ESM-Modul-String der Nutzerklasse;
  Transpile-Dauer im Browser < ~5 s (messen, im README notieren).
- [ ] **P5.3 Laden + Registrieren.** Modul-String als Blob-URL dynamisch
  importieren, Klasse in `abap.Classes` registrieren (Namenskonvention der
  Transpiler-Ausgabe beachten), bei erneutem Run die alte Registrierung
  ersetzen.
  *Abnahme:* Playwright-Test: Editor-Code → Run → App rendert rechts;
  Code ändern → Run → geänderte App rendert (kein Reload der Gesamtseite
  nötig außer dem iframe).
- [ ] **P5.4 Fehler-UX.** Transpiler-/Laufzeitfehler landen lesbar in einem
  Ausgabe-Panel (nicht nur in der Konsole): abaplint-Diagnostik vor Run
  erzwingen (Run bei Syntaxfehlern blockieren mit Hinweis), Runtime-Dumps
  (`abap.Classes`-Exceptions) abfangen und mit Klasse/Methode anzeigen.
  *Abnahme:* Test mit drei Fehlerbildern — Syntaxfehler (blockt Run),
  Transpiler-Limitierung (Meldung im Panel), Laufzeitfehler (Dump im Panel).

## Phase 6 — Playground-UX

Ziel: Aus dem Technik-Demo wird ein Playground, den man verlinken kann.

- [ ] **P6.1 Shell-Layout.** Splitter (verschiebbar), Toolbar mit Run
  (Ctrl+Enter), Format, Share, Sample-Auswahl; Statuszeile mit
  abap2UI5-Version + Transpiler-Version; responsive (mobil: Tabs statt
  Splitter). Design schlicht halten, UI5-Look dem iframe überlassen.
- [ ] **P6.2 Sample-Galerie.** `samples/`-Ordner mit 5–10 Beispielklassen
  aufsteigender Komplexität (Hello World, Eingabe+Event, Tabelle, Popup,
  Wizard — geeignete Vorlagen aus den abap2UI5-Demos übernehmen und auf
  Playground-Tauglichkeit prüfen, d. h. keine Systemabhängigkeiten).
  Dropdown lädt Sample in den Editor.
  *Abnahme:* Jedes Sample läuft grün durch einen parametrisierten
  Playwright-Test (Sample laden → Run → rendert).
- [ ] **P6.3 Share-Links.** Editor-Inhalt komprimiert im URL-Fragment
  (z. B. base64+deflate, wie es TypeScript-Playground macht); Laden einer
  Share-URL stellt den Code wieder her und startet Run automatisch.
  *Abnahme:* Test — Share-URL erzeugen, in neuem Kontext öffnen, gleiche App
  rendert.
- [ ] **P6.4 Persistenz.** Editor-Inhalt in localStorage (Wiederherstellen
  nach Reload, mit "Reset auf Sample"-Knopf).

## Phase 7 — Qualität, CI, Doku

- [ ] **P7.1 CI-Gates.** `check.yml` fährt: Framework-Build, alle
  Unit-/Headless-Tests, Playwright-e2e (Samples-Matrix), Bundle-Size-Limit
  (Budget festlegen und begründen). Pages-Deploy nur bei grünem Check.
- [ ] **P7.2 Version-Bump-Prozess.** Dokumentierter Ablauf (README):
  abap2UI5-SHA bumpen → Build → Tests → committen. Optional ein
  wöchentlicher Scheduled-Workflow, der den Bump als Branch vorbereitet.
- [ ] **P7.3 Doku.** README final: Screenshot/GIF, Architekturdiagramm,
  "Wie funktioniert das?"-Abschnitt (Transpiler, sql.js, fetch-Shim),
  bekannte Grenzen (Sprachumfang = Transpiler-Umfang, keine echten
  HTTP-Aufrufe nach draußen, Performance-Hinweise).
- [ ] **P7.4 Ankündigungsreife.** Abschlussprüfung gegen die ursprüngliche
  Idee: Editor mit abaplint links, App rechts, alles im Browser, als GitHub
  Page erreichbar. Offene Punkte als Phase-8-Kandidaten einsortieren.

## Phase 8 — Optionale Ausbaustufen (nur nach explizitem Auftrag)

- [ ] Mehrdatei-Support (mehrere Klassen/Interfaces, Datei-Tabs).
- [ ] IndexedDB-Persistenz der sql.js-DB über Reloads hinweg.
- [ ] Deep-Links in die abap2UI5-Samples-Repos (Sample im Playground öffnen).
- [ ] Konfigurierbare abaplint-Regeln im UI.
- [ ] Embedding-Modus (Playground als iframe für Doku-Seiten).

---

## Erkenntnisse

Je Phase beim Abschluss ergänzen: Was war anders als geplant, welche
Messwerte (Bundle-Größe, Transpile-Dauer, Init-Dauer), welche Upstream-Issues
wurden aufgemacht.

### Erkenntnisse Phase 1

*(noch leer)*
