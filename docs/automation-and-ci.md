# Automation and CI

Every BC Atlas command is deterministic and returns a meaningful exit code:
`0` for success, `1` for an operation failure or a failed check, and `2` for
invalid usage. Use JSON output for scripts.

## Gate pull requests on architecture health

```sh
bca check ./app --fail-on warning
```

GitHub Actions example that also publishes the health summary on the job page:

```yaml
name: Architecture

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  architecture:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install --global bc-atlas
      - name: Architecture health
        run: |
          bca check ./app --format markdown -o health.md || status=$?
          cat health.md >> "$GITHUB_STEP_SUMMARY"
          exit ${status:-0}
      - name: Architecture report is current
        run: |
          bca report ./app
          git diff --exit-code -- docs/atlas
```

Azure Pipelines:

```yaml
steps:
  - task: NodeTool@0
    inputs:
      versionSpec: 22.x
  - script: npm install --global bc-atlas
    displayName: Install BC Atlas
  - script: bca check ./app --fail-on warning
    displayName: Architecture health
```

## Keep diagrams and reports in sync

```sh
bca report ./app
git diff --exit-code -- docs/atlas
```

For a single diagram:

```sh
bca graph ./app --view project -o docs/architecture.svg
git diff --exit-code -- docs/architecture.svg docs/architecture.d2
```

## Read the model from scripts

```sh
bca inspect ./app -o architecture.json
bca check ./app --format json > health.json
```

Parse standard output only after exit code `0` (or `1` for `check`, which
still prints its report).

## Check generated user documentation

```sh
bca docs validate ./test/UITest --strict
bca docs generate ./test/UITest --output-dir docs/generated
git diff --exit-code -- docs/generated
```

`bca docs automation ./test/UITest --provider github` prints a ready-made
pipeline for these steps. Use `azure-devops` for Azure Pipelines.

## Run in a container

```sh
docker build -t bc-atlas .
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" bc-atlas check /workspace/app
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" bc-atlas report /workspace/app --output-dir /workspace/docs/atlas
```

## Keep this project's documentation synchronized

This repository generates its table of contents and CLI capability summary
from source data:

```sh
npm run docs
npm run docs:check
```

`npm run check` also runs `docs:check`, so CI fails when generated
documentation is stale.
