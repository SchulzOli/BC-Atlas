namespace Contoso.Sales;

page 50100 "CON Sales Order"
{
    PageType = Card;
    SourceTable = "CON Sales Order";
    ApplicationArea = All;
    UsageCategory = Documents;

    layout
    {
        area(Content)
        {
            field("No."; Rec."No.") { ApplicationArea = All; }
            field("Item No."; Rec."Item No.") { ApplicationArea = All; }
            field(Quantity; Rec.Quantity) { ApplicationArea = All; }
            field(Amount; Rec.Amount) { ApplicationArea = All; }
        }
    }

    actions
    {
        area(Processing)
        {
            action(Post)
            {
                ApplicationArea = All;
                Caption = 'Post';

                trigger OnAction()
                var
                    SalesPost: Codeunit "CON Sales-Post";
                begin
                    SalesPost.Post(Rec);
                end;
            }
        }
    }
}
