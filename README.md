# BC Atlas

[![CI](https://github.com/SchulzOli/ALD2Tree/actions/workflows/ci.yml/badge.svg)](https://github.com/SchulzOli/ALD2Tree/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

BC Atlas is an open-source CLI for Microsoft Dynamics 365 Business Central AL
projects. It turns AL source into architecture diagrams, executable user
documentation, and a linked Markdown code catalog.

BC Atlas parses AL with
[`tree-sitter-al`](https://github.com/SShadowS/tree-sitter-al) and uses a shared
architecture model for every output. The parser and SVG renderer are bundled as
WebAssembly, so the standard workflow needs only Node.js.

## Features

### Architecture diagrams

Explore an AL application through focused project, module, object, data, call,
boundary, contract, event, UI, and workflow views. Export editable D2, rendered
SVG, or machine-readable JSON while retaining relationship evidence and
resolution diagnostics.

[Learn more about architecture diagrams](./docs/architecture-diagrams.md)

### Executable user documentation

Generate deterministic Markdown guides directly from AL `[Test]` procedures.
`[SCENARIO]`, `[GIVEN]`, `[WHEN]`, and `[THEN]` comments describe intent, while
`TestPage` operations provide concrete user steps. The AL test remains the
single source for both verification and documentation.

[Learn more about documentation from AL UI tests](./docs/al-ui-test-documentation.md)

### Code Graph as Markdown

Create a navigable code catalog with one Markdown file per workspace AL object.
Each page contains object metadata, type-specific structure, dependencies,
backlinks, and a project-relative source reference.

[Learn more about Code Graph as Markdown](./docs/code-graph-markdown-design.md)

## Example output

These diagrams are generated from the checked-in
[warehouse example](./examples/README.md) with BC Atlas itself.

### Complete architecture

![BC Atlas project view showing UI, service, data, contract, and security relationships](./docs/generated/images/project-view.png)

### Focused workflow and UI views

| Workflow trace | UI composition |
| --- | --- |
| ![Workflow trace showing calls, an event dispatch, and a table write](./docs/generated/images/workflow-view.png) | ![UI view showing a page extension, page action, and source table](./docs/generated/images/ui-view.png) |

The matching editable [D2 and SVG files](./examples/output) are committed and
can be regenerated with `npm run examples`.

## Quick start

Requirements: Node.js 20 or later. Install the published CLI globally:

```sh
npm install --global bc-atlas
```

Create an architecture diagram:

```sh
bca graph ./path/to/al-project --view project -o architecture.svg
```

Generate a user guide from an AL UI test:

```sh
bca docs generate ./path/to/UITest.Codeunit.al --procedure MyScenario
```

Create a Markdown code catalog:

```sh
bca codegraph ./path/to/al-project --output-dir docs/codegraph
```

D2, JSON, and SVG output need no additional compiler. PNG and PDF rendering
requires the optional D2 executable.

## Local Control Center

Open architecture views and AL UI-test documentation in one local interface:

```sh
bca serve ./path/to/al-project --tests ./path/to/ui-tests --port 0
```

The server binds locally and keeps AL source authoritative; it does not maintain
a separate scenario database. See the [Control Center guide](./docs/control-center.md).

## Agents and automation

Agents can discover the installed, versioned CLI contract before constructing a
command:

```sh
bca capabilities
```

BC Atlas also provides the `bca-mcp` stdio server. See the
[agent integration guide](./docs/agent-integration.md) for setup, available
tools, output contracts, and write safeguards. For CI examples, strict checks,
and generated-artifact validation, see [Automation and CI](./docs/automation-and-ci.md).

## Documentation

- [Getting started](./docs/getting-started.md)
- [Architecture diagrams](./docs/architecture-diagrams.md)
- [Documentation from AL UI tests](./docs/al-ui-test-documentation.md)
- [Code Graph as Markdown](./docs/code-graph-markdown-design.md)
- [Configuration](./docs/configuration.md)
- [Control Center](./docs/control-center.md)
- [Agent integration](./docs/agent-integration.md)
- [Automation and CI](./docs/automation-and-ci.md)
- [Troubleshooting](./docs/troubleshooting.md)
- [Complete CLI reference](./docs/cli-reference.md)
- [Documentation table of contents](./docs/_TOC_.md)

## Local development

```sh
git clone https://github.com/SchulzOli/ALD2Tree.git
cd ALD2Tree
npm ci
npm run check
npm test
npm run examples
npm pack --dry-run
```

The repository pins the upstream AL grammar artifact in
`vendor/tree-sitter-al.wasm`. Maintainers can update it with
`npm run update:grammar -- <tree-sitter-al tag>`.

## Contributing and support

Contributions are welcome. Start with [CONTRIBUTING.md](./CONTRIBUTING.md) and
read the [Code of Conduct](./CODE_OF_CONDUCT.md). Use the issue forms for bugs
and feature requests, [SUPPORT.md](./SUPPORT.md) for usage help, and
[SECURITY.md](./SECURITY.md) for private vulnerability reporting.

Release notes are maintained in [CHANGELOG.md](./CHANGELOG.md).

## License

[MIT](./LICENSE). Dependencies retain their own licenses; see
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).