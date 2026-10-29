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

## A diagram is too large

Use the BC Atlas panel in VS Code or `bca export --view report` for an overview, then select a
focused view. Add filters. Files of views with more than 1,500 objects (the
project view of the Base Application has about 8,000) show every group as one
box with the relations between groups bundled; the `.d2` file keeps every
object. On the Diagrams page, views with more than 120 objects start that way,
and a click on a group opens it; the page also has a namespace filter, and
hovering an object highlights its relations.
Reduce `--max-edges` only after you select the required scope.

## Many unresolved references

References to the base app or dependencies resolve when their symbols are
available. Download symbols into `.alpackages` (for example with the AL
extension in VS Code) and rerun the command.

## Calls are missing

The call view hides unresolved calls by default. Add
`--include-unresolved-calls` for investigation. Without the AL compiler,
dynamic calls can remain unresolved when AL source does not identify a target;
install the AL Development Tools or the AL Language extension so the compiler
resolves them ([AL toolchain](./al-toolchain.md)).

## The AL compiler is not used

`bca check` prints an `AL compiler` line when it ran. If it does not:

- install the AL Development Tools (`dotnet tool install --global
  Microsoft.Dynamics.BusinessCentral.Development.Tools`) or the AL Language
  extension for VS Code, or point `--compiler` at `alc`, `al`, or the
  extension folder;
- check that `al.compiler` in `.bca.json`, `BCA_AL_COMPILER`, or
  `bcAtlas.alCompiler` is not `off`;
- on Linux and macOS, install the .NET 8 runtime or later.

Many `AL0185 ... is missing` errors mean the Microsoft symbols are not in a
package cache: run **AL: Download Symbols**, or set `al.packageCachePath` to
the folder that has them.

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
