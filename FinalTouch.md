# Final Touch: BC Atlas CLI auslieferbar machen

Stand: 08.09.2026, Repository-Version `0.5.0`.

Bewertung anhand von Implementierung, Dokumentation, Tests und gezielten Gegenproben. Die TODO-Datei wurde nicht gelesen oder als Grundlage verwendet. Diese Datei ist eine Arbeitsliste; die beschriebenen Änderungen sind noch nicht umgesetzt. Breaking Changes sind ausdrücklich erlaubt.

## Einschätzung

Der Funktionsumfang reicht bereits für einen nützlichen Release: zehn Architekturansichten, D2/JSON/SVG, optional PNG/PDF, Markdown-Codekataloge, Dokumentation aus AL-UI-Tests, Dokumentationspakete, Watch-Modus, Control Center und MCP. Vor dem Release fehlen vor allem sichere Schreiboperationen, ein konsistenter CLI-Vertrag und verlässliche Abläufe für reale Workspaces und CI.

Empfehlung: zuerst die P0-Punkte schließen, anschließend die P1-Punkte für den unten beschriebenen Produktumfang. Zusätzliche Ansichten oder eine neue technische Plattform sind dafür nicht erforderlich. Bestehende Schnittstellen dürfen vereinfacht und vereinheitlicht werden.

## Bereits geprüft

- `npm run check`: erfolgreich, einschließlich `docs:check`.
- `npm test`: **64 von 64 Tests erfolgreich**, keine übersprungenen Tests.
- `npm pack --dry-run --ignore-scripts --json`: erfolgreich; 71 Dateien, etwa 0,84 MB gepackt und 9,75 MB entpackt. Die Prüfungen aus `prepack` wurden zuvor separat ausgeführt.
- Lokale Umgebung: Windows, Node.js `22.22.1`, npm `11.19.0`.
- Zusätzliche Gegenproben liefen ausschließlich mit temporären Beispieldateien.
- Nicht geprüft: frische Installation des gepackten Pakets, tatsächlicher npm-Veröffentlichungsstatus, reale BC-Symbolpakete, große Kundenprojekte, PNG/PDF mit externer D2-Installation und lokale Ausführung auf Linux/macOS.

Die grünen Tests sind eine gute Basis, decken die folgenden Gegenbeispiele aber noch nicht ab.

## P0 — vor einer allgemeinen Auslieferung erledigen

### 01 — Codekatalog ohne Datenverlust erzeugen

- [x] `codegraph` darf ausschließlich eigene erzeugte Dateien ersetzen und entfernen.
- [x] Eingabeordner, Repository-Wurzel, deren Vorfahren und sonstige gefährliche Zielüberschneidungen vor jeder Änderung ablehnen. Symbolische Links und Windows-Junctions bei dieser Prüfung berücksichtigen.
- [x] Verzeichniswechsel mit Rückfall auf den bisherigen Stand absichern; für parallele Aufrufe eindeutige temporäre Verzeichnisse verwenden.

**Befund:** `generateCodeGraph` löscht das komplette Zielverzeichnis mit `fs.rm(..., { recursive: true })` und benennt erst danach das temporäre Verzeichnis um. Eine vorhandene `handwritten.md` im Ausgabeordner wurde in der Gegenprobe tatsächlich gelöscht. Das Ziel wird nicht gegen den Quellordner abgesichert. Ein Fehlschlag beim anschließenden Umbenennen würde außerdem den bisherigen Katalog verlieren.

**Abnahme:** Fremde Dateien bleiben erhalten, veraltete eigene Seiten verschwinden, ein fehlerhafter oder abgebrochener Lauf erhält den letzten vollständigen Katalog. `--output-dir` auf dem Quellordner scheitert vor dem Schreiben.

**Ansatzpunkt:** [src/codegraph.js](src/codegraph.js), `generateCodeGraph`. Die vorhandene Besitzmarkierung und Sicherung beim Docs-Paket in [src/docs/package.js](src/docs/package.js) als Ausgangspunkt prüfen.

