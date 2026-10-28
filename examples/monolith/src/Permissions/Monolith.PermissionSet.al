namespace Contoso.Permissions;

using Contoso.Core;
using Contoso.Sales;
using Contoso.Warehouse;

permissionset 50000 "CON ALL"
{
    Assignable = true;
    Permissions =
        tabledata "CON Item" = RIMD,
        tabledata "CON Item Category" = RIMD,
        tabledata "CON Sales Order" = RIMD,
        tabledata "CON Shipment" = RIMD,
        codeunit "CON Item Mgt." = X,
        codeunit "CON Sales-Post" = X,
        codeunit "CON Shipment Mgt." = X;
}
