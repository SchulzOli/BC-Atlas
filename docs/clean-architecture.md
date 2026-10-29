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
bca export ./app -o architecture.html                                    # 4. share
```

## 1. Find a suitable architecture

Without an `architecture` section in `.bca.json`, `bca architecture` proposes
one from today's dependencies:

1. **Group** the objects into candidate components. By default (`auto`) every
   module (nested `app.json`) or app is a component, and any that is too large
   is split by namespace (see below). `--group-by coupling` forms components
   from namespaces that are tightly coupled to each other instead (see
   [Group by coupling](#group-by-coupling)). `--group-by namespace`, `folder`,
   `module`, or `app` chooses one grouping; `--depth` fixes the number of
   namespace or folder segments.
2. **Order** the components so that as little coupling as possible points
   against the order (a weighted feedback arc set, see
   [Coupling weights](#coupling-weights)). Permission sets are left out of this
   step: they grant access to everything and follow the components instead of
   shaping them.
3. **Layer** them: layer 0 is the core, every other component sits one layer
   above the deepest component it may use.

### When a component is split by namespace

| Step | Rule |
| --- | --- |
| Too large | More than 15% of the analyzed objects, and at least 40: `max(40, 15% × objects)`. For the Base Application run below (8,347 objects) that is 1,253. |
| First cut | One namespace segment below the prefix the objects share, e.g. `Microsoft.Sales`, `Microsoft.Finance`. |
| Deeper | A part with more than 15% (and at least 40) of the split objects goes one segment deeper, for at most 8 rounds. |
| Leftovers | Objects directly in a namespace that was split deeper stay together as a component of their own. |
| Context | Objects outside the analyzed path (`--paths`, a focus folder) are not split; each of their apps stays one component. |
| Small groups | `--min-objects N` merges groups with fewer than N objects into the component they depend on most. Default: 1 (no merging). |
| Overrides | `--depth N` uses N segments and never splits further; `--group-by namespace` splits every object by namespace, not only large modules. |

### Coupling weights

Not every dependency is equally hard to cut. BC Atlas weighs each one by what
it takes to remove it, and uses the weights to order the components, to merge
small groups, to find objects that belong elsewhere, to rank objects
(PageRank), to detect communities, and to score an architecture:

| Relation | Weight | Why |
| --- | ---: | --- |
| `writes` | 5 | Data owned elsewhere; the writes must move behind the owner's codeunit, or the table must move. |
| `extends` | 4 | A table, page, or enum extension belongs next to what it extends. |
| `relates`, `implements` | 3 | Schema (`TableRelation`) and contracts. |
| `calls`, `runs`, `part`, `reads` | 2 | Can go behind an interface, an event, or a codeunit. |
| `selects` | 1.5 | An enum value that selects an implementation. |
| `uses`, `subscribes` | 1 | A variable or an event subscriber is already loose. |
| `permits`, `includes` | 0.1 | Permission grants move with the components. |

Repeated uses of one kind count logarithmically: ten calls bind more than
one, but not ten times as much. Change a weight in `.bca.json`:

```json
{ "architecture": { "couplingWeights": { "reads": 3, "subscribes": 0.5 } } }
```

### Group by coupling

`--group-by coupling` starts from the namespaces (without one, the folders) of
each module or app and puts the ones whose objects are tightly coupled to each
other into one component (Louvain communities on the coupling weights, at
object level; a namespace joins the community most of its objects belong to).
The components keep `namespace:` selectors, so `.bca.json` stays readable.
Use it when the namespaces of a monolith do not match how the code is
actually used.

### Compare groupings

Every architecture, configured or proposed, gets a score:

| Score | Meaning |
| --- | --- |
| Cohesion (per component) | The share of a component's coupling that stays inside it. |
| Coupling inside components | The share of all coupling that stays inside components. |
| Modularity | Weighted modularity of the components (−0.5 to 1): coupling inside components compared with what random components of the same sizes would keep. Higher is better; one component holding everything scores 0. |

```text
$ bca architecture ./app --propose --group-by namespace
  32 components in 17 layers, 1,200 objects assigned.
  56% of the coupling stays inside components (modularity 0.53).
$ bca architecture ./app --propose --group-by coupling
  12 components in 8 layers, 1,200 objects assigned.
  68% of the coupling stays inside components (modularity 0.56).
