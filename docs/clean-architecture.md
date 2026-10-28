# Clean architecture

BC Atlas helps you find a target architecture for an AL app or workspace,
shows every dependency that stands in its way together with how to resolve
it, and keeps the architecture in place as the code changes. The typical goal:
split a large app into several smaller apps, or keep a set of apps cleanly
layered.

The rule behind it is the dependency rule of clean architecture: **source
code dependencies point inward**, from outer components (UI, integrations,
process apps) to inner ones (shared master data, foundations). A component can
become an app of its own only when nothing it uses points outward or sideways.

```sh
bca architecture ./app --propose --format markdown -o architecture.md   # 1. find
bca architecture ./app --propose --write --update-baseline               # 2. adopt
bca check ./app                                                          # 3. enforce
bca explore ./app --history -o architecture.html                         # 4. watch
```

## 1. Find a suitable architecture

Without an `architecture` section in `.bca.json`, `bca architecture` proposes
one from today's dependencies:

1. **Group** the objects into candidate components. By default (`auto`) every
   module (nested `app.json`) or app is a component, and any that holds more
   than 15% of the objects is split by namespace: one segment below the common
   prefix, and deeper until no part is that large. `--group-by namespace`,
   `folder`, `module`, or `app` chooses one grouping; `--depth` fixes the
   number of namespace or folder segments.
2. **Order** the components so that as few object dependencies as possible
   point against the order (a weighted feedback arc set). Permission sets are
   left out of this step: they grant access to everything and follow the
   components instead of shaping them.
3. **Layer** them: layer 0 is the core, every other component sits one layer
   above the deepest component it may use.

The proposal lists the components with their layers and allowed dependencies,
the dependencies that still point the wrong way, which components can become
apps today, and objects that are more closely tied to another component than
to their own ("objects that belong elsewhere").

## 2. Write the architecture down

`--write` saves the architecture in `.bca.json`; edit names, layers, and
selectors as you like:

```json
{
  "architecture": {
    "components": [
      { "name": "Core", "layer": 0, "match": ["namespace:Contoso.Core"] },
      { "name": "Sales", "layer": 1, "match": ["namespace:Contoso.Sales"], "dependsOn": ["Core"] },
      { "name": "Integration", "layer": 2, "match": ["app:Contoso Integration"], "dependsOn": ["Sales"] }
    ],
    "allowSameLayer": false,
    "severity": "error",
    "unassigned": "warning"
  }
}
```

| Setting | Meaning |
| --- | --- |
| `match` | Selectors that assign objects to the component. The most specific matching selector wins. |
| `layer` | 0 is the core. Without `dependsOn`, a component may use components in lower layers. |
| `dependsOn` | The components this one may use directly. When set, it replaces the layer rule. |
| `allowSameLayer` | Allow dependencies between different components of the same layer. Default: `false`, because siblings that use each other cannot become separate apps. |
| `severity` | Severity of a violation in `bca check`: `error` (default), `warning`, or `info`. |
| `unassigned` | Severity for objects that match no component. Default: `info`. |
| `baseline` | Baseline file. Default: `.bca-architecture-baseline.json`. |

Selectors:

| Selector | Matches |
| --- | --- |
| `namespace:Contoso.Sales` | The namespace and everything below it; globs allowed. |
| `folder:src/Sales` | Files below the folder; globs allowed. |
| `app:Contoso Sales` | An app by name or ID. |
| `module:Job Queue` | A module (nested `app.json`) by name or ID. |
| `type:table,tableextension` | Object types. |
| `object:codeunit:Sales-Post` | One object by type and name or ID. |
| `*` | Everything no other selector matches. |

## 3. Resolve what stands in the way

Every dependency that breaks a rule is a **violation**:

| Rule | Meaning |
| --- | --- |
| `outward-dependency` | A component uses a component in a higher layer. |
| `same-layer-dependency` | A component uses a sibling in the same layer. |
| `undeclared-component-dependency` | The target is not in `dependsOn`. |

Violations are grouped into **work items**: one per source object, target
component, and strategy. Each one says what to do in AL terms:

