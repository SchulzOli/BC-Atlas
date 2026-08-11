# BC Atlas architecture analysis

BC Atlas turns AL source and package symbols into focused architecture models while preserving the evidence used to derive each relationship.

## Language

**Architecture Model**:
The resolved collection of AL objects, relationships, diagnostics, and view metadata.

**Operation Semantics**:
The canonical classification of an AL call as a read, write, explicit commit, or ordinary call.

**Relation Evidence**:
The operations, source procedures, occurrences, confidence, and other facts supporting one architecture relationship.

**Call Target**:
The procedure selected from an owning AL object using receiver type, scope, name, and arity.

**Permission Fact**:
A normalized table-data grant, execute grant, permission-set inclusion, or permission-set classification.

## Relationships

- An **Architecture Model** contains relationships with zero or more items of **Relation Evidence**.
- **Operation Semantics** determines whether a call becomes data-access evidence or needs a **Call Target**.
- A **Call Target** connects two procedure members in an **Architecture Model**.
- A **Permission Fact** connects a permission set to an AL object or another permission set.

## Example dialogue

> **Dev:** "Why does this relationship have a weight of three?"
> **Domain expert:** "Its **Relation Evidence** contains three calls, all classified by **Operation Semantics** as writes to the same table."

## Flagged ambiguities

- "relation" can mean an AL schema relation or any graph edge; use **Relation Evidence** for the facts retained while graph edges are aggregated.
