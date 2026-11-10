codeunit 50101 "OBI Install"
{
    Subtype = Install;
    Access = Internal;

    trigger OnInstallAppPerCompany()
    var
        Control: Codeunit "OBI Control";
    begin
        Control.EnsureDefaults();
    end;
}
