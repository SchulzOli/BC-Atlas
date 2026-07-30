# Future BC Atlas CLI view types

## Purpose

This roadmap covers new, reusable visualization modes for BC Atlas (`bca`). The views
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
bca graph src --view boundary --scope namespace:My.App.Sales
bca graph src --view boundary --scope folder:Integration
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
bca graph src --view contracts
bca graph src --view contracts --focus "Interface Name"
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
bca graph src --view events
bca graph src --view events --focus "OnAfterPosting"
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
bca graph src --view extensions
bca graph src --view extensions --focus "Sales Order"
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
bca graph src --view permissions
bca graph src --view permissions --focus "Warehouse User"
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


### 7. `workspace`

Shows relationships among multiple AL applications in a workspace.

Example:

```text
bca graph . --view workspace
bca graph . --view workspace --include-platform
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
bca graph src --view workflow --entry "ProcessDocument"
bca graph src --view workflow --config bca.workflow.json
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
