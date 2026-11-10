# BC OpenBridge

**Interoperabilitäts-Gateway für Microsoft Dynamics 365 Business Central.**
Macht Business Central über offene Standards für beliebige Systeme bedienbar – ERP-fremde
Anwendungen, Integrationsplattformen, Datenplattformen, Low-Code-Tools und KI-Agenten – und
setzt dabei eine durchgängige Sicherheitsarchitektur (Zero Trust, Least Privilege, Audit) durch.

```
 Clients (REST · OpenAPI-SDKs · Power Platform · iPaaS · KI-Agenten via MCP)
        │  OAuth 2.0/OIDC-JWT oder API-Key · Scopes · Rate Limits
        ▼
 ┌───────────────────────── BC OpenBridge ─────────────────────────┐
 │ REST /v1 (OpenAPI 3.1) · MCP /mcp · Events /v1/events · AsyncAPI │
 │ Validierung · OData-Übersetzung · Cursor · ETag · Idempotenz     │
 │ Audit-Hash-Kette · Metriken · Trace Context · RFC 9457           │
 └───────┬─────────────────────────────────────────────▲───────────┘
         │ OAuth 2.0 Client Credentials (Secret/Zertifikat)   │ Webhooks (clientState)
         ▼                                             │
 Business Central API v2.0  +  OpenBridge-AL-Extension (api/openbridge/interop/v1.0)
         │
         └──► CloudEvents 1.0, signiert nach Standard Webhooks ──► Abonnenten / Broker
```

## Offene Standards

| Bereich | Standard | Wofür |
|---|---|---|
| API-Beschreibung | **OpenAPI 3.1** (`/openapi.json`), JSON Schema 2020-12 | Client-Generierung (Kiota, openapi-generator, NSwag), Power-Platform-Connector, API-Management |
| Event-Beschreibung | **AsyncAPI 3.0** (`/asyncapi.json`) | Dokumentation & Codegen für ereignisgetriebene Konsumenten |
| Events | **CloudEvents 1.0** (CNCF) | herstellerneutrales Event-Format, 1:1 auf Kafka/AMQP/MQTT/NATS abbildbar |
| Webhook-Signaturen | **Standard Webhooks** (HMAC-SHA256) | Empfänger prüfen Echtheit und Replay mit Standardbibliotheken |
| KI-Agenten | **Model Context Protocol** (Streamable HTTP, JSON-RPC 2.0) | Claude, Copilot & Co. bedienen BC sicher über Tools |
| Authentifizierung | **OAuth 2.0 / OIDC**, RFC 6750, RFC 7519/8725 (JWT BCP), **RFC 9728** (Protected Resource Metadata) | Anbindung an jeden IdP (Entra ID, Keycloak, Okta …), Auto-Discovery |
| Upstream-Auth | OAuth 2.0 Client Credentials, **RFC 7523** (private_key_jwt) | zertifikatsbasiert ohne geteiltes Geheimnis |
| Fehler | **RFC 9457** Problem Details | einheitliche, maschinenlesbare Fehler |
| Nebenläufigkeit | ETag / If-Match / If-None-Match (RFC 9110), **RFC 6585** (428) | Schutz vor Lost Updates |
| Wiederholungen | **Idempotency-Key** (IETF-Draft) | sichere Retries für POST |
| Partielle Updates | **JSON Merge Patch** (RFC 7396) | `PATCH` mit `application/merge-patch+json` |
| Paging | **RFC 8288** `Link: rel="next"` + opake Cursor | einfache, sichere Paginierung |
| Tracing | **W3C Trace Context** | durchgängige Korrelation Client → Gateway → BC → Events |
| Metriken | Prometheus / OpenMetrics (`/metrics`) | Betrieb & Alarmierung |
| Rate Limits | `RateLimit-*` / `Retry-After` | Client-seitiges Backoff |
| Lieferkette | **CycloneDX SBOM** (`npm run sbom`) | Software-Stückliste |

## Sicherheitsmerkmale (Kurzfassung)

