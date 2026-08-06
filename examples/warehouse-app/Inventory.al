namespace BCA.Example.Inventory;

interface "Handles Warehouse Activity"
{
    procedure Process();
}

table 50100 "Warehouse Request"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { }
        field(2; Description; Text[100]) { }
        field(3; Processed; Boolean) { }
    }

    keys
    {
        key(PK; "Entry No.")
        {
            Clustered = true;
        }
    }
}

codeunit 50101 "Warehouse Processor" implements "Handles Warehouse Activity"
{
    Permissions = tabledata "Warehouse Request" = RM;

    var
        Request: Record "Warehouse Request";

    procedure Process()
    begin
        if not Request.FindFirst() then
            exit;

        Process(Request);
    end;

    procedure Process(var WarehouseRequest: Record "Warehouse Request")
    begin
        ValidateRequest(WarehouseRequest);
        WarehouseRequest.Validate(Processed, true);
        WarehouseRequest.Modify(true);
        OnRequestProcessed();
    end;

    local procedure ValidateRequest(WarehouseRequest: Record "Warehouse Request")
    begin
    end;

    [IntegrationEvent(false, false)]
    procedure OnRequestProcessed()
    begin
    end;
}

enum 50102 "Warehouse Handler" implements "Handles Warehouse Activity"
{
    value(0; Default)
    {
        Implementation = "Handles Warehouse Activity" = "Warehouse Processor";
    }
}
