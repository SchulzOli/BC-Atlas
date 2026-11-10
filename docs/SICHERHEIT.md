# Sicherheitskonzept BC OpenBridge

## 1. Schutzziele und Prinzipien

| Schutzziel | Umsetzung |
|---|---|
| Vertraulichkeit | Authentifizierung jedes Aufrufs, Scopes, Mandanten-Allowlist, Ausgabe-Allowlist, verschlüsselte Cursor, keine Upstream-Interna in Fehlern |
| Integrität | strikte Eingabevalidierung, keine OData-Injection, ETag/If-Match, Idempotency-Key, signierte Webhooks |
| Verfügbarkeit | Rate Limits (IP + Principal), Body-Limits, Timeouts, Retries mit Backoff, Respekt vor BC-Throttling |
| Nachvollziehbarkeit | Hash-verkettetes Audit-Log, W3C-Trace-IDs in Logs/Fehlern/Events, Metriken |

Leitlinien: **Zero Trust** (jede Anfrage wird geprüft, auch intern), **Least Privilege** (Scopes pro
Entität und Operation, Löschen separat), **Fail closed** (fehlende/ungültige Konfiguration → kein Start),
**Secure by Default** (HTTPS-Pflicht upstream/outbound, private Ziele gesperrt, Metriken geschützt).

## 2. Vertrauensgrenzen

```
[Client] ──TB1──► [Gateway] ──TB2──► [Business Central]
                     ▲   └──TB4──► [Webhook-Abonnenten]
                     └──TB3── [BC-Webhook-Benachrichtigungen]
```

* **TB1** Clients → Gateway: OAuth-JWT oder API-Key, Scopes, Rate Limit, Validierung.
* **TB2** Gateway → BC: Service-Principal (Client Credentials, bevorzugt Zertifikat). Clients erhalten nie BC-Tokens.
* **TB3** BC → Gateway: öffentlicher Endpunkt, abgesichert durch `clientState` (Konstantzeitvergleich), Entitäts- und Mandantenprüfung.
* **TB4** Gateway → Abonnenten: HTTPS, SSRF-Schutz, Standard-Webhooks-Signatur, keine Redirects.

## 3. Bedrohungsmodell (STRIDE)

| # | Bedrohung | Kategorie | Gegenmaßnahme | Code |
|---|---|---|---|---|
| T1 | Gefälschte/abgelaufene Tokens, `alg=none`, HS256-Key-Confusion | Spoofing | nur RS/PS/ES-Algorithmen, Schlüssel nur aus JWKS, Kty/Alg/Kurve-Abgleich, iss/aud/exp/nbf/iat | `security/jwt.ts` |
| T2 | Gestohlener/erratener API-Key | Spoofing | 256-bit-Keys, nur Hash gespeichert, Konstantzeitvergleich, Ablauf/Deaktivierung, Rate Limit, Audit von Fehlversuchen, Präfix `obk_` für Secret-Scanner | `security/apikeys.ts` |
| T3 | OData-Injection (`' or 1 eq 1`), Zugriff auf nicht freigegebene Felder | Tampering / Info Disclosure | kein Roh-OData, Registry-Whitelist, typisierte Literale, Escaping, Längen-/Anzahl-Limits | `bc/odata.ts` |
| T4 | Mass Assignment (z. B. `balanceDue` schreiben) | Tampering | nur `writable`-Felder, unbekannte Felder → 400 | `api/service.ts` |
| T5 | Lost Updates bei parallelen Änderungen | Tampering | `If-Match` Pflicht (428), 412 bei Konflikt | `app.ts`, `bc/client.ts` |
| T6 | Doppelte Buchungen durch Retries | Tampering | Idempotency-Key pro Principal mit Payload-Fingerprint | `http/idempotency.ts` |
| T7 | Rechteausweitung über andere Entitäten/Mandanten | Elevation of Privilege | Scopes pro Entität+Operation, `bc.delete` separat, Mandanten-Allowlist, Event-Feed nach Scopes gefiltert | `security/principal.ts` |
| T8 | Manipulierte Paging-Links → SSRF / Datenzugriff | EoP / Info Disclosure | AES-256-GCM-Cursor, gebunden an Principal/Entität/Mandant/Ablauf; Ziel-URL wird gegen BC-Collection geprüft | `security/cursor.ts` |
| T9 | Gefälschte BC-Benachrichtigungen | Spoofing | `clientState` ≥ 16 Zeichen, Konstantzeitvergleich, nur bekannte Entitäten/Mandanten | `app.ts` |
| T10 | SSRF über Webhook-Ziele (Cloud-Metadaten 169.254.169.254, interne Dienste) | EoP | HTTPS-Pflicht, DNS-Auflösung gegen Blocklist (privat, Loopback, Link-Local, ULA, IPv4-mapped), keine Credentials in URLs, `redirect: manual` | `security/ssrf.ts` |
| T11 | Gefälschte Events beim Abonnenten / Replay | Spoofing | Standard-Webhooks-HMAC, Zeitstempel-Toleranz 5 min, `webhook-id` zur Deduplizierung | `events/standard-webhooks.ts` |
| T12 | Abstreiten von Änderungen, nachträgliche Log-Manipulation | Repudiation | Audit pro Datenzugriff (Principal, Ressource, Ergebnis, Trace-ID), SHA-256-Hash-Kette, Verifikation | `security/audit.ts` |
| T13 | Leaks von Secrets/Tokens in Logs | Info Disclosure | rekursive Redaction sensibler Schlüssel; Upstream-Fehler ohne Tenant/Interna | `observability/log.ts`, `bc/client.ts` |
| T14 | DoS / Erschöpfung des BC-Kontingents | DoS | Token-Bucket pro IP und Principal, Body-Limit, Header-/Request-Timeouts, Seitengrößen-Limit, BC-429 mit `Retry-After` | `security/ratelimit.ts` |
| T15 | CSRF / Browser-Missbrauch | Tampering | nur `application/json` (415 sonst), CORS-Allowlist, Bearer statt Cookies, CSP `default-src 'none'` | `http/io.ts` |
| T16 | DNS-Rebinding gegen den MCP-Endpunkt | Spoofing | Origin-Prüfung, Auth-Pflicht | `app.ts` |
| T17 | KI-Agent führt destruktive Aktionen aus (Prompt-Injection) | EoP | kein Lösch-Tool, ETag-Pflicht für Updates, Tool-Sichtbarkeit nach Scopes, separater Scope `mcp.use`, Audit mit `channel: mcp` | `mcp/server.ts` |
| T18 | Supply-Chain-Angriff über Abhängigkeiten | Tampering | null Laufzeit-Abhängigkeiten, SBOM, `npm audit signatures` in CI, Image-Pinning empfohlen | `package.json`, CI |

