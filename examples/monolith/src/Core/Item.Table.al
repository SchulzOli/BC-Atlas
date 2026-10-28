namespace Contoso.Core;

table 50000 "CON Item"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { }
        field(2; Description; Text[100]) { }
        field(3; "Unit Price"; Decimal) { }
        field(4; "Category Code"; Code[20]) { TableRelation = "CON Item Category".Code; }
        field(5; "Last Sold"; Date) { }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
    }
}

table 50001 "CON Item Category"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; Code; Code[20]) { }
        field(2; Description; Text[100]) { }
    }

    keys
    {
        key(PK; Code) { Clustered = true; }
    }
}
