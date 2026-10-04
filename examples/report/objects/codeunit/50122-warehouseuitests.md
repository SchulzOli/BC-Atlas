---
Type: "Codeunit"
ID: "50122"
Name: "WarehouseUITests"
Namespace: "BCA.Example.UI"
App: "BC Atlas Warehouse Example 1.0.0.0"
Access: "Internal"
Permissions: "tabledata \"Warehouse Request\" = RIMD"
Subtype: "Test"
---

# Codeunit 50122 WarehouseUITests

## Global variables

| Variable | Type | Subtype | Properties |
| --- | --- | --- | --- |
| RequestNotProcessedErr | Label |  |  |
| UnexpectedDescriptionErr | Label |  |  |

## Procedures

| Visibility | Procedure header | Attributes |
| --- | --- | --- |
| public | `procedure WarehouseRequests_CreateRequest_PersistsDescription() var WarehouseRequest: Record "Warehouse Request"; WarehouseRequests: TestPage "Warehouse Requests"` | `[Test]` |
| public | `procedure WarehouseRequests_ProcessRequest_MarksRequestProcessed() var WarehouseRequest: Record "Warehouse Request"; WarehouseRequests: TestPage "Warehouse Requests"` | `[Test]` |

## Dependencies

| Relationship | Target | From | Evidence |
| --- | --- | --- | --- |
| Permits | [Warehouse Request](../table/50100-warehouse-request.md) | Object | RIMD |
| Reads | [Warehouse Request](../table/50100-warehouse-request.md) | WarehouseRequests_CreateRequest_PersistsDescription() | Get |
| Reads | [Warehouse Request](../table/50100-warehouse-request.md) | WarehouseRequests_ProcessRequest_MarksRequestProcessed() | Get |
| Uses | [Warehouse Request](../table/50100-warehouse-request.md) | Object |  |
| Uses | [Warehouse Requests](../page/50110-warehouse-requests.md) | Object |  |
| Writes | [Warehouse Request](../table/50100-warehouse-request.md) | WarehouseRequests_CreateRequest_PersistsDescription() | DeleteAll |
| Writes | [Warehouse Request](../table/50100-warehouse-request.md) | WarehouseRequests_ProcessRequest_MarksRequestProcessed() | DeleteAll |
| Writes | [Warehouse Request](../table/50100-warehouse-request.md) | WarehouseRequests_ProcessRequest_MarksRequestProcessed() | Insert |

## Used by

None.

## Source

WarehouseUITests.al:11
