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
| `internal-access` | from `architecture.severity` | A component uses an object of another component that is not in its `exposes`, or that is `Access = Internal` in another app (or in any other component with `architecture.internalAccess: "component"`). |
| `dependency-rule` | from the rule | A dependency breaks one of the `architecture.rules`; `policy` names the rule. |
| architecture checks (`component-cycle`, `empty-component`, `unused-selector`, `unused-component-dependency`, `inconsistent-component-dependency`, `declared-component-cycle`, `component-too-large`, `unstable-dependency`, `foreign-table-write`, `could-be-internal`, `public-surface-change`, `unassigned-objects`) | see [Checks of the architecture](./clean-architecture.md#checks-of-the-architecture) | The architecture as a whole and its configuration. |
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
ToolTips, `ObsoleteTag` and `ObsoleteReason`, or cyclomatic complexity. With
the AL compiler available, `bca check` runs it with the analyzers of
`al.codeAnalyzers` (CodeCop, UICop, AppSourceCop, PerTenantExtensionCop, or
LinterCop) and reports their diagnostics.

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
(apps, files, objects, relationships, object and relationship counts, and
`compiler` when the AL toolchain ran), `counts`, `hubs`, and `findings`.
Findings from the AL compiler also carry `column`, `endLine`, `endColumn`,
`helpLink`, and `origin: "al"`.

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
