# Troubleshooting

## The command is not found

Run `npm install --global bc-atlas`. For a checkout, run `npm ci` and
`npm link`, or call `node src/cli.js` from the repository root.

## "unknown command or path"

The first argument is neither a command nor an existing path. Run `bca` to see
all commands. A path alone is not a command: use `bca check <path>` or
`bca export <path>`, or open the folder in VS Code with the BC Atlas extension.

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
`--namespace`, and `--type` filters, and the `exclude` list in `.bca.json`.

## A picture is too large

Use a lens (`bca view --lens data`), go into one object
(`--inside codeunit:50100`), or show one node and what is near it
(`--focus`, `--depth`). Add filters. The BC Atlas view draws every object of a
large app; use a lens, **Find**, the legend, or **Neighbors** on a node to get
to a part you can read.

## Many unresolved references

References to the base app or dependencies resolve when their symbols are
available. Download symbols into `.alpackages` (for example with the AL
extension in VS Code), or set `al.packageCachePath` to the folder that has
them, and rerun the command.

## Calls are missing

Calls are resolved from the source. Dynamic calls can remain unresolved when
the AL source does not identify a target.

## `check` fails

Read the findings list. Use `--format json` for every finding, raise
`--max-fan-in` or `--max-fan-out` for intentional hubs, set `check.cycles` to
`info` while you work down existing cycles, or use `--fail-on never` to report
without failing.

## Generated project documentation is stale

```sh
npm run docs
npm run docs:check
```

For usage help, read [SUPPORT.md](../SUPPORT.md). Report private
vulnerabilities through [SECURITY.md](../SECURITY.md).
