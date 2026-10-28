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
| `parse-error` | error | tree-sitter could not parse a file. With the AL compiler, its syntax errors replace this rule. |
| AL compiler and analyzer rules (`AL0185`, `AA0137`, `AW0005`, ...) | from the compiler or rule set | Compiler errors and warnings and CodeCop, UICop, AppSourceCop, and PerTenantExtensionCop findings, with the exact range and the Microsoft help link, when the [AL toolchain](./al-toolchain.md) is installed or `--compiler-log` imports an error log. |
| `forbidden-dependency` | from the policy | A dependency matches a `forbiddenDependencies` rule. |
| `architecture-violation` | from `architecture.severity` | A dependency against the layers or `dependsOn` of the [target architecture](./clean-architecture.md); `violation` names the exact rule (`outward-dependency`, `same-layer-dependency`, `undeclared-component-dependency`, `layer-skip-dependency`). |
| `internal-access` | from `architecture.severity` | A component uses an object of another component that is `Access = Internal` or not in its `exposes`. |
| `dependency-rule` | from the rule | A dependency breaks one of the `architecture.rules`; `policy` names the rule. |
| architecture checks (`component-cycle`, `empty-component`, `unused-selector`, `unused-component-dependency`, `inconsistent-component-dependency`, `declared-component-cycle`, `component-too-large`, `unstable-dependency`, `foreign-table-write`, `could-be-internal`, `public-surface-change`, `unassigned-objects`) | see [Checks of the architecture](./clean-architecture.md#checks-of-the-architecture) | The architecture as a whole and its configuration. |
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
bca check --format sarif -o bca.sarif    # GitHub code scanning, Azure DevOps
```

The JSON report contains `passed`, `failOn`, `thresholds`, `summary`
(apps, files, objects, relationships, object and relationship counts, and
`compiler` when the AL toolchain ran), `counts`, `hubs`, and `findings`.
Findings from the AL compiler also carry `column`, `endLine`, `endColumn`,
`helpLink`, and `origin: "al"`.

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
