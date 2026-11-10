// Generated from Atlas Sync Fact Snapshot 1 (fingerprint demo-hand-der) of "Demo: Post sales order".
// BC Atlas reads the tags below. Generate the documentation with:
//   bca docs generate <this file> --app <app-root> --export markdown,html,dita,bpmn
// Run it in the AL test framework to replay the clicks. Review lines marked "Atlas Sync: verify"
// and add [ConfirmHandler]/[StrMenuHandler]/[MessageHandler] functions for dialogs of the process.
// (Example: written by hand in the exact shape "BAS Doc Gen AL Test" produces for the demo snapshot.)
codeunit 50000 "BAS UITest DemoPostSalesOrder"
{
    Subtype = Test;
    TestPermissions = Disabled;

    trigger OnRun()
    begin
        // [FEATURE] [Order to cash] [UI]
    end;

    var
        NetChangeErr: Label 'Table %1: expected a net change of %2 records as in Atlas Sync snapshot 1, but got %3.', Comment = '%1 = table, %2 = expected, %3 = actual';

    [Test]
    procedure DemoPostSalesOrder_AsRecorded()
    var
        SalesOrderListPage: TestPage "Sales Order List";
        SalesOrderPage: TestPage "Sales Order";
        CountsBefore: Dictionary of [Integer, Integer];
    begin
        // [DOC-ID] demo-post-sales-order
        // [FEATURE] Order to cash
        // [SCENARIO] Demo: Post sales order: Create a sales order for a customer, add an item line and post it (ship and invoice).
        // [GIVEN] [STATE] Data comparable to the recording in company CRONUS International Ltd. (recorded 2026-11-10).
        CaptureCounts(CountsBefore);

        // [WHEN] Enter the data on the Sales Order page
        // Open Sales Orders.
        SalesOrderListPage.OpenView();
        // On the Sales Orders page, choose New.
        SalesOrderPage.OpenNew();
        // In the Customer Name field, enter "Adatum Corporation".
        SalesOrderPage."Sell-to Customer Name".SetValue('Adatum Corporation');
        // In the Lines part, in the Type field, enter "Item".
        SalesOrderPage."Lines"."Type".SetValue('Item'); // Atlas Sync: verify part name
        // In the Lines part, in the No. field, enter "1896-S".
        SalesOrderPage."Lines"."No.".SetValue('1896-S'); // Atlas Sync: verify part name
        // In the Lines part, in the Quantity field, enter "1".
        SalesOrderPage."Lines"."Quantity".SetValue('1'); // Atlas Sync: verify part name
        // [THEN] Business Central saves: Sales Header: 1x insert; Sales Header: 1x modify; Sales Line: 1x insert; Sales Line: 1x modify; Sales Line: 1x modify; Sales Line: 1x modify

        // [WHEN] On the Sales Order page, choose Post
        // On the Sales Order page, choose Post....
        SalesOrderPage."Post".Invoke();

        // [THEN] The data changes exactly as recorded (net records per table).
        VerifyNetChange(CountsBefore, 17, 3); // G/L Entry: 3 created, 0 deleted
        VerifyNetChange(CountsBefore, 21, 1); // Cust. Ledger Entry: 1 created, 0 deleted
        VerifyNetChange(CountsBefore, 36, 0); // Sales Header: 1 created, 1 deleted
        VerifyNetChange(CountsBefore, 37, 0); // Sales Line: 1 created, 1 deleted
        VerifyNetChange(CountsBefore, 112, 1); // Sales Invoice Header: 1 created, 0 deleted
    end;

    local procedure CaptureCounts(var Counts: Dictionary of [Integer, Integer])
    begin
        Counts.Set(17, CountRecords(17));
        Counts.Set(21, CountRecords(21));
        Counts.Set(36, CountRecords(36));
        Counts.Set(37, CountRecords(37));
        Counts.Set(112, CountRecords(112));
    end;

    local procedure VerifyNetChange(Counts: Dictionary of [Integer, Integer]; TableNo: Integer; Expected: Integer)
    var
        Actual: Integer;
    begin
        Actual := CountRecords(TableNo) - Counts.Get(TableNo);
        if Actual <> Expected then
            Error(NetChangeErr, TableNo, Expected, Actual);
    end;

    local procedure CountRecords(TableNo: Integer): Integer
    var
        RecRef: RecordRef;
    begin
        RecRef.Open(TableNo);
        exit(RecRef.Count());
    end;
}
