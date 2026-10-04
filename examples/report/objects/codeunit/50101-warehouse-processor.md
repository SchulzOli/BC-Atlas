---
Type: "Codeunit"
ID: "50101"
Name: "Warehouse Processor"
Namespace: "BCA.Example.Inventory"
App: "BC Atlas Warehouse Example 1.0.0.0"
Permissions: "tabledata \"Warehouse Request\" = RM"
---

# Codeunit 50101 Warehouse Processor

## Global variables

| Variable | Type | Subtype | Properties |
| --- | --- | --- | --- |
| Request | Record "Warehouse Request" | Warehouse Request |  |

## Procedures

| Visibility | Procedure header | Attributes |
| --- | --- | --- |
| public | `procedure Process()` |  |
| public | `procedure Process(var WarehouseRequest: Record "Warehouse Request")` |  |
| local | `local procedure ValidateRequest(WarehouseRequest: Record "Warehouse Request")` |  |

## Events

| Visibility | Event header | Attributes |
| --- | --- | --- |
| public | `procedure OnRequestProcessed()` | [IntegrationEvent(false, false)] |

## Dependencies

| Relationship | Target | From | Evidence |
| --- | --- | --- | --- |
| Implements | [Handles Warehouse Activity](../interface/handles-warehouse-activity.md) | Object |  |
| Permits | [Warehouse Request](../table/50100-warehouse-request.md) | Object | RM |
| Reads | [Warehouse Request](../table/50100-warehouse-request.md) | Process() | FindFirst |
| Uses | [Warehouse Request](../table/50100-warehouse-request.md) | Object |  |
| Writes | [Warehouse Request](../table/50100-warehouse-request.md) | Process(Record "Warehouse Request") | Modify |

## Used by

| Relationship | Source | From | Evidence |
| --- | --- | --- | --- |
| Permits | [WAREHOUSE PROCESS](../permissionset/50121-warehouse-process.md) | Object | X |
| Selects implementation | [Warehouse Handler](../enum/50102-warehouse-handler.md) | Default |  |
| Uses | [Warehouse Requests](../page/50110-warehouse-requests.md) | Object |  |

## Source

Inventory.al:28