* **Keine Laufzeit-Abhängigkeiten** – nur Node.js-Standardbibliothek → minimale Supply-Chain-Angriffsfläche.
* **Authentifizierung:** OIDC-JWTs (nur asymmetrische Algorithmen, Schlüssel ausschließlich aus JWKS, iss/aud/exp/nbf-Prüfung) oder API-Keys (256 bit, nur SHA-256-Hash gespeichert, Vergleich in konstanter Zeit, Ablaufdatum).
* **Autorisierung:** feingranulare Scopes (`bc.read`, `bc.customers.write`, `bc.delete`, `events.read`, `mcp.use`, `admin` …) plus Mandanten-Allowlist.
* **Keine OData-Injection:** Clients senden nie rohes OData; Filter werden gegen ein Feld-Registry typgeprüft und escaped.
* **Ein- und Ausgabe-Allowlist:** unbekannte/schreibgeschützte Felder werden abgelehnt, Antworten enthalten nur registrierte Felder.
* **Verschlüsselte Cursor** (AES-256-GCM), an Principal/Entität/Mandant gebunden – keine Tenant-Infos nach außen, kein SSRF über nextLinks.
* **Webhook-Sicherheit:** eingehend `clientState` (konstante Zeit), ausgehend Standard-Webhooks-Signaturen, SSRF-Schutz (kein HTTP, keine privaten/Metadaten-IPs, keine Redirects).
* **Manipulationssicheres Audit-Log** (SHA-256-Hash-Kette, `npm run audit:verify`), inkl. Lesezugriffen auf personenbezogene Daten (DSGVO Art. 5 (2)).
* **Härtung:** Rate Limits pro IP und Principal, Body-Limits, strikte Content-Types (CSRF-Schutz), Security-Header, Origin-Prüfung für MCP (DNS-Rebinding), Secrets nie im Log (Redaction), Fail-closed-Konfiguration.

Details, Bedrohungsmodell und Restrisiken: [docs/SICHERHEIT.md](docs/SICHERHEIT.md) · Architektur: [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md)

## Schnellstart ohne Business-Central-Mandanten

Voraussetzung: **Node.js ≥ 24** (führt TypeScript nativ aus).

```bash
npm install          # nur für Typecheck/Tests – das Gateway selbst hat keine Abhängigkeiten
npm run dev:mock     # BC-Mock :4010 · Gateway :8080 · Webhook-Empfänger :4020
```

Die Ausgabe zeigt zwei Demo-API-Keys und fertige `curl`-Beispiele. Ausprobieren:

```bash
curl -H "Authorization: Bearer $KEY" "http://localhost:8080/v1/companies"
curl -H "Authorization: Bearer $KEY" "http://localhost:8080/v1/companies/<id>/customers?filter.city=Berlin&sort=-balanceDue&limit=5"
```

Jede Änderung (POST/PATCH/DELETE) löst über den BC-Mock eine Webhook-Benachrichtigung aus, die als
signiertes CloudEvent beim Beispiel-Empfänger ([examples/event-receiver.ts](examples/event-receiver.ts)) ankommt.

## REST-API im Überblick

| Methode & Pfad | Scope | Beschreibung |
|---|---|---|
| `GET /v1/companies` | `bc.read` | freigegebene Mandanten |
| `GET /v1/entities` | – | Registry: Entitäten, Felder, Operationen, eigene Rechte |
| `GET /v1/companies/{cid}/{entity}` | `bc.read` / `bc.{entity}.read` | Liste mit `filter.<feld>[.<op>]`, `select`, `sort`, `limit`, `cursor` |
| `GET /v1/companies/{cid}/{entity}/{id}` | dto. | Einzelsatz + `ETag` |
| `POST /v1/companies/{cid}/{entity}` | `bc.write` / `bc.{entity}.write` | Anlage, optional `Idempotency-Key` |
| `PATCH /v1/companies/{cid}/{entity}/{id}` | dto. | Änderung, **`If-Match` Pflicht** |
| `DELETE /v1/companies/{cid}/{entity}/{id}` | zusätzlich `bc.delete` | Löschen, **`If-Match` Pflicht** |
| `GET /v1/events?after=<seq>` | `events.read` | Event-Feed (Polling-Alternative zu Webhooks) |
| `POST /mcp` | `mcp.use` | MCP-Server für KI-Agenten |
| `GET /openapi.json`, `/asyncapi.json` | öffentlich | Verträge |
| `GET /.well-known/oauth-protected-resource` | öffentlich | RFC 9728 |
| `GET /healthz`, `/readyz` | öffentlich | Liveness / Readiness |
| `GET /metrics` | `metrics.read` | Prometheus |
| `POST /admin/subscriptions/sync` u. a. | `admin` | BC-Webhook-Abos, fehlgeschlagene Zustellungen |

