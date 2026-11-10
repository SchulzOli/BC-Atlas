/// <summary>
/// Removes API log entries older than "Log Retention Days".
/// Schedule it as a Job Queue Entry (Object Type to Run = Codeunit, ID = 50103), e.g. daily.
/// </summary>
codeunit 50103 "OBI Purge Log"
{
    Access = Public;
    Permissions = tabledata "OBI Setup" = r,
                  tabledata "OBI API Log" = rd;

    trigger OnRun()
    begin
        Purge();
    end;

    /// <summary>Returns the number of deleted entries.</summary>
    procedure Purge(): Integer
    var
        Setup: Record "OBI Setup";
        ApiLog: Record "OBI API Log";
        Deleted: Integer;
    begin
        Setup.ReadOrDefault();
        if Setup."Log Retention Days" <= 0 then
            exit(0);

        ApiLog.SetFilter(SystemCreatedAt, '<%1', CreateDateTime(Today() - Setup."Log Retention Days", 0T));
        Deleted := ApiLog.Count();
        if Deleted > 0 then
            ApiLog.DeleteAll();
        exit(Deleted);
    end;
}
