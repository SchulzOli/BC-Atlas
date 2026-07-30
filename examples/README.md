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

The command writes matching D2 source and SVG files to `examples/output`:

- `project` shows the complete role-oriented architecture;
- `workflow` traces request processing through calls, writes, and events;
- `ui` focuses on pages, actions, extensions, and source tables.

You can also explore other views:

```sh
node src/cli.js graph examples/warehouse-app --view contracts -o contracts.svg
node src/cli.js graph examples/warehouse-app --view events -o events.svg
node src/cli.js graph examples/warehouse-app --view data -o data.svg
node src/cli.js inspect examples/warehouse-app -o model.json
```

The PNG images in `docs/generated/images` are browser captures of these SVG
outputs at a consistent viewport. Regenerate the SVG files first whenever view
rendering changes.
