/// <summary>
/// Controls the app: setup and entity controls through the UI or the control-plane APIs
/// (setup, entityControls), plus purging the API log.
/// </summary>
permissionset 50101 "OBI ADMIN"
{
    Caption = 'OpenBridge Administrator';
    Assignable = true;
    IncludedPermissionSets = "OBI API";

    Permissions =
        tabledata "OBI Setup" = RIMD,
        tabledata "OBI Entity Control" = RIMD,
        tabledata "OBI API Log" = RD,
        codeunit "OBI Purge Log" = X,
        page "OBI API Setup" = X,
        page "OBI API Entity Controls" = X,
        page "OBI Setup" = X,
        page "OBI Entity Controls Part" = X,
        page "OBI API Log" = X,
        page "OBI External Mappings" = X;
}
