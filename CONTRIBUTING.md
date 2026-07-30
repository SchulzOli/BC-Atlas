# Contributing to BC Atlas

Thanks for helping make AL architecture easier to understand. Bug reports,
documentation fixes, examples, and focused code changes are all welcome.

## Before you start

- Search the [existing issues](https://github.com/SchulzOli/ALD2Tree/issues)
  before opening a new one.
- Use GitHub Discussions or the support guidance in [SUPPORT.md](./SUPPORT.md)
  for usage questions.
- Report vulnerabilities privately as described in [SECURITY.md](./SECURITY.md).
- Follow the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Development setup

BC Atlas requires Node.js 20 or newer.

```sh
git clone https://github.com/SchulzOli/ALD2Tree.git
cd ALD2Tree
npm ci
npm test
npm run check
```

Try the CLI against the included sample project:

```sh
node src/cli.js graph examples/warehouse-app --view project -o dist/example.d2
npm run examples
```

## Making a change

1. Create a branch from the default branch.
2. Keep the change focused and add or update tests for observable behavior.
3. Update the README or CLI reference when commands, options, or output change.
4. Run `npm run check`, `npm test`, and `npm pack --dry-run`.
5. Open a pull request and explain the problem, solution, and verification.

The architecture pipeline deliberately keeps parsing, resolution, views, and
rendering separate. Prefer extending the relevant stage instead of coupling
presentation logic to the parser.

## Tests and fixtures

Tests use Node's built-in test runner. Small, self-contained AL fixtures are
preferred. A regression fixture should demonstrate only the syntax required to
reproduce the issue and must not contain proprietary customer code.

Generated examples are deterministic. If a view changes intentionally, run
`npm run examples`, inspect the changed `.d2` and `.svg` files, and refresh the
corresponding screenshots described in [examples/README.md](./examples/README.md).

## Commit and pull-request guidance

Use clear, imperative commit subjects. Pull requests should remain reviewable;
large changes are easier to merge when split into independently useful steps.
By contributing, you agree that your contributions are licensed under the
project's [MIT License](./LICENSE).
