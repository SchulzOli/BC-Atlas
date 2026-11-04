# Configuration

BC Atlas reads `.bca.json` from the input root. Use `--config` to select another JSON file.

Command-line options override configuration values.

## Create a configuration

Run `bca setup` in the folder that contains `app.json`. It writes a starter
`.bca.json` with your app name, excluded test folders, source links for your
Git host, and default `check` and `report` sections, and asks which
automation you want. For the file alone, answer `none` to the automation
questions or run:

```sh
bca setup apply ./app --hooks none --ci none --editor none --schedule none --dry-run
bca setup apply ./app --hooks none --ci none --editor none --schedule none
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

Rules that work with the components and layers of a target architecture
(`component:Sales`, `layer:0`, relation kinds such as `writes`) go into
`architecture.rules`; see [Rules of your own](./clean-architecture.md#rules-of-your-own).

## Configure health checks and reports

```json
{
  "check": {
    "failOn": "error",
    "cycles": "warning",
    "maxFanIn": 25,
    "maxFanOut": 25,
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
  "report": {
    "outputDir": "docs/atlas",
    "views": ["project", "module", "data", "contracts", "events", "ui"],
    "codegraph": false
  }
}
```

`check.contractExpectations` opts selected interface methods into a warning
when a resolved enum implementation can complete silently through an empty
body, a constant `true` return, or a conditional path with no error. Each
`interface` selector must match exactly one existing interface object, and
every method name must exist on that interface. Selectors use the same syntax
as architecture selectors, such as `object:interface:IPipelineStep`,
`id:50100`, or `namespace:Contoso.Pipeline`. Without an expectation, detected
neutral fallbacks are informational and do not fail the default check. Set
`failOn` to `"warning"` (or use `--fail-on warning`) to fail on configured
expectations.

The body classification is structural evidence from supported source syntax,
not proof of runtime behavior. Symbol-only bodies, unresolved delegation, and
ambiguous implementation signatures remain unknown rather than being treated
as empty or safe.

`check.contexts` opts specific objects into context-responsibility summaries.
Each `object` and role entry uses an existing object selector and must match
objects in the analyzed project. `maxCallDepth` is a positive integer with a
default of `3`; direct operations are reported separately from bounded
indirect call candidates. The analysis reports reads, persistent and temporary
writes, explicit commits, resolved calls, and in-memory assignments to global
variables. Permission grants and cache assignments are not persistent writes.
If temporary state cannot be determined, the write remains uncertain.

Planning and partner-resolution responsibilities are attributed only to
objects explicitly listed under `roles.planning` and
`roles.partnerResolution`. `lazyReadMethods` takes exact procedure signatures
on the selected object, such as `"TryGetExchange()"`; method names alone do not
establish a responsibility. Read-only lazy reads remain visible and permitted
unless `"lazy-reads"` is in `forbid`. The supported `forbid` values are
`"persistent-writes"`, `"commits"`, `"planning"`, `"partner-resolution"`, and
`"lazy-reads"`. An empty or omitted `forbid` reports evidence without asserting
a policy violation. Configured violations are warnings and follow the normal
`failOn` threshold.

Indirect findings are bounded candidates, not proof of runtime behavior.
Unresolved calls, cycles, and depth limits are disclosed in
`contextResponsibilities.summaries[].limitations`; the JSON finding evidence
also identifies direct versus indirect effects. With no `check.contexts`
setting, health output retains its existing shape. CLI and MCP checks use the
same canonical analysis.

These policies are opt-in: without `check.contractExpectations`, detected
neutral contract fallbacks remain informational and do not become warnings.
Without `check.contexts`, no context-responsibility findings or
`contextResponsibilities` report section are produced.

See [Architecture health checks](./health-checks.md) and
[Architecture reports](./reports.md).

## Use the AL compiler

```json
{
  "al": {
    "compiler": "auto",
    "analyzers": ["CodeCop", "UICop"],
    "errorLog": ".output/errorlogs",
    "callGraph": true
  }
}
```

| Property | Description |
| --- | --- |
| `compiler` | `auto` (default): the AL Language extension's compiler or the AL Development Tools when installed; `off`; or a path to `alc`, `al`, or the extension folder. |
| `analyzers` | Code analyzers for the compile. Default: `al.codeAnalyzers` from the AL settings when `al.enableCodeAnalysis` is on. |
| `errorLog` | Import an AL compiler error log file or folder from another build. |
| `callGraph` | `false` keeps calls at the source-level analysis while compiler diagnostics still apply. |
| `workspaceFile` | The `.code-workspace` file whose folders and settings apply, when the root has several. |

Symbols, rule set, and analyzers otherwise come from the AL settings in
`.vscode/settings.json` and the `.code-workspace` file. See
[AL toolchain](./al-toolchain.md).

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
