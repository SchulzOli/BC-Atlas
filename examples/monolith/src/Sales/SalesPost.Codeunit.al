namespace Contoso.Sales;

using Contoso.Core;

codeunit 50100 "CON Sales-Post"
{
    procedure Post(var SalesOrder: Record "CON Sales Order")
    var
        ItemMgt: Codeunit "CON Item Mgt.";
    begin
        SalesOrder.Amount := SalesOrder.Quantity * ItemMgt.UnitPrice(SalesOrder."Item No.");
        SalesOrder.Status := SalesOrder.Status::Posted;
        SalesOrder.Modify();
        OnAfterPost(SalesOrder);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterPost(var SalesOrder: Record "CON Sales Order")
    begin
    end;
}
