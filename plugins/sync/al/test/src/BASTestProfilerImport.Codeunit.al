codeunit 50256 "BAS Test Profiler Import"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "BAS Test Assert";
        Library: Codeunit "BAS Test Library";

    trigger OnRun()
    begin
        // [FEATURE] [Atlas Sync] [Profiler] [UT]
    end;

    [Test]
    procedure LoadsCallTreeWithParentsDepthAndHits()
    var
        CallFrame: Record "BAS Call Frame";
        ProfilerBridge: Codeunit "BAS Profiler Bridge";
        TempBlob: Codeunit "Temp Blob";
        InStr: InStream;
        RecordingNo: Integer;
    begin
        // [SCENARIO] An .alcpuprofile becomes profiler frames; the synthetic (root) node is skipped.
        RecordingNo := Library.CreateRecording('Profile test');
        Library.SampleProfile(TempBlob);
        TempBlob.CreateInStream(InStr, TextEncoding::UTF8);
        ProfilerBridge.LoadProfileFrames(RecordingNo, InStr);

        CallFrame.SetRange("Recording No.", RecordingNo);
        CallFrame.SetRange(Source, CallFrame.Source::Profiler);
        Assert.AreEqual(2, CallFrame.Count(), 'root skipped');
        CallFrame.Get(RecordingNo, CallFrame.Source::Profiler, 0, 3);
        Assert.AreEqual('Codeunit', CallFrame."Object Type", 'normalized type');
        Assert.AreEqual(80, CallFrame."Object ID", 'object id');
        Assert.AreEqual('CheckAndUpdate', CallFrame."Method Name", 'method');
        Assert.AreEqual(2, CallFrame."Parent Frame No.", 'parent');
        Assert.AreEqual(2, CallFrame.Depth, 'depth below (root)');
        Assert.AreEqual(7, CallFrame."Hit Count", 'samples');
        Assert.AreEqual('Base Application', CallFrame."App Name", 'app');
    end;

    [Test]
    procedure InvalidProfileIsRejected()
    var
        ProfilerBridge: Codeunit "BAS Profiler Bridge";
        TempBlob: Codeunit "Temp Blob";
        OutStr: OutStream;
        InStr: InStream;
    begin
        TempBlob.CreateOutStream(OutStr, TextEncoding::UTF8);
        OutStr.WriteText('{"no-nodes": true}');
        TempBlob.CreateInStream(InStr, TextEncoding::UTF8);
        asserterror ProfilerBridge.LoadProfileFrames(Library.CreateRecording('Bad profile'), InStr);
        Assert.ExpectedError('not a valid AL CPU profile');
    end;
}
