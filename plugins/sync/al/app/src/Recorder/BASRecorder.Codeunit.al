/// <summary>
/// Session-wide recorder state. While a recording is active in this session every database write
/// (via the global triggers) is buffered together with the full AL call stack.
/// The buffer is a temporary table on purpose: temporary records survive a rollback, so writes of a
/// process that ends in an error are still documented. The buffer is persisted on Stop.
/// </summary>
codeunit 50150 "BAS Recorder"
{
    SingleInstance = true;
    Access = Public;

    var
        TempBufferedEvent: Record "BAS Recording Event" temporary;
        TrackedTables: Dictionary of [Integer, Boolean];
        ActiveRecordingNo: Integer;
        RecordingStartedAt: DateTime;
        NextEntryNo: Integer;
        BufferedCount: Integer;
        MaxEvents: Integer;
        ExcludedTableFilter: Text;
        SetupLoaded: Boolean;
        RecorderArmed: Boolean;
        CaptureCallStack: Boolean;
        IncludeSystemTables: Boolean;
        UseProfiler: Boolean;
        LimitReached: Boolean;
        ProfilerRunning: Boolean;
        NotArmedErr: Label 'The recorder is not enabled. Turn on Recorder Enabled in Atlas Sync Setup, then sign out and in again so that this session arms the database triggers.';
        AlreadyRecordingErr: Label 'Recording %1 is already running in this session. Stop it first.', Comment = '%1 = recording number';
        RecordingElsewhereErr: Label 'Recording %1 is marked as running in session %2. Use Force Stop if that session no longer exists.', Comment = '%1 = recording number, %2 = session id';
        NotActiveErr: Label 'Recording %1 is not running in this session.', Comment = '%1 = recording number';
        NotRecordingErr: Label 'No recording is running in this session.';
        ProfilerNotStartedMsg: Label 'The recording runs, but the sampling profiler could not be started (%1). The snapshot will contain call stacks of writes only.', Comment = '%1 = error text';
        FormatTxt: Label '%1 %2 %3', Locked = true;

    procedure StartRecording(var Recording: Record "BAS Recording")
    var
        ProfilerBridge: Codeunit "BAS Profiler Bridge";
    begin
        ReloadSetup();
        if not RecorderArmed then
            Error(NotArmedErr);
        if ActiveRecordingNo <> 0 then
            Error(AlreadyRecordingErr, ActiveRecordingNo);
        Recording.Get(Recording."No.");
        if Recording.Status = Recording.Status::Recording then
            Error(RecordingElsewhereErr, Recording."No.", Recording."Session ID");
        Recording.TestField("Process Name");

        if Recording."Started At" = 0DT then
            Recording."Started At" := CurrentDateTime();
        Recording.Status := Recording.Status::Recording;
        Recording."Session ID" := SessionId();
        Recording."Stopped At" := 0DT;
        Recording.Modify(true);

        TempBufferedEvent.Reset();
        TempBufferedEvent.DeleteAll();
        BufferedCount := 0;
        LimitReached := false;
        NextEntryNo := LastEntryNo(Recording."No.");
        RecordingStartedAt := Recording."Started At";
        ActiveRecordingNo := Recording."No.";

        if UseProfiler then begin
            ProfilerRunning := ProfilerBridge.TryStart();
            if not ProfilerRunning then
                Message(ProfilerNotStartedMsg, GetLastErrorText());
        end;
    end;

    procedure StopRecording(var Recording: Record "BAS Recording")
    var
        ProfilerBridge: Codeunit "BAS Profiler Bridge";
    begin
        if ActiveRecordingNo <> Recording."No." then
            Error(NotActiveErr, Recording."No.");

        // Stop capturing first so that persisting the buffer is not recorded itself.
        ActiveRecordingNo := 0;
        FlushBuffer(Recording."No.");

        Recording.Get(Recording."No.");
        if ProfilerRunning then begin
            ProfilerBridge.StopAndStore(Recording);
            ProfilerRunning := false;
        end;
        Recording.Status := Recording.Status::Stopped;
        Recording."Stopped At" := CurrentDateTime();
        Recording."Limit Reached" := LimitReached;
        Recording.Modify(true);
    end;

    /// <summary>Marks a recording as stopped when the session that recorded it is gone. Unflushed events of that session are lost.</summary>
    procedure ForceStop(var Recording: Record "BAS Recording")
    begin
        if ActiveRecordingNo = Recording."No." then begin
            StopRecording(Recording);
            exit;
        end;
        Recording.Get(Recording."No.");
        Recording.Status := Recording.Status::Stopped;
        if Recording."Stopped At" = 0DT then
            Recording."Stopped At" := CurrentDateTime();
        Recording.Modify(true);
    end;

    /// <summary>Adds a manual step boundary ("Now the user releases the order") to the timeline.</summary>
    procedure AddMarker(Description: Text)
    begin
        if ActiveRecordingNo = 0 then
            Error(NotRecordingErr);
        AppendEvent(Enum::"BAS Event Type"::Marker, 0, '', '', Description, '');
    end;

    /// <summary>Forgets the session state (active recording, buffer, setup cache) without saving anything. For tests.</summary>
    procedure ResetSession()
    begin
        ActiveRecordingNo := 0;
        TempBufferedEvent.Reset();
        TempBufferedEvent.DeleteAll();
        BufferedCount := 0;
        LimitReached := false;
        ProfilerRunning := false;
        SetupLoaded := false;
        Clear(TrackedTables);
    end;

    procedure IsRecording(): Boolean
    begin
        exit(ActiveRecordingNo <> 0);
    end;

    procedure ActiveRecording(): Integer
    begin
        exit(ActiveRecordingNo);
    end;

    procedure BufferedEventCount(): Integer
    begin
        exit(BufferedCount);
    end;

    /// <summary>Called for every global database write of this session.</summary>
    procedure LogDatabaseWrite(EventType: Enum "BAS Event Type"; var RecRef: RecordRef)
    var
        CallStack: Text;
    begin
        if ActiveRecordingNo = 0 then
            exit;
        if LimitReached then
            exit;
        if RecRef.IsTemporary() then
            exit;
        if not IsTableTracked(RecRef.Number()) then
            exit;
        if (MaxEvents > 0) and (BufferedCount >= MaxEvents) then begin
            LimitReached := true;
            exit;
        end;

        if CaptureCallStack then
            CallStack := SessionInformation.Callstack();
        AppendEvent(EventType, RecRef.Number(), RecRef.Name(), Format(RecRef.RecordId()), '', CallStack);
    end;

    /// <summary>True when this session should route writes through the global triggers.</summary>
    procedure IsRecorderArmed(): Boolean
    begin
        LoadSetup();
        exit(RecorderArmed);
    end;

    procedure IsTableTracked(TableId: Integer): Boolean
    var
        TempInteger: Record "Integer" temporary;
        Tracked: Boolean;
    begin
        if (TableId >= 50150) and (TableId <= 50199) then
            exit(false); // the recorder's own tables
        if TrackedTables.Get(TableId, Tracked) then
            exit(Tracked);

        LoadSetup();
        Tracked := true;
        if (TableId >= 2000000000) and not IncludeSystemTables then
            Tracked := false;
        if Tracked and (ExcludedTableFilter <> '') then begin
            TempInteger.Number := TableId;
            TempInteger.Insert();
            TempInteger.SetFilter(Number, ExcludedTableFilter);
            Tracked := TempInteger.IsEmpty();
        end;
        TrackedTables.Set(TableId, Tracked);
        exit(Tracked);
    end;

    procedure ReloadSetup()
    begin
        SetupLoaded := false;
        Clear(TrackedTables);
        LoadSetup();
    end;

    local procedure LoadSetup()
    var
        Setup: Record "BAS Setup";
    begin
        if SetupLoaded then
            exit;
        SetupLoaded := true;
        RecorderArmed := false;
        // Runs inside every session's trigger setup: never fail for users without access to the app.
        if not Setup.ReadPermission() then
            exit;
        Setup.ReadOrDefault();
        RecorderArmed := Setup."Recorder Enabled";
        CaptureCallStack := Setup."Capture Call Stack";
        IncludeSystemTables := Setup."Include System Tables";
        UseProfiler := Setup."Use Sampling Profiler";
        ExcludedTableFilter := Setup."Excluded Table Filter";
        MaxEvents := Setup."Max Events per Recording";
    end;

    local procedure AppendEvent(EventType: Enum "BAS Event Type"; TableId: Integer; TableName: Text; RecordIdText: Text; Description: Text; CallStack: Text)
    begin
        NextEntryNo += 1;
        BufferedCount += 1;
        TempBufferedEvent.Init();
        TempBufferedEvent."Recording No." := ActiveRecordingNo;
        TempBufferedEvent."Entry No." := NextEntryNo;
        TempBufferedEvent."Event Type" := EventType;
        TempBufferedEvent."Occurred At" := CurrentDateTime();
        TempBufferedEvent."Elapsed (ms)" := TempBufferedEvent."Occurred At" - RecordingStartedAt;
        TempBufferedEvent."Table ID" := TableId;
        TempBufferedEvent."Table Name" := CopyStr(TableName, 1, MaxStrLen(TempBufferedEvent."Table Name"));
        TempBufferedEvent."Record ID" := CopyStr(RecordIdText, 1, MaxStrLen(TempBufferedEvent."Record ID"));
        TempBufferedEvent.Description := CopyStr(Description, 1, MaxStrLen(TempBufferedEvent.Description));
        TempBufferedEvent.SetCallStack(CallStack);
        TempBufferedEvent.Insert();
    end;

    local procedure FlushBuffer(RecordingNo: Integer)
    begin
        TempBufferedEvent.Reset();
        if TempBufferedEvent.FindSet() then
            repeat
                PersistEvent(RecordingNo, TempBufferedEvent, TempBufferedEvent.GetCallStack(), CaptureCallStack);
            until TempBufferedEvent.Next() = 0;
        TempBufferedEvent.DeleteAll();
        BufferedCount := 0;
    end;

    /// <summary>
    /// Saves one event with its parsed call stack (origin, writer, frames). Used when a recording
    /// is stopped, and by demo data and tests to replay recorded call stacks.
    /// </summary>
    procedure PersistEvent(RecordingNo: Integer; SourceEvent: Record "BAS Recording Event"; CallStack: Text; CallStackCaptured: Boolean)
    var
        RecordingEvent: Record "BAS Recording Event";
        CallFrame: Record "BAS Call Frame";
        TempFrame: Record "BAS Call Frame" temporary;
        Parser: Codeunit "BAS Call Stack Parser";
    begin
        RecordingEvent.Init();
        RecordingEvent.TransferFields(SourceEvent);
        RecordingEvent."Recording No." := RecordingNo;
        RecordingEvent.SetCallStack(CallStack);
        Parser.ParseCallStack(CallStack, TempFrame);
        Parser.AnnotateEvent(RecordingEvent, TempFrame, CallStackCaptured);
        if RecordingEvent.Description = '' then
            RecordingEvent.Description := CopyStr(StrSubstNo(FormatTxt, RecordingEvent."Event Type", RecordingEvent."Table Name", RecordingEvent."Record ID"), 1, MaxStrLen(RecordingEvent.Description));
        RecordingEvent.Insert();

        TempFrame.Reset();
        if TempFrame.FindSet() then
            repeat
                CallFrame := TempFrame;
                CallFrame."Recording No." := RecordingNo;
                CallFrame."Event Entry No." := RecordingEvent."Entry No.";
                CallFrame.Insert();
            until TempFrame.Next() = 0;
    end;

    local procedure LastEntryNo(RecordingNo: Integer): Integer
    var
        RecordingEvent: Record "BAS Recording Event";
    begin
        RecordingEvent.SetRange("Recording No.", RecordingNo);
        if RecordingEvent.FindLast() then
            exit(RecordingEvent."Entry No.");
        exit(0);
    end;
}
