# System handbook

The object catalog describes each AL object on its own page. The system
handbook works the other way round: each page answers one question across all
objects of an app, so people new to it (and the people who maintain it) can
see how the system works without reading hundreds of files.

```sh
bca export ./app --view handbook              # docs/handbook
bca export ./app --view handbook -o wiki/system --title "Contoso Sales"
```

| Page | Answers |
| --- | --- |
| `README.md` | What is the system made of? It lists apps, object types, components (configured, or proposed when none are configured) with their layers and purpose, and the objects that most others use. |
| `events.md` | Which events exist and who raises them? Who reacts to each one, which events of other apps (such as the Base Application) the system hooks into, and which events have no subscriber yet. |
| `data.md` | Which tables are there? Who inserts, modifies, deletes, and reads each one, and which pages show it. It also lists table extensions, tables of other apps that this system writes, and tables that no code here writes. |
| `permissions.md` | What does each permission set grant (tabledata rights, execute), and what does it include? Which tables does no permission set of the system cover? |
| `interfaces.md` | Which contracts exist? Their methods, the codeunits and enums that implement them, and the enum values that select each implementation. |
| `ui.md` | What can users open? Pages and reports by usage category (as Tell Me lists them), with caption, page type, source table, and application area. It also lists pages that are only opened from other pages, and API endpoints. |
| `code-health.md` | Where is the code hard to change? The most complex procedures (cyclomatic complexity), the largest objects, obsolete objects, procedures and fields, and how many public procedures have a `///` summary. |

Everything comes from the AL source and the [metadata](./code-graph-markdown-design.md#overview)
that BC Atlas reads from it: captions, `///` comments, `UsageCategory`,
`PageType`, `SourceTable`, `ObsoleteState`, data operations, event
subscribers, and permission sets. The text improves as the code is
documented. A `/// <summary>` above an event, an interface, or a codeunit
shows up in the handbook.

## Link to the object catalog

With `--catalog`, every object name links to its page in the
[object catalog](./code-graph-markdown-design.md), so you can go from the overview to
the details:

```sh
bca export ./app --view catalog -o docs/codegraph
bca export ./app --view handbook -o docs/handbook --catalog docs/codegraph
```

`bca run` links the two on its own when the same run writes the catalog (the
`codegraph` task). Otherwise set `handbook.catalog` in `.bca.json` to the
catalog's folder.

## Keep it up to date

Add the `handbook` task to a trigger in `.bca.json`, and the pages are
regenerated with every run, or verified in CI:

```json
{
  "automation": {
    "triggers": {
      "ci": { "tasks": ["check", "handbook"], "sync": "verify" },
      "schedule": { "cron": "0 6 * * 1", "tasks": ["report", "handbook"], "sync": "pull-request" }
    }
  },
  "handbook": { "outputDir": "docs/handbook", "title": "Contoso Sales", "catalog": "docs/codegraph" }
}
```

The GitHub Action takes it too (`tasks: check,handbook`). The output folder
is replaced on every run. BC Atlas refuses to write into a folder that holds
anything other than an earlier handbook.

See the [generated example](../examples/handbook/README.md) for the warehouse
example app.
