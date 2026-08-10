# Control Center

The Control Center combines architecture views and AL UI-test documentation in a local web interface.

## Start the combined interface

Provide the AL application and the AL UI-test directory:

```sh
bca serve ./app --tests ./test/UITest --port 0
```

Port `0` selects an available loopback port. Open the URL that BC Atlas prints.

## Start the documentation-only interface

```sh
bca docs serve ./test/UITest --port 0
```

The server binds to the local computer. Keep the command attached to the terminal. Press `Ctrl+C` to stop it.

## Data ownership

The Control Center does not keep an independent scenario database. It reloads AL source for reads and uses validated AL writers for changes.

Preview metadata changes before you write them. Use the current source hash to prevent accidental overwrites.

```sh
bca docs set ./test/UITest --id partner-create --tag OWNER \
  --value "Integration Operations" --dry-run
```

Read [Documentation from AL UI tests](./al-ui-test-documentation.md) for the metadata model and generation workflow.
