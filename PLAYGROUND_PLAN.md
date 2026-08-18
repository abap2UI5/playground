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

Ziel: Links ein Editor mit VS-Code-Gefühl — Live-Diagnostik, Hover,
Go-to-Definition, Rename, Pretty Printer — gegen die echten
Framework-Definitionen.

- [x] **P4.1 Monaco einbetten.** `src/editor/editor.mjs`: Monaco aus npm,
  ABAP-Grammatik aus `monaco-editor/languages/definitions/abap`, Theme folgt
  `prefers-color-scheme`. Monacos eigene Worker werden bewusst nicht gebaut
  (siehe Erkenntnisse).
  *Abnahme:* Test — Editor rendert den Beispielcode mit Highlighting.
- [x] **P4.2 abaplint-Registry.** *(kein Web Worker — siehe Erkenntnisse.)*
  `src/editor/registry.mjs` baut eine Registry mit den **Original**-Quellen
  von abap2UI5 + open-abap-core als Dependencies (`dist/editor/corpus.json`,
  910 Dateien, 3,8 MB) plus der Nutzerdatei. Syntax-Target v750, Regelsatz
  auf „würde das laufen" beschränkt. Erster Parse über `parseAsync` mit
  Fortschritt, damit die Seite nicht einfriert.
  *Abnahme:* Tests — Syntaxfehler erzeugt Marker in der richtigen Zeile;
  eine Klasse, die nur korrekt aufs Framework zugreift, meldet **nichts**
  (beweist, dass die Registry das Framework kennt); ein nicht existierender
  Klassenname und eine fehlende Methodenimplementierung werden gemeldet.
- [x] **P4.3 @abaplint/monaco verdrahten.** Diagnostik als Marker, Hover,
  Definition, Rename, Referenzen, Symbole, Quick Fixes, semantisches
  Highlighting und der Pretty Printer über `registerABAP( )`.
  Namens-Completion ist **selbst gebaut** — abaplint hat dafür keine API
  (siehe Erkenntnisse).
  *Abnahme:* Tests — Completion schlägt `z2ui5_cl_ui5_view_builder` vor,
  Hover zeigt etwas, Format rückt die Klasse wieder ein.

## Phase 5 — Live-Transpile: der eigentliche Playground-Kern

Ziel: Der Code aus dem Editor läuft nach "Run" rechts als App.

- [x] **P5.1 Downport der Nutzerklasse.** **Entfällt vollständig** — der
  Transpiler versteht modernes ABAP direkt (siehe Erkenntnisse Phase 5).
  *Abnahme:* Test „modern ABAP is compiled without a downport step" —
  `VALUE #( FOR … )`, `COND #`, String-Templates, Inline-Deklarationen und
  Tabellenausdrücke laufen als App.
- [x] **P5.2 Einzelobjekt-Transpile.** `src/editor/transpile.mjs`: Der
  Transpiler bekommt einen Proxy auf die Registry, in dem nur die
  Nutzerklasse existiert. 20 s → **10–50 ms**.
  *Abnahme:* Test — Editor ändern, Run, die neue App rendert.
- [x] **P5.3 Laden + Registrieren.** `defineClass( )` in
  `src/runtime/index.mjs` führt den erzeugten Code mit `new Function` aus
  (kein Blob-Import — der würde gecacht) und leert anschließend die
  Typ-Caches des Frameworks.
  *Abnahme:* Test „a second run replaces the class" — zweiter Run mit
  anderen Attributen rendert korrekt.
- [x] **P5.4 Fehler-UX.** Run ist bei Fehlern blockiert und nennt die Zeile;
  ein falsch benannter Klassenname bekommt eine eigene Meldung statt
  abaplints „must match filename"; eine ABAP-Ausnahme landet im
  Framework-Fehlerbild mit vollem Dump.
  *Abnahme:* drei Tests, je ein Fehlerbild.

## Phase 6 — Playground-UX

Ziel: Aus dem Technik-Demo wird ein Playground, den man verlinken kann.

