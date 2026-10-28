# Troubleshooting

## The command is not found

Run `npm install --global bc-atlas`. For a checkout, run `npm ci` and
`npm link`, or call `node src/cli.js` from the repository root.

## "unknown command or path"

The first argument is neither a command nor an existing path. Run `bca` to see
all commands. A path alone is not a command: use `bca check <path>` or
`bca export <path>`, or open the folder in VS Code with the BC Atlas extension.

## "unknown command" for `graph`, `report`, `explore`, `inspect`, ...

These commands are now part of `bca export` and the VS Code extension. See the table
[Earlier commands](./cli-reference.md#earlier-commands) in the CLI
reference.

## The BC Atlas extension shows nothing

The extension starts when the workspace contains an `app.json`. Run
**BC Atlas: Show Output** for the analysis log and **BC Atlas: Select
Project…** to choose the app, or a folder above several apps. The engine needs
Node.js 22: VS Code 1.101 or later brings it; for older versions set
`bcAtlas.nodePath` to a Node.js 22 executable.

## "serve" is no longer available

The documentation server (`bca serve`, `bca docs serve`) was removed in 0.6.0.
Use the BC Atlas extension in VS Code for a browsable overview, `bca export --view report` for a
static one in any Markdown viewer and your repository host, and
`bca docs ...` for documentation metadata.

## BC Atlas finds no AL files

Check that the input path contains `.al` files. Check `--include`, `--exclude`,
`--namespace`, and `--type` filters, and the `exclude` list in `.bca.json`
(the `.bca.json` written by `bca setup` excludes test folders).

## The object view fails

The object view requires `--object`. Use a name, object ID, object key, or
typed selector.

```sh
bca export ./app --view object --object codeunit:50100 -o object.svg
```

## The boundary view fails

The boundary view requires at least one `--scope` value. Prefix the value with
`namespace:`, `folder:`, `app:`, or `object:`.

## PNG or PDF rendering fails

Install the [D2 executable](https://d2lang.com) and add it to `PATH`. Use SVG
when you do not need raster or PDF output.

## A diagram is too large

Use the BC Atlas panel in VS Code or `bca export --view report` for an overview, then select a
focused view. Add filters. The bundled SVG renderer draws at most 1,500 nodes;
larger views (the project view of the Base Application has about 9,500) stop
with a message and keep the `.d2` file, which the `d2` executable can render
with more memory. In VS Code, the Diagrams page has a namespace filter.
Reduce `--max-edges` only after you select the required scope.

## Many unresolved references

References to the base app or dependencies resolve when their symbols are
available. Download symbols into `.alpackages` (for example with the AL
extension in VS Code) and rerun the command.

## Calls are missing

The call view hides unresolved calls by default. Add
`--include-unresolved-calls` for investigation. Dynamic calls can remain
unresolved when AL source does not identify a target.

## `check` fails

Read the findings list. Use `--format json` for every finding, raise
`--max-fan-in` or `--max-fan-out` for intentional hubs, set `check.cycles` to
`info` while you work down existing cycles, or use `--fail-on never` to report
without failing.

## `codegraph` refuses to replace a directory

The output directory is replaced atomically. To protect your files, BC Atlas
refuses to replace a non-empty directory without a generated `index.md`.
Choose an empty or dedicated `--output-dir`.

## Turn off the update notice

Set `BCA_NO_UPDATE_CHECK=1` (or `NO_UPDATE_NOTIFIER=1`). The notice is never
shown in CI, Git hooks, `bca run`, or with `--format json`.

## Generated project documentation is stale

```sh
npm run docs
npm run docs:check
```

For usage help, read [SUPPORT.md](../SUPPORT.md). Report private
vulnerabilities through [SECURITY.md](../SECURITY.md).
