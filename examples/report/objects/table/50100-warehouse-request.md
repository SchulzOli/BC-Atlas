---
Type: "Table"
ID: "50100"
Name: "Warehouse Request"
Namespace: "BCA.Example.Inventory"
App: "BC Atlas Warehouse Example 1.0.0.0"
DataClassification: "CustomerContent"
---

# Table 50100 Warehouse Request

## Fields

| No. | Field | Type | Length | Properties | Table relation |
| --- | --- | --- | --- | --- | --- |
| 1 | Entry No. | Integer |  |  |  |
| 2 | Description | Text | 100 |  |  |
| 3 | Processed | Boolean |  |  |  |

## Keys

| Key | Fields | Properties |
| --- | --- | --- |
| PK | Entry No. | `Clustered = true` |

## Dependencies

None.

## Used by

| Relationship | Source | From | Evidence |
| --- | --- | --- | --- |
| Permits | [WAREHOUSE PROCESS](../permissionset/50121-warehouse-process.md) | Object | RIMD |
| Permits | [Warehouse Processor](../codeunit/50101-warehouse-processor.md) | Object | RM |
| Permits | [WarehouseUITests](../codeunit/50122-warehouseuitests.md) | Object | RIMD |
| Reads | [Warehouse Processor](../codeunit/50101-warehouse-processor.md) | Process() | FindFirst |
| Reads | [Warehouse Requests](../page/50110-warehouse-requests.md) | Object |  |
| Reads | [WarehouseUITests](../codeunit/50122-warehouseuitests.md) | WarehouseRequests_CreateRequest_PersistsDescription() | Get |
| Reads | [WarehouseUITests](../codeunit/50122-warehouseuitests.md) | WarehouseRequests_ProcessRequest_MarksRequestProcessed() | Get |
| Uses | [Warehouse Processor](../codeunit/50101-warehouse-processor.md) | Object |  |
| Uses | [WarehouseUITests](../codeunit/50122-warehouseuitests.md) | Object |  |
| Writes | [Warehouse Processor](../codeunit/50101-warehouse-processor.md) | Process(Record "Warehouse Request") | Modify |
| Writes | [WarehouseUITests](../codeunit/50122-warehouseuitests.md) | WarehouseRequests_CreateRequest_PersistsDescription() | DeleteAll |
| Writes | [WarehouseUITests](../codeunit/50122-warehouseuitests.md) | WarehouseRequests_ProcessRequest_MarksRequestProcessed() | DeleteAll |
| Writes | [WarehouseUITests](../codeunit/50122-warehouseuitests.md) | WarehouseRequests_ProcessRequest_MarksRequestProcessed() | Insert |

## Source

Inventory.al:8
