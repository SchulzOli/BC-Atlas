namespace Contoso.Core.Pricing;

using Contoso.Core.Items;

interface "CON Price Calculation"
{
    procedure UnitPrice(ItemNo: Code[20]): Decimal;
}

codeunit 50010 "CON Standard Pricing" implements "CON Price Calculation"
{
    procedure UnitPrice(ItemNo: Code[20]): Decimal
    var
        Item: Record "CON Item";
        PriceGroup: Record "CON Price Group";
    begin
        Item.Get(ItemNo);
        if PriceGroup.Get(Item."Price Group") then
            exit(Item."Unit Price" * (100 - PriceGroup."Discount %") / 100);
        exit(Item."Unit Price");
    end;
}

codeunit 50011 "CON Pricing Mgt."
{
    procedure Calculate(ItemNo: Code[20]): Decimal
    var
        Pricing: Codeunit "CON Standard Pricing";
        Price: Decimal;
    begin
        Price := Pricing.UnitPrice(ItemNo);
        OnAfterCalculate(ItemNo, Price);
        exit(Price);
    end;

    [IntegrationEvent(false, false)]
    procedure OnAfterCalculate(ItemNo: Code[20]; var Price: Decimal)
    begin
    end;
}