### 02 — Metadatenänderungen gegen konkurrierende Bearbeitung absichern

- [x] Den ursprünglichen Dateihash im Änderungsplan behalten und unmittelbar beim Speichern erneut prüfen.
- [x] Schreiboperationen auf derselben Datei innerhalb des Prozesses koordinieren; temporäre Dateinamen dürfen bei parallelen Anfragen nicht kollidieren.
- [x] Bei Konflikten verständlich abbrechen und erneutes Laden verlangen. CLI, HTTP und MCP müssen denselben Schreibpfad verwenden.

**Befund:** `--expected-hash` wird nur in `planMetadataEdit` geprüft. `writeMetadataEdit` ersetzt anschließend die Datei ohne erneuten Vergleich. Gegenprobe: Nach dem Planen einen Kommentar an die AL-Datei angehängt, dann gespeichert — der Kommentar ging verloren. Der temporäre Name enthält nur die Prozess-ID.

**Abnahme:** Eine Änderung zwischen Lesen, Vorschau und Speichern bleibt erhalten; der veraltete Schreibauftrag scheitert. Zwei parallele Bearbeitungen überschreiben sich nicht unbemerkt. Die Grenzen gegenüber gleichzeitig schreibenden externen Editoren müssen klar sein.

**Ansatzpunkt:** [src/docs/al-ui-writer.js](src/docs/al-ui-writer.js), `planMetadataEdit` und `writeMetadataEdit`.

### 03 — Schreibende HTTP-Schnittstelle des Control Centers absichern

- [x] Zulässige Host- und Origin-Werte sowie den JSON-Content-Type prüfen, bevor ein Kommando ausgeführt wird.
- [x] Schreibende Browseranfragen an die gestartete Sitzung binden, beispielsweise mit einem Sitzungstoken.
- [x] Exportziele auf einen beim Start freigegebenen Bereich beschränken; AL-Mutationen nur mit aktuellem Dateihash zulassen.

**Befund:** Der Server bindet korrekt an `127.0.0.1`, prüft aber weder Origin noch Content-Type. Eine lokale HTTP-Gegenprobe mit `Origin: https://example.invalid`, `Content-Type: text/plain` und einem JSON-Kommando erzeugte Dateien und erhielt HTTP 200. Der Aufrufer kann das Ausgabeziel im Request bestimmen. Das belegt die fehlende serverseitige Prüfung; Browser-spezifische Zugriffsschranken wurden nicht getestet.

**Abnahme:** Fremde Origins, unzulässige Hosts, falsche Content-Types und fehlende Schreibberechtigungen werden vor Dateizugriffen abgewiesen. Die normale lokale Oberfläche funktioniert weiterhin.

**Ansatzpunkt:** [src/docs/server.js](src/docs/server.js), `requestJson`, `executeCommand`, `startDocsServer`.

### 04 — Optionen pro Befehl validieren, bevor Seiteneffekte auftreten

- [x] Jeder Befehl akzeptiert nur Optionen, die er tatsächlich ausführt. Unpassende Optionen ergeben Usage-Fehler statt stiller Ignorierung.
- [x] Format, Pflichtargumente, Zahlenbereiche und widersprüchliche Selektoren vollständig vor Analyse und Schreiben validieren.
- [x] `--check`, `--dry-run` und `--strict` eindeutig definieren: implementieren oder für den betreffenden Befehl ablehnen.

**Befund:** Architektur- und Docs-Befehle verwenden jeweils gemeinsame Optionstabellen ohne vollständige Prüfung je Unterbefehl. `docs generate <dir> --check` schrieb in der Gegenprobe einen neuen `index.md` und endete mit 0. `generateCommand` wertet auch `strict` nicht aus. Bei mehreren Docs-Schreibbefehlen wird `outputFormat` erst nach dem Schreiben geprüft.

