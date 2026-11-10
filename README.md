# bc-claude

**MCP-Server, mit dem Claude Business Central bedient** – über das [BC-OpenBridge-Gateway](../bc-openbridge).

Das Gateway ist für *alle* Systeme gebaut und bietet generische, standardkonforme Schnittstellen.
bc-claude ist die Schicht daneben, zugeschnitten auf die Arbeitsweise eines KI-Assistenten:

| Für Claude gebaut | Warum |
|---|---|
| **Orientierung zuerst** (`bc_overview`) | ein Aufruf liefert Firmen, Entitäten, Felder und die eigenen Rechte |
| **Aufgaben- statt Tabellen-Werkzeuge** (`bc_customer_overview`, `bc_open_items`) | eine Frage = ein Aufruf; aggregiert, mit Kennzahlen und Stichtag |
| **Nachsichtige Eingaben** | Firmenname statt GUID, „Customer“ statt „customers“, Firma weglassbar wenn eindeutig, Kundennummer oder Name statt ID |
| **Kompakte Ausgabe** | Markdown-Tabellen mit sinnvollen Spalten pro Entität statt JSON-Dumps; exakte Werte zusätzlich als `structuredContent` |
| **Zweistufige Änderungen** | `bc_prepare_*` zeigt einen Vorher/Nachher-Plan, erst `bc_apply_change` schreibt |
| **Kein Löschen** | gibt es in bc-claude nicht |
| **Prompt-Injection-Hygiene** | BC-Inhalte stehen in `<bc-data>` und sind als Daten markiert |
| **Keine eigenen Rechte** | alles läuft über das Gateway: Scopes, Validierung, Rate Limits und Audit-Log gelten auch für Claude |

## Werkzeuge

| Werkzeug | Zweck |
|---|---|
| `bc_overview` | Firmen, Entitäten, Rechte, Feldnamen |
| `bc_find` | Debitoren/Kreditoren/Artikel per Namens- oder Nummernteil finden |
| `bc_query` | gefilterte Liste einer Entität (Filter, Felder, Sortierung, Cursor) |
| `bc_get` | ein Datensatz komplett |
| `bc_customer_overview` | Kunde 360°: Stammdaten, Kreditlimit-Auslastung, offene/überfällige Rechnungen, Aufträge, offene Posten |
| `bc_open_items` | Forderungen oder Verbindlichkeiten je Partner, inkl. Überfälligkeit |
| `bc_recent_changes` | zuletzt eingegangene Änderungs-Events |
| `bc_prepare_create` / `bc_prepare_update` | Änderung prüfen und als Plan anzeigen (schreibt nichts) |
| `bc_apply_change` | bestätigten Plan ausführen (ETag-Schutz, Idempotenz) |

Dazu Ressourcen (`bc://guide`, `bc://entities`) und Prompts (`kunden-check`, `offene-posten`, `sichere-aenderung`).

### Warum zweistufig?
* **Sichtbarkeit:** Der Nutzer sieht vor dem Schreiben genau, welche Felder sich von welchem auf welchen Wert ändern.
* **Kein Überschreiben fremder Änderungen:** Der Plan merkt sich das ETag. Hat jemand den Satz inzwischen geändert, lehnt BC ab (412) und nichts wird geschrieben.
* **Keine Dubletten:** Anlagen laufen mit der Plan-ID als `Idempotency-Key`; ein wiederholtes Ausführen legt nichts doppelt an.
* **Ehrliche Grenze:** Die eigentliche Bestätigungsschranke ist die Rechteabfrage von Claude Code für `bc_apply_change` (als *destruktiv* markiert). Dieses Werkzeug deshalb **nicht** dauerhaft freigeben; die Leserwerkzeuge kann man freigeben.

## Einrichtung

**Lokal mit dem BC-Mock** (keine Konfiguration nötig):

```bash
cd bc-openbridge && npm run dev:mock
```

`dev:mock` schreibt einen eigenen Schlüssel für Claude nach `bc-openbridge/.dev-claude-key`
(Scopes `bc.read`, `bc.write`, `events.read` – ohne Löschen, ohne Admin) und löscht ihn beim Beenden.
Die Datei `.mcp.json` im Ordner `NewPriojects` meldet den Server bei Claude Code an; ein Skill unter
`.claude/skills/business-central/` beschreibt Claude den Arbeitsablauf. Nach dem Start von Claude Code
im Ordner `NewPriojects` den Server einmal freigeben.

**Mit einem echten Gateway:**

| Variable | Bedeutung |
|---|---|
| `OPENBRIDGE_URL` | Gateway-URL (https; http nur für localhost) |
| `OPENBRIDGE_API_KEY` oder `OPENBRIDGE_API_KEY_FILE` | eigener API-Key für Claude (wird bei Dateien bei jedem Aufruf neu gelesen) |
| `BC_CLAUDE_READ_ONLY=true` | blendet alle Schreibwerkzeuge aus |

Empfehlung: einen eigenen Key nur für Claude anlegen, mit den kleinsten nötigen Scopes, z. B. nur lesend:

```bash
npm run create-api-key -- --name claude --scopes bc.read,events.read --file api-keys.json
```

Andere MCP-Clients (Claude Desktop o. Ä.) starten den Server genauso: `node bc-claude/src/server.ts` mit den Variablen oben.

## Entwicklung

```bash
npm install
npm run check     # Typecheck + Tests (startet BC-Mock und Gateway aus ../bc-openbridge)
```

Keine Laufzeit-Abhängigkeiten; Node ≥ 24 führt TypeScript direkt aus.
