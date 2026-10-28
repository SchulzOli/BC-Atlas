namespace Contoso.Warehouse;

using Contoso.Sales;

table 50200 "CON Shipment"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { }
        field(2; "Sales Order No."; Code[20]) { TableRelation = "CON Sales Order"."No."; }
        field(3; "Item No."; Code[20]) { }
        field(4; Quantity; Decimal) { }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
    }
}