**Abnahme:** Ein nicht unterstütztes `--check` kann niemals Dateien verändern. `docs generate --format xml` sowie unzulässige Optionskombinationen scheitern ohne Nebenwirkungen. Dies gilt auch für `--procedure` und `--id` zusammen.

**Ansatzpunkt:** [src/cli.js](src/cli.js), [src/docs/cli.js](src/docs/cli.js).

### 05 — Maschinenlesbare Ausgabe und Exitcodes verlässlich machen

- [x] `--format json` in jedem unterstützten Erfolgszweig einhalten; Fortschritt und Statusmeldungen nach stderr verschieben.
- [x] Usage-Fehler durchgehend mit 2, Betriebs-/Validierungsfehler mit 1 und Erfolg mit 0 beenden.
- [x] Architekturdiagnostik auch beim fehlgeschlagenen Strict-Lauf zugänglich machen, etwa als JSON-Bericht oder strukturierte Fehlerausgabe.
- [x] Festlegen, ob `inspect` ausschließlich JSON liefert. Die aktuelle Mehrdeutigkeit mit anderen Formaten beseitigen.

**Befund:** `docs generate --procedure Example --format json` und die Auswahl über `--id` liefern beide erfolgreich `wrote …` als Text. Ungültige Werte wie `inspect --direction diagonal` und `docs list --format xml` ergeben 1 statt des dokumentierten Usage-Codes 2. Strict-Architekturanalyse wirft vor der Berichtsausgabe nur eine zusammengefasste Fehlermeldung. `inspect` wird im Capability-Vertrag als JSON beschrieben, akzeptiert im allgemeinen Parser aber weitere Formate.

**Abnahme:** Alle im Manifest als JSON ausgewiesenen Aufrufe lassen sich mit einem JSON-Parser lesen. Eine Negativmatrix prüft unbekannte Optionen, ungültige Werte, fehlende Dateien, Analysefehler und Schreibfehler. Ein fehlgeschlagener Strict-Lauf benennt die betroffenen Dateien und Diagnosen ohne notwendigen zweiten Analyselauf.

**Ansatzpunkt:** [src/cli.js](src/cli.js), [src/docs/cli.js](src/docs/cli.js), [src/architecture.js](src/architecture.js).

### 06 — Generierte CI-Pipelines müssen den richtigen Inhalt prüfen

- [x] Den gewählten Testpfad in die Pipeline übernehmen und relativ zum Checkout ausdrücken. Nicht portable absolute Pfade verständlich ablehnen oder umrechnen.
- [x] Neue, geänderte und entfernte generierte Dateien erkennen. Bevorzugt einen schreibfreien Inhaltsvergleich verwenden; `docs package --check` existiert bereits.
- [x] Readiness, lokale Befehle und generierte Pipeline auf denselben Corpus und dieselben Validierungsregeln beziehen.

**Befund:** `createAutomationPlan` berechnet lokale Befehle mit `inputPath`, erzeugt die Pipeline jedoch ausdrücklich mit `pipelineCommands(".", ...)`. Die Gegenprobe bestätigt diesen Unterschied. Außerdem erkennt das verwendete `git diff --exit-code` keine unversionierten neuen Dateien. `docs generate` entfernt seinerseits keine veralteten Szenarioseiten.

**Abnahme:** In einem Repository mit mehreren Apps und Testordnern prüft die Pipeline genau den ausgewählten Corpus. Hinzufügen, Umbenennen und Entfernen eines Szenarios lassen die Prüfung jeweils scheitern, solange die eingecheckten Ausgaben veraltet sind.

**Ansatzpunkt:** [src/docs/automation.js](src/docs/automation.js), [src/docs/markdown.js](src/docs/markdown.js), [docs/automation-and-ci.md](docs/automation-and-ci.md).

## P1 — die wesentlichen Anwendungsfälle vervollständigen

### 07 — Einen konsistenten Befehls- und Fähigkeitsvertrag herstellen

