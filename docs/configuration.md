# Configuration

BC Atlas reads `.bca.json` from the input root. Use `--config` to select another JSON file.

Command-line options override configuration values.

## Start with the example

Copy [`.bca.example.json`](../.bca.example.json) to your AL project as `.bca.json`. Remove settings that you do not need.

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

Run with `--strict` in CI. The command then fails for warning or error diagnostics.

See the [CLI reference](./cli-reference.md#configuration-file) for all properties.
