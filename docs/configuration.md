# Configuration

BC Atlas reads `.bca.json` from the input root. Use `--config` to select another JSON file.

Command-line options override configuration values.

## Create a configuration

Create `.bca.json` next to `app.json`. The complete reference is [`.bca.example.json`](../.bca.example.json). A
minimal file looks like this:

```json
{
  "title": "Sales architecture",
  "namespaces": ["Contoso.**"],
  "exclude": ["**/test/**"]
}
```

Add `"$schema": "./node_modules/bc-atlas/schemas/bca.schema.json"` (or the
schema's GitHub URL) to `.bca.json` for completion and checks in editors; the
VS Code extension applies the schema to `.bca.json` on its own.

## Select what is analyzed

| Key | Does |
| --- | --- |
| `projectRoot` | Root of the AL project, relative to the file. |
| `paths` | Analyze only these folders (globs allowed). |
| `namespaces` | Namespace globs to keep. |
| `types` | Object types to keep, such as `table` or `codeunit` (like `--type`). |
| `include`, `exclude` | File or object globs to keep or to leave out. |
| `title` | Title of the view and the report. |

## Link to the source

```json
{
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
    "undeclaredDependencies": "warning",
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
    "lenses": ["overview", "apps", "modules", "data", "events", "contracts", "pages"],
    "json": false
  }
}
```

`check.contractExpectations` opts selected interface methods into a warning
when a resolved enum implementation can complete silently through an empty
body, a constant `true` return, or a conditional path with no error. Each
`interface` selector must match exactly one existing interface object, and
every method name must exist on that interface. Selectors use the same syntax
everywhere, such as `object:interface:IPipelineStep`,
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

`report` holds the defaults of `bca export --view report`: `outputDir`
(default `docs/atlas`), `lenses` (the lenses to draw; one the project does not
have is left out), `title`, and `json` (also write the resolved model as
`model.json`).

See [Architecture health checks](./health-checks.md) and
[Architecture reports](./reports.md).

## Read the AL workspace

```json
{
  "al": {
    "workspaceFile": "contoso.code-workspace"
  }
}
```

`al.workspaceFile` names the `.code-workspace` file whose folders and
`al.packageCachePath` apply, relative to the project root. Default: the one in
the root, when there is exactly one.

Symbol packages are read from `.alpackages` and from every
`al.packageCachePath` of `.vscode/settings.json` and the `.code-workspace`
file.

## Shape the generated documentation

[`bca layers`](./layers.md) writes every page and section in English unless
`layers` says otherwise:

```json
{
  "layers": {
    "outputDir": "docs/layers",
    "pictures": "auto",
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
| `view` | `false` | Also write `view.html`, the view as one offline file |
| `pages` | every page | Per kind (`readme`, `architecture`, `findings`, `apps`, `namespaces`, `objects`, `lenses`, `stories`): `false` leaves it out, a list of names, IDs, or patterns with `*` keeps those |
| `scope` | the whole system | Only objects that match `apps`, `namespaces`, `types`, and no entry of `exclude` are documented |
| `sections` | every section | Per kind of page (`readme`, `architecture`, `findings`, `app`, `namespace`, `object`, `lens`, `story`): the sections to write, in that order |
| `titles` | | A heading in English, and what to call it; `object.Used by` for one kind of page, `README` for the title of the first page |
| `language` | `en` | `de`: the fixed headings, table headers, labels, and the footer in German |
| `names` | | The file of a kind of page, with `{name}`, `{type}`, `{id}`, `{app}`, `{namespace}`; links and pictures follow |
| `templates` | | Folder with `<kind>.md` templates: <code v-pre>{{title}}</code>, <code v-pre>{{summary}}</code>, <code v-pre>{{picture}}</code>, <code v-pre>{{section "Uses"}}</code>, <code v-pre>{{body "Uses"}}</code>, <code v-pre>{{sections}}</code>, <code v-pre>{{footer}}</code>, and facts such as <code v-pre>{{name}}</code> |
| `profiles` | | Named sets of the keys above for `bca layers --profile <name>`; each writes to its `outputDir`, or to `<outputDir>-<name>` |

A setting that is not valid writes nothing: the error names the key and
lists what can be chosen. See
[the documentation profile](./layers.md#what-is-written-and-how-the-documentation-profile)
for each key, the sections of each kind of page, and what `language`
translates.

See the [CLI reference](./cli-reference.md#configuration-file) for all properties.
