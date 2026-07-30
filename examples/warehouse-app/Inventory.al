namespace BCA.Example.Inventory;

interface "Handles Warehouse Activity"
{
    procedure Process();
}

table 50100 "Warehouse Request"
{
    fields
    {
        field(1; "Entry No."; Integer) { }
        field(2; Description; Text[100]) { }
        field(3; Processed; Boolean) { }
    }
}

codeunit 50101 "Warehouse Processor" implements "Handles Warehouse Activity"
{
    var
        Request: Record "Warehouse Request";

    procedure Process()
    begin
        ValidateRequest();
        Request.Modify();
        OnRequestProcessed();
    end;

    local procedure ValidateRequest()
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
