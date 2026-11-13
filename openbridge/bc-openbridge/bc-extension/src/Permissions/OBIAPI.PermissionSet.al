/// <summary>
/// Assign to the gateway's Microsoft Entra application (page "Microsoft Entra Applications").
/// Data APIs only. Setup and entity controls are readable indirectly (through "OBI Control")
/// but not through the control-plane API pages, so the gateway cannot change its own rules.
/// </summary>
permissionset 50100 "OBI API"
{
    Caption = 'OpenBridge API (gateway)';
    Assignable = true;

    Permissions =
        tabledata "OBI External Mapping" = RIMD,
        tabledata "OBI API Log" = Ri,
        tabledata "OBI Setup" = r,
        tabledata "OBI Entity Control" = r,
        tabledata "Cust. Ledger Entry" = R,
        table "OBI External Mapping" = X,
        table "OBI API Log" = X,
        table "OBI Setup" = X,
        table "OBI Entity Control" = X,
        codeunit "OBI Control" = X,
        page "OBI API External Mappings" = X,
        page "OBI API Cust. Ledger Entries" = X,
        page "OBI API Log Entries" = X;
}
