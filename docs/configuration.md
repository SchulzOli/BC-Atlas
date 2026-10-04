# Configuration

BC Atlas reads `.bca.json` from the input root. Use `--config` to select another JSON file.

Command-line options override configuration values.

## Create a configuration

Run `bca init` in the folder that contains `app.json`. It writes a starter
`.bca.json` with your app name, excluded test folders, source links for your
Git host, and default `check` and `report` sections. Use `--print` to preview
it or `--force` to replace an existing file.

```sh
bca init ./app
```

The complete reference is [`.bca.example.json`](../.bca.example.json). A
minimal file looks like this:

```json
{
  "view": "project",
  "direction": "right",
  "groupBy": "role",
  "exclude": ["**/test/**"],
  "maxEdges": 500
}
```

## Configure a workflow

```json
{
  "view": "workflow",
  "workflow": {
    "entries": ["ProcessDocument"],
    "depth": 8,
    "maxNodes": 100,
    "maxEdges": 250,
    "edgeTypes": ["calls", "events", "writes"]
  }
}
```

Use `phases` to group steps. Use `stop` to show a node without expanding it. Use `collapse` to bypass utility procedures.

## Customize roles and source links

Role mappings are evaluated in declaration order. A pattern can match an
object type, `type:name`, `namespace:type:name`, or source file path.

```json
{
  "groupBy": "role",
  "roleMappings": {
    "Domain": ["Contoso.Sales:table:*", "Contoso.Sales:codeunit:*"],
    "Adapters": ["**/Integration/**"]
  },
  "sourceUrl": "https://github.com/example/repo/blob/{ref}/{file}#L{line}",
  "sourceRef": "main",
  "sourcePathPrefix": "apps/Sales"
}
```

The source file is relative to `projectRoot`. Use `sourcePathPrefix` when that
root is inside a larger repository.

## Check dependency rules

Add a `forbiddenDependencies` array to detect invalid architectural dependencies:

```json
{
  "forbiddenDependencies": [
    {
      "from": "Contoso.Core:**",
      "to": "Contoso.UI:**",
      "severity": "warning",
      "message": "Core must not depend on UI"
    }
  ]
}
```

Run `bca check` in CI. A rule with `"severity": "error"` fails the default
check; use `--fail-on warning` (or `--strict`) to fail on warnings too.

## Configure health checks and reports

```json
{
  "check": {
    "failOn": "error",
    "cycles": "warning",
    "maxFanIn": 25,
    "maxFanOut": 25
  },
  "report": {
    "outputDir": "docs/atlas",
    "views": ["project", "module", "data", "contracts", "events", "ui"],
    "codegraph": false
  }
}
```

See [Architecture health checks](./health-checks.md) and
[Architecture reports](./reports.md).

## Automate it

`bca setup` adds an `automation` section that says which features run on Git
hooks, in pipelines, and on a schedule, and how generated files are synced:

```json
{
  "automation": {
    "hooks": "husky",
    "ci": "github",
    "triggers": {
      "pre-commit": { "tasks": ["check"], "sync": "none" },
      "pre-push": { "tasks": ["report", "docs"], "sync": "verify" },
      "ci": { "tasks": ["check", "report", "docs"], "sync": "verify" },
      "schedule": { "cron": "0 6 * * 1", "tasks": ["report", "docs"], "sync": "pull-request" }
    }
  },
  "docs": { "tests": "test", "export": ["markdown", "html"], "outputDir": "docs/guides" }
}
```

See [Guided setup](./setup.md) and [Automation](./automation-and-ci.md).

See the [CLI reference](./cli-reference.md#configuration-file) for all properties.
