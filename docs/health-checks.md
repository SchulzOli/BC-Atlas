# Architecture health checks

`bca check` turns the analyzed project into a short list of findings and an
exit code, so dependency rules can block a pull request like a failing test.

```sh
bca check ./app
```

```text
BC Atlas health check - BC Atlas Warehouse Example 1.0.0.0

  Files          4
  Objects        9 (codeunit 3, enum 1, interface 1, page 1, ...)
  Relationships  28 (uses 8, permits 6, writes 5, reads 4, ...)
  Unresolved     0
  Cycles         0

Most connected objects
  codeunit 50101 Warehouse Processor               in   4  out   2
  ...

Findings
  INFO   codeunit 50101 Warehouse Processor: 2 public procedure(s) without a /// summary: Process, Process (Inventory.al:35)
  INFO   interface Handles Warehouse Activity: 1 public procedure(s) without a /// summary: Process (Inventory.al:5)

Result: PASSED - 0 error(s), 0 warning(s), 2 info (fail on: error)
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
| `contract-fallback` | info; warning for configured expectations | A resolved enum implementation or inherited interface default has an empty body, a constant `true` return, or a conditional path that can complete without an error. Configure `check.contractExpectations` to make the selected methods warnings. |
| `context-responsibility` | info; warning for direct effects forbidden by policy | An explicitly selected context has record reads/writes, temporary writes, commits, resolved calls, selected role responsibilities, in-memory global assignments, or bounded indirect effect candidates. Configure `check.contexts` and its `forbid` list to assert selected responsibilities. |
| `undocumented-public-api` | info | Public procedures of public codeunits and interfaces without a `///` summary. `Access = Internal` objects and test codeunits are not API. |
| `orphan-objects` | info | Objects without any relationship. |
| `unresolved-references` | info | References to objects outside the analyzed source. Add `.alpackages` symbols to resolve them. A wildcard permission (`tabledata * = R`) is not one. |

`undocumented-public-api` reports once per object and lists the procedures,
so a large app does not flood the results. Set it to `error`, `warning`,
`info`, or `off` in `check.severities`:

```json
{ "check": { "severities": { "undocumented-public-api": "warning" } } }
```

BC Atlas does not repeat what the AL analyzers check: DataClassification,
ToolTips, `ObsoleteTag` and `ObsoleteReason`, or cyclomatic complexity.

`contract-fallback` is based on supported source structure, not a proof of
runtime behavior or a business obligation. Direct `Error` calls,
conditional behavior, delegation, and unknown bodies remain distinct; an
unresolved helper or symbol-only body is never promoted to a proven silent
success. Findings include `basis`, `resolution`, primary and supporting source
locations, and `limitations`. Unknown-value enum implementations are not used
as ordinary fallbacks.

`context-responsibility` runs only for objects explicitly selected by
`check.contexts`. Its JSON report includes `contextResponsibilities.summaries`
with direct effects, bounded indirect candidates, resolved calls, selected
planning/partner-resolution roles, explicitly selected lazy-read methods, and
traversal limitations. `maxCallDepth` defaults to `3`. Temporary writes,
permission grants, and in-memory assignments are not persistent writes;
unknown temporary state stays uncertain. Planning and partner resolution are
never inferred from method names. Read-only lazy reads are informational and
permitted unless `"lazy-reads"` is explicitly forbidden. With no
`check.contexts` setting, the report shape is unchanged.

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
(apps, files, objects, relationships, unresolved references, cycles, and
object and relationship counts), `counts`, `hubs`, and `findings`.

Findings are ordered deterministically by severity, rule, then message. CLI
JSON and the MCP `bc_atlas_check` tool return the same canonical health report;
JSON retains the complete evidence arrays and any `limitations`. Text and
Markdown display the primary location plus up to four supporting locations
per finding. When more evidence exists, they state how many items were omitted
and direct readers to JSON; limitations remain visible. SARIF uses the primary
location for the finding and emits file-backed supporting evidence as
`relatedLocations`, with `limitations` in result properties.

## Configure

```json
{
  "check": {
    "failOn": "warning",
    "cycles": "error",
    "maxFanIn": 30,
    "maxFanOut": 20,
    "severities": { "undocumented-public-api": "warning" },
    "contractExpectations": [
      {
        "interface": "object:interface:IPipelineStep",
        "methods": ["Execute"]
      }
    ],
    "contexts": [
      {
        "object": "object:codeunit:EDIPlatformContext",
        "maxCallDepth": 3,
        "roles": {
          "planning": ["object:codeunit:EDIPipelinePlanFactory"],
          "partnerResolution": ["object:codeunit:EDIPartnerContextResolver"]
        },
        "lazyReadMethods": ["TryGetExchange()"],
        "forbid": ["persistent-writes", "commits"]
      }
    ]
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
`forbiddenDependencies` match `Namespace:ObjectType:ObjectName`. See
[configuration](./configuration.md#configure-health-checks-and-reports) for
contract expectation and context selector validation details.
