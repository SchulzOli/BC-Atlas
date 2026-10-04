# Troubleshooting

## The command is not found

Run `npm install --global bc-atlas`. For a checkout, run `npm ci` and
`npm link`, or call `node src/cli.js` from the repository root.

## "unknown command or path"

The first argument is neither a command nor an existing path. Run `bca` to see
all commands. `bca <path>` is a shortcut for `bca graph <path>`, so check the
path for typos.

## "serve" is no longer available

The local web server (`bca serve`, `bca docs serve`) was removed in 0.6.0.
Use `bca report` for a browsable, static overview that works in any Markdown
viewer and in your repository host, and `bca docs ...` for documentation
metadata.

## BC Atlas finds no AL files

Check that the input path contains `.al` files. Check `--include`, `--exclude`,
`--namespace`, and `--type` filters, and the `exclude` list in `.bca.json`
(`bca init` excludes test folders).

## The object view fails

The object view requires `--object`. Use a name, object ID, object key, or
typed selector.

```sh
bca graph ./app --view object --object codeunit:50100 -o object.svg
```

## The boundary view fails

The boundary view requires at least one `--scope` value. Prefix the value with
`namespace:`, `folder:`, `app:`, or `object:`.

## PNG or PDF rendering fails

Install the [D2 executable](https://d2lang.com) and add it to `PATH`. Use SVG
when you do not need raster or PDF output.

## A diagram is too large

Use `bca report` for an overview, then select a focused view. Add filters.
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

## Generated project documentation is stale

```sh
npm run docs
npm run docs:check
```

For usage help, read [SUPPORT.md](../SUPPORT.md). Report private
vulnerabilities through [SECURITY.md](../SECURITY.md).