## 4. Empfehlungen für den Betrieb

* **Zertifikat statt Client Secret** für die BC-Verbindung (`BC_CLIENT_CERT_FILE`/`BC_CLIENT_KEY_FILE`); Rotation über Entra ID.
* In BC dem Service-Principal **nur die nötigen Berechtigungssätze** geben; die Extension liefert `OBI API` (Gateway) und `OBI ADMIN` (Administration) getrennt.
* `BC_ALLOWED_COMPANIES` und `BC_ENTITIES` explizit setzen – nur veröffentlichen, was gebraucht wird.
* Getrennte Identitäten pro Client-System (eigene API-Keys bzw. App-Registrierungen), kurze Ablaufzeiten.
* Audit-Log in WORM-Speicher oder SIEM weiterleiten und regelmäßig `npm run audit:verify` ausführen.
* TLS am Reverse Proxy terminieren (TLS 1.2+), `TRUST_PROXY=true` nur hinter vertrauenswürdigem Proxy.
* `CURSOR_SECRET` und `BC_WEBHOOK_CLIENT_STATE` aus einem Secret Store (Docker/Kubernetes Secrets, Key Vault) laden (`*_FILE`).
* Alarme auf `openbridge_auth_failures_total`, `openbridge_rate_limited_total`, `openbridge_webhook_deliveries_total{outcome="error"}`.

## 5. Bekannte Restrisiken / Ausbaustufen

| Thema | Status | Ausbau |
|---|---|---|
| Idempotenz-Store, Rate Limits, Event-Feed, Dead Letters sind **im Speicher** | gilt pro Instanz | für Hochverfügbarkeit Redis/Postgres-Implementierung hinter denselben Schnittstellen |
| Webhook-Zustellung **at-least-once**, Wiederholungen nur im Prozess | Verlust bei Neustart möglich | Events an Broker (Kafka, Service Bus, NATS) weiterreichen |
| SSRF: DNS-Rebinding zwischen Prüfung und Verbindung | gering (Abonnenten sind admin-konfiguriert) | Egress-Proxy / Netzwerk-Policy |
| Audit-Hash-Kette schützt vor unbemerkter Änderung, nicht vor vollständigem Ersetzen | — | periodisch Kettenkopf extern signieren/ablegen (z. B. RFC 3161-Zeitstempel) |
| Mandantenfähige Datenfilter pro Principal (z. B. nur eigene Debitoren) | nicht enthalten | Row-Level-Filter im Registry ergänzen |
| mTLS für Clients | am Reverse Proxy möglich | Zertifikats-Principal im Gateway auswerten |