| Strategy | When | What to do | Effort |
| --- | --- | --- | --- |
| `declare-dependency` | The target lies further in, it is only missing from `dependsOn`. | Declare it (and in `app.json`), or go through a component you already use (`use-facade`). | S |
| `move-extension` | A table, page, or report extension extends an object of an outer component. | Move the extension next to the object it extends. | S |
| `move-subscriber` | A subscriber reacts to an event of an outer component. | Move the subscriber to the publisher's component. | S |
| `move-permissions` | A permission set grants objects of an outer component. | Grant them in a permission set (extension) of that component. | S |
| `move-navigation` | A page opens a page of an outer component (action, part). | Move the action or part into a page extension there. | S |
| `move-interface-down` | An object implements an interface of an outer component. | Move the interface to the component that uses it. | S |
| `move-enum-value` | An enum value selects an implementation in an outer component. | Move the value into an enum extension there. | S |
| `move-field-to-extension` | A table has a `TableRelation` to a table of an outer component. | Move the field into a table extension in that component. | M |
| `move-object-down` | Code uses a table only lower components need. | Move the table further in. | M |
| `extract-interface` | Code calls a codeunit or uses a table of an outer component. | Define an interface in the inner component and implement it outside (enum implementation); or publish an integration event (`raise-event`). | L |
| `move-object-up` | Anything else. | Move the source object out, or the target in. | M |

The report sorts work items by the number of dependencies they resolve.
`--format json` (and the MCP tool `bc_atlas_architecture`) returns the same
work items with stable strategy IDs, so an AI agent can pick one, apply it,
and run the check again.

### Metrics

Per component, after Robert C. Martin:

| Metric | Meaning |
| --- | --- |
| Instability (I) | Outgoing / (incoming + outgoing) coupling, counted in objects. 0 is stable, 1 is unstable. |
| Abstractness (A) | Share of interfaces among the objects. |
| Distance (D) | \|A + I − 1\|: stable components should be abstract, unstable ones concrete. |

A component that depends on a less stable one breaks the stable dependencies
principle; the Markdown report lists those pairs.

## 4. Enforce it over time

```sh
bca architecture ./app --update-baseline   # accept today's violations
bca check ./app                            # fails on new violations
```

The baseline (`.bca-architecture-baseline.json`) records the violations a
team accepts for now. `bca check` then:

- fails on every violation that is not in the baseline (one finding per work
  item, with the strategy);
- reports how many accepted violations remain;
- reports accepted violations that are gone, so you can run
  `--update-baseline` again and the baseline only shrinks;
- warns about component cycles and objects without a component.

Add `bca check` to your pipeline (`bca setup` configures it) and the
architecture cannot erode silently. Commit `.bca.json` and the baseline.

## 5. See it

`bca explore` shows the architecture as soon as `.bca.json` defines one, or
with `--propose`:

- a **Components** level with allowed (green) and wrong-way (red) component
  dependencies; select a component and choose **Show its objects**;
- on the object level, every violating dependency in red, and its resolution
  in the details;
- an **Architecture** panel with the largest work items; click one to jump to
  its object;
- with `--history`, the number of violations per commit as a red line over the
  timeline, so you can see when the architecture eroded or improved;
- the layout **Architecture layers as floors** stacks the components by layer.

## Example: the Base Application

On the W1 Base Application in [BCApps](https://github.com/microsoft/BCApps),
analyzed together with its declared dependencies (System Application and
Business Foundation, about 8,300 objects), the proposal keeps every module
(Job Queue, Power BI, User Task, ...) as a component and splits the root
module by namespace: 72 components in 29 layers, from System Application and
Foundation at the core up to Sales, Purchases, and Service.

- 37 components could become apps right away, mostly modules that already
  follow their manifests.
- 19,485 dependencies point the wrong way, grouped into 4,924 work items;
  11,576 of them are permission grants (D365 READ, D365 AUTOMATION, ...) that
  each future app would bring along in a permission set of its own.
- The largest structural work items are objects in the wrong place, such as
  `Mfg. Experience Tier` and `Service Experience Tier`: they live in the
  `System` namespace but subscribe to 49 Manufacturing and 44 Service tables,
  so they move to those components.

```sh
bca architecture ./BCApps/src/Layers/W1/BaseApp --project-root ./BCApps/src \
  --paths "Layers/W1/BaseApp" --paths "System Application/App" --paths "Business Foundation/App" \
  --propose --format markdown -o base-application-architecture.md
```
