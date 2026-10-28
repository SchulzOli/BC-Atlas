namespace Contoso.Warehouse;

using Contoso.Sales;

codeunit 50200 "CON Shipment Mgt."
{
    procedure Ship(var SalesOrder: Record "CON Sales Order")
    var
        Shipment: Record "CON Shipment";
    begin
        Shipment."No." := SalesOrder."No.";
        Shipment."Sales Order No." := SalesOrder."No.";
        Shipment."Item No." := SalesOrder."Item No.";
        Shipment.Quantity := SalesOrder.Quantity;
        Shipment.Insert();
        SalesOrder.Status := SalesOrder.Status::Shipped;
        SalesOrder.Modify();
        OnAfterShip(SalesOrder."Item No.");
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterShip(ItemNo: Code[20])
    begin
    end;
}