- [x] **P6.1 Shell-Layout.** Verschiebbarer Splitter (Position bleibt
  gespeichert, auch per Pfeiltasten bedienbar), Toolbar mit Run (Ctrl+Enter),
  Format, Sample-Auswahl und Share, Statuszeile mit Framework-Version.
  Unter 820 px Breite werden aus den beiden Panes Tabs.
  *Abnahme:* Tests — Splitter verschiebt und überlebt einen Reload; schmales
  Fenster zeigt Tabs; zurück auf breit sind wieder beide Panes sichtbar.
- [x] **P6.2 Sample-Galerie.** Sechs Beispiele in `src/editor/samples.mjs`:
  Hello World, Counter, Tabelle mit Mehrfachauswahl, Formular mit
  Validierung, Tabs mit Liste, Bestätigungs-Popup über `nav_app_call`.
  *Abnahme:* `tests/samples.spec.js` fährt **jedes** Sample: laden, laufen,
  bedienen und das in ABAP berechnete Ergebnis prüfen. Die Liste wird aus
  dem Katalog importiert — ein Sample ohne Test ist nicht möglich.
- [x] **P6.3 Share-Links.** `src/shell/share.mjs`: Quelltext deflated und
  base64url-kodiert im URL-Fragment (mit Versionspräfix). Share kopiert den
  Link in die Zwischenablage und schreibt ihn in die Adresszeile.
  *Abnahme:* Test — Link erzeugen, in einem frischen Browser-Kontext öffnen,
  derselbe Code steht im Editor; ein kaputtes Fragment öffnet das Sample
  statt einer Fehlerseite.
- [x] **P6.4 Persistenz.** Editor-Inhalt in `localStorage`; beim Start
  gewinnt ein Share-Link vor dem gespeicherten Entwurf vor dem Sample. Das
  Sample-Menü sagt, woher der Code kommt, statt einen Namen zu behaupten.
  *Abnahme:* Test — Inhalt überlebt Reload, Sample-Auswahl ersetzt ihn.

## Phase 7 — Qualität, CI, Doku

- [x] **P7.1 CI-Gates.** `.github/actions/build` (Composite Action, von
  `check.yml` und `pages.yml` gemeinsam benutzt) installiert, stellt die
  teuren Zwischenstände aus dem Cache her (`deps/`, `~/.ui5`,
  `build/downport`), baut und prüft das Größenbudget
  (`tools/check-size.mjs`). Danach laufen die Tests. Pages deployt erst nach
  grünen Tests.
  *Abnahme:* Lauf auf GitHub grün (~5 min); `npm run check:size` läuft lokal.
- [x] **P7.2 Version-Bump-Prozess.** Im README dokumentiert. Zusätzlich
  `.github/workflows/upstream.yml`: baut und testet **wöchentlich gegen
  Upstream-HEAD**, ohne die Pins anzufassen, und legt bei Fehlschlag ein
  Issue an (bzw. kommentiert das bestehende). `tools/fetch-deps.mjs --latest`
  ist der Schalter dafür.
- [x] **P7.3 Doku.** README mit Screenshot, Architekturdiagramm, „wie es
  funktioniert", **was es nicht kann** (eine Klasse, keine eigene Datenbank,
  nur der Sprachumfang des Transpilers, nur die eingebauten UI5-Bibliotheken)
  und der Landkarte der Build-Scripts. Der Plan hier bleibt die
  Detailbegründung und wird im README verlinkt.
- [x] **P7.4 Ankündigungsreife.** Abgleich mit der ursprünglichen Idee:
  Editor mit abaplint links ✓, App rechts ✓, alles im Browser ✓, als
  GitHub Page ✓. Einzige verbleibende Handlung für einen Menschen:
  Settings → Pages → Source → „GitHub Actions" einschalten.

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

### Erkenntnisse Phase 4

**Kein Web Worker — und das ist keine Bequemlichkeit.** `@abaplint/monaco`
ruft die LanguageServer-Methoden **synchron** in den Monaco-Providern auf; die
Registry muss also im selben Thread liegen. Das Problem war der erste Parse
(~3 s in Node, ~4 s im Browser), der die Seite einfrieren würde. Lösung:
`reg.parseAsync({progress})` — der `tick`-Hook wird **awaited**, also kann man
darin ans Event-Loop zurückgeben. Alle 25 Objekte ein `setTimeout(0)` reicht:
die Seite bleibt bedienbar und zeigt einen Fortschritt. Achtung: das
Progress-Objekt braucht **auch** `tickSync()`, sonst wirft die zweite
Parse-Hälfte (`FindGlobalDefinitions`).

