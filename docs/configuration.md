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

## Shape the architecture proposal

`architecture.proposal` decides what `bca architecture --propose` takes into
account: which relation kinds count, which existing structures it starts from,
how finely it splits, components you define yourself, and objects that should
not shape components. See
[Decide what the proposal considers](./clean-architecture.md#decide-what-the-proposal-considers).

Add `"$schema": "./node_modules/bc-atlas/schemas/bca.schema.json"` (or the
schema's GitHub URL) to `.bca.json` for completion and checks in editors; the
VS Code extension applies the schema to `.bca.json` on its own.

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

## Shape the generated documentation

[`bca layers`](./layers.md) writes every page and section in English unless
`layers` says otherwise:

```json
{
  "layers": {
    "outputDir": "docs/layers",
    "pictures": "auto",
    "history": "none",
    "view": false,
    "pages": { "stories": false, "lenses": ["data", "events"] },
    "scope": { "apps": ["Contoso Sales"], "types": ["table", "codeunit", "page"], "exclude": ["*Test*"] },
    "sections": { "object": ["Inside", "Uses", "Used by"] },
    "titles": { "Used by": "Who uses it", "README": "Our system" },
    "language": "de",
    "names": { "objects": "objekte/{type}/{name}.md", "readme": "index.md" },
    "templates": "docs/templates",
    "profiles": {
      "management": { "outputDir": "docs/overview", "pages": { "objects": false } }
    }
  }
}
```

| Key | Default | Does |
| --- | --- | --- |
| `outputDir` | `docs/layers` | The folder of the pages |
| `pictures` | `auto` | Pictures of single objects: `auto` (up to 400 objects), `all`, or `none` |
| `history` | `none` | `releases`: every run also records each release (Git tag) not recorded yet |
| `view` | `false` | Also write `view.html`, the view as one offline file |
| `pages` | every page | Per kind (`readme`, `architecture`, `changes`, `findings`, `apps`, `components`, `namespaces`, `objects`, `lenses`, `stories`): `false` leaves it out, a list of names, IDs, or patterns with `*` keeps those |
| `scope` | the whole system | Only objects that match `apps`, `components`, `namespaces`, `types`, and no entry of `exclude` are documented |
| `sections` | every section | Per kind of page (`readme`, `architecture`, `changes`, `findings`, `app`, `component`, `namespace`, `object`, `lens`, `story`): the sections to write, in that order |
| `titles` | | A heading in English, and what to call it; `object.Used by` for one kind of page, `README` for the title of the first page |
| `language` | `en` | `de`: the fixed headings, table headers, labels, and the footer in German |
| `names` | | The file of a kind of page, with `{name}`, `{type}`, `{id}`, `{app}`, `{component}`, `{namespace}`; links and pictures follow |
| `templates` | | Folder with `<kind>.md` templates: <code v-pre>{{title}}</code>, <code v-pre>{{summary}}</code>, <code v-pre>{{picture}}</code>, <code v-pre>{{section "Uses"}}</code>, <code v-pre>{{body "Uses"}}</code>, <code v-pre>{{sections}}</code>, <code v-pre>{{footer}}</code>, and facts such as <code v-pre>{{name}}</code> |
| `profiles` | | Named sets of the keys above for `bca layers --profile <name>`; each writes to its `outputDir`, or to `<outputDir>-<name>` |

A setting that is not valid writes nothing: the error names the key and
lists what can be chosen. See
[the documentation profile](./layers.md#what-is-written-and-how-the-documentation-profile)
for each key, the sections of each kind of page, and what `language`
translates.

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

## Your own workflows and processes

Three sections are built in the view (the **Flow** menu and its builder), from
the terminal, or by an agent, and can be written by hand as well:

```json
{
  "flows": [
    { "id": "docs", "when": ["pre-push", "ci"], "steps": [
      { "id": "gate", "what": "check" },
      { "what": "layers", "to": "docs/system", "after": ["gate"] }
    ] }
  ],
  "processes": [
    { "id": "purchase-requests", "title": "Purchase requests", "steps": [
      { "id": "create", "title": "Create a request", "lane": "Employee", "test": "purchase-request-create" },
      { "id": "approve", "title": "Approve it", "lane": "Team lead", "test": "purchase-request-approve", "after": ["create"] }
    ] }
  ],
  "processTelemetry": { "path": "telemetry", "case": "requestNo" }
}
```

| Section | Says | Guide |
| --- | --- | --- |
| `flows` | What to make from the source (the artifacts), when (the triggers), and where to save it; steps can come after others, if they passed, failed, or always. `bca run` runs them. | [Flows](./flows.md) |
| `processes` | How the company works with the app: steps in the lanes of the roles that do them, each with the process test or recording that shows it works. `bca process` mines, runs, and exports them. | [Processes](./processes.md) |
| `processTelemetry` | Where the telemetry of Business Central is (exports of Application Insights), and which field carries the case: the time of the processes. | [Its time: telemetry](./processes.md#its-time-telemetry) |

Where the nodes of the flows are on the canvas of the builder is not in
`.bca.json` but next to it, in `.bca/flow-canvas.json`.

See the [CLI reference](./cli-reference.md#configuration-file) for all properties.
