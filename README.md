# BC Atlas

[![CI](https://github.com/SchulzOli/BC-Atlas/actions/workflows/ci.yml/badge.svg)](https://github.com/SchulzOli/BC-Atlas/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

**Understand, guard, and document Microsoft Dynamics 365 Business Central AL
projects - straight from source.**

BC Atlas (`bca`) parses AL with
[`tree-sitter-al`](https://github.com/SShadowS/tree-sitter-al), resolves
objects, calls, events, data access, and permissions into an architecture
model, and turns it into diagrams, health checks, reports, and documentation.
Parser and renderer are WebAssembly: Node.js is the only requirement.

```sh
npm install --global bc-atlas
cd path/to/al-project
bca init      # create .bca.json
bca report    # docs/atlas/README.md: overview, diagrams, health
bca check     # architecture gate for CI
```

## Features at a glance

| Area | Command | What you get |
| --- | --- | --- |
| **Get started** | `bca init` | A `.bca.json` tailored to your app: title, excluded test folders, source links for your Git host. |
| | `bca report` | One Markdown page with an at-a-glance table, six architecture diagrams, and the health summary. [Example](./examples/report/README.md) |
| **Visualize** | `bca graph` | D2, SVG, PNG, PDF, or JSON for ten focused views (below). |
| | `bca watch` | The same diagram, rebuilt on every AL change. |
| **Analyze** | `bca check` | Health findings - cycles, forbidden dependencies, hot spots, diagnostics - with a CI exit code. |
| | `bca inspect` | The resolved architecture model as JSON for scripts. |
| **Document** | `bca codegraph` | One linked Markdown page per AL object. |
| | `bca docs` | User guides and test cases from AL UI tests (`[SCENARIO]`, `[GIVEN]`, `[WHEN]`, `[THEN]`) as Markdown, HTML, DITA 1.3, or Azure DevOps CSV, with real captions and translations. [Example](./examples/docs/index.md) |
| **Integrate** | `bca capabilities` | A versioned JSON contract of every command for tools and agents. |
| | `bca mcp` | A Model Context Protocol server for AI agents. |

Run `bca` for the same overview in your terminal and `bca help <command>` for
options and examples.

## Views

| View | Answers | Example |
| --- | --- | --- |
| `project` | What does the app contain? | `bca graph --view project -o project.svg` |
| `module` | How do namespaces or folders depend on each other? | `bca graph --view module -o modules.svg` |
| `object` | What surrounds one object? | `bca graph --view object --object codeunit:50100 -o object.svg` |
| `data` | Which code reads and writes which tables? | `bca graph --view data -o data.svg` |
| `call` | Which procedures call each other? | `bca graph --view call --root-procedure Post --call-direction both -o calls.svg` |
| `boundary` | What crosses a namespace, folder, app, or object boundary? | `bca graph --view boundary --scope namespace:Contoso.Sales -o boundary.svg` |
| `contracts` | Which types implement an interface? | `bca graph --view contracts -o contracts.svg` |
| `events` | Which subscribers react to which publishers? | `bca graph --view events --focus OnPosted -o events.svg` |
| `ui` | How do pages, actions, and source tables connect? | `bca graph --view ui --focus "Sales Order" -o ui.svg` |
| `workflow` | What happens after an action or entry point? | `bca graph --view workflow --entry action:Release -o flow.svg` |

### Screenshots

Generated from the checked-in [warehouse example](./examples/README.md).

![BC Atlas project view showing UI, service, data, contract, and security relationships](./docs/generated/images/project-view.png)

| Workflow trace | UI composition |
| --- | --- |
| ![Workflow trace showing calls, an event dispatch, and a table write](./docs/generated/images/workflow-view.png) | ![UI view showing a page extension, page action, and source table](./docs/generated/images/ui-view.png) |

## What BC Atlas understands

- extensions and customization targets, implemented interfaces, and
  enum-mediated implementations;
- dependencies through `Record`, object references, and database types;
- procedure calls, including typed codeunit variables, overloads, chained
  calls, and `EventSubscriber` attributes;
- table reads, writes, schema relations, explicit commits, and safe
  cardinality evidence;
- permission sets: table-data `RIMD` rights, execute rights, and composed sets
  across dependent apps;
- pages, parts, actions, and navigation;
- `app.json` metadata, `.alpackages` symbols, multi-app workspaces, cycles,
  hubs, orphans, and unresolved references.

Relationship colors are consistent across views, and labels and dash patterns
ensure that color is never the only signal. Every edge keeps its evidence
(operations, source procedures, locations) in JSON and SVG tooltips.

## Guard the architecture

```sh
bca check --fail-on warning
```

```json
{
  "check": { "failOn": "warning", "cycles": "error", "maxFanIn": 25, "maxFanOut": 25 },
  "forbiddenDependencies": [
    { "from": "Contoso.Core:**", "to": "Contoso.UI:**", "severity": "error", "message": "Core must not depend on UI" }
  ]
}
```

`--format markdown` produces a summary for pull requests or job pages; see
[Automation and CI](./docs/automation-and-ci.md).

## Documentation

Start with the [documentation table of contents](./docs/_TOC_.md):

- [Getting started](./docs/getting-started.md)
- [Architecture reports](./docs/reports.md) and [health checks](./docs/health-checks.md)
- [Architecture diagrams and views](./docs/architecture-diagrams.md)
- [Configuration](./docs/configuration.md) and the complete [`.bca.example.json`](./.bca.example.json)
- [Documentation from AL UI tests](./docs/al-ui-test-documentation.md) and [Code Graph](./docs/code-graph-markdown-design.md)
- [Agent integration and MCP](./docs/agent-integration.md)
- [CLI reference](./docs/cli-reference.md) and [troubleshooting](./docs/troubleshooting.md)

## AI agents and tools

```sh
bca capabilities   # versioned JSON contract: argv templates, options, enums, exit codes
bca mcp            # MCP stdio server (also installed as bca-mcp)
```

Agents should read the contract first, pass arguments as arrays, parse stdout
only after a successful exit code, and preview AL metadata edits with
`--dry-run`. The MCP server exposes inspect, check, report, diagram, and
documentation tools. See [agent integration](./docs/agent-integration.md).

## How it works

```text
*.al + app.json + .alpackages
  -> tree-sitter AL syntax tree
  -> objects, members, relations          (analyzer)
  -> resolved model with evidence         (resolver, call analysis, semantics)
  -> view projection and insights         (views, workflow, health)
  -> D2 / SVG / JSON / Markdown           (renderers)
```

Parsing, resolution, projection, and rendering are separate stages, so new
views and outputs do not touch the parser. Every command is defined once in
`src/capabilities.js`; help, argument validation, the JSON contract, and the
generated reference derive from it.

### Current limits

BC Atlas is an architecture extractor, not the AL compiler. References resolve
by object type, ID, name, namespace, app preference, and declared dependencies,
including `.alpackages` symbols. Dynamic calls, interface dispatch, and unusual
subscriber forms stay syntactic or unresolved when the source does not identify
a target. Conditional compilation is represented as parsed, not evaluated.

## Development

```sh
git clone https://github.com/SchulzOli/BC-Atlas.git
cd BC-Atlas
npm ci
npm run check      # syntax check and generated-docs check
npm test
npm run examples   # regenerate examples/output and examples/report
```

Container:

```sh
docker build -t bc-atlas .
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" bc-atlas report /workspace/app --output-dir /workspace/docs/atlas
```

The AL grammar is pinned in `vendor/tree-sitter-al.wasm`; update it with
`npm run update:grammar -- <tree-sitter-al tag>`. The [roadmap](./ROADMAP.md)
lists planned work.

### Publishing

Releases are published manually through the `Publish npm package` workflow.
Update and commit the version in `package.json` and `package-lock.json`, then
enter that exact version in the workflow form. The workflow rejects mismatched
or already published versions, runs all checks, and publishes with the selected
dist-tag. It requires an `NPM_TOKEN` repository secret.

## Contributing and support

Contributions are welcome - see [CONTRIBUTING.md](./CONTRIBUTING.md) and the
[Code of Conduct](./CODE_OF_CONDUCT.md). Use [SUPPORT.md](./SUPPORT.md) for
help and [SECURITY.md](./SECURITY.md) for private vulnerability reports.
Release notes are in [CHANGELOG.md](./CHANGELOG.md).

## License

[MIT](./LICENSE). Dependencies retain their own licenses: `tree-sitter-al` and
`web-tree-sitter` are MIT, and D2 is MPL-2.0. See
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
