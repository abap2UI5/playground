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
│   ├── framework.mjs     Build-zeitlich transpiliertes abap2UI5 + open-abap-core,
│   │                     inklusive sql.js-Setup und der Brücke roundtrip()
│   └── sql-wasm.wasm     SQLite als WebAssembly
├── app/                  abap2UI5-UI5-Frontend (webapp aus build/cloud),
│                         läuft im iframe, UI5-Core vom CDN,
│                         window.fetch der Backend-URL wird auf den Shim umgebogen
└── samples/              Beispielklassen (Quelle: abap2UI5-Demos)
```

Roundtrip zur Laufzeit: Editor → Run → Web Worker (Downport-Fixes +
Transpile der Nutzerklasse gegen die Registry) → Blob-Modul importieren →
Klasse in `abap.Classes` registrieren → iframe (neu) laden → das UI5-Frontend
POSTet per `fetch()` → Brücke ruft den transpilierten HTTP-Handler → JSON zurück
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
- Einstiegspunkt Backend: `z2ui5_cl_ui5_http_handler=>_main( is_req )` — eine
  öffentliche Klassenmethode über eine schlichte Struktur, kein ICF nötig
  (siehe Erkenntnisse Phase 2).

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

- [x] **P1.1 Downport + Transpile im Build.** Build-Script
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
- [x] **P1.2 Browser-Setup für die Datenbank.** `src/runtime/db-setup.mjs`:
  Adaption von `node/setup/setup.mjs` — sql.js so laden, dass es im Browser
  funktioniert (WASM-Datei `sql-wasm.wasm` mit nach `dist/` kopieren und
  per `locateFile` auflösen), dann Schema + Inserts ausführen.
  *Abnahme:* Unit-Test (Node reicht, sql.js verhält sich identisch), der
  `setup()` ausführt und danach eine SELECT auf eine z2ui5-Tabelle absetzt.
- [x] **P1.3 Bundling.** `npm run build:framework` bündelt `build/output/*`
  + Runtime + db-setup mit esbuild zu `dist/runtime/framework.mjs`
  (ESM, ein File oder wenige Chunks). Auf Node-only-Importe prüfen
  (`fs`, `path`, `child_process` dürfen im Bundle nicht landen bzw. müssen
  gestubbt sein — esbuild `platform: 'browser'` deckt das auf).
  *Abnahme:* Bundle-Build grün; ein Headless-Browser-Test (Playwright,
  Chromium ist im Container unter `/opt/pw-browsers/chromium` vorinstalliert)
  lädt eine Testseite, ruft `initializeABAP()` + DB-Setup auf und meldet Erfolg.
  Bundle-Größe im README notieren.
- [x] **P1.4 Erkenntnisse festhalten.** Abschnitt "Erkenntnisse Phase 1"
  unten ergänzen: Welche Module mussten gestubbt werden, wie groß ist das
  Bundle, wie lange dauert `initializeABAP()` im Browser.

## Phase 2 — Ein Roundtrip ohne UI

Ziel: Ein POST-Body wie ihn das UI5-Frontend schickt geht rein, die
JSON-Antwort des Frameworks kommt raus — komplett im Browser, noch ohne UI5.
Das war als riskanteste Einzelkomponente geplant; es wurde die einfachste.

- [x] **P2.1 Brücke ins Framework.** *(umformuliert gegenüber dem
  ursprünglichen Plan — siehe Erkenntnisse Phase 2.)* Statt einen
  `if_http_server` nachzubauen: `src/abap/zcl_pg_bridge.clas.abap` ruft
  `z2ui5_cl_ui5_http_handler=>_main( )` auf, eine öffentliche Klassenmethode
  über eine einfache Struktur rein / raus. `src/runtime/index.mjs` exportiert
  das als `roundtrip(body) -> {status, reason, body}`.
  *Abnahme:* Browser-Test gegen das gebaute Bundle.
- [x] **P2.2 App-Start-Roundtrip als Test.** `src/abap/zcl_pg_hello.clas.abap`
  als eingebaute Demo-App. Wire-Format aus `app/webapp/core/Server.js`
  nachgelesen: der App-Start-Body ist
  `{"value":{"S_FRONT":{"SEARCH":"?app_start=<KLASSE>"}}}` — der Klassenname
  kommt aus der URL-Query, nicht aus einem eigenen Feld.
  *Abnahme:* `tests/runtime.spec.js` — App-Start liefert 200 mit der View,
  ein zweiter Roundtrip mit der Draft-ID feuert ein Event und sieht den
  Zustand des ersten (beweist die Draft-Persistenz über sql.js), eine
  unbekannte App-Klasse liefert einen lesbaren 500.
- [x] **P2.3 Session-Reset.** `resetDatabase()` in `src/runtime/db-setup.mjs`
  baut die Datenbank neu auf.
  *Abnahme:* Test — Roundtrip, Reset, alte Draft-ID ist danach unbrauchbar.

## Phase 3 — UI5-Frontend im iframe: erste sichtbare App

Ziel: Rechts rendert eine echte abap2UI5-App, noch mit fest eingebauter
Beispielklasse (Editor kommt in Phase 4/5).

- [x] **P3.1 Frontend mitliefern statt CDN.** *(umformuliert — siehe
  Erkenntnisse Phase 3.)* `tools/build-ui5.mjs` baut
  `deps/abap2ui5/build/cloud/app/webapp` mit der UI5-Tooling-Kette gegen
  eine gepinnte OpenUI5-Version; die Bibliotheken kommen aus npm und landen
  unter `dist/app/resources/`. Statt CDN-Link.
  *Abnahme:* Test — beim Start der App geht kein einziger Request an eine
  fremde Origin, und nichts liefert 404.
- [x] **P3.2 fetch-Interception im iframe.** `src/shell/frontend-bridge.js`
  läuft als klassisches Script vor dem UI5-Bootstrap, setzt
  `z2ui5.checkLocal = true` (damit das Frontend auf die eigene URL POSTet)
  und ersetzt `window.fetch` für genau diesen einen Request; alles andere
  geht unverändert ans Netz.
  *Abnahme:* Test — die App rendert sichtbar, ein Klick auf den Button löst
  einen Roundtrip aus und der in ABAP berechnete Text erscheint.
- [x] **P3.3 Reload-Zyklus.** `run(appClass)` in `src/shell/main.mjs`:
  Datenbank neu, dann iframe mit
  `app/index.html?app_start=<KLASSE>&run=<n>` neu laden. Der Zähler macht
  jeden Lauf zu einem eigenen Dokument, sodass der Browser keinen Cache
  ausspielen kann.
  *Abnahme:* Test — Zustand ändern, "Run", die App steht wieder auf Anfang.

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

**Messwerte** (abap2UI5 @ 67f214d, abaplint 2.120.26, Transpiler 2.13.59):

| | |
|---|---|
| Downport (`abaplint --fix`, 106 Iterationen) | ~3 min, 0 Issues |
| Transpile | ~20 s, 735 Objekte |
| Bundle `dist/runtime/framework.mjs` | 8,7 MB, **0,8 MB gzip** |
| `sql-wasm.wasm` | 643 KB |
| Framework-Boot im Browser (Import bis bereit) | ~1,2 s |

**Fünf Fallen, jede davon ein harter Stopper.** Sie stehen hier, weil keine
davon aus der Dokumentation ersichtlich ist und jede als unverständlicher
Laufzeitfehler auftritt:

1. **`addCommonJS: true` ist Pflicht, obwohl wir ESM bauen.** Ohne den Flag
   schreibt der Transpiler `.mjs`-Dateien *ohne jeden Import/Export*, die sich
   per nacktem Bezeichner referenzieren (`class cl_abap_classdescr extends
   cl_abap_objectdescr`). Das funktioniert in *keinem* Loader, auch nicht unter
   Node — verifiziert. Mit dem Flag entsteht ein echter Modulgraph mit
   `await import(...)` und `export {...}`, den esbuild normal bündelt. Der
   Flag-Name ist irreführend: es entsteht kein CommonJS.
2. **`keepNames: true` ist Pflicht.** open-abap implementiert RTTI über
   `@KERNEL`-Escapes, die den **JavaScript-Konstruktornamen** lesen
   (`cl_abap_typedescr=>describe_by_data` → `p_data.constructor.name`).
   Jeder Bundler benennt Klassen bei Namenskollision um — und `abap.types.String`
   kollidiert sofort mit dem globalen `String`. Ohne `keepNames` liefert jedes
   DESCRIBE den falschen Typ; der Fehler erscheint als `CONVT_NO_NUMBER` beim
   Aufbau des Typcaches, meilenweit von der Ursache entfernt.
3. **`Buffer` wird gebraucht, bevor irgendein Anwendungscode läuft.**
   `cl_abap_char_utilities` baut MAXCHAR/MINCHAR im Klassenkonstruktor aus Hex.
   Lösung: npm-Paket `buffer` per esbuild-`inject`.
4. **Die Default-Konsole der Runtime schreibt auf `process.stdout`.** Der erste
   ABAP-`WRITE` passiert in einem Klassenkonstruktor von open-abap (ein
   „todo"-WRITE in `describe_by_data`) — also bevor man `abap.console`
   überhaupt zuweisen könnte. Lösung: das Modul
   `@abaplint/runtime/.../console/standard_out_console` per esbuild-Plugin auf
   eine eigene In-Memory-Konsole umbiegen.
5. **`crypto` darf kein Wegwerf-Stub sein.** `cl_system_uuid` prüft
   `if (CRYPTO.randomUUID)` und fällt sonst auf `window.crypto` zurück — ein
   Stub, dessen `randomUUID` *existiert* und wirft, bricht diesen Fallback.
   Jeder Roundtrip zieht eine Draft-ID darüber. Lösung:
   `src/runtime/node-crypto-shim.mjs` implementiert `randomUUID`/`randomBytes`
   echt über WebCrypto und wirft nur bei `createHash`/`createHmac`
   (synchrones Hashing gibt es im Browser nicht — wird von abap2UI5 nicht
   benutzt).

Weitere Node-Module (`zlib`, `http`, `https`, `net`, `tls`, `fs`, `path`,
`url`, `util`) werden von open-abap-core-Klassen importiert, die abap2UI5 nie
aufruft. Sie werden auf werfende Stubs aufgelöst — die Meldung nennt das
fehlende Modul, statt als „x is not a function" irgendwo aufzuschlagen.

**Nicht gebraucht:** `express-icf-shim` und `steampunk-2305-api-intersect-702`
(beide im Ursprungsplan als deps vorgesehen) — die `if_http_*`-Interfaces
kommen aus open-abap-core, und der ICF-Weg wird gar nicht beschritten.

**Bundle-Größe:** Das Bundle enthält die gesamte open-abap-Standardbibliothek,
weil `init.mjs` jedes Objekt lädt. Tree-Shaking ist nicht möglich, solange ABAP
Klassen dynamisch über `abap.Classes[name]` auflöst. 0,8 MB gzip ist für einen
Playground unkritisch.

### Erkenntnisse Phase 3

**Der UI5-CDN entfällt — OpenUI5 wird mitgeliefert.** Der ursprüngliche Plan
sah `https://sdk.openui5.org/...` vor (das ist auch abap2UI5s eigener
Standard). Dagegen sprach zunächst nur, dass die Build-Umgebung diese Domain
blockiert und damit kein einziger Render-Test lief. Beim Durchdenken war die
gelieferte Variante aber ohnehin die bessere:

- Die Version ist gepinnt, der Playground damit reproduzierbar.
- Er überlebt einen Ausfall von sdk.openui5.org.
- Die Regel „alles statisch" aus den Arbeitsregeln gilt dann wirklich.
- **Und die Tests können rendern** — davon hängen die Phasen 5 und 6 ab.

Kosten: `tools/build-ui5.mjs`, ~60 s Buildzeit (plus einmaligem
Framework-Download) und **103 MB in `dist/app`**. Das klingt viel, ist es aber
nicht: UI5 lädt Library-Preload-Bundles bedarfsgesteuert, eine typische App
zieht wenige MB. Seitengröße ≠ Transfergröße. GitHub Pages erlaubt 1 GB.

**Beim Trimmen war weniger mehr.** Ein erster Wurf warf zusätzlich alle
Übersetzungen (`messagebundle_*.properties`) und die RTL-Stylesheets weg —
das sparte 22 MB und erzeugte prompt 404s, weil UI5 die Bundles *nach Locale*
anfragt und nicht stillschweigend auf das Basis-Bundle zurückfällt. Geblieben
sind nur die eindeutig unerreichbaren Dateien: `-dbg.js`, `.js.map`, `.less`,
`test-resources/` und `sap/ui/test/` — zusammen immer noch 6266 Dateien und
gut ein Drittel des Baums.

**`sap-ui-version.json` muss man selbst schreiben.** `ui5 build` erzeugt die
Datei nur für Library-Projekte, nicht für Applikationen — das Frontend fragt
sie aber bei jedem Start ab (`core/Server.js` liest `sap/ui/VersionInfo`).
Ohne sie: 404 plus UI5-Fehlermeldung bei jedem Seitenaufruf.

**Der Klassenname geht über die iframe-URL rein**, der Cache-Buster gleich
mit. Die fetch-Interception vergleicht deshalb nur `origin` + `pathname`, nie
die volle URL — sonst würde der Zähler im Query-String den Roundtrip nicht
mehr als solchen erkennbar machen.

**UI5 präfixt Control-IDs mit der View-ID** (`mainView--btnGreet`). Tests
sollten auf das Suffix matchen (`[id$="--btnGreet"]`) — das ist der Teil, den
der ABAP-Code tatsächlich gewählt hat. Der Input trägt seinen Wert im
`-inner`-Element.

**Ein Interface-Konstante liegt unter ihrem qualifizierten Namen**:
`z2ui5_if_app=>version` ist im Transpilat
`abap.Classes["Z2UI5_IF_APP"]["z2ui5_if_app$version"]`, nicht `.version`.

### Erkenntnisse Phase 2

**Der geplante fetch-ICF-Shim entfällt — das war der falsche Weg.**
`z2ui5_cl_ui5_http_handler` hat mit `_main( is_req )` eine *öffentliche
Klassenmethode*, die eine schlichte Struktur (`method`, `body`, `path`,
`t_params`) nimmt und eine schlichte Struktur (`body`, `status_code`,
`status_reason`) zurückgibt. Der ganze `if_http_server`-Apparat existiert nur,
um genau diese beiden Strukturen zu füllen und zu leeren. Statt ihn
nachzubauen, ruft `zcl_pg_bridge` die Methode direkt auf — 40 Zeilen ABAP
statt einer Fake-ICF-Schicht.

Was dabei wegfällt, fällt zu Recht weg: Kompression, Stateful-Sessions und der
`sap-contextid`-Header-Tanz haben auf einer statischen Seite keine Bedeutung,
und die CSRF-Prüfung existiert, um Cross-Origin-POSTs abzuweisen — hier
verlässt die Anfrage den Browser nie.

**Strukturen aus JavaScript zu *lesen* ist einfach, sie zu *bauen* nicht.**
Deshalb nimmt die Brücke einen String und gibt eine Struktur zurück:
`res.get().body.get()`. Umgekehrt hätte man `abap.types.Structure` von Hand
zusammensetzen müssen.

**Der App-Klassenname kommt aus der URL-Query**, nicht aus einem eigenen
JSON-Feld: das Frontend schickt `S_FRONT.SEARCH`, und
`z2ui5_cl_ui5_handler=>request_app_start` liest daraus `app_start`. Für den
iframe heißt das: `?app_start=<KLASSE>` an die iframe-URL hängen, sonst nichts.

**Eine transpilierte globale Klasse ist selbstgenügsam** — kein Import, kein
Export, sie liest `abap` aus dem globalen Scope und trägt sich am Ende selbst
in `abap.Classes` ein. Für Phase 5 heißt das: der live transpilierte
Nutzercode lässt sich mit `new Function("abap", src)` laden und erneut laden.
Ein Blob-URL-Import wäre hier sogar schädlich, weil der Browser Blob-Module für
die Lebensdauer der Seite cacht und ein zweites „Run" die alte Fassung
registrieren würde.
