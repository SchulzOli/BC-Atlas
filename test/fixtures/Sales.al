namespace Demo.Sales;

interface "Posts Sales"
{
    procedure Post();
}

table 50100 "Sales Buffer"
{
    fields
    {
        field(1; "Entry No."; Integer) { }
    }
}

codeunit 50101 "Sales Poster" implements "Posts Sales"
{
    var
        Buffer: Record "Sales Buffer";
        Customer: Record Customer;

    procedure Post()
    begin
        Validate();
    end;

    local procedure Validate()
    begin
    end;

    [IntegrationEvent(false, false)]
    procedure OnPosted()
    begin
    end;
}

tableextension 50102 "Customer Sales Ext." extends Customer
{
}

page 50103 "Sales Buffer List"
{
    SourceTable = "Sales Buffer";
}

enum 50104 "Sales Posting Choice" implements "Posts Sales"
{
    value(0; Default)
    {
        Implementation = "Posts Sales" = "Sales Poster";
    }
}

page 50105 "Sales Buffer Card"
{
    SourceTable = "Sales Buffer";

    layout
    {
        area(Content)
        {
            part(Lines; "Sales Buffer List")
            {
            }
        }
    }

    actions
    {
        area(Processing)
        {
            action(OpenList)
            {
                RunObject = page "Sales Buffer List";
            }
        }
    }
}
