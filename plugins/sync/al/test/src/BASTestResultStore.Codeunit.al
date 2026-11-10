/// <summary>Keeps test results in memory; temporary records survive the rollback after each test codeunit.</summary>
codeunit 50260 "BAS Test Result Store"
{
    SingleInstance = true;
    Access = Public;

    var
        TempResult: Record "BAS Test Result" temporary;
        StartedAt: DateTime;

    procedure Clear()
    begin
        TempResult.Reset();
        TempResult.DeleteAll();
    end;

    procedure TestStarted()
    begin
        StartedAt := CurrentDateTime();
    end;

    procedure Add(CodeunitId: Integer; CodeunitName: Text; FunctionName: Text; Success: Boolean; ErrorMessage: Text)
    var
        EntryNo: Integer;
    begin
        TempResult.Reset();
        if TempResult.FindLast() then
            EntryNo := TempResult."Entry No.";
        TempResult.Init();
        TempResult."Entry No." := EntryNo + 1;
        TempResult."Codeunit ID" := CodeunitId;
        TempResult."Codeunit Name" := CopyStr(CodeunitName, 1, MaxStrLen(TempResult."Codeunit Name"));
        TempResult."Function Name" := CopyStr(FunctionName, 1, MaxStrLen(TempResult."Function Name"));
        TempResult.Success := Success;
        if not Success then
            TempResult."Error Message" := CopyStr(ErrorMessage, 1, MaxStrLen(TempResult."Error Message"));
        if StartedAt <> 0DT then
            TempResult."Duration (ms)" := CurrentDateTime() - StartedAt;
        TempResult.Insert();
    end;

    procedure CopyTo(var Target: Record "BAS Test Result" temporary)
    begin
        Target.Reset();
        Target.DeleteAll();
        TempResult.Reset();
        if TempResult.FindSet() then
            repeat
                Target := TempResult;
                Target.Insert();
            until TempResult.Next() = 0;
    end;
}