Filter-Operatoren: `eq ne gt ge lt le startswith contains` – z. B. `filter.balanceDue.gt=1000`,
`filter.displayName.startswith=Nord`, `filter.postingDate.ge=2026-01-01`.

Veröffentlichte Entitäten (BC API v2.0): `customers`, `vendors`, `items`, `salesOrders`,
`salesInvoices`, `purchaseInvoices`, `accounts`, `generalLedgerEntries`; über die AL-Extension
zusätzlich `customerLedgerEntries` und `externalMappings`. Erweitern: Eintrag in
[src/bc/entities.ts](src/bc/entities.ts) – OpenAPI, AsyncAPI, Validierung, MCP-Tools und Filter
leiten sich automatisch ab.

## KI-Agenten (MCP)

Tools: `bc_list_companies`, `bc_describe_entities`, `bc_query`, `bc_get`, `bc_create`, `bc_update`.
Bewusst **ohne** Lösch-Tool; Updates erfordern das aktuelle ETag; Tools werden nur angezeigt, wenn
der Aufrufer passende Scopes hat; jeder Aufruf landet mit `channel: "mcp"` im Audit-Log.

Beispiel für einen MCP-Client (Streamable HTTP):

```json
{ "mcpServers": { "business-central": {
    "type": "http", "url": "https://bc-gateway.example.com/mcp",
    "headers": { "Authorization": "Bearer obk_…" } } } }
```

Mit OIDC entdecken MCP-Clients den Autorisierungsserver automatisch über RFC 9728.

## Produktivbetrieb mit Business Central

1. **Entra-App für das Gateway → BC:** App-Registrierung anlegen, API-Berechtigung *Dynamics 365 Business
   Central → Application → `API.ReadWrite.All`* mit Admin-Zustimmung; Zertifikat (empfohlen) oder Secret.
2. **In Business Central:** Seite *Microsoft Entra-Anwendungen* → Client-ID eintragen, Status *Aktiviert*,
   minimale Berechtigungssätze zuweisen (z. B. lesend `D365 READ` bzw. gezielt pro Tabelle) und – bei
   installierter Extension – `OBI API`.
3. **AL-Extension** aus [bc-extension/](bc-extension/) veröffentlichen (Custom APIs + Kontroll-Ebene, siehe dortige README).
4. **Entra-App für die Clients → Gateway:** *API verfügbar machen* (`api://bc-openbridge`), App-Rollen
   `bc.read`, `bc.write`, `events.read`, `mcp.use` … anlegen, im Manifest `accessTokenAcceptedVersion: 2`.
   `OIDC_ISSUER=https://login.microsoftonline.com/<tenant>/v2.0`, `OIDC_AUDIENCE=<App-ID-URI>,<Client-ID>`.
5. `.env` aus [.env.example](.env.example) erstellen, API-Keys mit `npm run create-api-key` erzeugen,
   Abonnenten in `event-subscribers.json` eintragen.
6. Starten: `docker compose up -d` (gehärteter Container, read-only, ohne Capabilities) hinter einem
   TLS-terminierenden Reverse Proxy. `PUBLIC_BASE_URL` muss für BC-Webhooks öffentlich per HTTPS erreichbar sein.

## Entwicklung

```bash
npm run typecheck    # tsc --noEmit (strict)
npm test             # Unit- + End-to-End-Tests gegen den BC-Mock
npm run check        # beides
npm run sbom         # CycloneDX-SBOM
```

Projektstruktur: `src/http` (Pipeline, Router, Problem Details, Idempotenz) · `src/security` (JWT, API-Keys,
Scopes, Rate Limit, Audit, SSRF, Cursor) · `src/bc` (Client, Token, Registry, OData) · `src/api` (Service-Schicht) ·
`src/spec` (OpenAPI/AsyncAPI) · `src/events` (CloudEvents, Bus, Standard Webhooks, BC-Abos) · `src/mcp` ·
`src/mock` (BC-Mock) · `bc-extension/` (AL).

> **Hinweis:** Der BC-Mock bildet nur das vom Gateway genutzte Verhalten nach. Vor dem Produktivgang gegen
> eine BC-Sandbox testen – insbesondere Berechtigungssätze, Feldlängen und Webhook-Zustellung.
