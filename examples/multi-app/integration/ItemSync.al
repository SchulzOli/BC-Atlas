namespace Contoso.Integration;

using Contoso.Core.Items;

// Reads Contoso Core directly although app.json only declares Contoso Sales.
codeunit 50201 "CON Item Sync"
{
    procedure Sync(ItemNo: Code[20])
    var
        Item: Record "CON Item";
    begin
        if Item.Get(ItemNo) then
            Item.Modify();
    end;
}
