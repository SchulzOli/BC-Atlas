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

## Sources

Every page starts with **Based on:**, the parts of the AL code it reads, and
the overview ends with a **Sources** table: how many AL files and objects,
the apps from `app.json`, the symbol packages (name and version), whether the
AL compiler resolved the calls, whether the architecture is configured or
proposed, and the `.bca.json` used. Nothing in the handbook is entered by
hand.

Everything comes from the AL source and the [metadata](./code-graph-markdown-design.md#overview)
that BC Atlas reads from it: captions, `///` comments, `UsageCategory`,
`PageType`, `SourceTable`, `ObsoleteState`, data operations, event
subscribers, and permission sets. The text improves as the code is
documented. A `/// <summary>` above an event, an interface, or a codeunit
shows up in the handbook.

## In VS Code, the exported view, the report, and for agents

- **VS Code and the exported view:** the BC Atlas view tells the same as
  stories on the graph: what the system is, its data, events, contracts, user
  interface, permissions, and health, each on the objects it is about.
  **Export › Documentation** saves every story as one Markdown document; the
  handbook pages themselves are written by `bca export --view handbook`.
- **Report:** `bca export --view report --handbook` writes the handbook to
  `<output>/handbook`. With `--codegraph`, object names link to the catalog
  in `<output>/objects`. In `.bca.json` this is `report.handbook`.
- **AI agents:** the MCP tool `bc_atlas_handbook` returns one page or all of
  them.

## German

`--language de` (or `de-DE`) writes the handbook in German, with the terms of
the German Business Central client: Tabelle, Seite, Bericht,
Berechtigungssatz. In `.bca.json` this is `handbook.language`. Names from the
code (objects, captions, `///` comments) stay as they are written.

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
