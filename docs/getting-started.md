# Getting started

BC Atlas reads Microsoft Dynamics 365 Business Central AL source. It creates architecture diagrams, JSON models, and user documentation.

## Requirements

- Install Node.js 20 or later.
- Use an AL project that contains an `app.json` file.
- Install the D2 executable only if you need PNG or PDF output.

BC Atlas includes the parser and the SVG renderer. D2, JSON, and SVG output need no extra compiler.

## Install the CLI

Install the published package:

```sh
npm install --global bc-atlas
```

To use a local checkout, run these commands:

```sh
npm ci
npm link
```

You can also use `node src/cli.js` instead of `bca` in a checkout.

## Create your first diagram

Run this command from any directory:

```sh
bca graph ./path/to/al-project --view project -o architecture.svg
```

BC Atlas searches the input path for AL files. It also searches upward for the nearest `app.json` file.

## Inspect the model

Use JSON when a script or tool must read the result:

```sh
bca inspect ./path/to/al-project > architecture.json
```

Check the exit code before you parse standard output.

## Next steps

- Read [Architecture diagrams](./architecture-diagrams.md) to select a view.
- Read [Configuration](./configuration.md) to save project settings.
- Read [Documentation from AL UI tests](./al-ui-test-documentation.md) to generate user guides.
- Use the [CLI reference](./cli-reference.md) for every option.
