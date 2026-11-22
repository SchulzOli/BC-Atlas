# Getting started

BC Atlas reads Microsoft Dynamics 365 Business Central AL source and turns it
into a view for your editor and browser: how the system works, health,
dependencies, objects, and documentation in one place. The same results are
available as files for Git and CI. This page takes you from installation to a
health check in CI in a few commands.

You are reading the docs either on GitHub or on the
[documentation website](https://schulzoli.github.io/BC-Atlas/), which adds
search.

## Requirements

- Node.js 22 or later.
- An AL project that contains an `app.json` file.

The AL parser is bundled as WebAssembly, and BC Atlas draws its pictures
itself (layout with ELK, PNG with resvg). JSON, SVG, PNG, and Markdown output
need no browser or extra download.

## 1. Install

- **In VS Code** (daily work): install the **BC Atlas** extension
  (`SchulzOli.bc-atlas`). It brings the engine with it; nothing else is needed.
- **On the command line and in pipelines**:

  ```sh
  npm install --global bc-atlas
  bca --version
  ```

  Run `bca --help` to see every feature grouped by area.

## 2. Open the project in VS Code

Open the folder with your `app.json`. BC Atlas analyzes the source and shows
health in the status bar, findings in the Problems panel, and CodeLens above
each object. **BC Atlas: Open** shows the view: an overview, health
findings, every lens, and each object from the inside. It updates when AL
files change. See
[BC Atlas for VS Code](./vscode.md).

## 3. Write the overview into the repository

```sh
bca layers
```

This writes the documentation of the repository into `docs/atlas`: how it
works, how its apps and namespaces are connected, and one page per app,
namespace, and object, each with a picture. `bca layers --check` says in CI
whether the pages are still in sync with the source. See
[Layered documentation](./layers.md) and the
[generated example](../examples/layers/README.md).

To share the BC Atlas view with people who do not use VS Code,
`bca export -o atlas.html` writes it as one offline HTML file: the graph
with every lens, finding, and story.

## 4. Check the health in CI

```sh
bca check
```

`check` prints a health summary and exits with `1` when a finding reaches the
fail level (default: `error`). Use `--fail-on warning` to also block cycles,
forbidden dependencies, and hot spots. See
[Architecture health checks](./health-checks.md).

In a pipeline, install BC Atlas and run the checks as steps:

```sh
npm install --global bc-atlas
bca check --format sarif -o bca.sarif
bca layers --check
```

## Go deeper

| I want to | Command | Read |
| --- | --- | --- |
| See one object and its neighbors | Select it in the BC Atlas view and choose **Neighbors**, or `bca view --focus codeunit:50100 -o object.svg` | [CLI reference](./cli-reference.md#view) |
| Look at any part of the app without a window | `bca view --lens data`, `bca view --inside codeunit:50100`, `bca view --story fix` | [CLI reference](./cli-reference.md#view) |
| Write a picture of one lens | `bca view --lens modules --form diagram -o modules.svg` | [CLI reference](./cli-reference.md#view) |
| Keep the view file current while coding | `bca export -o atlas.html --watch` | [CLI reference](./cli-reference.md#export) |
| Feed the model to a script | `bca view --format json > atlas.json` | [CLI reference](./cli-reference.md#view) |
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
