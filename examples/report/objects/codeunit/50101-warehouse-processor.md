---
Type: "Codeunit"
ID: "50101"
Name: "Warehouse Processor"
Namespace: "BCA.Example.Inventory"
App: "BC Atlas Warehouse Example 1.0.0.0"
Permissions: "tabledata \"Warehouse Request\" = RM"
---

# Codeunit 50101 Warehouse Processor

## Overview

| Characteristic | Value |
| --- | --- |
| Access | public |
| Permissions | tabledata "Warehouse Request" = RM |
| Size | 32 lines, 3 procedures (2 public), 1 event, 1 global variable |
| Complexity | 5 in all, at most 2 (Process), 1.3 on average |

## Global variables

| Variable | Type | Subtype |
| --- | --- | --- |
| Request | Record "Warehouse Request" | Warehouse Request |

## Procedures

| Visibility | Procedure header | Lines | Complexity | Description |
| --- | --- | --- | --- | --- |
| public | `procedure Process()` | 7 | 2 |  |
| public | `procedure Process(var WarehouseRequest: Record "Warehouse Request")` | 7 | 1 |  |
| local | `local procedure ValidateRequest(WarehouseRequest: Record "Warehouse Request")` | 3 | 1 |  |

## Events

| Visibility | Event header | Description | Attributes |
| --- | --- | --- | --- |
| public | `procedure OnRequestProcessed()` |  | [IntegrationEvent(false, false)] |

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
| subscribes | [Warehouse Notifications](50120-warehouse-notifications.md) | NotifyRequestProcessed |  |
| Uses | [Warehouse Requests](../page/50110-warehouse-requests.md) | Object |  |

## Source

Inventory.al:28
