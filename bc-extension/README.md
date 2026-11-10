# OpenBridge Interop – Business Central extension

API-first companion app for the bc-openbridge gateway. Everything it does is reachable through
the API at `api/openbridge/interop/v1.0`. A **control plane** inside the app decides what the
data APIs may do.

```
https://api.businesscentral.dynamics.com/v2.0/{tenant}/{environment}/api/openbridge/interop/v1.0/companies({companyId})/…
```

## How it is organised

| Layer | Objects | Purpose |
|---|---|---|
| Registry | enum `OBI Entity` (50100), enum `OBI Operation` (50101) | Every entity the app exposes, plus the four CRUD operations. |
| Control plane | table `OBI Setup` (50100), table `OBI Entity Control` (50101), codeunit `OBI Control` (50100) | Master switch, read-only mode, auditing, and an on/off switch for each CRUD operation per entity. `CheckAccess()` is the single gate that every API page calls. |
| Audit | table `OBI API Log` (50102), codeunit `OBI Purge Log` (50103) | One entry per API write; old entries are deleted after the retention period. |
| Data | table `OBI External Mapping` (50103), enum `OBI Sync Status` (50102) | Maps external ids to BC records (example of full CRUD). |
| API | pages 50100–50104 | See the table below. |
| UI | pages 50110–50113 | Admin cockpit: search for **OpenBridge Setup**. |
| Security | permission sets `OBI API`, `OBI ADMIN` | Gateway vs. administrator. |
| Lifecycle | codeunits `OBI Install` / `OBI Upgrade`, `Company-Initialize` subscriber | Create the setup and one control row per entity. Safe to run again. |

## Endpoints

| Entity set | Operations | Gated by | Permission set |
|---|---|---|---|
| `externalMappings` | GET, POST, PATCH, DELETE | entity control `ExternalMapping` | OBI API |
| `customerLedgerEntries` | GET | entity control `CustomerLedgerEntry` | OBI API |
| `apiLogEntries` | GET | entity control `ApiLog` | OBI API |
| `setup` | GET, PATCH + actions | permissions only (never by the switch) | OBI ADMIN |
| `entityControls` | GET, PATCH + action | permissions only | OBI ADMIN |

### How a request is checked (`OBI Control.CheckAccess`)

1. `OnBeforeCheckAccess` event: an extension can take over the check here.
2. Control-plane entities (`setup`, `entityControls`) always pass. Otherwise, after switching the API off, you could not switch it back on through the API.
3. `API Enabled = false` → rejected with `Disabled Message`, if one is set.
4. `Read-Only Mode` → every write is rejected.
5. The entity must support the operation (`Supports()`, which extensions can change via `OnBeforeSupports`).
6. The entity must be `Enabled`, and its `Allow Read/Create/Update/Delete` switch must be on.

Rejected requests return a client error (HTTP 400) whose title is *OpenBridge API access denied*.
Every request opens the API page first, so **Allow Read is required for any operation**.

Writes made through the API are logged in `OBI API Log` (when `Audit Writes` is on). Changes made in the
admin UI are not: the log covers the API only.

## Controlling the app via API

```http
GET   …/companies({cid})/setup
PATCH …/companies({cid})/setup({id})            If-Match: *   {"readOnlyMode": true}
POST  …/companies({cid})/setup({id})/Microsoft.NAV.disableApi
POST  …/companies({cid})/setup({id})/Microsoft.NAV.enableApi
POST  …/companies({cid})/setup({id})/Microsoft.NAV.resetEntityControls
POST  …/companies({cid})/setup({id})/Microsoft.NAV.purgeApiLog

GET   …/companies({cid})/entityControls
PATCH …/companies({cid})/entityControls({id})   If-Match: *   {"allowDelete": false}
POST  …/companies({cid})/entityControls({id})/Microsoft.NAV.resetToDefault
```

## CRUD example (externalMappings)

```http
POST …/companies({cid})/externalMappings
{"sourceSystem":"SHOPIFY","externalId":"gid://shopify/Customer/42","entitySet":"customers",
 "bcSystemId":"5f0c…","syncStatus":"Synced"}

GET    …/companies({cid})/externalMappings?$filter=sourceSystem eq 'SHOPIFY' and externalId eq 'gid://shopify/Customer/42'
PATCH  …/companies({cid})/externalMappings({id})   If-Match: W/"…"   {"syncStatus":"Failed","lastError":"timeout"}
DELETE …/companies({cid})/externalMappings({id})   If-Match: W/"…"
```

`sourceSystem + entitySet + externalId` must be unique. Setting `syncStatus` to `Synced` also sets
`lastSyncedAt` and clears `lastError`.

## Setup

1. Download symbols (`AL: Download symbols`) from a BC 26+ sandbox, then publish (F5). `.vscode/launch.json` targets a sandbox named `sandbox`.
2. In BC, open **Microsoft Entra Applications**, add the gateway's app registration, and assign it **OBI API**. Give **OBI ADMIN** to administrators, or to a separate admin app registration.
3. Open **OpenBridge Setup** and decide which entities and operations to allow.
4. Optional: create a Job Queue Entry for codeunit 50103 (daily) to delete old log entries.

## Adding an entity

1. Add a value to `OBI Entity` (or extend the enum from another app).
2. Declare its operations in `OBI Control.Supports` (or subscribe to `OnBeforeSupports`).
3. Create an API page that calls `CheckAccess` in `OnOpenPage`, `OnInsertRecord`, `OnModifyRecord` and `OnDeleteRecord`, and `LogWrite` after each write (copy `OBI API External Mappings`).
4. Grant the page and its tables in `OBI API`.
5. Bump the version. The upgrade codeunit adds the new control row.
6. Register it in the gateway: `src/bc/entities.ts`, `apiRoute: 'openbridge/interop/v1.0'`, `requiresExtension: true`.
