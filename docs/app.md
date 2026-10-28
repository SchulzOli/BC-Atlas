# The BC Atlas app

`bca app` opens BC Atlas in your browser for one AL app or workspace. The app
shows everything BC Atlas knows about the project in one place, with one look
and feel:

```sh
bca ./app            # short for: bca app ./app
bca app ./workspace --port 8080 --no-open
```

BC Atlas analyzes the source, starts a small web server on `localhost`, and
opens the app. It re-analyzes when AL files, `app.json`, `.bca.json`, or the
architecture baseline change, and open pages refresh by themselves. Stop it
with `Ctrl+C`.

**Try it:** the documentation website hosts exported apps for the
[warehouse example](https://schulzoli.github.io/BC-Atlas/examples/app/html/warehouse-app.html)
and the [multi-app workspace](https://schulzoli.github.io/BC-Atlas/examples/app/html/multi-app.html).

## Pages

| Page | Shows | Same as |
| --- | --- | --- |
| Overview | Objects, apps, health, the architecture at a glance, the most connected objects, and what to do next. | |
| Health | Every finding, filterable by severity, with a link to the object it is about. | `bca check` |
| Architecture | The configured architecture, or a proposal: components in layers, work items with their resolution, components with Martin metrics, and objects that belong elsewhere. | `bca architecture` |
| Dependencies | The 3D dependency explorer: objects, modules, apps, and components; inside one app vs. across apps; replayable over Git history. | `bca export --view explorer` |
| Diagrams | Every diagram view (project, module, object, data, call, boundary, contracts, events, ui, workflow) with zoom, pan, and SVG or D2 download. | `bca export --view <view>` |
| Objects | Every AL object, searchable and sortable, filtered by type, app, component, or violations. | |
| Object | One object: what it uses and what uses it (inside one app or across apps), its wrong-way dependencies with steps to resolve them, fields, procedures, actions, and properties. Open it in VS Code, in your Git host, in 3D, or as a diagram. | `bca export --view object --object <selector>` |
| Docs | The guides from your AL UI tests, when the project has documented UI tests. | `bca docs generate --export html` |

Click an object anywhere (a finding, a work item, a dependency, a node in the
3D explorer) to open its page. The theme button switches between light and
dark; the explorer follows.

## Change the architecture from the app

On the Architecture page:

- **Adopt this architecture** saves the proposal (components, layers, allowed
  dependencies) to `.bca.json` and accepts today's wrong-way dependencies in
  `.bca-architecture-baseline.json`, like
  `bca architecture --propose --write --update-baseline`.
- **Propose again** with a different grouping (`auto`, `module`, `app`,
  `namespace`, `folder`), namespace depth, or minimum component size shows a
  new proposal; nothing is written until you adopt it.
- **Accept current violations** updates the baseline, like
  `bca architecture --update-baseline`. Afterwards `bca check` fails only on
  new violations.

See [Clean architecture](./clean-architecture.md) for the rules behind it.

## Share it: the app as one file

```sh
bca export ./app -o atlas.html
```

writes the same pages as one self-contained HTML file that works offline:
publish it from CI, attach it to a pull request, or send it. The exported app
contains the diagrams of the report views (`project`, `module`, `data`,
`contracts`, `events`, `ui`) with their default settings, the explorer, every
object page, and the docs. It cannot change files; open the project with
`bca app` for that. Add `--history` (one frame per commit) or
`--history-by prs` or `--history-by releases` to include the Git timeline in
the explorer, and `--last 20` to keep it short.

## Security

- The server listens on `127.0.0.1` only and rejects requests whose `Host`
  header is not `localhost` or `127.0.0.1`.
- Requests that change files need a random token that only the page served by
  this run of `bca app` knows, so other websites cannot use your browser to
  change your project.
- Diagrams are inserted without scripts or event handlers, and links in them
  only open `http` and `https` addresses.

## Large projects

`bca app` analyzes the project before it opens the browser. For the Base
Application with the System Application and Business Foundation (about 9,500
objects) that takes about two minutes; afterwards every page opens in under a
second. The first rendering of a large diagram view can take 20 seconds; it
is cached until the source changes. Views with more than 1,500 nodes are not
drawn; filter them by namespace or pick a focused view. Use `--paths` to analyze only some
folders of a large repository, and open the Dependencies page without
a **Timeline** first: replaying many commits takes longer. The timeline can
step through commits, merged pull requests, or releases, and **Last** limits
it to the most recent ones.
