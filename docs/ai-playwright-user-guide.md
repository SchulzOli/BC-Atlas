# AI-generated Business Central documentation

The `ald2tree docs` commands turn a small business scenario into an executable
Playwright acceptance test and publish passing test steps as customer-facing
Markdown.

The workflow deliberately separates business intent from browser automation:

```text
scenario.yml -> Codex generates Playwright -> deterministic test run -> Markdown
                           ^                         |
                           +------ Codex heals ------+
```

The scenario owns the goal, expected results, and safety constraints. The AI
may generate or repair technical browser interactions, but it must not edit or
weaken that contract.

## Prerequisites

- Node.js 20 or later.
- `ald2tree` dependencies installed with `npm install`.
- Microsoft Edge, or another Playwright browser configured with
  `BC_DOCS_BROWSER`.
- Codex CLI installed and authenticated for `generate` and `heal`.
- A disposable Business Central company or sandbox with deterministic test
  data.
- A test user that can sign in non-interactively. Do not put credentials in a
  scenario or committed test.

Check the local tools:

```sh
node --version
codex --version
npx playwright --version
```

## 1. Write a scenario contract

Create a YAML file under `scenarios/`:

```yaml
id: create-edi-partner
title: Create an EDI partner
description: Create an EDI partner with only a partner code and name.
goal: Create a new EDI partner using only Partner Code and Name.

start:
  url: https://bc.example/BC/?company=CRONUS%20DE
  company: CRONUS DE
  roleCenter: EDI Platform

prerequisites:
  - You are signed in to the CRONUS DE company.
  - You have permission to create EDI partners.

expected:
  - The EDI partner is saved.
  - The partner code and name are visible in the EDI Partners list.

constraints:
  - Do not configure message profiles or mappings.
  - Do not block the partner.
```

Required fields are:

- `id`: lowercase kebab-case; also used for test and Markdown filenames.
- `title`: customer-facing document title.
- `goal`: the business outcome the AI must achieve.
- `expected`: non-empty list of results that the test must assert.

`prerequisites` and `constraints` are optional but strongly recommended.
Anything under `expected` or `constraints` is treated as immutable during
generation and healing.

Do not describe every click. The generator discovers navigation from the live
application. Give it the goal, the observable result, and the boundaries.

## 2. Generate the Playwright test

Preview the complete agent instruction without running Codex:

```sh
ald2tree docs generate scenarios/create-edi-partner.yml --dry-run
```

Generate, execute, and stabilize the test:

```sh
ald2tree docs generate scenarios/create-edi-partner.yml
```

The URL is selected in this order:

1. `--bc-url`
2. `BC_URL`
3. `start.url` from the scenario

For CI and shared scenarios, prefer an environment variable:

```powershell
$env:BC_URL = "https://bc-test/BC/?company=CRONUS%20DE"
ald2tree docs generate scenarios/create-edi-partner.yml
```

By default, the generated test is written to:

```text
docs-tests/generated/create-edi-partner.spec.js
```

The generator is instructed to:

- explore the current Business Central UI;
- use resilient role, label, and text locators;
- represent customer actions with `test.step()`;
- assert every expected result in a `Verify: <exact expected text>` step;
- use unique test data;
- attach a final screenshot named `result`;
- avoid unrelated data and setup;
- stop rather than bypass authentication, permissions, or semantic blockers.

Use `--agent-command` if the Codex executable has a different name or path.
`CODEX_BIN` provides the same setting through the environment.

## 3. Run and publish

Run the generated test deterministically:

```sh
ald2tree docs run scenarios/create-edi-partner.yml
```

Show the browser while diagnosing a local run:

```sh
ald2tree docs run scenarios/create-edi-partner.yml --headed
```

For a successful documented test, the reporter writes:

```text
docs/generated/create-edi-partner.md
docs/generated/images/create-edi-partner-result.png
```

The numbered procedure comes from user-facing `test.step()` titles. Expected
results come from the scenario contract. Image attachments are copied beside
the Markdown.

Failed tests do not overwrite published Markdown. Playwright retains a trace
and failure screenshot for diagnosis.

