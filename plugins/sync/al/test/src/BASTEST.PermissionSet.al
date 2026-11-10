/// <summary>Run the Atlas Sync tests and the self-test page.</summary>
permissionset 50250 "BAS TEST"
{
    Caption = 'Atlas Sync Tests';
    Assignable = true;
    IncludedPermissionSets = "BAS RECORDER";

    Permissions =
        table "BAS Test Result" = X,
        codeunit "BAS Test Assert" = X,
        codeunit "BAS Test Library" = X,
        codeunit "BAS Test Text Helper" = X,
        codeunit "BAS Test Call Stack Parser" = X,
        codeunit "BAS Test Page Script Import" = X,
        codeunit "BAS Test Recorder" = X,
        codeunit "BAS Test Profiler Import" = X,
        codeunit "BAS Test Snapshot Builder" = X,
        codeunit "BAS Test Doc Generation" = X,
        codeunit "BAS Self Test Runner" = X,
        codeunit "BAS Test Result Store" = X,
        page "BAS Self Test" = X;
}
