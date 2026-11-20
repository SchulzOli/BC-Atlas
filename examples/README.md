# BC Atlas examples

`warehouse-app` is a small, standalone AL project designed to exercise BC
Atlas without customer code. It contains namespaces, tables, pages, a page
extension, an interface implementation, enum-based dispatch, procedure calls,
an integration event and subscriber, record writes, and a permission set.

Generate every checked-in example from the repository root:

```sh
npm ci
npm run examples
```

The command writes three pictures of the warehouse example to
`examples/output`, each a lens of the view as `bca view` draws it:

- `overview.svg` shows how it works: the screens, the logic, and the data;
- `data.svg` shows the tables and the code that reads and writes them;
- `pages.svg` shows the pages and what they show.

It also writes the [report](./report/README.md) produced by
`bca export examples/warehouse-app --view report -o examples/report`: the
numbers, a picture of each lens, and the health summary. The
[knowledge graph](./knowledge-graph/warehouse-app.ttl) of the same app is in
`examples/knowledge-graph`, as Turtle and OWL.

It generates the [user documentation](./docs/index.md) from the AL UI
tests in `WarehouseUITests.al`, using real captions and tooltips from the app,
as Markdown, a single [HTML file](./docs/index.html), DITA 1.3 tasks, and an
Azure DevOps test-case CSV. The app's `Translations` folder contains a German
XLIFF file; try `--language de-DE` to see translated output.

`purchasing-app` is a purchase request process over several roles: request,
release, approve, order, with its AL UI tests in `processes`.

`multi-app` is a workspace with three apps that depend on each other, one of
them without declaring it. `npm run examples` writes its
[layered documentation](./layers/README.md):

```sh
node src/cli.js layers examples/multi-app -o examples/layers
```

Export the view of an example, draw a lens, or check it:

```sh
node src/cli.js export examples/warehouse-app -o warehouse.html
node src/cli.js view examples/warehouse-app --lens contracts --form diagram -o contracts.svg
node src/cli.js view examples/warehouse-app --lens events -o events.svg
node src/cli.js view examples/warehouse-app --format json -o atlas.json
node src/cli.js check examples/warehouse-app
```

The documentation website hosts the examples as exported apps:
[warehouse](https://schulzoli.github.io/BC-Atlas/examples/app/html/warehouse-app.html),
[multi-app](https://schulzoli.github.io/BC-Atlas/examples/app/html/multi-app.html),
and [purchasing](https://schulzoli.github.io/BC-Atlas/examples/app/html/purchasing-app.html).

The images `overview-lens.png`, `data-lens.png`, and `pages-lens.png` in
`docs/generated/images` are PNG renderings of the SVG files in
`examples/output`; `npm run examples` writes both.
