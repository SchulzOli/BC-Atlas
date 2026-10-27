namespace Contoso.Sales.Quotes;

using Contoso.Core.Items;
using Contoso.Core.Pricing;

table 50100 "CON Sales Quote"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { }
        field(2; "Item No."; Code[20]) { TableRelation = "CON Item"."No."; }
        field(3; Quantity; Decimal) { }
        field(4; Amount; Decimal) { }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
    }
}

codeunit 50100 "CON Quote Mgt."
{
    procedure Recalculate(var Quote: Record "CON Sales Quote")
    var
        PricingMgt: Codeunit "CON Pricing Mgt.";
    begin
        Quote.Amount := Quote.Quantity * PricingMgt.Calculate(Quote."Item No.");
        Quote.Modify(true);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CON Pricing Mgt.", 'OnAfterCalculate', '', false, false)]
    local procedure RoundPrice(ItemNo: Code[20]; var Price: Decimal)
    begin
        Price := Round(Price, 0.01);
    end;
}

page 50100 "CON Sales Quote"
{
    PageType = Document;
    SourceTable = "CON Sales Quote";

    layout
    {
        area(Content)
        {
            field("No."; Rec."No.") { }
            field("Item No."; Rec."Item No.") { }
            field(Quantity; Rec.Quantity) { }
            field(Amount; Rec.Amount) { }
        }
    }

    actions
    {
        area(Processing)
        {
            action(Recalculate)
            {
                trigger OnAction()
                var
                    QuoteMgt: Codeunit "CON Quote Mgt.";
                begin
                    QuoteMgt.Recalculate(Rec);
                end;
            }
        }
    }
}

permissionset 50100 "CON Sales"
{
    Assignable = true;
    Permissions = tabledata "CON Sales Quote" = RIMD,
        codeunit "CON Quote Mgt." = X,
        page "CON Sales Quote" = X;
}
