# BC Atlas Sync - end-to-end video run (Playwright)

> **Status: not yet run against a live tenant.** The selectors for the Business Central web client
> are written defensively but have not been verified. Expect to adjust a few of them on the first run
> (see [Troubleshooting](#troubleshooting)).

This project drives the Business Central web client through the complete BC Atlas Sync
workflow and records **one video of the whole run**, plus an HTML report with a screenshot for every step:

1. **Atlas Sync Setup** (page 50150) - asserts *Recorder Enabled* is on (it is never toggled by the test).
2. **Atlas Sync Recordings** (50151) → *New* → *Process Name* `"<BAS_PROCESS_NAME> <timestamp>"`, *Description* → **Start Recording** → OK.
3. **Add Step Marker** "Create the sales order".
4. Real process in the same browser session: **Sales Orders** → *New* → *Customer Name* → line *Type* Item, *No.*, *Quantity* 1.
5. Back to the recording (first row of 50151) → marker "Post the order" → back to the sales order → **Post...** → *Ship and Invoice* → OK → *No* to "open the posted invoice?".
   If anything in this step fails, the run continues with a warning annotation - the recorder still documents what happened.
6. Recording → **Stop Recording**.
7. **Import Clicks (Page Script)** with [`fixtures/sales-order-post.yml`](fixtures/sales-order-post.yml) (a Page Scripting recording of the same flow).
8. **Create Snapshot** → snapshot card (50156): screenshot, *Fingerprint*, *Drift Detected* → **Download All (ZIP)**.

### Why the test never reloads the page after "Start Recording"

The Atlas Sync recorder is bound to the BC **session** that started it, and every full page load
(`page.goto`, reload) creates a new BC session. After step 2 the test therefore navigates only
inside the client: the BC search (**Alt+Q**, "Tell me") and opening list rows. The card field
*This Session* ("Recording in this session - N events buffered") is checked on each return to the
recording; if it says otherwise, a warning is added to the report.

## Prerequisites

- The **BC Atlas Sync** extension (`build/OpenBridge_BC Atlas Sync_1.0.0.0.app`, built with `pwsh ./scripts/Build-AL.ps1` from `al/app`) is published to the sandbox environment.
- Your user has the permission set **BAS RECORDER** (Atlas Sync Recorder).
- **Atlas Sync Setup** → *Recorder Enabled* = on, **then sign out and in again** (the recorder arms only in
  sessions started after the change). Run `npm run login` *after* that.
- Demo company data: **CRONUS International Ltd.** with customer *Adatum Corporation* and item *1896-S*
  (or set `BC_COMPANY`, `BC_CUSTOMER`, `BC_ITEM_NO`), and a posting date inside the allowed posting period.
- **BC client language English (United States)** - the test finds actions, fields and dialog buttons by their English captions.
- Node.js 18+ (20+ recommended).

## Install

```bash
cd e2e
npm install
npx playwright install chromium
cp .env.example .env    # optional, adjust values
```

## Sign in once (manual, headed)

```bash
npm run login
```

A Chromium window opens at the BC URL. Sign in yourself (MFA etc.); the script waits up to **5 minutes**
until the BC client has loaded, then saves the browser storage state to `.auth/state.json`
(gitignored - it contains session cookies, keep it private). No credentials are ever stored in files.
Repeat `npm run login` when the session expires (the test fails fast with a hint if it lands on the sign-in page).

> Chosen over a Playwright `setup` project because sign-in is manual: a separate script keeps
> `npm test` non-interactive and never blocks a run waiting for a human.

## Run

| Command | What it does |
|---|---|
| `npm run video` | Runs the test (headless) and copies the video to `artifacts/` - **use this** |
| `npm test` | Runs the test headless |
| `npm run test:headed` | Runs the test in a visible browser |
| `npm run report` | Opens the HTML report (steps, screenshots, trace, video, ZIP attachment) |
| `npm run collect-video` | Copies the newest video (and ZIP) from `test-results/` to `artifacts/` again |
| `npm run typecheck` | `tsc --noEmit` |

`npm run video` collects the video even when the test fails (its exit code is then the collector's, so
check the list output or the report for pass/fail).

## Where things land

| What | Where |
|---|---|
| Video of the run | `test-results/<test>/video.webm` → copied to `artifacts/AtlasSync-E2E-<date>.webm` |
| Documentation ZIP | `test-results/artifacts/<name>.zip` (attached to the report) → copied to `artifacts/` |
| HTML report | `playwright-report/index.html` (`npm run report`) |
| Trace, screenshots | `test-results/<test>/` and inside the report |

`test-results/` is wiped by Playwright at the start of every run; `artifacts/` is kept.

## Environment variables

Read from the environment or from `.env` (see [`.env.example`](.env.example)).

| Variable | Default | Meaning |
|---|---|---|
| `BC_BASE_URL` | `https://businesscentral.dynamics.com` | Web client base URL |
| `BC_TENANT` | *(empty)* | Optional tenant id or domain |
| `BC_ENVIRONMENT` | `sandbox` | Environment name |
| `BC_COMPANY` | `CRONUS International Ltd.` | Company |
| `BAS_PROCESS_NAME` | `Demo: Post sales order` | Recording process name (timestamp appended) |
| `BC_CUSTOMER` | `Adatum Corporation` | Customer of the sales order |
| `BC_ITEM_NO` | `1896-S` | Item on the sales line |
| `SLOWMO` | `250` | Delay between actions in ms (watchable video) |

URLs are built as `${BC_BASE_URL}/${BC_TENANT}/${BC_ENVIRONMENT}?company=<company>&page=<id>`.

The Page Scripting fixture is static and uses the default customer and item; if you change
`BC_CUSTOMER`/`BC_ITEM_NO`, update `fixtures/sales-order-post.yml` to match (or record your own with
Settings → Page Scripting and replace the file).

## Project layout

```
e2e/
  playwright.config.ts          video/trace/screenshots always on, 1600x900, slowMo
  helpers/env.ts                env vars, paths, BC URL builder
  helpers/bc.ts                 BC web client helpers (bcFrame, invokeAction, fillField, fillLine, closeDialog, ...)
  tests/atlas-sync-recording.spec.ts the flow
  fixtures/sales-order-post.yml      Page Scripting recording that is imported in step 7
  scripts/login.ts              manual sign-in → .auth/state.json
  scripts/collect-video.mjs     newest video.webm (+ ZIP) → artifacts/
```

## Troubleshooting

- **Everything times out / nothing is found** - the client UI is expected inside
  `iframe[title="Main Content"]` (`bcFrame()` in `helpers/bc.ts`). If your BC version uses another iframe
  title, change `MAIN_FRAME`. Without such an iframe the helpers fall back to the page itself.
- **Action / field / button "not found"** - captions are matched exactly in **English**. Set your BC
  language to English (My Settings → Language) and sign in again. Actions are looked up as `menuitem`
  or `button`; if hidden, the helper opens the hinted groups and *More options*, *Actions*, *Process*,
  *Home*, *Related*. Run `npm run test:headed` with `SLOWMO=1000` and inspect the report screenshots / trace
  to see the real accessible names.
- **"Recorder Enabled is OFF"** - enable it in Atlas Sync Setup, sign out and in, then `npm run login` again.
- **Redirected to the sign-in page** - `.auth/state.json` expired; run `npm run login`.
- **"This Session" warning** - the recording is not running in the browser session of the test (e.g. a
  page reload happened). Events of that part of the run are not captured.
- **The newest recording is not ours** - someone else created a recording at the same time
  (50151 is sorted by *No.* descending and the test opens the first row).
- **Posting fails** (posting date not allowed, missing setup, credit limit dialog, ...) - step 5 only adds
  a warning; the snapshot then documents the run up to the failure.
- **Sales order line not filled** - the lines grid markup differs between BC versions. `fillLine()` first
  looks for a cell editor named like the column, then maps the column header index to the first row.
- **File upload** - `Import Clicks (Page Script)` opens BC's upload dialog; the test answers the file chooser
  (or sets the hidden `input[type=file]` directly).
