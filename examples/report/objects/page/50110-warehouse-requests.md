---
Type: "Page"
ID: "50110"
Name: "Warehouse Requests"
Namespace: "BCA.Example.UI"
App: "BC Atlas Warehouse Example 1.0.0.0"
ApplicationArea: "All"
Caption: "'Warehouse Requests'"
PageType: "List"
SourceTable: "\"Warehouse Request\""
UsageCategory: "Lists"
---

# Page 50110 Warehouse Requests

## Fields

| Field | Source expression | Area/Container | Properties |
| --- | --- | --- | --- |
| EntryNo | Rec."Entry No." | Content | `ApplicationArea = All`<br>`Caption = 'Entry No.'`<br>`ToolTip = 'Specifies the number that identifies the warehouse request.'` |
| Description | Rec.Description | Content | `ApplicationArea = All`<br>`Caption = 'Description'`<br>`ToolTip = 'Specifies what the warehouse needs to do.'` |
| Processed | Rec.Processed | Content | `ApplicationArea = All`<br>`Caption = 'Processed'`<br>`ToolTip = 'Specifies whether the request has been processed.'`<br>`Editable = false` |

## Actions

| Action | Area/Group | Runs | Properties |
| --- | --- | --- | --- |
| ProcessRequest | Processing |  | `ApplicationArea = All`<br>`Caption = 'Process'`<br>`ToolTip = 'Process the selected warehouse request and mark it as processed.'` |

## Dependencies

| Relationship | Target | From | Evidence |
| --- | --- | --- | --- |
| Reads | [Warehouse Request](../table/50100-warehouse-request.md) | Object |  |
| Uses | [Warehouse Processor](../codeunit/50101-warehouse-processor.md) | Object |  |

## Used by

| Relationship | Source | From | Evidence |
| --- | --- | --- | --- |
| Extends | [Warehouse Request Ext.](../pageextension/50111-warehouse-request-ext.md) | Object |  |
| Permits | [WAREHOUSE PROCESS](../permissionset/50121-warehouse-process.md) | Object | X |
| Uses | [WarehouseUITests](../codeunit/50122-warehouseuitests.md) | Object |  |

## Source

WarehouseUI.al:5
