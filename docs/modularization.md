# Split a monolith into apps

BC Atlas guides a large AL app (or a customization that grew over years)
towards a set of smaller apps: it shows where to cut, what each cut costs,
plans the extraction of a component, performs the moves, and lets the AL
compiler and `bca check` verify every step.

```sh
bca architecture ./app --propose --write --update-baseline   # 1. components and layers
bca architecture ./app --format markdown -o architecture.md  # 2. where to cut: work items, data ownership
bca architecture ./app --extract Warehouse                   # 3. plan one extraction
bca refactor surface ./app --component Core --apply         #    lock what others may use
bca architecture ./app --update-surface                      #    and record it
bca refactor move ./app --object codeunit:50001 --to Warehouse --apply   # 4. do the moves
bca check ./app                                              # 5. verify (with the AL compiler)
```

The example below is [`examples/monolith`](../examples/monolith): one app
with Core, Sales, Warehouse, and permissions in folders of their own.

## 1. Agree on components and layers

[Clean architecture](./clean-architecture.md) explains how BC Atlas proposes
components and layers and how to write them down in `.bca.json`. In the
example, every folder is a component:

```json
{
  "architecture": {
    "components": [
      { "name": "Core", "layer": 0, "match": ["folder:src/Core"] },
      { "name": "Sales", "layer": 1, "match": ["folder:src/Sales"], "dependsOn": ["Core"] },
      { "name": "Warehouse", "layer": 2, "match": ["folder:src/Warehouse"], "dependsOn": ["Sales", "Core"] },
      { "name": "Permissions", "layer": 3, "match": ["folder:src/Permissions"], "dependsOn": ["Core", "Sales", "Warehouse"] }
    ]
  }
}
```

## 2. See where to cut

`bca architecture` lists the dependencies that stand in the way as work items
(see [Clean architecture](./clean-architecture.md)).
Two more views show what a cut costs:

**Data ownership.** For every table that other components use: who owns it,
who writes, reads, relates to (`TableRelation`), and extends it. A table that
other components write is the most expensive dependency to cut, because its
writes must move behind a codeunit of the owner, or the table must move. `bca
check` reports such tables as `foreign-table-write` (info) at the table.

| Table | Owner | Written by | Related from |
| --- | --- | --- | --- |
| table 50100 CON Sales Order | Sales | Warehouse (1) | Warehouse (1) |
| table 50000 CON Item | Core | - | Sales (1) |

