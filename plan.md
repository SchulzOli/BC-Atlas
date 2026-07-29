# Future ald2tree CLI view types

## Purpose

This roadmap covers new, reusable visualization modes for `ald2tree`. The views
must work across AL applications and must not encode application-specific object
names, folders, workflows, or business domains.

The original supported views are:

- `project`
- `module`
- `object`
- `data`
- `call`

Version 0.5.0 added:

- `boundary`
- `contracts`
- `events`
- `ui`

Improvements to implemented views belong in the normal implementation backlog.
The remaining sections describe the design and future view types.

## Design principles

- Derive relationships from the AL syntax tree, symbols, `app.json`, and explicit
  user configuration.
- Mark inferred or ambiguous relationships visually instead of presenting them
  as certain.
- Support filtering by object type, object name or ID, namespace, folder, and
  application.
- Keep D2 output useful as source: stable node IDs, deterministic ordering, and
  readable labels.
- Aggregate large graphs by default and allow users to expand selected areas.
- Emit useful diagnostics when a view cannot resolve a referenced object.
- Avoid assumptions about naming conventions unless the user explicitly enables
  a configurable heuristic.

## Proposed views

### 1. `boundary` — implemented in 0.5.0

Shows the dependencies crossing a selected architectural boundary, such as a
folder, namespace, application, or explicit object set.

Example:

```text
ald2tree graph src --view boundary --scope namespace:My.App.Sales
ald2tree graph src --view boundary --scope folder:Integration
```

The view should:

- separate objects inside and outside the selected scope;
- distinguish inbound from outbound dependencies;
- classify edges as calls, data access, events, extension, or UI navigation;
- aggregate external objects by namespace, folder, or app;
- highlight boundary objects with unusually high coupling.

Acceptance criteria:

- A scope can be selected without changing source code.
- Every rendered edge includes its relationship kind.
- Users can expand an aggregated external group.

### 2. `contracts` — implemented in 0.5.0

Shows abstractions and their implementations.

Example:

```text
ald2tree graph src --view contracts
ald2tree graph src --view contracts --focus "Interface Name"
```

The view should include:

- interfaces and implementing codeunits;
- interface-implementing enum values;
- extensible enums involved in implementation selection;
- unresolved or duplicate implementations;
- optional call relationships through an interface.

Acceptance criteria:

- Direct implementations and enum-mediated implementations are distinct.
- Unresolved implementation names appear as diagnostics.
- Focusing on one contract hides unrelated implementation families.

### 3. `events` — implemented in 0.5.0

Shows event publishers and subscribers.

Example:

```text
ald2tree graph src --view events
ald2tree graph src --view events --focus "OnAfterPosting"
```

The view should include:

- integration and business event publishers;
- event subscriber procedures;
- publisher object, event name, subscriber object, and subscriber procedure;
- trigger events when they can be resolved reliably;
- unresolved publisher references.

Acceptance criteria:

- Publisher-to-subscriber edges are derived from attributes and declarations.
- Event names are visible even when an object cannot be resolved.
- Filters can suppress trigger events or standard-library publishers.

### 4. `extensions`

Shows how AL extension objects modify or augment base objects.

Example:

```text
ald2tree graph src --view extensions
ald2tree graph src --view extensions --focus "Sales Order"
```

The view should cover:

- table extensions and their base tables;
- page extensions and their base pages;
- report extensions and their base reports;
- enum extensions and their base enums;
- permission-set extensions and their base permission sets;
- added fields, controls, actions, enum values, and permissions as optional
  member details.

Acceptance criteria:

- Each extension is connected to its resolved base object.
- Missing base objects remain visible as unresolved external nodes.
- Member details can be toggled to control graph size.

### 5. `permissions`

Shows permission sets, included permission sets, and access to AL objects.

Example:

```text
ald2tree graph src --view permissions
ald2tree graph src --view permissions --focus "Warehouse User"
```

The view should:

- render permission sets and permission-set extensions;
- show included permission sets;
- show object permissions with `R`, `I`, `M`, `D`, and `X` labels;
- distinguish direct from inherited permissions;
- optionally compare required access inferred from data and call relationships.

Acceptance criteria:

- Permission labels preserve the exact declared operations.
- Cycles in included permission sets are highlighted.
- Inferred access gaps are clearly marked as diagnostics, not facts.

### 6. `ui` — implemented in 0.5.0

Shows page composition and user navigation.

Example:

```text
ald2tree graph src --view ui
ald2tree graph src --view ui --focus "Customer Card"
```

The view should include:

- pages and their source tables;
- page extensions and extended pages;
- parts and subpages;
- actions and resolved `RunObject` targets;
- page fields and source expressions when member detail is enabled.

Acceptance criteria:

- Composition and navigation use different edge styles.
- Page parts resolve their target pages where possible.
- The default rendering omits field-level detail for large projects.

### 7. `workspace`

Shows relationships among multiple AL applications in a workspace.

