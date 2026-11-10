codeunit 50165 "BAS Install"
{
    Subtype = Install;
    Access = Internal;

    trigger OnInstallAppPerDatabase()
    var
        Setup: Record "BAS Setup";
    begin
        Setup.InsertIfNotExists();
    end;
}
