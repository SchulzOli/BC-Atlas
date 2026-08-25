# Code Graph as Markdown

## Purpose

Code Graph as Markdown is the third BC Atlas output beside architecture
diagrams and documentation generated from AL UI tests. It produces a
navigable Markdown catalog of an AL application:

```text
AL source -> BC Atlas architecture model -> one Markdown file per AL object
```

The generated files describe code structure. They do not explain business
processes and do not replace the UI-test documentation.

## Design goals

- Generate exactly one Markdown file for each workspace AL object.
- Put the object's identity and AL properties in a consistent metadata section.
- Link workspace objects through resolved dependencies and schema relations.
- Give each object type a small, useful structural inventory.
- Keep output deterministic so CI can detect stale documentation.
- Reuse the existing analyzer and resolver as the only source of graph facts.

## Non-goals for the first version

- No AI-generated summaries.
- No procedure bodies, local variables, or source-code copies.
- No attempt to reproduce AL syntax as Markdown.
- No Markdown file for every object in dependency packages.
- No replacement for D2 architecture views or UI-test task guides.
- No backlinks inferred from text. All links come from resolved model edges.

## Command

```text
bca codegraph <file-or-directory> --output-dir docs/codegraph
```

The command analyzes the complete input before writing files. It creates the
output directory, one file per workspace object, and a root `index.md`.

Useful first-version options:

| Option | Purpose |
| --- | --- |
| `--output-dir <path>` | Output directory. Default: `docs/codegraph`. |
| `--project-root <path>` | Analyze a multi-app workspace while documenting the selected input. |
| `--include <glob>` | Include matching source paths or object selectors. Repeatable. |
| `--exclude <glob>` | Exclude matching source paths or object selectors. Repeatable. |
| `--strict` | Fail on analyzer warnings and errors. |

The command should not expose layout, graph-depth, or prose-style options in
the first version.

## Output layout

```text
docs/codegraph/
  index.md
  Warehouse/
    Inventory/
      50100-warehouse-entry.md
      50101-warehouse-entries.md
    Services/
      50102-warehouse-service.md
  Contracts/
    50103-inventory-provider.md
```

The output mirrors the AL source directory layout relative to the selected
input. For example, an object in `Warehouse/Services/WarehouseService.al` is
written below `docs/codegraph/Warehouse/Services/`. The AL source filename is
not repeated as another directory.

Objects declared directly at the input root have no directory to mirror. Only
those objects use a fallback directory named after the object type, such as
`table/`, `page/`, `codeunit/`, or `interface/`:

```text
docs/codegraph/
  table/
    50100-warehouse-entry.md
  page/
    50101-warehouse-entries.md
```

The filename format is `<id>-<slug>.md`. Objects without a numeric ID use
`<slug>.md`. Multiple objects declared in one AL file are written beside each
other. If two output paths still collide, the namespace slug is added before
the object slug. Paths are computed for the complete model before any file is
written, so links do not depend on traversal order.

Only source objects inside the selected workspace receive files. A resolved
workspace target is a relative Markdown link. A dependency-package or
unresolved target is displayed as text with its package and resolution status;
BC Atlas does not create thousands of external placeholder files.

`index.md` follows the mirrored directory tree and groups objects within each
directory by object type. It reports the object count, unresolved-reference
count, and analyzer diagnostics summary without adding volatile timestamps.

## Common document contract

Every object document uses the same top-level order:

1. YAML metadata front matter
2. Title
3. Type-specific structure
4. Dependencies
5. Used by
6. Source

Empty type-specific sections are omitted. YAML metadata, `Dependencies`, `Used
by`, and `Source` are always present.

### Metadata

Metadata is YAML front matter at the start of each object document. String
values use JSON-compatible double quoting, which is valid YAML and preserves
AL punctuation and multiline expressions safely.

```yaml
---
Type: "Table"
ID: "50100"
Name: "Warehouse Entry"
Namespace: "Contoso.Warehouse"
App: "Contoso Warehouse 1.0.0.0"
Access: "Public"
DataClassification: "CustomerContent"
Caption: "Warehouse Entries"
---
```

The table starts with the normalized identity fields `Type`, `ID`, `Name`,
`Namespace`, and `App`. It then includes every property declared directly on
the object, in source order. Property values remain AL values; the generator
object, in source order. Property values remain AL values and are escaped only
as required for a valid YAML double-quoted scalar.

Extension objects include `Extends` in metadata and link it when the base
object is another generated workspace object.

### Dependencies

Outgoing relationships are grouped by relationship kind and sorted by target.

| Relationship | Target | From | Evidence |
| --- | --- | --- | --- |
| TableRelation | [Location](../table/14-location.md) | Field `LocationCode` | `Location.Code` |
| Reads | [Warehouse Entry](../table/50100-warehouse-entry.md) | `FindEntries(Code[20])` | `FindSet` |
| Calls | [Warehouse Service](../codeunit/50102-warehouse-service.md) | `Post()` | `Run()` |
| Implements | [Inventory Provider](../interface/50103-inventory-provider.md) | Object | `Implements` |

The section can contain `extends`, `implements`, `relates`, `reads`, `writes`,
`calls`, `publishes`, `subscribes`, `runs`, `part`, `includes`, `permits`, and
enum implementation-selection relationships. It uses the existing relation
evidence, including source member, operation, condition, and target field.

Repeated runtime operations between the same source member and target are
combined into one row. Schema relations such as `TableRelation` stay separate
from runtime reads and writes.

### Used by

`Used by` is the inverse projection of resolved workspace edges. It uses the
same columns and points to the source object. Unresolved edges cannot produce a
backlink.

### Source

The source section contains the project-relative AL file and starting line. If
the normal `--source-url` template is configured, the file is also a repository
link. Local absolute paths are never written.