```

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
| `exposes` | Selectors for the objects other components may use, its public surface. Without it, every object that is not `Access = Internal` is public. |
| `maxObjects` | Most objects the component may hold before `bca check` reports it as too large. |

For the whole architecture:

| Setting | Meaning |
| --- | --- |
| `allowSameLayer` | Allow dependencies between different components of the same layer. Default: `false`, because siblings that use each other cannot become separate apps. |
| `strictLayers` | A component without `dependsOn` may use only the layer directly below it, not deeper ones. Default: `false`. |
| `maxObjects` | Most objects per component (a component's own `maxObjects` wins). |
| `couplingWeights` | Weight per relation kind; see [Coupling weights](#coupling-weights). |
| `rules` | Dependency rules of your own, see [Rules of your own](#rules-of-your-own). |
| `severity` | Severity of a violation in `bca check`: `error` (default), `warning`, or `info`. |
| `severities` | Severity per rule, `off` turns a rule off: `{ "internal-access": "warning", "unstable-dependency": "off" }`. Accepts the violation rules (`outward-dependency`, `internal-access`, ...) and the [checks of the architecture](#checks-of-the-architecture). |
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
| `component:Sales` | The objects of a component. Only in `exposes` and `rules`. |
| `layer:0,1` | The objects of the components in these layers. Only in `exposes` and `rules`. |

Selectors joined with `&` must all match: `namespace:Contoso.Sales & type:table`.

## 3. Resolve what stands in the way

Every dependency that breaks a rule is a **violation**.

**What is checked.** Only dependencies between two different components. All
13 relation kinds count (extends, implements, calls, uses, reads, writes,
relates, selects, runs, part, subscribes, permits, includes). Not checked:
dependencies inside one component, and dependencies to objects that belong to
no component, such as platform objects (`Integer`, `Date`), unresolved
references, and package symbols no selector matches.

**The rules, in order.** For a dependency from component A to component B, the
first rule that applies decides:

| # | When | Result |
| --- | --- | --- |
| 1 | A has `dependsOn` | Allowed only if B is listed, otherwise `undeclared-component-dependency`. Layers are not consulted. The list is direct, not transitive: A → B → C does not allow A → C. |
| 2 | A or B has no `layer` | Allowed (no rule applies). |
| 3 | B's layer is higher than A's | `outward-dependency`: an inner component uses an outer one. |
| 4 | Same layer and `allowSameLayer` is `false` | `same-layer-dependency`: siblings that use each other cannot become separate apps. |
| 5 | `strictLayers` and B lies more than one layer below A | `layer-skip-dependency`: A must go through the layer in between. |
| 6 | B's layer is lower | Allowed. |

A proposal sets `dependsOn` on every component, so its violations always come
from rule 1.

**Public objects.** A dependency the rules allow must still use a public object
of B; otherwise it is an `internal-access` violation. An object is public
unless it has `Access = Internal` (which no other app can see, so the
dependency would break the moment B becomes an app of its own), or B lists
`exposes` and the object matches none of them. The AL compiler reports the
same case between apps that already exist as `AL0161`.

**Rules of your own** (`rules`, below) report `dependency-rule` violations.

Each rule's severity comes from `severities`, then `severity`; `off` turns it
off. Turned-off rules report nothing and do not count against a component.

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
| `use-public-api` | An object uses an internal object of another component (`internal-access`). | Use a public codeunit, interface, or event of that component; or set `Access = Public` (or add the object to `exposes`) if it is meant to be used. | S |
| `go-through-layer` | A component skips a layer (`layer-skip-dependency`). | Reach the object through the component in between, or declare the dependency in `dependsOn`. | M |
| `follow-rule` | A rule of your own forbids the dependency. | What the rule's `resolution` (or `message`) says. | M |
| `move-object-up` | Anything else. | Move the source object out, or the target in. | M |

The report sorts work items by the number of dependencies they resolve.
`--format json` (and the MCP tool `bc_atlas_architecture`) returns the same
work items with stable strategy IDs, so an AI agent can pick one, apply it,
and run the check again.

### Rules of your own

`rules` adds dependency rules that the layers cannot express, such as "only
the owning component writes its tables" or "the core has no pages". A rule
forbids every dependency from an object that matches `from` to an object that
matches `to`:

```json
{
  "architecture": {
    "rules": [
      {
        "name": "owner-writes-its-tables",
        "from": "*",
        "to": "type:table",
        "kinds": ["writes"],
        "across": true,
        "message": "Only the component that owns a table writes to it",
        "resolution": "Call a codeunit of the owning component that writes the record."
      },
      { "name": "core-has-no-ui", "from": "layer:0", "to": "type:page,report" },
      { "name": "integration-uses-only-sales", "from": "component:Integration", "to": "*", "except": ["component:Sales", "component:Integration"] }
    ]
  }
}
```

| Field | Meaning |
| --- | --- |
| `name` | The rule's ID in findings and in the baseline. Default: `from -> to`. |
| `from`, `to` | Selectors (one or a list), including `component:` and `layer:`. |
| `except` | Targets the rule allows anyway. `"to": "*"` with `except` turns a rule into an allow list. |
| `kinds` | Only these relation kinds count, e.g. `["writes"]`, `["calls", "runs"]`. Default: all. |
| `across` | Only dependencies between two different components count. Default: `false`, so rules also apply inside a component. |
| `severity` | `error`, `warning`, `info`, or `off`. Default: `severity` of the architecture. |
| `message`, `resolution` | What the finding says and how to resolve it. |

Rules apply to dependencies on objects of the analyzed apps and their symbol
packages, not to platform objects or unresolved references. Their violations
take part in the baseline like every other violation, but they do not decide
whether a component can become an app.

### Checks of the architecture

Besides the dependencies, `bca check` checks the architecture as a whole. These
checks are not baselined; configure their severity in `severities`.

| Rule | Default | Reports |
| --- | --- | --- |
| `component-cycle` | warning | Components that depend on each other in a cycle. |
| `unassigned-objects` | info | Objects that match no component (or the `unassigned` setting). |
| `empty-component` | warning | A component no object matches, often a typo in a selector. |
| `unused-selector` | info | A selector that assigns no object, because nothing matches or a more specific selector of another component wins. |
| `unused-component-dependency` | info | A `dependsOn` entry the component does not use. |
| `inconsistent-component-dependency` | warning | A `dependsOn` entry that points to a higher layer, or to the same layer without `allowSameLayer`. |
| `declared-component-cycle` | warning | `dependsOn` entries that form a cycle; such components cannot become separate apps. |
| `component-too-large` | warning | A component with more objects than `maxObjects`. |
| `unstable-dependency` | info | A component that depends on a less stable one (stable dependencies principle, see [Metrics](#metrics)). |
| `could-be-internal` | info | Objects of a component that no other component uses and that could be `Access = Internal` (`bca refactor surface`). |
| `public-surface-change` | warning | A change that breaks components using the public surface recorded in `.bca-surface.json` (`bca architecture --update-surface`). |
| `foreign-table-write` | info | A table that other components write; see [data ownership](./modularization.md). Points at the table. |

Checks of the configuration point at the component in `.bca.json`, so editors
and code scanning show them there.

To take a component out as an app of its own, plan the extraction and perform
the moves with `bca architecture --extract` and `bca refactor move`; see
[Split a monolith into apps](./modularization.md).

### Metrics

Per component, after Robert C. Martin:

| Metric | Meaning |
| --- | --- |
| Instability (I) | Outgoing / (incoming + outgoing) coupling, counted in objects. 0 is stable, 1 is unstable. |
| Abstractness (A) | Share of interfaces among the objects. |
| Distance (D) | \|A + I − 1\|: stable components should be abstract, unstable ones concrete. |

A component that depends on a less stable one (instability higher by more
than 0.1) breaks the stable dependencies principle; the Markdown report lists
those pairs, and `bca check` reports them as `unstable-dependency` (info by
default).

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
- reports the [checks of the architecture](#checks-of-the-architecture):
  cycles, objects without a component, and mistakes in the configuration.

Add `bca check` to your pipeline (`bca setup` configures it) and the
architecture cannot erode silently. Commit `.bca.json` and the baseline.

## 5. See it

In VS Code, the BC Atlas panel has an Architecture page with the layers, the work items,
and the components, and buttons to adopt a proposal and to accept today's
violations. Its Dependencies page, the 3D explorer (also
`bca export --view explorer`), shows the architecture as soon as `.bca.json`
defines one, or with `--propose`:

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
