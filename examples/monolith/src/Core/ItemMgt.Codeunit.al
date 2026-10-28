namespace Contoso.Core;

codeunit 50000 "CON Item Mgt."
{
    Access = Internal;

    procedure UnitPrice(ItemNo: Code[20]): Decimal
    var
        Item: Record "CON Item";
    begin
        Item.Get(ItemNo);
        exit(Item."Unit Price");
    end;
}
