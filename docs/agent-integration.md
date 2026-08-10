# Agent integration

Use the capability manifest before an agent constructs a BC Atlas command.

```sh
bca capabilities
```

The command writes versioned JSON to standard output. It defines command IDs, argument templates, options, output contracts, and exit codes.

## Invocation rules

1. Pass each argument as a separate array item.
2. Do not construct a shell command string.
3. Use `inspect` or `--format json` for machine reads.
4. Check for exit code `0` before you parse standard output.
5. Run `docs set` and `docs unset` with `--dry-run` first.
6. Pass `--expected-hash` when you write AL metadata.

## Source of truth

AL source is authoritative. JSON, Markdown, D2, and SVG files are generated outputs.

Read the [generated capability summary](./reference/cli-capabilities.md) for the current command list. Use `bca capabilities` for the complete machine contract.
