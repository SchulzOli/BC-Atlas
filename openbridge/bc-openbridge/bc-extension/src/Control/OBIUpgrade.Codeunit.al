codeunit 50102 "OBI Upgrade"
{
    Subtype = Upgrade;
    Access = Internal;

    trigger OnUpgradePerCompany()
    var
        Control: Codeunit "OBI Control";
    begin
        // Adds control rows for entities introduced in the new version; existing rows keep their settings.
        Control.EnsureDefaults();
    end;
}