- [ ] Hilfe, Optionsvalidierung, `capabilities` und generierte Referenz aus einer gemeinsamen Befehlsbeschreibung ableiten, soweit das die vorhandene Doppelpflege wirklich reduziert.
- [ ] `docs package` und `docs metadata` in `capabilities` aufnehmen; diese ausführbaren Befehle fehlen dort derzeit.
- [ ] Workflow-Entries korrekt als optional beziehungsweise konfigurierbar beschreiben. Das Manifest verlangt sie, die Implementierung kann sie inferieren.
- [ ] Tatsächliche Defaults dokumentieren, insbesondere `Docu/UI` bei `docs package` gegenüber `docs/generated` bei `docs generate`.
- [ ] Pro Unterbefehl kurze Hilfe mit passenden Beispielen liefern; Tippfehler und fehlende Argumente gezielt erklären.

**Abnahme:** Ein Agent kann jeden freigegebenen CLI-Ablauf allein anhand von `capabilities` korrekt aufrufen. Tests vergleichen tatsächliche Befehle, Optionen, Defaults und Ausgaben; bloße Vorkommen von Optionsnamen in der Referenz reichen nicht.

**Ansatzpunkt:** [src/capabilities.js](src/capabilities.js), [test/cli.test.js](test/cli.test.js), [docs/cli-reference.md](docs/cli-reference.md).

### 08 — Docs-Generierung, Paket und Validierung vereinheitlichen

- [ ] Festlegen und dokumentieren, wann ein einzelner Guide, ein einfacher Katalog oder ein verteilbares Dokumentationspaket erzeugt wird. Überflüssige Varianten dürfen zusammengelegt werden.
- [ ] Gemeinsame Regeln für Klassifikationen, Titel, IDs, Links, Warnungen und Fehler in CLI, MCP und Control Center verwenden.
- [ ] Berechnete und explizite IDs sowie Dateinamen zwischen `generate`, `package`, Navigation und Automation konsistent behandeln.
- [ ] Besitzmarkierung, Entfernen veralteter eigener Seiten und `--check` für den empfohlenen Katalogablauf bereitstellen.

**Befund:** Die CLI-Validierung ergänzt `guidePolicyDiagnostics`; MCP- und HTTP-Validierung lesen bislang direkt den Corpus. Paketgenerierung hat einen weiteren Validierungsweg. `docs package` besitzt bereits deterministische ZIPs, einen schreibfreien Check und den Erhalt fremder Dateien; der einfache Markdown-Writer schreibt dagegen fortlaufend einzelne Dateien und bereinigt keine alten Seiten. Die Automation verlangt explizite IDs, obwohl das Paket auch berechnete IDs verwendet.

**Abnahme:** Derselbe Corpus erhält über alle Schnittstellen dieselben relevanten Diagnosen. Ein Szenario kann hinzugefügt, umbenannt, verlinkt und entfernt werden, ohne verwaiste Seiten oder widersprüchliche Links zu hinterlassen.

**Ansatzpunkt:** [src/docs/cli.js](src/docs/cli.js), [src/docs/package.js](src/docs/package.js), [src/docs/markdown.js](src/docs/markdown.js), [src/mcp.js](src/mcp.js), [src/docs/server.js](src/docs/server.js).

### 09 — Konfiguration und Pfadregeln verbindlich machen

- [ ] Konfiguration einschließlich verschachtelter Workflow- und Policy-Werte typisieren und unbekannte Schlüssel ablehnen.
- [ ] Eine eindeutige Basis für relative Konfigurationspfade festlegen und umsetzen, vorzugsweise den Ordner der Konfigurationsdatei.
- [ ] Vorrang von CLI gegenüber Konfiguration auch für Listen, verschachtelte Werte und boolesche Optionen vollständig definieren. Konfigurierte Flags müssen auf der CLI wieder ausschaltbar sein.
- [ ] Für Einzeldatei, App-Wurzel, Unterordnerfokus und Multi-App-Workspace erklären, wo `.bca.json` gesucht wird; die effektiv verwendete Konfiguration leicht sichtbar machen.

