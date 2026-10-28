namespace Contoso.Sales;

using Contoso.Core;

table 50100 "CON Sales Order"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { }
        field(2; "Item No."; Code[20]) { TableRelation = "CON Item"."No."; }
        field(3; Quantity; Decimal) { }
        field(4; Amount; Decimal) { }
        field(5; Status; Enum "CON Order Status") { }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
    }
}

enum 50100 "CON Order Status"
{
    Extensible = true;

    value(0; Open) { }
    value(1; Posted) { }
    value(2; Shipped) { }
}
