# Architecture reports

`bca export --view report` writes a complete overview of an AL project into
your repository: one Markdown page with the numbers, one picture per lens,
and the health summary. The output is plain Markdown and SVG, so it renders on GitHub,
Azure DevOps, GitLab, and in any Markdown viewer without a server.

```sh
bca export ./app --view report
```

See the [warehouse example report](../examples/report/README.md) generated
from this repository.

## Output

```text
docs/atlas/
  README.md      numbers, contents, pictures, health, regenerate command
  overview.svg   how it works: the screens, the logic, and the data
  apps.svg       the apps and what they use of each other
  modules.svg    namespaces and what they use of each other
  data.svg       tables and the code that reads, writes, relates, and extends them
  events.svg     event publishers and their subscribers
  contracts.svg
  pages.svg
  model.json     with --json: resolved project model
```

A lens with nothing to show (for example `contracts` in an app without
interfaces) is left out instead of failing the report.

## Options

```sh
# Select the lenses to draw
bca export ./app --view report --lenses overview,data,calls

# A custom folder, with the resolved model
bca export ./app --view report -o docs/architecture --json

# Restrict the report to one area of a larger workspace
bca export ./apps/Sales --view report --project-root . --namespace "Contoso.Sales.**"
```

Save defaults in the `report` section of `.bca.json`:

```json
{
  "report": {
    "outputDir": "docs/atlas",
    "lenses": ["overview", "apps", "modules", "data", "events", "contracts", "pages"],
    "json": false,
    "title": "Sales architecture"
  }
}
```

## Keep the report current

The report is deterministic: the same source produces the same files. Commit
it and let CI fail when it is stale:

```sh
bca export --view report
git diff --exit-code -- docs/atlas
```

The health thresholds come from the `check` section of `.bca.json`; see
[Architecture health checks](./health-checks.md).