Danach ist alles inkrementell: eine Änderung an der Nutzerdatei kostet
**3–4 ms** für Reparse + Diagnostik, unabhängig von der Korpusgröße.

**`keepNames: true` wird auch im Seiten-Bundle gebraucht.** Ohne das
löst abaplint `z2ui5_if_client` nicht mehr auf und meldet „unable to
resolve" — derselbe Fehlermechanismus wie im Framework-Bundle (Phase 1,
Punkt 2), nur eine Ebene höher. `Buffer` braucht abaplint ebenfalls (beim
Aufbau seiner DDIC-Built-ins).

**abaplint hat keine Completion-API.** `@abaplint/monaco` registriert zwar
einen `CompletionItemProvider`, der liefert aber nur eine Handvoll fester
Snippets (`method`, `bool`, `true`, …) — keine Symbole. Der LanguageServer
kennt `hover`, `gotoDefinition`, `rename`, `references`, `documentSymbol`,
`codeActions`, `documentFormatting`, `semanticTokens` — aber kein
`completion`. Die Namens-Completion im Playground ist deshalb selbst gebaut
und bewusst bescheiden: sie vervollständigt **Objektnamen** aus der Registry,
keine Member. Wer wissen will, wie eine Methode heißt, nimmt Hover oder
Go-to-Definition.

**Der URI muss exakt der Registry-Dateiname sein.** `LanguageServer.diagnostics`
schlägt das Dokument über `reg.getFileByName(uri)` nach. Monacos Model-URI und
der abaplint-`MemoryFile`-Name müssen zeichengleich sein — sonst kommen
stillschweigend null Diagnosen zurück, was wie „alles in Ordnung" aussieht.

**Der Pretty Printer indentet immer**, auch wenn alle Formatierungsregeln aus
sind: `PrettyPrinter` benutzt die Regel-Config nur für Optionen, nicht als
Schalter.

### Erkenntnisse Phase 5

**Der geplante Browser-Downport entfällt ersatzlos.** Der Transpiler versteht
modernes ABAP direkt — getestet mit `VALUE #( FOR i = 1 WHILE … )`, `COND #`,
String-Templates, Inline-`DATA(…)`, Tabellenausdrücken und der
Builder-Kette: 56 ms, keine Beanstandung. Der Downport im *Framework*-Build
bleibt trotzdem, weil er dort erprobt ist und die Bibliothek gegen die
702-Semantik absichert; für Nutzercode ist er überflüssig.

**Der Transpiler transpiliert immer die ganze Registry** — `Transpiler.run(reg)`
läuft über `reg.getObjects()`, und `addDependencies( )` ändert daran nichts:
684 Objekte, **18 Sekunden**. Für einen Run-Button unbrauchbar.

Die Lösung ist ein **Proxy auf die Registry**, in dem `getObjects()` nur die
Nutzerklasse liefert. Entscheidend dabei ist das `this`: Der Proxy gibt
Methoden **ungebunden** zurück (`Reflect.get(target, prop, receiver)`), damit
sie mit dem Proxy als Empfänger laufen. Dadurch iterieren auch `setConfig`
(markiert dirty) und `findIssues` nur über die gefilterte Liste. Bindet man
stattdessen an das Original, markiert jeder Compile den gesamten Korpus dirty
und erzwingt einen 3,5-s-Reparse. Mit korrektem Empfänger: **10–50 ms**.

Der Transpiler **stellt die Config nicht zurück**, die er setzt (anderes
Release, `errorNamespace: VOID_EVERYTHING`). Der Playground setzt sie danach
selbst zurück — ebenfalls über den Proxy, sonst kostet die Rückgabe wieder
einen Vollreparse.

**`Transpiler.run` ist async und lässt sich nicht synchron auspacken.** Ein
erster Versuch, das Promise synchron auszulesen, funktionierte nirgends —
`compile( )` ist jetzt korrekt `async`.

**Der wichtigste Fund der Phase: Typ-Caches sind auf den Klassennamen
geschlüsselt.** Ein zweiter Run mit geänderten Attributen ergab
`BINDING_ERROR - No class attribute for binding found` für ein Attribut, das
sichtbar im Quelltext stand. Ursache: `cl_abap_objectdescr=>mt_cache` (RTTI,
open-abap) und die `mt_attri_cache`/`mt_bool_cache` in
`z2ui5_cl_ui5_util_context` beschreiben nach dem Neu-Definieren noch die
*alte* Fassung der Klasse.

