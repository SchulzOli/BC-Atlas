namespace Contoso.Core;

using Contoso.Warehouse;

// Reacts to shipments; it lives in Core but only Warehouse raises the event.
codeunit 50001 "CON Warehouse Hooks"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CON Shipment Mgt.", 'OnAfterShip', '', false, false)]
    local procedure UpdateLastSold(ItemNo: Code[20])
    var
        Item: Record "CON Item";
    begin
        if Item.Get(ItemNo) then begin
            Item."Last Sold" := Today();
            Item.Modify();
        end;
    end;
}
