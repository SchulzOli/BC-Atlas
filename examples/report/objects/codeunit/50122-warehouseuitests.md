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

Verifies and documents the primary warehouse request workflows through the user interface.

## Overview

| Characteristic | Value |
| --- | --- |
| Access | internal |
| Subtype | Test |
| Permissions | tabledata "Warehouse Request" = RIMD |
| Size | 69 lines, 2 procedures (2 public), 2 global variables |
| Complexity | 4 in all, at most 2 (WarehouseRequests_CreateRequest_PersistsDescription), 2 on average |

## Global variables

| Variable | Type | Subtype |
| --- | --- | --- |
| RequestNotProcessedErr | Label |  |
| UnexpectedDescriptionErr | Label |  |

## Procedures

| Visibility | Procedure header | Lines | Complexity | Description |
| --- | --- | --- | --- | --- |
| public | `procedure WarehouseRequests_CreateRequest_PersistsDescription()` | 26 | 2 | `[Test]` |
| public | `procedure WarehouseRequests_ProcessRequest_MarksRequestProcessed()` | 29 | 2 | `[Test]` |

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
