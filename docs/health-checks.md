# Architecture health checks

`bca check` turns the architecture model into a short list of findings and an
exit code, so architecture rules can block a pull request like a failing test.

```sh
bca check ./app
```

```text
BC Atlas health check - BC Atlas Warehouse Example 1.0.0.0

  Files          4
  Objects        9 (codeunit 3, enum 1, interface 1, page 1, ...)
  Relationships  26 (uses 8, permits 5, writes 5, reads 4, ...)
  Unresolved     0
  Cycles         0

Most connected objects
  codeunit 50101 Warehouse Processor               in   3  out   2
  ...

Findings
  INFO   1 object(s) without relationships: codeunit 50120 Warehouse Notifications

Result: PASSED - 0 error(s), 0 warning(s), 1 info (fail on: error)
```

## Rules

| Rule | Default severity | Trigger |
| --- | --- | --- |
| `parse-error` | error | tree-sitter could not parse a file. |
| `forbidden-dependency` | from the policy | A dependency matches a `forbiddenDependencies` rule. |
| other diagnostics | warning or error | Analysis diagnostics such as unreadable symbol packages. |
| `dependency-cycle` | warning | Objects depend on each other in a cycle. Configure with `check.cycles`. |
| `high-fan-in` | warning | More than `maxFanIn` distinct objects depend on one object. |
| `high-fan-out` | warning | One object depends on more than `maxFanOut` distinct objects. |
| `orphan-objects` | info | Objects without any relationship. |
| `unresolved-references` | info | References to objects outside the analyzed source. Add `.alpackages` symbols to resolve them. |

## Fail levels

`--fail-on` selects the lowest severity that fails the command:

| Value | Fails on |
| --- | --- |
| `error` (default) | errors |
| `warning` | errors and warnings (same as `--strict`) |
| `info` | any finding |
| `never` | nothing; report only |

## Output formats

```sh
bca check --format json                  # machine-readable HealthReport
bca check --format markdown -o health.md # for PR comments or job summaries
```

The JSON report contains `passed`, `failOn`, `thresholds`, `summary`
(apps, files, objects, relationships, object and relationship counts),
`counts`, `hubs`, and `findings`.

## Configure

```json
{
  "check": {
    "failOn": "warning",
    "cycles": "error",
    "maxFanIn": 30,
    "maxFanOut": 20
  },
  "forbiddenDependencies": [
    {
      "from": "Contoso.Core:**",
      "to": "Contoso.UI:**",
      "severity": "error",
      "message": "Core must not depend on UI"
    }
  ]
}
```

Command-line options override the `check` section. Patterns in
`forbiddenDependencies` match `Namespace:ObjectType:ObjectName`.
