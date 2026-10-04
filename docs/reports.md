# Architecture reports

`bca report` produces the fastest complete overview of an AL project: one
Markdown page that links every diagram, the health summary, and optionally the
object catalog. The output is plain Markdown and SVG, so it renders on GitHub,
Azure DevOps, GitLab, and in any Markdown viewer without a server.

```sh
bca report ./app
```

See the [warehouse example report](../examples/report/README.md) generated
from this repository.

## Output

```text
docs/atlas/
  README.md        overview, contents, diagrams, health, regenerate command
  project.svg/.d2  role-oriented architecture
  module.svg/.d2   namespace or folder dependencies
  data.svg/.d2     tables with reads, writes, and relations
  contracts.svg/.d2
  events.svg/.d2
  ui.svg/.d2
  objects/         with --codegraph: one page per AL object
  model.json       with --json: resolved project model
```

A view without matching objects (for example `contracts` in an app without
interfaces) is listed as "Not rendered" with the reason instead of failing the
report.

## Options

```sh
# Select views and skip SVG rendering for a fast draft
bca report ./app --views project,data,call --format d2

# Full documentation set in a custom folder
bca report ./app --output-dir docs/architecture --codegraph --json

# Restrict the report to one area of a larger workspace
bca report ./apps/Sales --project-root . --namespace "Contoso.Sales.**"
```

Save defaults in the `report` section of `.bca.json`:

```json
{
  "report": {
    "outputDir": "docs/atlas",
    "views": ["project", "module", "data", "contracts", "events", "ui"],
    "format": "svg",
    "codegraph": true,
    "json": false,
    "title": "Sales architecture"
  }
}
```

## Keep the report current

The report is deterministic: the same source produces the same files. Commit
it and let CI fail when it is stale:

```sh
bca report
git diff --exit-code -- docs/atlas
```

The health thresholds come from the `check` section of `.bca.json`; see
[Architecture health checks](./health-checks.md).
