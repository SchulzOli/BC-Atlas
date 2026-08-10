# Troubleshooting

## The command is not found

Run `npm install --global bc-atlas`. For a checkout, run `npm ci` and `npm link`.

You can also run `node src/cli.js` from the repository root.

## BC Atlas finds no AL files

Check that the input path contains `.al` files. Check `--include`, `--exclude`, `--namespace`, and `--type` filters.

## The object view fails

The object view requires `--object`. Use a name, object ID, object key, or typed selector.

```sh
bca graph ./app --view object --object codeunit:50100 -o object.svg
```

## The boundary view fails

The boundary view requires at least one `--scope` value. Prefix the value with `namespace:`, `folder:`, `app:`, or `object:`.

## PNG or PDF rendering fails

Install the D2 executable and add it to `PATH`. Use SVG when you do not need raster or PDF output.

## A diagram is too large

Select a focused view. Add filters. Reduce `--max-edges` only after you select the required scope.

## Calls are missing

The call view hides unresolved calls by default. Add `--include-unresolved-calls` for investigation.

Dynamic calls can remain unresolved when AL source does not identify a target.

## Strict mode fails

Run the command without `--strict` and inspect the diagnostics. Correct parse errors, unresolved policy violations, or documentation warnings.

## Generated project documentation is stale

Run these commands:

```sh
npm run docs
npm run docs:check
```

For usage help, read [SUPPORT.md](../SUPPORT.md). Report private vulnerabilities through [SECURITY.md](../SECURITY.md).
