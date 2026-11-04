---
Type: "Codeunit"
ID: "50120"
Name: "Warehouse Notifications"
Namespace: "BCA.Example.Automation"
App: "BC Atlas Warehouse Example 1.0.0.0"
---

# Codeunit 50120 Warehouse Notifications

## Procedures

| Visibility | Procedure header | Attributes |
| --- | --- | --- |
| local | `local procedure NotifyRequestProcessed()` | `[EventSubscriber(ObjectType::Codeunit, Codeunit::"Warehouse Processor", 'OnRequestProcessed', '', false, false)]` |
| local | `local procedure SendNotification()` |  |

## Dependencies

| Relationship | Target | From | Evidence |
| --- | --- | --- | --- |
| subscribes | [Warehouse Processor](50101-warehouse-processor.md) | NotifyRequestProcessed |  |

## Used by

None.

## Source

Automation.al:6