**Befund:** `loadConfig` prüft nur, ob das JSON-Wurzelelement ein Objekt ist. `{ "strcit": true }` wird nachweislich ohne Fehler akzeptiert. Relative Pfade werden an mehreren Stellen mit `path.resolve` gegen das Arbeitsverzeichnis aufgelöst. Die CLI stellt für viele positive Flags keinen Gegenwert bereit.

**Abnahme:** Tippfehler scheitern mit Angabe des Schlüssels. Ein Projekt lässt sich aus einem anderen Arbeitsverzeichnis mit derselben Konfiguration korrekt ausführen. Pfade mit Leerzeichen und Umlauten funktionieren.

**Ansatzpunkt:** [src/config.js](src/config.js), [src/architecture.js](src/architecture.js), [.bca.example.json](.bca.example.json).

### 10 — Symbolauflösung für reale Multi-App-Projekte absichern

- [ ] Paketversionen anhand von App-Identität und Abhängigkeiten auswählen; doppelte Caches und mehrere Versionen derselben App eindeutig behandeln.
- [ ] Workspace-Quellen gegenüber mitgeladenen Symbolen derselben App priorisieren und echte Mehrdeutigkeit sichtbar melden.
- [ ] Einen externen Symbolcache explizit angeben können, wenn er nicht unter der analysierten Wurzel liegt.
- [ ] Für Call-/Workflow-Analysen entscheiden, welche externen Memberinformationen aus Symbolen erforderlich sind; benötigte Signaturen übernehmen und verbleibende Auflösungsgrenzen kennzeichnen.

**Befund aus dem Code:** Der Loader nimmt alle `.app`-Dateien unter gefundenen `.alpackages` auf. Objektschlüssel enthalten App-ID, Namespace, Typ und Objektidentität, aber keine Version. Der Resolver filtert Kandidaten nach App/Namespace/Abhängigkeits-ID, ohne Paketversionsauswahl. Externe Symbole erhalten derzeit leere `procedures`- und `fields`-Listen. Vorhandene Multi-App-Tests sind hilfreich, ersetzen aber keine Gegenprobe mit mehreren Cache-Versionen und echten Symbolpaketen.

**Abnahme:** Ein Workspace mit zwei Apps, gemeinsamer Abhängigkeit, doppeltem Cache und zwei Paketversionen liefert eindeutige reproduzierbare Ziele oder konkrete Konfliktdiagnosen. Fehlende externe Member werden nicht als sicher aufgelöste Calls dargestellt.

**Ansatzpunkt:** [src/symbols.js](src/symbols.js), [src/resolver.js](src/resolver.js), [test/analyzer.test.js](test/analyzer.test.js).

### 11 — Aussagekraft der Analyse an realistischen AL-Fällen nachweisen

- [ ] Eine dokumentierte Abdeckungsmatrix für die zugesagten Objekttypen und Beziehungen anlegen und mit repräsentativen Fixtures absichern.
- [ ] Schwerpunktfälle: Erweiterungen, Events, Interfaces/Enums, überladene Aufrufe, temporäre Records, Report/Query/XMLport-Datenzugriffe, Berechtigungen und TestPage-Abläufe.
- [ ] Präprozessorbedingungen eindeutig behandeln: entweder aktive Defines auswerten oder alternative Zweige ausdrücklich als bedingte statische Sicht darstellen.
- [ ] Für unbekannte oder dynamische Ziele nachvollziehbare Diagnosen und Evidenz liefern. Nicht unterstützte Syntax darf keine scheinbar vollständige Analyse ergeben.
- [ ] Bei UI-Guides gemeinsame Helper-Codeunits und Handler-Funktionen prüfen; nicht auflösbare Nutzeraktionen konkret melden. Lokale Helper sind bereits unterstützt.

