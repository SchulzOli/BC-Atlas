# Getting started

BC Atlas reads Microsoft Dynamics 365 Business Central AL source and turns it
into an app for your browser: architecture, health, dependencies, diagrams,
objects, and documentation in one place. The same results are available as
files for Git and CI. This page takes you from installation to a guarded
architecture in a few commands.

You are reading the docs either on GitHub or on the
[documentation website](https://schulzoli.github.io/BC-Atlas/), which adds
search.

## Requirements

- Node.js 22 or later.
- An AL project that contains an `app.json` file.
- Optional: the [D2 executable](https://d2lang.com) for PNG or PDF output.

The AL parser and the SVG renderer are bundled as WebAssembly. D2, JSON, SVG,
and Markdown output need no compiler or extra download.

## 1. Install

- **In VS Code** (daily work): install the **BC Atlas** extension
  (`SchulzOli.bc-atlas`). It brings the engine with it; nothing else is needed.
- **On the command line, in Git hooks and pipelines**:

  ```sh
  npm install --global bc-atlas
  bca --version
  ```

  Run `bca --help` to see every feature grouped by area.

## 2. Open the project in VS Code

Open the folder with your `app.json`. BC Atlas analyzes the source and shows
health in the status bar, findings in the Problems panel, and CodeLens above
each object. **BC Atlas: Open** shows the panel: an overview, health
findings, the architecture (proposed from today's dependencies until you
adopt one), the 3D dependency explorer, every diagram view, and one page per
object. It updates when AL files change. See
[BC Atlas for VS Code](./vscode.md).

## 3. Set up the project

```sh
cd path/to/al-project
bca setup
```

`setup` detects your app, UI tests, translations, and Git host, then asks which
features to automate, which Git hooks (Husky or plain Git) and pipeline
(GitHub Actions or Azure Pipelines) to use, when to run on a schedule, and how
generated files stay in sync. It writes `.bca.json`, the hooks, and the
pipeline. Prefer a conversation? Run `bca setup agent --agent claude` (or
`copilot`, `cursor`) and use `/bca-setup` in your agent. See
[Guided setup](./setup.md).

The starter `.bca.json` excludes test folders and links objects to your Git
host. See [Configuration](./configuration.md).

## 4. Write the overview into the repository

```sh
bca export --view report
```

This writes `docs/atlas/README.md` with:

- an at-a-glance table (files, objects, relationships, cycles, health);
- one diagram each for the project, module, data, contracts, events, and UI
  views;
- the architecture health summary;
- the command that regenerates the report.

Add `--codegraph` for one linked Markdown page per AL object. See
[Architecture reports](./reports.md) and the
[generated example](../examples/report/README.md).

To share the BC Atlas pages with people who do not use VS Code,
`bca export -o atlas.html` writes them as one offline HTML file.

## 5. Guard the architecture in CI

```sh
bca check
```

`check` prints a health summary and exits with `1` when a finding reaches the
fail level (default: `error`). Use `--fail-on warning` to also block cycles,
forbidden dependencies, and hot spots. Once you adopt an architecture (in the
app, or with `bca architecture --propose --write --update-baseline`), `check`
also fails on new dependencies that point the wrong way. See
[Architecture health checks](./health-checks.md),
[Clean architecture](./clean-architecture.md), and
[Automation](./automation-and-ci.md).

## 6. Stay up to date

BC Atlas tells you in the terminal when a new version exists:

```text
BC Atlas 0.8.0 is available (you have 0.7.0). Run "bca update" to see what's new.
```

`bca update` shows the release notes, asks before installing, and moves your
Git hooks, VS Code tasks, and pipeline to the new version. Teams on GitHub can
let Dependabot propose updates instead. See
[Staying up to date](./setup.md#staying-up-to-date).

## Go deeper

| I want to | Command | Read |
| --- | --- | --- |
| See one object and its neighbors | Objects page in VS Code, or `bca export --view object --object codeunit:50100 -o object.svg` | [Architecture diagrams](./architecture-diagrams.md) |
| Trace what happens after an action | `bca export --view workflow --entry action:Release -o flow.svg` | [Architecture diagrams](./architecture-diagrams.md) |
| Split a large app into smaller ones | Architecture page in VS Code, or `bca architecture --propose` | [Clean architecture](./clean-architecture.md) |
| Keep a diagram file current while coding | `bca export --view module -o modules.svg --watch` | [CLI reference](./cli-reference.md#export) |
| Feed the model to a script | `bca export --view project --format json > model.json` | [CLI reference](./cli-reference.md#export) |
| Turn UI tests into user guides | `bca docs generate ./test --output-dir docs/guides` | [AL UI-test documentation](./al-ui-test-documentation.md) |
| Let an AI agent use BC Atlas | `bca mcp` | [Agent integration](./agent-integration.md) |

## Run from a checkout

```sh
git clone https://github.com/SchulzOli/BC-Atlas.git
cd BC-Atlas
npm ci
npm link            # optional: makes `bca` available globally
node src/cli.js --help
```
