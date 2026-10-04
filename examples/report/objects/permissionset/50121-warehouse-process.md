---
Type: "Permission Set"
ID: "50121"
Name: "WAREHOUSE PROCESS"
Namespace: "BCA.Example.Automation"
App: "BC Atlas Warehouse Example 1.0.0.0"
Assignable: "true"
Permissions: "tabledata \"Warehouse Request\" = RIMD,\n        codeunit \"Warehouse Processor\" = X,\n        page \"Warehouse Requests\" = X"
---

# Permission Set 50121 WAREHOUSE PROCESS

## Dependencies

| Relationship | Target | From | Evidence |
| --- | --- | --- | --- |
| Permits | [Warehouse Processor](../codeunit/50101-warehouse-processor.md) | Object | X |
| Permits | [Warehouse Request](../table/50100-warehouse-request.md) | Object | RIMD |
| Permits | [Warehouse Requests](../page/50110-warehouse-requests.md) | Object | X |

## Used by

None.

## Source

Automation.al:18