Example:

```text
ald2tree graph . --view workspace
ald2tree graph . --view workspace --include-platform
```

The view should use `app.json` files and resolved references to show:

- applications and their declared dependencies;
- runtime and platform compatibility metadata;
- cross-app object references;
- unresolved or version-incompatible dependencies;
- optional grouping by publisher.

Acceptance criteria:

- Multiple `app.json` roots are discovered deterministically.
- Declared dependencies and observed code references are visually distinct.
- Platform and system applications can be hidden by default.

### 8. `workflow`

Shows an execution flow selected by entry points or explicit configuration.
This is a general trace-oriented view, not a hardcoded business-process diagram.

Example:

```text
ald2tree graph src --view workflow --entry "ProcessDocument"
ald2tree graph src --view workflow --config ald2tree.workflow.json
```

The view should:

- start from one or more procedures, triggers, actions, or event publishers;
- combine resolved calls, events, and data mutations;
- collapse utility calls and repeated infrastructure nodes;
- allow configuration to label phases and define stop conditions;
- show cycles and unresolved branches.

Acceptance criteria:

- The same engine works for any domain and naming scheme.
- Inferred sequence is labeled separately from definite call order.
- Depth, node count, and edge-type limits prevent unusable graphs.

### 9. `state`

Shows state-bearing fields and detected transitions.

Example:

```text
ald2tree graph src --view state --table "Document Header" --field Status
```

The view should:

- use a selected enum, option, or state-like field;
- render declared values;
- find assignments and validated transitions;
- link transitions to the responsible procedure, trigger, or object;
- accept configuration when static analysis cannot identify the state field.

Acceptance criteria:

- The state source is always explicit in the output.
- Possible transitions are distinguished from proven transitions.
- Dynamic or unresolved assignments produce diagnostics.

### 10. `tests`

Shows test coverage relationships at the AL object and procedure level.

Example:

```text
ald2tree graph src --view tests
ald2tree graph src --view tests --focus "Posting"
```

The view should include:

- test codeunits and test procedures;
- objects and procedures directly invoked by tests;
- handler functions and handler attributes;
- unreferenced production objects as an optional overlay;
- configurable naming heuristics only as a fallback.

Acceptance criteria:

- Attribute-based test and handler detection does not depend on names.
- Direct calls and heuristic coverage are visually distinct.
- Users can disable all heuristic relationships.

### 11. `diagnostics`

Turns architecture findings into a renderable graph.

Example:

```text
ald2tree graph src --view diagnostics
ald2tree graph src --view diagnostics --rules ald2tree.rules.json
```

Potential findings include:

- unresolved and ambiguous references;
- dependency cycles;
- isolated objects;
- high-coupling hubs;
- cross-boundary access;
- forbidden dependency directions;
- unused interfaces, events, or extension points.

Acceptance criteria:

- Every finding includes a rule identifier and supporting relationship.
- Thresholds and architectural rules are configurable.
- Diagnostic severity affects styling but not graph semantics.

### 12. `diff`

Shows architectural changes between two source snapshots or saved models.

Example:

```text
ald2tree graph . --view diff --base main --target HEAD
ald2tree graph . --view diff --base-model before.json --target-model after.json
```

The view should show:

- added, removed, and changed objects;
- added and removed dependency edges;
- changed public procedures, fields, events, and implementations;
- moved objects when identity can be established;
- confidence for inferred renames.

Acceptance criteria:

- The view can compare two serialized ald2tree models without Git.
- Added, removed, and unchanged graph elements are visually distinct.
- Rename detection never silently replaces add/remove facts.

## Delivery order

### Phase 1: structural relationships

1. `extensions`
2. `permissions`

`boundary` and `contracts` shipped in 0.5.0. The remaining views build mainly
on syntax and symbol relationships that AL declares explicitly.

### Phase 2: application composition

1. `workspace`

`events` and `ui` shipped in 0.5.0. `workspace` requires additional
multi-project resolution.

### Phase 3: analysis views

1. `workflow`
2. `state`
3. `tests`
4. `diagnostics`
5. `diff`

These need confidence tracking, configuration, graph comparison, or deeper
control-flow analysis.

## Shared implementation work

Before or alongside the new views:

- define typed relationship kinds in the intermediate model;
- retain source locations and confidence on nodes and edges;
- add stable filters and scope selectors shared by every view;
- support model export and import for reproducible rendering and `diff`;
- add configurable aggregation and expansion;
- add fixtures covering interfaces, events, extensions, permissions, page
  composition, multiple apps, and AL tests;
- document which relationships are exact, inferred, or unresolved.

## Definition of done for a new view

A view is complete when:

- it is exposed through `ald2tree graph --view <name>`;
- CLI help and README examples are present;
- D2 and SVG generation are tested;
- output is deterministic;
- focused and project-wide fixtures are covered;
- unresolved references do not abort rendering;
- application-specific conventions are optional configuration, never defaults.