**Checks of the architecture.** Component cycles, components that use a less
stable one, and mistakes in `.bca.json`; see
[Checks of the architecture](./clean-architecture.md#checks-of-the-architecture).

## 3. Plan an extraction

```sh
bca architecture ./app --extract Warehouse --format markdown -o extract-warehouse.md
```

The plan for one component says:

| Part | What it contains |
| --- | --- |
| Objects | What moves: objects and files, and files that also hold objects of other components (they are split). |
| Uses, used by | The components on both sides of the cut. |
| Blockers | What makes the split impossible today, with the work items that resolve it: wrong-way dependencies from and to the component, `Access = Internal` objects used across the cut, components that use each other, and **app cycles**: the new app would use components that stay behind while components that stay behind use it. |
| `app.json` | ID, name, publisher, dependencies (including the symbols of Microsoft apps it uses), `runtime`, `platform`, and `application` of the source app, `idRanges` from the object IDs, and `internalsVisibleTo` when needed. The ID is derived from the source app and the component name, so the same plan always names the same app. |
| Tables | Tables and table extensions whose data moves with them. |
| Steps | The order: resolve blockers, create the app, split files, move files, move the data, add the dependency to the apps that use it, move permission grants, compile, check. |

Tables keep their data when they move between apps with `ObsoleteState =
PendingMove` and `MovedTo` in the source app and `MovedFrom` in the new one
(runtime 14.0, Business Central 2024 release wave 2 or later); after both apps
are released, the source sets `ObsoleteState = Moved`. The plan fills in both
app IDs.

In the example, Warehouse is blocked twice: Core's `CON Warehouse Hooks`
subscribes to a Warehouse event (a wrong-way dependency), and Warehouse uses
Sales while Core and the permission set use Warehouse, so the remaining app
and the new one would depend on each other.

The Architecture page (VS Code or `bca export`) shows the same plan: choose
a component under **Extract a component**.

## Lock the public surface

Before a component becomes an app, decide what other apps may use of it. Its
**public surface** is what other components use today (its de facto API):
`bca architecture` shows it per component (JSON `surface`, the Markdown
report, the **Public surface** card on the Architecture page), with who uses
each object and how.

```sh
bca refactor surface ./app --component Core          # preview
bca refactor surface ./app --component Core --apply  # Access = Internal + exposes
```

- Codeunits without events, queries, and enums that are not extensible, which
  no other component uses, get `Access = Internal`: no other app can see them
  once the component is an app. `bca check` lists them as `could-be-internal`
  (info). Tables, interfaces, extensible enums, and codeunits that publish
  events stay public, because other apps extend, implement, or subscribe to
  them.
- The objects other components use go into `exposes` of the component in
  `.bca.json`, so any new use of another object is an `internal-access`
  violation.

Then record the surface, like a baseline:

```sh
bca architecture ./app --update-surface   # writes .bca-surface.json; commit it
```

`bca check` compares the code with `.bca-surface.json` and reports changes
that break the components that use the surface, the way AppSourceCop guards
an app's API (`public-surface-change`, warning):

```text
WARN   codeunit 50100 CON Sales-Post of Sales: procedure Post(var Record "CON Sales Order") was changed to Post(var Record "CON Sales Order"; Boolean)
WARN   table 50000 CON Item of Core: field 5 Last Sold: Date was removed
```

It compares public procedures (parameter types and return type), events,
table fields (number, name, type), and enum values, and reports objects that
were removed or became `Access = Internal`. Additions never break anyone. Run
`--update-surface` again when a change is intended.

## 4. Do the moves

Work items whose strategy is a move (`move-extension`, `move-subscriber`,
`move-object-up`, and `move-object-down` with one target) carry the command
that performs them:

```sh
bca refactor move ./app --object codeunit:50001 --to Warehouse
```

```diff
--- a/src/Core/WarehouseHooks.Codeunit.al
+++ b/src/Warehouse/WarehouseHooks.Codeunit.al
@@ -1,6 +1,6 @@
-namespace Contoso.Core;
+namespace Contoso.Warehouse;
 
-using Contoso.Warehouse;
+using Contoso.Core;
 
 // Reacts to shipments; it lives in Core but only Warehouse raises the event.
 codeunit 50001 "CON Warehouse Hooks"
```

- The file moves to the component's folder (its `folder:` selector, else where
  most of its objects are); an object that shares a file with others is cut
  out into `<Name>.<Type>.al`.
- The namespace becomes the component's (its `namespace:` selector, else the
  one most of its objects use). The moved file gets the usings it needs, and
  every file that references the object gets `using <new namespace>;`.
- Without `--apply`, nothing is written. `--apply` refuses when a file changed
  since the analysis.
- Moving into another app's folder warns about app dependencies, the target
  app's `idRanges`, and table data.

AI agents use the same through MCP: `bc_atlas_architecture` (work items with
commands, data ownership), `bc_atlas_extraction_plan`, and
`bc_atlas_refactor_move` (`dryRun` by default). See
[Agent integration](./agent-integration.md).

## 5. Verify every step

With the [AL toolchain](./al-toolchain.md) installed, `bca check` compiles the
workspace and reports compiler errors next to the architecture findings. In
the example, after the move above:

- the AL compiler reports no diagnostics;
- the wrong-way dependency and the component cycle are gone;
- data ownership now shows that Warehouse writes `CON Item` of Core, the next
  candidate for an API codeunit in Core.

Run `bca architecture --update-baseline` after each step so the baseline only
shrinks, and `bca architecture --extract Warehouse` again: the plan shrinks
with it.
