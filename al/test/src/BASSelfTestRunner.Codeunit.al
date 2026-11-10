/// <summary>
/// Runs every Atlas Sync test codeunit without Microsoft's test framework apps. Each test codeunit
/// runs in its own transaction that is rolled back afterwards, so the tests leave no data behind.
/// </summary>
codeunit 50259 "BAS Self Test Runner"
{
    Subtype = TestRunner;
    TestIsolation = Codeunit;

    trigger OnRun()
    var
        ResultStore: Codeunit "BAS Test Result Store";
    begin
        ResultStore.Clear();
        Codeunit.Run(Codeunit::"BAS Test Text Helper");
        Codeunit.Run(Codeunit::"BAS Test Call Stack Parser");
        Codeunit.Run(Codeunit::"BAS Test Page Script Import");
        Codeunit.Run(Codeunit::"BAS Test Recorder");
        Codeunit.Run(Codeunit::"BAS Test Profiler Import");
        Codeunit.Run(Codeunit::"BAS Test Snapshot Builder");
        Codeunit.Run(Codeunit::"BAS Test Doc Generation");
    end;

    trigger OnBeforeTestRun(CodeunitId: Integer; CodeunitName: Text; FunctionName: Text; Permissions: TestPermissions): Boolean
    var
        ResultStore: Codeunit "BAS Test Result Store";
    begin
        ResultStore.TestStarted();
        exit(true);
    end;

    trigger OnAfterTestRun(CodeunitId: Integer; CodeunitName: Text; FunctionName: Text; Permissions: TestPermissions; Success: Boolean)
    var
        ResultStore: Codeunit "BAS Test Result Store";
    begin
        if FunctionName = '' then
            exit; // the OnRun of the test codeunit itself
        ResultStore.Add(CodeunitId, CodeunitName, FunctionName, Success, GetLastErrorText());
    end;
}
