---
Type: "Enum"
ID: "50102"
Name: "Warehouse Handler"
Namespace: "BCA.Example.Inventory"
App: "BC Atlas Warehouse Example 1.0.0.0"
---

# Enum 50102 Warehouse Handler

## Values

| Ordinal | Value | Properties |
| --- | --- | --- |
| 0 | Default | `Implementation = "Handles Warehouse Activity" = "Warehouse Processor"` |

## Dependencies

| Relationship | Target | From | Evidence |
| --- | --- | --- | --- |
| Implements | [Handles Warehouse Activity](../interface/handles-warehouse-activity.md) | Object |  |
| Selects implementation | [Warehouse Processor](../codeunit/50101-warehouse-processor.md) | Default |  |

## Used by

None.

## Source

Inventory.al:61
