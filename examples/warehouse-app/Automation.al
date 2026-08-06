namespace BCA.Example.Automation;

using BCA.Example.Inventory;

codeunit 50120 "Warehouse Notifications"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"Warehouse Processor", 'OnRequestProcessed', '', false, false)]
    local procedure NotifyRequestProcessed()
    begin
        SendNotification();
    end;

    local procedure SendNotification()
    begin
    end;
}

permissionset 50121 "WAREHOUSE PROCESS"
{
    Assignable = true;
    Permissions =
        tabledata "Warehouse Request" = RIMD,
        codeunit "Warehouse Processor" = X,
        page "Warehouse Requests" = X;
}
