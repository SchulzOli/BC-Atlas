namespace Contoso.Core.Items;

table 50000 "CON Item"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { }
        field(2; Description; Text[100]) { }
        field(3; "Unit Price"; Decimal) { }
        field(4; "Price Group"; Code[10]) { TableRelation = "CON Price Group".Code; }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
    }
}

table 50001 "CON Price Group"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; Code; Code[10]) { }
        field(2; "Discount %"; Decimal) { }
    }

    keys
    {
        key(PK; Code) { Clustered = true; }
    }
}

page 50000 "CON Item Card"
{
    PageType = Card;
    SourceTable = "CON Item";

    layout
    {
        area(Content)
        {
            field("No."; Rec."No.") { }
            field(Description; Rec.Description) { }
        }
    }
}
