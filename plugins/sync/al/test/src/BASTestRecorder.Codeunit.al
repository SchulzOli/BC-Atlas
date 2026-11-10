codeunit 50255 "BAS Test Recorder"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "BAS Test Assert";
        Library: Codeunit "BAS Test Library";
        Recorder: Codeunit "BAS Recorder";

    trigger OnRun()
    begin
        // [FEATURE] [Atlas Sync] [Recorder] [UT]
    end;

    [Test]
    procedure OwnAndSystemTablesAreNotTracked()
    var
        Setup: Record "BAS Setup";
    begin
        Library.ArmRecorder(true);
        Assert.IsFalse(Recorder.IsTableTracked(Database::"BAS Recording Event"), 'own tables never tracked (no recursion)');
        Assert.IsFalse(Recorder.IsTableTracked(2000000001), 'system tables excluded by default');
        Assert.IsTrue(Recorder.IsTableTracked(18), 'Customer tracked');

        Setup.Get();
        Setup."Excluded Table Filter" := '17|405';
        Setup.Modify();
        Recorder.ReloadSetup();
        Assert.IsFalse(Recorder.IsTableTracked(17), 'excluded by filter');
        Assert.IsTrue(Recorder.IsTableTracked(21), 'not in filter');
        Recorder.ResetSession();
    end;

    [Test]
    procedure StartFailsWhenRecorderIsNotEnabled()
    var
        Recording: Record "BAS Recording";
    begin
        Library.ArmRecorder(false);
        Recording.Get(Library.CreateRecording('Not armed'));
        asserterror Recorder.StartRecording(Recording);
        Assert.ExpectedError('not enabled');
        Recorder.ResetSession();
    end;

    [Test]
    procedure RecordsWritesWithCallStackAndMarkers()
    var
        Recording: Record "BAS Recording";
        RecordingEvent: Record "BAS Recording Event";
        CallFrame: Record "BAS Call Frame";
        RecRef: RecordRef;
    begin
        // [SCENARIO] A live recording captures the write with this test as the writer and keeps markers in order.
        Library.ArmRecorder(true);
        Recording.Get(Library.CreateRecording('Live recorder test'));
        Recorder.StartRecording(Recording);
        Assert.IsTrue(Recorder.IsRecording(), 'recording active');

        Recorder.AddMarker('Phase A');
        RecRef.Open(Database::Customer);
        RecRef.Init();
        Recorder.LogDatabaseWrite(Enum::"BAS Event Type"::Insert, RecRef);
        Assert.AreEqual(2, Recorder.BufferedEventCount(), 'buffered before stop');

        Recorder.StopRecording(Recording);
        Assert.IsFalse(Recorder.IsRecording(), 'stopped');
        Recording.Get(Recording."No.");
        Assert.AreEqual(Format(Recording.Status::Stopped), Format(Recording.Status), 'status');

        RecordingEvent.SetRange("Recording No.", Recording."No.");
        Assert.AreEqual(2, RecordingEvent.Count(), 'persisted events');
        RecordingEvent.SetRange("Event Type", RecordingEvent."Event Type"::Marker);
        Assert.AreEqual(1, RecordingEvent.Count(), 'one marker');
        RecordingEvent.SetRange("Event Type", RecordingEvent."Event Type"::Insert);
        RecordingEvent.FindFirst();
        Assert.AreEqual(18, RecordingEvent."Table ID", 'customer write');
        Assert.AreEqual(Codeunit::"BAS Test Recorder", RecordingEvent."Leaf Object ID", 'this test is the writer (recorder frames skipped)');
        Assert.IsTrue(RecordingEvent."Stack Depth" > 0, 'call stack captured');
        Assert.Contains(RecordingEvent.GetCallStack(), 'BAS Test Recorder', 'raw call stack stored');

        CallFrame.SetRange("Recording No.", Recording."No.");
        CallFrame.SetRange("Event Entry No.", RecordingEvent."Entry No.");
        Assert.AreEqual(RecordingEvent."Stack Depth", CallFrame.Count(), 'one frame row per stack line');
        Recorder.ResetSession();
    end;

    [Test]
    procedure TemporaryRecordsAndLimitAreRespected()
    var
        Setup: Record "BAS Setup";
        Recording: Record "BAS Recording";
        RecRef: RecordRef;
    begin
        Library.ArmRecorder(true);
        Setup.Get();
        Setup."Max Events per Recording" := 1;
        Setup.Modify();
        Recording.Get(Library.CreateRecording('Limit test'));
        Recorder.StartRecording(Recording);

        RecRef.Open(Database::Customer, true);
        Recorder.LogDatabaseWrite(Enum::"BAS Event Type"::Insert, RecRef);
        Assert.AreEqual(0, Recorder.BufferedEventCount(), 'temporary records are ignored');
        RecRef.Close();

        RecRef.Open(Database::Customer);
        Recorder.LogDatabaseWrite(Enum::"BAS Event Type"::Insert, RecRef);
        Recorder.LogDatabaseWrite(Enum::"BAS Event Type"::Modify, RecRef);
        Assert.AreEqual(1, Recorder.BufferedEventCount(), 'limit of 1 event');

        Recorder.StopRecording(Recording);
        Recording.Get(Recording."No.");
        Assert.IsTrue(Recording."Limit Reached", 'limit flagged on the recording');
        Recorder.ResetSession();
    end;
}