**Abnahme:** Die Fixtures prüfen erwartete Beziehungen und bewusst nicht behauptete Beziehungen. Zusätzlich mindestens ein repräsentatives größeres AL-Projekt sowie ein realitätsnahes UI-Testprojekt fachlich gegenprüfen. Dokumentation trennt statische Ableitung von tatsächlicher Testausführung; ein eigener BC-Test-Runner ist für diesen Release nicht erforderlich.

**Ansatzpunkt:** [src/analyzer.js](src/analyzer.js), [src/call-analysis.js](src/call-analysis.js), [src/workflow.js](src/workflow.js), [src/docs/al-ui-source.js](src/docs/al-ui-source.js).

### 12 — Watch-Modus auf alle tatsächlichen Eingaben beziehen

- [ ] Die effektiv aufgelöste Projektwurzel beobachten, auch wenn sie aus der Konfiguration stammt.
- [ ] Explizite Konfigurationsdateien und verwendete Symbolpakete in die Änderungsüberwachung aufnehmen.
- [ ] Anlegen, Löschen, Umbenennen und Editor-Speichervorgänge zuverlässig behandeln; eigene Ausgaben und irrelevante Verzeichnisse ausnehmen.
- [ ] Abbruch, Watcher-Fehler und Wiederanlauf nach einem temporären Parse-/Renderfehler testen. Den letzten gültigen Export erhalten.

**Befund:** `watch` verwendet nur `values["project-root"] ?? input` als Watch-Wurzel. Der Änderungsfilter akzeptiert AL, `app.json` und exakt `.bca.json`; Änderungen an einem anders benannten `--config` und an `.app`-Paketen lösen keinen Neuaufbau aus. Dedizierte Watch-Verhaltenstests fehlen in der bestehenden Suite.

**Abnahme:** Änderung an einer außerhalb des Fokus liegenden Workspace-Abhängigkeit, an der expliziten Konfiguration oder an einem Symbolpaket aktualisiert das Ergebnis. Nach einem fehlerhaften Zwischenspeichern funktioniert der nächste gültige Lauf wieder.

**Ansatzpunkt:** [src/cli.js](src/cli.js), `watch`.

### 13 — Exporte reproduzierbar und bei Fehlern stabil halten

- [ ] D2 und gerendertes Ergebnis gemeinsam vorbereiten und erst nach erfolgreichem Rendering veröffentlichen.
- [ ] Für maschinenlesbare Artefakte einen portablen Pfadvertrag festlegen. Absolute lokale Wurzeln nur ausgeben, wo sie als Laufzeitkontext benötigt werden.
- [ ] Stabile Sortierung und IDs über Betriebssysteme und Checkout-Pfade hinweg prüfen; Schemaänderungen versionieren.
- [ ] Fehlende externe D2-Installation, fehlgeschlagenes Rendering, lange Laufzeiten und Abbruch mit einem kontrollierten Fehler behandeln.
- [ ] Begrenzte Diagramme müssen erkennbar gekürzt sein; vorhandene Trunkierungsangaben zwischen JSON, D2 und Statusausgabe abstimmen.

**Befund:** `build` schreibt D2 vor dem Rendern direkt ins endgültige Ziel. JSON enthält absolute Werte wie `root`, `projectRoot` und `selectedPath`. Mehrere Sortierungen verwenden `localeCompare`. Für D2-Subprozesse und WASM-Rendering ist kein eigener Laufzeitgrenzwert vorgesehen. Das sind konkrete Ansatzpunkte; betriebssystemübergreifende Abweichungen wurden lokal nicht gemessen.

**Abnahme:** Zwei identische Läufe ergeben identische veröffentlichbare Artefakte. Vergleichsläufe aus unterschiedlichen Checkout-Pfaden und auf den unterstützten Betriebssystemen bestehen. Ein Renderfehler hinterlässt keinen gemischten alten/neuen Exportstand.

**Ansatzpunkt:** [src/cli.js](src/cli.js), [src/svg.js](src/svg.js), [src/codegraph.js](src/codegraph.js), [src/d2.js](src/d2.js).

