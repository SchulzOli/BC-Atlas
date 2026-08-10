# Automation and CI

Use JSON output for automation. Use strict validation when a diagnostic must fail the build.

## Check architecture

```sh
bca inspect ./app --strict -o architecture.json
```

You can also generate a diagram and check the committed output:

```sh
bca graph ./app --view project -o docs/architecture.svg
git diff --exit-code -- docs/architecture.svg docs/architecture.d2
```

## Check generated user documentation

```sh
bca docs validate ./test/UITest --strict
bca docs generate ./test/UITest --output-dir docs/generated
git diff --exit-code -- docs/generated
```

Generate a pipeline definition when you need a starting point:

```sh
bca docs automation ./test/UITest --provider github --output-dir docs/generated
```

Use `azure-devops` as the provider for an Azure Pipelines definition.

## Keep this project documentation synchronized

This repository generates its TOC and CLI capability summary from source data.

```sh
npm run docs
npm run docs:check
```

The standard `npm run check` command also runs `docs:check`. CI fails when generated documentation is stale.