## Object-type sections

### Tables and table extensions

Tables contain a field matrix and keys. Table extensions additionally show
field modifications when present.

| No. | Field | Type | Length | Properties | Table relation |
| ---: | --- | --- | ---: | --- | --- |
| 1 | Entry No. | Integer | | `AutoIncrement = true` | |
| 2 | Location Code | Code | 20 | `NotBlank = true` | [Location.Code](../table/14-location.md) |

The field's `TableRelation` is rendered in its own linked column and is not
duplicated in `Properties`. Conditional relations retain their condition and
filters. Keys use a second matrix with name, fields, and key properties.

### Pages, page extensions, and page customizations

Pages use separate sections for fields, parts, and actions.

Fields:

| Field | Source expression | Area/Container | Properties |
| --- | --- | --- | --- |

Parts:

| Part | Page | Area/Container | Properties |
| --- | --- | --- | --- |

Actions:

| Action | Area/Group | Runs | Properties |
| --- | --- | --- | --- |

Page extensions and customizations also identify `add`, `modify`, `move`, and
`actionref` changes so the catalog distinguishes added controls from changes to
existing controls.

### Codeunits

Codeunits list global variables and procedure headers. Procedure bodies and
local variables are excluded.

Global variables:

| Variable | Type | Subtype | Properties |
| --- | --- | --- | --- |

Procedures:

| Visibility | Procedure header | Attributes |
| --- | --- | --- |
| Public | `Post(var Header: Record "Warehouse Header"): Boolean` | |
| Local | `ValidateLines(Header: Record "Warehouse Header")` | `TryFunction` |

Triggers and event publishers use separate matrices because they have
different roles. Procedure headers preserve parameter names, `var`, types,
subtypes, return names and types, overloads, and attributes.

### Interfaces

Interfaces list inherited interfaces in metadata and expose one procedure
header matrix. Implementing codeunits appear under `Used by`.

### Enums and enum extensions

Enums list values with ordinal, name, caption, declared properties, and linked
implementation codeunits. Enum extensions also link the enum they extend.

### Reports and report extensions

Reports separate:

- dataset dataitems and columns;
- request-page fields and actions;
- labels;
- triggers and procedure headers.

Report extensions show added or modified dataset elements and request-page
changes rather than pretending to be complete reports.

### Queries

Queries list dataitems, columns, filters, joins/dataitem links, triggers, and
procedure headers in separate matrices.

### XMLports

XMLports list schema nodes, source fields/text elements, direction and format
properties, request-page fields/actions, triggers, and procedure headers.

### Permission sets and permission-set extensions

Permission sets list assignability in metadata, included permission sets, and
grants in a matrix with object type, linked target, and rights. Permission-set
extensions link their base permission set and list added inclusions or grants.

### Control add-ins

Control add-ins list scripts, startup/recreate scripts, style sheets, images,
events, and procedure headers. Asset paths are text, not copied files.

### Profiles, profile extensions, and page customizations

Profiles list role-center, description, and customization properties. Profile
extensions list the extended profile and added page customizations. A page
customization keeps the page-oriented fields, parts, and actions described
above and links both its target page and profile usage when resolvable.

### Entitlements

Entitlements list included permission sets and license/user-plan properties.

### Unknown future object types

An object type recognized by the parser but without a specialized renderer
still receives a valid document with metadata, generic declared members,
dependencies, backlinks, and source. This prevents a new AL object type from
silently disappearing from the catalog.

## Analyzer model additions

The Markdown writer must not parse AL. The shared architecture model needs the
following additions:

- `properties` on every object and structural member;
- complete field type, number, source expression, and container context;
- first-class page parts and control modifications;
- complete procedure parameters and return declarations;
- global-variable visibility and subtype details;
- enum values and implementation properties;
- report dataset, query, XMLport, permission, profile, entitlement, and
  control-add-in member collections.

Each model item retains its source location. Existing object keys and resolved
edges remain the identity and linking mechanism.

These additions benefit `inspect` and later diagram details as well. They must
be additive so existing JSON consumers and diagram renderers continue to work.

## Generation rules

- Generate UTF-8 Markdown with LF line endings.
- Sort documents by app, namespace, type, numeric ID, then name.
- Preserve source directories relative to the selected input; use an
  object-type directory only for source files at the input root.
- Preserve declaration order inside member matrices.
- Use relative links and POSIX `/` separators on every operating system.
- Escape `|`, line breaks, and Markdown link characters in cell values.
- Write to a temporary directory and replace the destination only after every
  document and link has been produced successfully.
- Do not include timestamps in object files. This keeps unchanged objects
  byte-for-byte stable.
- Emit diagnostics for duplicate output paths, unresolved workspace-looking
  targets, and links to filtered-out objects.

## Validation and CI

The generator validates that:

- every selected workspace object has exactly one file;
- every generated relative link resolves;
- every object file contains `Metadata`, `Dependencies`, `Used by`, and
  `Source`;
- object and member ordering is deterministic;
- no local absolute path is present.

CI can regenerate and compare the output:

```sh
bca codegraph app --output-dir docs/codegraph
git diff --exit-code -- docs/codegraph
```

## Implementation sequence

1. Extend analyzer fixtures and the architecture model with object properties,
   complete procedure headers, page parts, and richer fields.
2. Add a pure Markdown renderer for the common contract and the four primary
   object types: table, page, codeunit, and interface.
3. Add deterministic path allocation, links, backlinks, and `index.md`.
4. Add the remaining specialized object renderers listed above.
5. Expose `bca codegraph`, document it, and add generation snapshots plus a
   stale-output CI example.

The first usable increment ends after step 3. Other object types already get
the generic fallback, so specialized renderers can be added without changing
the file or link contract.