`defineClass( )` leert deshalb nach jedem Laden alle statischen Attribute,
deren Name `cache` enthält — **generisch statt per Liste**, weil eine Liste
veraltet, sobald abap2UI5 einen Cache hinzufügt. Ein unnötig geleerter Cache
kostet einen Neuaufbau; ein übersehener kostet einen Fehler, den niemand
erklären kann.

**Eine transpilierte Klasse wird mit `new Function` geladen, nicht als
Blob-Modul**: Blob-URLs cacht der Browser für die Lebensdauer der Seite, ein
zweiter Run würde die erste Fassung erneut registrieren.

### Erkenntnisse Phase 6

**Ein Aggregation-Element braucht den Namensraum seines Containers.** Das
Formular-Sample scheiterte zunächst mit
`failed to load 'sap/m/content.js'` — UI5 suchte ein Control namens
`content` in `sap.m`, weil `ele( \`content\` )` unter einem
`form:SimpleForm` ohne Präfix landete. Richtig ist
`ele( n = \`content\` ns = \`form\` )`. Der Fehler ist kein Renderfehler,
sondern ein **Ladefehler** — die App terminiert, statt schief auszusehen.

**Tests gegen UI5 brauchen die Control-Wurzel, nicht das Input-Element.** Eine
Checkbox in einer Tabelle rendert ein verstecktes `<input>` hinter einem
gestylten Kasten; anklickbar ist `[id$='-selectMulti']`, nicht `…-CB`.

**Die Statuszeile allein ist kein Synchronisationspunkt.** Nach einem
Sample-Wechsel steht dort noch „running" von der vorigen App, während die
neue kompiliert — eine Prüfung kann dann gegen die App laufen, die gerade
ersetzt wird. `tests/helpers.mjs` wartet deshalb darauf, dass sich das `src`
des iframes ändert (der Run-Zähler steckt darin).

**Ein Tab-Wechsel darf im Breitbild nichts verstecken.** Die erste Fassung
von `show( )` setzte `hidden` bedingungslos, sodass die Auswahl eines Samples
auf einem großen Bildschirm den Editor ausblendete. `show( )` prüft jetzt die
Media Query und ordnet im Breitbild nur die Tab-Markierung.

**Share-Links sind klein genug.** Ein Sample von ~2500 Zeichen wird als
`deflate-raw` + base64url zu unter 700 Zeichen — ABAP komprimiert
hervorragend. Der Code steht im **Fragment**, verlässt den Browser also nie.

### Erkenntnisse Phase 7

**Was ein Besucher wirklich lädt: ~3 MB komprimiert.** Aufgeschlüsselt
(`npm run check:size`):

| | komprimiert | roh |
|---|---|---|
| `assets/shell.mjs` (Monaco, abaplint, Transpiler) | 1,33 MB | 5,73 MB |
| `runtime/framework.mjs` (abap2UI5 + open-abap) | 0,80 MB | 8,51 MB |
| `editor/corpus.json` (ABAP-Quellen für den Editor) | 0,60 MB | 3,80 MB |
| `runtime/sql-wasm.wasm` | 0,31 MB | 0,63 MB |

Die veröffentlichte Seite ist mit **127 MB** deutlich größer — das ist fast
ausschließlich UI5, das bedarfsgesteuert nachgeladen wird. Seitengröße und
Transfergröße sind hier zwei verschiedene Dinge, und das Budget in
`tools/check-size.mjs` misst beide getrennt.

**Der CI-Lauf dauert etwa 5 Minuten** — inklusive Downport, Transpile,
UI5-Build und 39 Browser-Tests. Ohne Caches wären es eher zehn.

**Die Testsuite hat sich zweimal bezahlt gemacht**, an Stellen, die kein
Lint gefunden hätte: der fehlende Namensraum an einer Aggregation (die App
terminiert beim Laden, nicht beim Rendern) und die Typ-Caches nach einem
zweiten Run. Beides wäre einem Menschen erst beim Benutzen aufgefallen.
