# BC Atlas examples

`monolith` is one app with Core, Sales, Warehouse, and permission folders,
a misplaced event subscriber, tables written by other components, and an
internal codeunit: the walkthrough of [Split a monolith into apps](../docs/modularization.md)
runs on it.

`warehouse-app` is a small, standalone AL project designed to exercise BC
Atlas without customer code. It contains namespaces, tables, pages, a page
extension, an interface implementation, enum-based dispatch, procedure calls,
an integration event and subscriber, record writes, and a permission set.

Generate every checked-in example from the repository root:

```sh
npm ci
npm run examples
```

The command writes matching D2 source and SVG files to `examples/output`:

- `project` shows the complete role-oriented architecture;
- `workflow` traces request processing through calls, writes, and events;
- `ui` focuses on pages, actions, extensions, and source tables.

It also writes the complete [architecture report](./report/README.md) produced
by `bca export examples/warehouse-app --view report -o examples/report --codegraph`,
including the health summary and one Markdown page per object.

Finally it generates the [user documentation](./docs/index.md) from the AL UI
tests in `WarehouseUITests.al`, using real captions and tooltips from the app,
as Markdown, a single [HTML file](./docs/index.html), DITA 1.3 tasks, and an
Azure DevOps test-case CSV. The app's `Translations` folder contains a German
XLIFF file; try `--language de-DE` to see translated output.

`multi-app` is a workspace with three apps that depend on each other, one of
them without declaring it. `npm run examples` replays it as a Git history and
writes the [dependency explorer example](./explorer/README.md):

```sh
node src/cli.js export examples/multi-app --view explorer -o dependencies.html
```

Open either example in the app, or export other views:

```sh
node src/cli.js app examples/warehouse-app
node src/cli.js export examples/warehouse-app -o warehouse.html
node src/cli.js export examples/warehouse-app --view contracts -o contracts.svg
node src/cli.js export examples/warehouse-app --view events -o events.svg
node src/cli.js export examples/warehouse-app --view data -o data.svg
node src/cli.js export examples/warehouse-app --view project -f json -o model.json
node src/cli.js check examples/warehouse-app
```

The documentation website hosts both examples as exported apps:
[warehouse](https://schulzoli.github.io/BC-Atlas/examples/app/html/warehouse-app.html)
and [multi-app](https://schulzoli.github.io/BC-Atlas/examples/app/html/multi-app.html).

The diagram images in `docs/generated/images` are PNG renderings of these SVG
files; `npm run examples` writes both.
