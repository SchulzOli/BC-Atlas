---
Type: "Codeunit"
ID: "50120"
Name: "Warehouse Notifications"
Namespace: "BCA.Example.Automation"
App: "BC Atlas Warehouse Example 1.0.0.0"
---

# Codeunit 50120 Warehouse Notifications

## Overview

| Characteristic | Value |
| --- | --- |
| Access | public |
| Size | 12 lines, 2 procedures (0 public) |
| Complexity | 2 in all, at most 1 (NotifyRequestProcessed), 1 on average |

## Procedures

| Visibility | Procedure header | Lines | Complexity | Description |
| --- | --- | --- | --- | --- |
| local | `local procedure NotifyRequestProcessed()` | 4 | 1 | `[EventSubscriber(ObjectType::Codeunit, Codeunit::"Warehouse Processor", 'OnRequestProcessed', '', false, false)]` |
| local | `local procedure SendNotification()` | 3 | 1 |  |

## Dependencies

| Relationship | Target | From | Evidence |
| --- | --- | --- | --- |
| subscribes | [Warehouse Processor](50101-warehouse-processor.md) | NotifyRequestProcessed |  |

## Used by

| Relationship | Source | From | Evidence |
| --- | --- | --- | --- |
| Permits | [WAREHOUSE PROCESS](../permissionset/50121-warehouse-process.md) | Object | X |

## Source

Automation.al:6
