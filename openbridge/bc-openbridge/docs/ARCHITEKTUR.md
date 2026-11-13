# Architektur

## Komponenten

```
src/
├─ main.ts                 Start, Graceful Shutdown
├─ app.ts                  Request-Pipeline und Routen
├─ config.ts               Konfiguration aus ENV (+ *_FILE-Secrets), fail closed
├─ http/                   Router, Body-Parsing, RFC 9457, Idempotency-Key
├─ security/               JWT/OIDC, API-Keys, Scopes, Rate Limit, Audit, SSRF, Cursor
├─ bc/                     Entra-Token, BC-HTTP-Client, Entity-Registry, OData-Übersetzung
├─ api/service.ts          protokollunabhängige Geschäftslogik (REST & MCP nutzen sie gemeinsam)
├─ spec/                   OpenAPI 3.1 und AsyncAPI 3.0 aus dem Registry
├─ events/                 CloudEvents, Event-Bus + Zustellung, Standard Webhooks, BC-Abos
├─ mcp/                    Model-Context-Protocol-Server
├─ observability/          JSON-Logs, Prometheus-Metriken, W3C Trace Context
└─ mock/                   Business-Central-Mock für Entwicklung und Tests
bc-extension/              AL-App: Custom APIs + Kontroll-Ebene in Business Central
```

## Request-Pipeline

```
Trace Context → Security-Header → CORS → IP-Rate-Limit → Routing → Authentifizierung
→ Principal-Rate-Limit → Handler → Service (Scopes, Mandant, Validierung, Audit)
→ BC-Client (Token, Retry, ReadOnly-Intent, ETag) → Projektion → Antwort / RFC 9457
```

## Ein Registry, viele Schnittstellen

[src/bc/entities.ts](../src/bc/entities.ts) ist die einzige Quelle der Wahrheit. Daraus entstehen:

* Eingabevalidierung (Typen, Längen, Enums, Pflichtfelder, Schreibschutz)
* erlaubte Filter-/Sortierfelder und typisierte OData-Literale
* Ausgabe-Projektion (nur registrierte Felder verlassen das Gateway)
* OpenAPI-Schemas und -Pfade, AsyncAPI-Kanäle und -Nachrichten
* MCP-Tool-Schemas (Entitäts-Enums) und Scope-Namen (`bc.<entitySet>.read|write`)

Neue Entität = ein Registry-Eintrag (bei Custom APIs plus AL-API-Page mit passendem `apiRoute`).

## Datenfluss Änderungsereignisse

```
BC-Datensatz ändert sich
  → BC sendet Notification an POST /webhooks/bc   (Abo via /subscriptions, Handshake mit validationToken)
  → clientState geprüft, Ressource geparst, Entität/Mandant geprüft
  → CloudEvent 1.0 (deterministische id → Deduplizierung)
  → Event-Feed (GET /v1/events)  +  Zustellung an passende Abonnenten
       (Typ-Muster, Mandantenfilter, HMAC-Signatur, Retries, Dead-Letter)
```

Events sind bewusst **„thin“**: Sie enthalten Referenzen (`data.href`), keine Geschäftsdaten.
Empfänger laden Details über die REST-API – mit ihren eigenen Rechten. So gelangen keine Daten an
Empfänger, die sie nicht lesen dürften, und Events bleiben klein.

## Abbildung auf die Business-Central-API

| Gateway | Business Central |
|---|---|
| `GET /v1/companies/{c}/customers?filter.city=Berlin&limit=50` | `GET …/api/v2.0/companies({c})/customers?$filter=city eq 'Berlin'` + `Prefer: odata.maxpagesize=50` + `Data-Access-Intent: ReadOnly` |
| `cursor=<AES-GCM>` | `@odata.nextLink` (`$skiptoken`) |
| `PATCH … If-Match: W/"…"` | `PATCH …(id)` mit `If-Match`; `Request_EntityChanged` → 412 |
| Custom-Entitäten | `…/api/openbridge/interop/v1.0/companies({c})/…` (AL-Extension) |
| Events | `POST …/api/v2.0/subscriptions` (Ablauf nach 3 Tagen, automatische Erneuerung) |

## Skalierung

Das Gateway ist zustandsarm. Für mehrere Replikas: gleiches `CURSOR_SECRET`, geteilter Store für
Idempotenz/Rate Limits (Schnittstellen in `http/idempotency.ts`, `security/ratelimit.ts`) und Events
an einen Broker statt In-Memory-Feed. BC-Abos sollte nur eine Instanz verwalten (Leader oder separater Job).