### 14 — Das tatsächlich auszuliefernde Paket testen

- [ ] Ein echtes npm-Tarball erzeugen und in einer sauberen Umgebung mit Produktionsabhängigkeiten installieren.
- [ ] Die installierten Befehle `bca` und `bca-mcp` aufrufen, einschließlich SVG, Docs-Paket, Codekatalog und Control-Center-Assets.
- [ ] Die unterstützten Node-Versionen verbindlich festlegen und mit CI, Docker, README und erzeugten Pipelines abgleichen. Die im Publish-Workflow verwendete Version 24 in die relevante Prüfung aufnehmen.
- [ ] PNG/PDF entweder mit externer D2-Installation testen oder klar als separat zu erfüllende optionale Funktion ausweisen.
- [ ] Release-Notizen, Paketversion und Schema-/CLI-Migration auf den finalen Umfang aktualisieren.

**Befund:** Eine Windows/Linux/macOS-CI-Matrix, `prepack`, ein Docker-Job und ein Publish-Workflow sind bereits vorhanden. Die Paketprüfung bleibt jedoch bei `npm pack --dry-run`; der Docker-Smoke-Test prüft nur `--version`. Tests im Checkout beweisen nicht, dass alle benötigten Assets und Laufzeitabhängigkeiten beim Nutzer verfügbar sind.

**Abnahme:** Ein Installations-Smoke-Test außerhalb des Repositories besteht ohne Dev-Abhängigkeiten und ohne Zugriff auf Checkout-Dateien. Der Release verwendet genau das getestete Artefakt. Eine Veröffentlichung selbst gehört nicht zu dieser Bestandsaufnahme.

**Ansatzpunkt:** [package.json](package.json), [.github/workflows/ci.yml](.github/workflows/ci.yml), [.github/workflows/publish-npm.yml](.github/workflows/publish-npm.yml), [Dockerfile](Dockerfile), [CHANGELOG.md](CHANGELOG.md).

### 15 — Laufzeitgrenzen mit größeren Projekten messen

- [ ] Für einen kleinen, mittleren und großen AL-Workspace Laufzeit, Speicher und Modellgröße von `inspect`, SVG und Codekatalog messen; Messumgebung festhalten.
- [ ] Docs-Dateisuche auf relevante Verzeichnisse beschränken. Sie läuft derzeit rekursiv auch durch Verzeichnisse, die die Architekturanalyse ausnimmt.
- [ ] Beim Paketlesen nur benötigte ZIP-Einträge dekomprimieren und sinnvolle Größenlimits vorsehen, sofern reale Pakete die aktuellen Speichergrenzen zeigen.
- [ ] Lange Analysen mit sparsamen Statusmeldungen auf stderr sichtbar machen; Caching erst nach Messung einführen.

**Befund:** Architektur und Docs werden jeweils vollständig neu analysiert; `loadSymbolPackages` dekomprimiert mit `unzipSync` zunächst das gesamte Archiv. Ein belastbarer Performance-Nachweis ist im geprüften Stand nicht enthalten. Ein konkretes Laufzeitproblem wurde hier nicht gemessen.

**Abnahme:** Dokumentierte, auf der Referenzmaschine reproduzierbare Laufzeit- und Speicherbudgets bestehen für die vereinbarte Projektgröße. Große oder defekte Eingaben enden kontrolliert statt mit unverständlichem Prozessabbruch.

**Ansatzpunkt:** [src/analyzer.js](src/analyzer.js), [src/symbols.js](src/symbols.js), [src/docs/model.js](src/docs/model.js).

## Abnahmematrix für den Release

