/// <summary>Builders for test data: recordings, call stack lines, documents and profiles.</summary>
codeunit 50251 "BAS Test Library"
{
    Access = Public;

    var
        FrameTxt: Label '"%1"(%2 %3).%4 line %5 - Base Application by Microsoft version 26.5.38752.40541', Locked = true;

    procedure CreateRecording(ProcessName: Text): Integer
    var
        Recording: Record "BAS Recording";
    begin
        Recording.Init();
        Recording."Process Name" := CopyStr(ProcessName, 1, MaxStrLen(Recording."Process Name"));
        Recording."Started At" := CurrentDateTime();
        Recording.Insert(true);
        exit(Recording."No.");
    end;

    procedure StopRecording(RecordingNo: Integer)
    var
        Recording: Record "BAS Recording";
    begin
        Recording.Get(RecordingNo);
        Recording.Status := Recording.Status::Stopped;
        Recording."Stopped At" := CurrentDateTime();
        Recording.Modify(true);
    end;

    /// <summary>Persists one write with a call stack exactly like the recorder does on Stop.</summary>
    procedure AddWrite(RecordingNo: Integer; EntryNo: Integer; EventType: Enum "BAS Event Type"; TableId: Integer; TableName: Text; CallStack: Text)
    var
        TempEvent: Record "BAS Recording Event" temporary;
        Recorder: Codeunit "BAS Recorder";
    begin
        TempEvent."Entry No." := EntryNo;
        TempEvent."Event Type" := EventType;
        TempEvent."Elapsed (ms)" := EntryNo * 100;
        TempEvent."Table ID" := TableId;
        TempEvent."Table Name" := CopyStr(TableName, 1, MaxStrLen(TempEvent."Table Name"));
        Recorder.PersistEvent(RecordingNo, TempEvent, CallStack, true);
    end;

    procedure Frame(ObjectName: Text; ObjectType: Text; ObjectId: Integer; Method: Text; LineNo: Integer): Text
    begin
        exit(StrSubstNo(FrameTxt, ObjectName, ObjectType, ObjectId, Method, LineNo));
    end;

    procedure Lf(): Text
    var
        TextHelper: Codeunit "BAS Text Helper";
    begin
        exit(TextHelper.Lf());
    end;

    procedure DocumentContent(SnapshotNo: Integer; DocType: Enum "BAS Doc Type"): Text
    var
        Document: Record "BAS Snapshot Document";
    begin
        Document.Get(SnapshotNo, DocType);
        exit(Document.GetContent());
    end;

    procedure FactCount(SnapshotNo: Integer; FactType: Enum "BAS Fact Type"): Integer
    var
        Fact: Record "BAS Snapshot Fact";
    begin
        Fact.SetRange("Snapshot No.", SnapshotNo);
        Fact.SetRange("Fact Type", FactType);
        exit(Fact.Count());
    end;

    procedure FindStep(SnapshotNo: Integer; FactType: Enum "BAS Fact Type"; Sequence: Integer; var Fact: Record "BAS Snapshot Fact")
    begin
        Fact.SetRange("Snapshot No.", SnapshotNo);
        Fact.SetRange("Fact Type", FactType);
        Fact.SetRange(Sequence, Sequence);
        Fact.FindFirst();
    end;

    procedure FindTable(SnapshotNo: Integer; TableId: Integer; var Fact: Record "BAS Snapshot Fact")
    begin
        Fact.SetRange("Snapshot No.", SnapshotNo);
        Fact.SetRange("Fact Type", Fact."Fact Type"::"Table Access");
        Fact.SetRange("Table ID", TableId);
        Fact.FindFirst();
    end;

    procedure ArmRecorder(Enabled: Boolean)
    var
        Setup: Record "BAS Setup";
        Recorder: Codeunit "BAS Recorder";
    begin
        Setup.InsertIfNotExists();
        Setup.Get();
        Setup."Recorder Enabled" := Enabled;
        Setup."Capture Call Stack" := true;
        Setup."Use Sampling Profiler" := false;
        Setup."Include System Tables" := false;
        Setup."Excluded Table Filter" := '';
        Setup."Max Events per Recording" := 0;
        Setup.Modify();
        Recorder.ResetSession();
    end;

    /// <summary>A small .alcpuprofile: (root) -> Sales-Post.OnRun -> Sales-Post.CheckAndUpdate.</summary>
    procedure SampleProfile(var TempBlob: Codeunit "Temp Blob")
    var
        OutStr: OutStream;
    begin
        TempBlob.CreateOutStream(OutStr, TextEncoding::UTF8);
        OutStr.WriteText('{"nodes":[' +
            '{"id":1,"callFrame":{"functionName":"(root)"},"hitCount":0,"children":[2]},' +
            '{"id":2,"callFrame":{"functionName":"OnRun","lineNumber":3},"hitCount":5,"children":[3],' +
            '"applicationDefinition":{"objectType":"CodeUnit","objectName":"Sales-Post","objectId":80},' +
            '"declaringApplication":{"appName":"Base Application","appPublisher":"Microsoft"}},' +
            '{"id":3,"callFrame":{"functionName":"CheckAndUpdate","lineNumber":87},"hitCount":7,"children":[],' +
            '"applicationDefinition":{"objectType":"CodeUnit","objectName":"Sales-Post","objectId":80},' +
            '"declaringApplication":{"appName":"Base Application","appPublisher":"Microsoft"}}],' +
            '"startTime":0,"endTime":100,"samples":[2,3],"timeDeltas":[0,1]}');
    end;
}
