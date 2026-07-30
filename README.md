# ald2tree

`ald2tree` is a lightweight CLI that parses Microsoft Dynamics 365 Business
Central AL source with
[`tree-sitter-al`](https://github.com/SShadowS/tree-sitter-al), builds a small
architecture graph, and writes
[`D2`](https://github.com/terrastruct/d2) diagram source.

The CLI discovers AL objects, groups them by namespace, and shows:

- extension and customization targets;
- implemented interfaces;
- dependencies expressed through `Record`, object-reference, and database types;
- unresolved targets as external nodes;
- procedure calls, including calls through typed codeunit variables and common
  event-subscriber attributes;
- app metadata from `app.json`, resolution diagnostics, cycles, hubs, and
  orphan objects.

## Quick start

Requirements: Node.js 20 or later. Both the AL parser and SVG renderer run as
WebAssembly, so no native compiler toolchain or separate D2 installation is
needed for `.d2`, `.json`, or `.svg` output. PNG and PDF output still use the
optional D2 executable.

```sh
npm install
npm link

ald2tree ./path/to/al-project -o architecture.d2
ald2tree ./path/to/al-project -o architecture.svg
```

When `--format` conflicts with the output extension, the format wins:
`-o calls.d2 -f svg` retains `calls.d2` and writes the rendered image to
`calls.svg`.

## Views and inspection

```sh
# Whole project
ald2tree graph ./app --view project -o project.d2

# Aggregated namespace modules
ald2tree graph ./app --view module -o modules.d2

# Folder-based modules instead of namespaces
ald2tree graph ./app --view module --group-by folder -o folders.d2

# One object plus its neighbors
ald2tree graph ./app --view object --object codeunit:50100 -o posting.d2

# Tables and data-oriented references
ald2tree graph ./app --view data -o data.d2

# Procedures, triggers, and syntactically resolvable calls
ald2tree graph ./app --view call -o calls.d2

# Include unresolved/external calls for investigation
ald2tree graph ./app --view call --include-unresolved-calls -o all-calls.d2

# Dependencies crossing a namespace, folder, app, or object boundary
ald2tree graph ./app --view boundary \
  --scope namespace:Contoso.Sales -o boundary.svg

# Interfaces, direct implementations, and enum-mediated implementations
ald2tree graph ./app --view contracts -o contracts.svg

# Event publishers and subscribers
ald2tree graph ./app --view events --focus OnPosted -o events.svg

# Page composition, source tables, actions, and navigation
ald2tree graph ./app --view ui --focus "Sales Order" -o ui.svg

# Machine-readable graph, diagnostics, app metadata, and insights
ald2tree inspect ./app -o model.json

# Rebuild after AL/config/app.json changes
ald2tree watch ./app --view project -o architecture.d2
```

Filters are repeatable and work in CI:

```sh
ald2tree ./app \
  --namespace "Contoso.Sales.**" \
  --type table,codeunit \
  --exclude "**/test/**" \
  --max-edges 300 \
  -o sales.d2
```

Current views favor readability:

- project diagrams use role lanes (`Data`, `UI`, `Services`, `Contracts`,
  `Security`) unless `--group-by namespace|folder|type` is supplied;
- module diagrams automatically keep the common namespace prefix and expose
  the first meaningful segment; numeric `--module-depth` remains available;
- call diagrams show resolved calls by default;
- data diagrams show table relations and detected reads/writes instead of
  every `Record` declaration;
- object diagrams include field, action, and procedure names for the focused
  object;
- boundary diagrams show inbound and outbound dependencies for repeatable
  `namespace:`, `folder:`, `app:`, and `object:` scopes;
- contract diagrams distinguish direct `implements` relationships from enum
  implementation selection;
- event diagrams connect declared event publishers to subscriber procedures and
  retain unresolved subscriptions;
- UI diagrams separate pages, actions, source tables, parts, and navigation
  targets;
- relation colors are consistent across every view: calls are blue, reads are
  dark blue, writes are orange-red, data relations are green, extensions are
  pink, implementations are amber, events are magenta, navigation is green,
  page composition is cyan, and permissions are purple; labels and dash
  patterns remain present so color is never the only signal;
- repeated edges are aggregated and labelled with their count;
- permission-set and codeunit `Permissions` declarations are represented as
  `permits [RIMD]` edges.

Run `ald2tree --help` for the complete CLI reference.

## Configuration

Place `.ald2tree.json` at the input root or pass `--config`. Command-line
options override configuration. See
[`.ald2tree.example.json`](./.ald2tree.example.json) for view, layout, filters,
theme, density, and forbidden-dependency policy examples.

Forbidden dependency patterns match
`Namespace:ObjectType:ObjectName`. Policy violations appear in JSON diagnostics
and cause `--strict` to fail when configured as warnings or errors.

Open the generated `.d2` file in the D2 playground or render it locally:

```sh
d2 architecture.d2 architecture.svg
```

## Design

The pipeline deliberately separates parsing, semantic extraction, and
presentation:

```text
*.al files -> tree-sitter AL AST -> neutral graph model -> D2 source -> optional image
```

This keeps the core useful without D2 installed and allows additional diagram
views without replacing the parser. See [plan.md](./plan.md) for the roadmap
and design decisions.

## Executable user documentation

The `docs generate` command turns an AL `[Test]` procedure into goal-oriented
Markdown directly. It combines `[SCENARIO]`, `[GIVEN]`, `[WHEN]`, and `[THEN]`
comments with `TestPage` operations to produce concrete page, field, action,
save, and outcome guidance:

```sh
ald2tree docs generate ../app-test/src/PartnerUITest.Codeunit.al \
  --procedure PartnersList_NewPartner_PersistsGeneralFields
```

No browser test or second implementation of the scenario is generated. See the
[AL UI-test documentation guide](./docs/al-ui-test-documentation.md) for source
conventions and CI usage.

## Current limits

This is an architecture extractor, not the AL compiler or language server.
Project-local references are resolved by object type, ID, name, namespace, app
preference, and declared app dependencies. Direct calls, calls through typed
object variables, and common `EventSubscriber` attributes are resolved where
possible. Dynamic calls, interface dispatch, and unusual subscriber forms
remain syntactic/unresolved when the source does not provide enough
information. Conditional compilation branches are represented as parsed by the
grammar rather than evaluated against a symbol set.

## Development

```sh
npm install
npm test
npm run check
node src/cli.js test/fixtures -o example.d2
npm pack --dry-run
```

Container usage:

```sh
docker build -t ald2tree .
docker run --rm -v "$PWD:/workspace" ald2tree /workspace -o /workspace/architecture.d2
```

The repository pins the upstream AL grammar artifact in
`vendor/tree-sitter-al.wasm`. Maintainers can update it with
`npm run update:grammar -- <tree-sitter-al tag>`.

## License

MIT. Dependencies retain their own licenses: `tree-sitter-al` is MIT,
`web-tree-sitter` is MIT, and D2 is MPL-2.0.
