namespace BCA.Example.UI;

using BCA.Example.Inventory;

/// <summary>
/// Verifies and documents the primary warehouse request workflows through the user interface.
/// </summary>
/// <remarks>
/// Covers request creation and processing. Notification delivery and background automation are outside this test object.
/// </remarks>
codeunit 50122 WarehouseUITests
{
    Access = Internal;
    Permissions = tabledata "Warehouse Request" = RIMD;
    Subtype = Test;

    [Test]
    procedure WarehouseRequests_CreateRequest_PersistsDescription()
    var
        WarehouseRequest: Record "Warehouse Request";
        WarehouseRequests: TestPage "Warehouse Requests";
    begin
        // [DOC-ID] warehouse-request-create
        // [FEATURE] warehouse-requests
        // [SCENARIO] Create a warehouse request from the request list.
        // [PERMISSIONS] WAREHOUSE PROCESS

        // [GIVEN] [STATE] No warehouse request exists for entry number 10000.
        WarehouseRequest.DeleteAll(false);

        // [WHEN] The user creates a warehouse request with a description.
        WarehouseRequests.OpenNew();
        WarehouseRequests.EntryNo.SetValue(10000);
        WarehouseRequests.Description.SetValue('Receive summer stock');
        WarehouseRequests.Close();

        // [THEN] The warehouse request is saved with the entered description.
        WarehouseRequest.Get(10000);
        if WarehouseRequest.Description <> 'Receive summer stock' then
            Error(UnexpectedDescriptionErr);

        // [NEXT] warehouse-request-process
    end;

    [Test]
    procedure WarehouseRequests_ProcessRequest_MarksRequestProcessed()
    var
        WarehouseRequest: Record "Warehouse Request";
        WarehouseRequests: TestPage "Warehouse Requests";
    begin
        // [DOC-ID] warehouse-request-process
        // [FEATURE] warehouse-requests
        // [SCENARIO] Process an existing warehouse request from the request list.
        // [PERMISSIONS] WAREHOUSE PROCESS

        // [GIVEN] [MASTER-DATA] A warehouse request exists and is not processed.
        WarehouseRequest.DeleteAll(false);
        WarehouseRequest.Validate("Entry No.", 10000);
        WarehouseRequest.Validate(Description, 'Receive summer stock');
        WarehouseRequest.Insert(false);

        // [WHEN] The user chooses Process on the warehouse request.
        WarehouseRequests.OpenEdit();
        WarehouseRequests.GoToRecord(WarehouseRequest);
        WarehouseRequests.ProcessRequest.Invoke();
        WarehouseRequests.Close();

        // [THEN] The warehouse request is marked as processed.
        WarehouseRequest.Get(10000);
        if not WarehouseRequest.Processed then
            Error(RequestNotProcessedErr);

        // [REQUIRES] warehouse-request-create
    end;

    var
        RequestNotProcessedErr: Label 'The warehouse request was not marked as processed.', Comment = 'Shown when the process action did not update the warehouse request.';
        UnexpectedDescriptionErr: Label 'The warehouse request description was not saved.', Comment = 'Shown when the created warehouse request has an unexpected description.';
}