namespace Contoso.Integration;

using Contoso.Sales.Quotes;

codeunit 50200 "CON Quote Export"
{
    procedure Export(var Quote: Record "CON Sales Quote")
    var
        QuoteMgt: Codeunit "CON Quote Mgt.";
    begin
        QuoteMgt.Recalculate(Quote);
        // Customer comes from the Base Application, which is not in this workspace.
        if Customer.Get(Quote."No.") then
            Quote.Modify();
    end;

    var
        Customer: Record Customer;
}