Set a different output directory with:

```powershell
$env:BC_DOCS_OUTPUT = "artifacts/docs"
ald2tree docs run scenarios/create-edi-partner.yml
```

The default browser channel is `msedge`. Override it with
`BC_DOCS_BROWSER=chrome` after installing that Playwright browser.

## 4. Heal a broken test

When application navigation or controls change:

```sh
ald2tree docs heal scenarios/create-edi-partner.yml
```

Preview the healing instruction first:

```sh
ald2tree docs heal scenarios/create-edi-partner.yml --dry-run
```

The healer runs the existing test, inspects the live UI and Playwright
evidence, repairs the test, and reruns it. Its prompt explicitly prohibits:

- editing the scenario;
- deleting or weakening assertions;
- skipping the test;
- matching arbitrary controls with overly broad selectors;
- catching and ignoring failures;
- hiding a semantic application change.

If the business behavior changed, healing must stop. A person then decides
whether the application is wrong or the scenario contract needs a reviewed
change.

Codex runs with the `workspace-write` sandbox by default. If that sandbox
cannot reach an internal Business Central host, run the agent only on an
isolated test machine or container and opt into broader access explicitly:

```sh
ald2tree docs generate scenarios/create-edi-partner.yml \
  --agent-sandbox danger-full-access
```

Do not use broader access on a developer machine containing unrelated
credentials or repositories.

## Generated test contract

Generated tests must annotate the source scenario:

```js
test("Create an EDI partner", {
  annotation: {
    type: "scenario",
    description: "scenarios/create-edi-partner.yml"
  }
}, async ({ page }, testInfo) => {
  await test.step("Open EDI Partners", async () => {
    // Browser interaction
  });

  await test.step("Create the partner", async () => {
    // Browser interaction
  });

  await test.step("Verify the new partner", async () => {
    // Navigation to the result
  });

  await test.step(
    "Verify: The EDI partner is saved.",
    async () => {
      // Assertion proving this exact expected outcome
    }
  );

  await test.step(
    "Verify: The partner code and name are visible in the EDI Partners list.",
    async () => {
      // Assertion proving this exact expected outcome
    }
  });

  await testInfo.attach("result", {
    body: await page.screenshot(),
    contentType: "image/png"
  });
});
```

Customer-visible `test.step()` entries become numbered documentation steps.
Steps beginning with `Verify: ` are checked against `expected` and rendered in
the expected-results section rather than the numbered procedure. If any exact
verification step is missing, Markdown publication fails. Keep technical setup,
authentication, cleanup, and retries outside customer-visible steps.

## CI example

Generation is normally a reviewed development activity. CI should run the
committed deterministic tests:

```yaml
- name: Install dependencies
  run: npm ci

- name: Run executable documentation
  env:
    BC_URL: ${{ secrets.BC_TEST_URL }}
    BC_TEST_USER: ${{ secrets.BC_TEST_USER }}
    BC_TEST_PASSWORD: ${{ secrets.BC_TEST_PASSWORD }}
  run: node src/cli.js docs run scenarios/create-edi-partner.yml

- name: Verify generated documentation is current
  run: git diff --exit-code -- docs/generated
```

Use a dedicated sandbox account without multifactor authentication when the
environment requires unattended sign-in. Store credentials only in the CI
secret store.

## Test-data strategy

Executable documentation changes application data. Prefer one of:

- recreate a disposable company for every pipeline;
- restore a known database snapshot;
- generate unique record identifiers and remove them in technical cleanup;
- use a dedicated company reserved for automated documentation.

Never run generation or healing against production. An AI explorer may take
different navigation paths while stabilizing a test.

## Current limitations

- The AI can infer navigation, but it cannot infer the correct business outcome;
  `expected` must come from a person who understands the feature.
- Authentication and MFA flows may require environment-specific setup.
- Business Central control add-ins and embedded external applications can need
  custom Playwright handling.
- Localization changes user-facing locators. Generate and run documentation in
  the language used by its readers.
- Healing routine technical drift is useful; semantic changes always require
  human review.