| Nutzerziel | Verbindlicher Ablauf | Nachweis |
| --- | --- | --- |
| Neues AL-Projekt verstehen | Installieren → Projekt-SVG → Modul-/Objektfokus | Ohne globale D2-Installation; hilfreiche Fehler bei ungültigem Input |
| Auswirkungen einer Änderung verstehen | Call-Ansicht mit Richtung/Tiefe, Boundary-Ansicht, Workflow-Entry | Erwartete eingehende/ausgehende Beziehungen, Evidenz und sichtbare Unsicherheit |
| Daten, Events und Berechtigungen prüfen | Data-, Events-, Contracts- und passende Objektansicht | Fachlich geprüfte Beziehungen auf repräsentativen AL-Fixtures |
| Multi-App-Lösung untersuchen | Workspace als `projectRoot`, Unterordner als Fokus, Symbolcache laden | Richtige App-/Paketidentitäten und nachvollziehbare externe Grenzen |
| Codekatalog pflegen | Generieren → Quelle ändern/umbenennen/löschen → erneut generieren | Gültige relative Links, keine fremden Dateiverluste, keine veralteten eigenen Seiten |
| Anleitungen aus UI-Tests liefern | List/Show → Validate → Generate oder Package → ZIP/Check | Konsistente IDs und Diagnosen; nachvollziehbare Nutzeraktionen |
| AL-Metadaten bearbeiten | Lesen → Dry-run → Schreiben mit Hash | Ausführbarer AL-Code bleibt erhalten; konkurrierende Änderungen werden erkannt |
| Architektur und Docs in CI prüfen | Strict-Analyse und schreibfreier Aktualitätsvergleich | Korrekte Exitcodes; neue, geänderte und entfernte Artefakte erkannt |
| Lokal kontinuierlich arbeiten | Watch bzw. Serve starten → Dateien ändern → beenden | Verlässlicher Neuaufbau, sichere lokale Schreibzugriffe, sauberer Prozessabbruch |
| Mit Agenten automatisieren | Capabilities lesen → JSON-Abfrage/MCP-Aufruf → Export | Vollständiger Vertrag, parsebare Antworten und gemeinsame fachliche Regeln |

## P2 — sinnvoll, aber kein Grund den Release aufzuhalten

- [ ] `init` für eine kleine gültige `.bca.json`, falls die Beispieldatei für den Einstieg nicht genügt.
- [ ] `doctor` für Pfade, Symbolcache, Konfiguration und optionales D2; erst einführen, wenn die P1-Diagnostik diese Informationen nicht ausreichend liefert.
- [ ] Shell-Completion, `--quiet` und gezielte Diagnosefilter nach Stabilisierung des Befehlsvertrags.
- [ ] Ein gemeinsamer Batch-Aufruf für mehrere Ansichten, sobald wiederholte Analyse messbar stört.
- [ ] Vergleich zweier Architekturmodelle oder Diagnose-Baselines für große Bestandsprojekte, wenn Strict-CI sonst nicht praktikabel eingeführt werden kann.

Nicht Bestandteil dieses Abschlusses: zusätzliche Diagrammsprachen, Cloud-Backend, Datenbank, Plugin-System, KI-generierte Fachtexte oder ein eigener Business-Central-Test-Runner.

## Empfohlene Reihenfolge

1. **Schreibsicherheit:** 01–03. Daten und lokale Schreibzugriffe absichern.
2. **CLI- und CI-Vertrag:** 04–09. Optionen, JSON, Diagnose, Konfiguration und Docs-Abläufe vereinheitlichen.
3. **Reale Projekte:** 10–13 und 15. Symbolauflösung, fachliche Abdeckung, Watch, Export und Projektgröße prüfen.
4. **Release:** 14 und die vollständige Abnahmematrix mit dem gepackten Artefakt durchführen.

**Freigabekriterium:** Alle P0-Punkte geschlossen, die zugesagten P1-Anwendungsfälle nachgewiesen, bekannte Grenzen dokumentiert und Installation sowie Kernabläufe mit dem tatsächlichen Release-Paket geprüft. Die bereits bestehenden Features werden dabei gezielt gehärtet; neue Komfortfunktionen bleiben nachrangig.
