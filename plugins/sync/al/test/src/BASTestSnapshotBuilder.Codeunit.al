codeunit 50257 "BAS Test Snapshot Builder"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "BAS Test Assert";
        Library: Codeunit "BAS Test Library";
        DemoData: Codeunit "BAS Demo Data";

    trigger OnRun()
    begin
        // [FEATURE] [Atlas Sync] [Snapshot] [UT]
    end;

    [Test]
    procedure GroupsWritesIntoTechnicalStepsByTrigger()
    var
        Snapshot: Record "BAS Snapshot";
        Fact: Record "BAS Snapshot Fact";
    begin
        // [SCENARIO] Consecutive writes of the same trigger are one technical step.
        Snapshot.Get(DemoData.CreateVersion(1));
        Snapshot.CalcFields("UI Steps", "Technical Steps", Tables);
        Assert.AreEqual(7, Snapshot."UI Steps", 'clicks');
        Assert.AreEqual(7, Snapshot."Technical Steps", '2 autosaves, 4 validations, 1 action');
        Assert.AreEqual(21, Snapshot."Write Events", 'writes');
        Assert.AreEqual(12, Snapshot.Tables, 'tables written');

        Library.FindStep(Snapshot."No.", Enum::"BAS Fact Type"::"Technical Step", 1, Fact);
        Assert.AreEqual('Page Autosave', Fact."Step Kind", 'step 1 is the client inserting the header');
        Library.FindStep(Snapshot."No.", Enum::"BAS Fact Type"::"Technical Step", 7, Fact);
        Assert.AreEqual('Action', Fact."Step Kind", 'step 7 kind');
        Assert.AreEqual('Post', Fact.Subject, 'exact AL action name from the call stack');
        Assert.AreEqual(15, Fact."Hit Count", 'posting writes');
        Assert.Contains(Fact."Call Path", 'Codeunit 80 "Sales-Post"', 'call path reaches Sales-Post');
        Assert.Contains(Fact."Data Summary", 'G/L Entry: 3x insert', 'data footprint');
    end;

    [Test]
    procedure LinksEachClickToTheStepItTriggered()
    var
        Snapshot: Record "BAS Snapshot";
        UiFact: Record "BAS Snapshot Fact";
        TechFact: Record "BAS Snapshot Fact";
    begin
        Snapshot.Get(DemoData.CreateVersion(1));
        Library.FindStep(Snapshot."No.", Enum::"BAS Fact Type"::"UI Step", 2, UiFact);
        Assert.AreEqual(0, UiFact."Linked Line No.", 'New runs no AL code');

        Library.FindStep(Snapshot."No.", Enum::"BAS Fact Type"::"UI Step", 3, UiFact);
        TechFact.Get(Snapshot."No.", UiFact."Linked Line No.");
        Assert.AreEqual('Sell-to Customer Name', TechFact.Subject, 'caption Customer Name -> control Sell-to Customer Name');

        Library.FindStep(Snapshot."No.", Enum::"BAS Fact Type"::"UI Step", 5, UiFact);
        TechFact.Get(Snapshot."No.", UiFact."Linked Line No.");
        Assert.AreEqual('Sales Order Subform', TechFact."Object Name", 'line field validated on the subform page');

        Library.FindStep(Snapshot."No.", Enum::"BAS Fact Type"::"UI Step", 7, UiFact);
        TechFact.Get(Snapshot."No.", UiFact."Linked Line No.");
        Assert.AreEqual(7, TechFact.Sequence, 'Post... -> posting step');
        Assert.AreEqual(UiFact."Line No.", TechFact."Linked Line No.", 'link is two-way');
    end;

    [Test]
    procedure GroupsStepsIntoBusinessPhases()
    var
        Snapshot: Record "BAS Snapshot";
        Fact: Record "BAS Snapshot Fact";
    begin
        // [SCENARIO] Data entry is one phase, the action that posts is the next.
        Snapshot.Get(DemoData.CreateVersion(1));
        Assert.AreEqual(2, Library.FactCount(Snapshot."No.", Enum::"BAS Fact Type"::Phase), 'phases');
        Library.FindStep(Snapshot."No.", Enum::"BAS Fact Type"::Phase, 1, Fact);
        Assert.AreEqual('Enter the data on the Sales Order page', Fact.Description, 'phase 1 title');
        Assert.AreEqual(6, Fact."Hit Count", 'phase 1 writes');
        Library.FindStep(Snapshot."No.", Enum::"BAS Fact Type"::Phase, 2, Fact);
        Assert.AreEqual('On the Sales Order page, choose Post', Fact.Description, 'phase 2 title from the click');
        Assert.AreEqual(15, Fact."Hit Count", 'phase 2 writes');

        Library.FindStep(Snapshot."No.", Enum::"BAS Fact Type"::"UI Step", 1, Fact);
        Assert.AreEqual(1, Fact."Phase No.", 'navigation belongs to phase 1');
        Library.FindStep(Snapshot."No.", Enum::"BAS Fact Type"::"Technical Step", 1, Fact);
        Assert.AreEqual(1, Fact."Phase No.", 'autosave joins the next phase');
        Library.FindStep(Snapshot."No.", Enum::"BAS Fact Type"::"UI Step", 7, Fact);
        Assert.AreEqual(2, Fact."Phase No.", 'Post... click is phase 2');
    end;

    [Test]
    procedure MarkersDefinePhasesWhenPresent()
    var
        Recording: Record "BAS Recording";
        Snapshot: Record "BAS Snapshot";
        Fact: Record "BAS Snapshot Fact";
        TempEvent: Record "BAS Recording Event" temporary;
        Builder: Codeunit "BAS Snapshot Builder";
        Recorder: Codeunit "BAS Recorder";
        RecordingNo: Integer;
    begin
        RecordingNo := Library.CreateRecording('Marker phases');
        TempEvent."Entry No." := 1;
        TempEvent."Event Type" := TempEvent."Event Type"::Marker;
        TempEvent.Description := 'Prepare';
        Recorder.PersistEvent(RecordingNo, TempEvent, '', true);
        Library.AddWrite(RecordingNo, 2, Enum::"BAS Event Type"::Insert, 18, 'Customer', Library.Frame('Customer Card', 'Page', 21, '"Name - OnValidate"(Trigger)', 1));
        TempEvent."Entry No." := 3;
        TempEvent.Description := 'Finish';
        Recorder.PersistEvent(RecordingNo, TempEvent, '', true);
        Library.AddWrite(RecordingNo, 4, Enum::"BAS Event Type"::Modify, 18, 'Customer', Library.Frame('Customer Card', 'Page', 21, '"Blocked - OnValidate"(Trigger)', 1));
        Library.StopRecording(RecordingNo);

        Recording.Get(RecordingNo);
        Snapshot.Get(Builder.CreateSnapshot(Recording));
        Assert.AreEqual(2, Library.FactCount(Snapshot."No.", Enum::"BAS Fact Type"::Phase), 'one phase per marker');
        Library.FindStep(Snapshot."No.", Enum::"BAS Fact Type"::Phase, 2, Fact);
        Assert.AreEqual('Finish', Fact.Description, 'phase named by the marker');
        Assert.AreEqual(1, Fact."Hit Count", 'write after the marker');
    end;

    [Test]
    procedure SameProcessGivesSameFingerprintAndNoDrift()
    var
        First: Record "BAS Snapshot";
        Second: Record "BAS Snapshot";
    begin
        // [SCENARIO] Re-recording an unchanged process reproduces the fingerprint.
        First.Get(DemoData.CreateVersion(1));
        Second.Get(DemoData.CreateVersion(1));
        Assert.AreEqual(64, StrLen(First.Fingerprint), 'SHA-256 hex');
        Assert.AreEqual(First.Fingerprint, Second.Fingerprint, 'same fingerprint');
        Assert.AreEqual(First."No.", Second."Previous Snapshot No.", 'compared with the previous snapshot');
        Assert.IsFalse(Second."Drift Detected", 'no drift');
    end;

    [Test]
    procedure ExtensionSubscriberIsReportedAsDrift()
    var
        First: Record "BAS Snapshot";
        Second: Record "BAS Snapshot";
        Fact: Record "BAS Snapshot Fact";
    begin
        // [SCENARIO] Version 2 adds an extension subscriber and a log table: snapshot 2 shows exactly that.
        First.Get(DemoData.CreateVersion(1));
        Second.Get(DemoData.CreateVersion(2));
        Assert.IsTrue(Second."Drift Detected", 'drift detected');
        Assert.AreNotEqualText(First.Fingerprint, Second.Fingerprint);

        Fact.SetRange("Snapshot No.", Second."No.");
        Fact.SetRange("Fact Type", Fact."Fact Type"::"Drift Added");
        Assert.AreEqual(3, Fact.Count(), 'two new methods and one new table');
        Fact.SetRange("Object ID", 50201);
        Assert.AreEqual(1, Fact.Count(), 'Contoso Sales Audit subscriber');
        Fact.SetRange("Object ID");
        Fact.SetRange("Fact Type", Fact."Fact Type"::"Drift Removed");
        Assert.AreEqual(0, Fact.Count(), 'nothing removed');
    end;

    [Test]
    procedure FingerprintIgnoresRecordCounts()
    var
        RecordingA: Record "BAS Recording";
        RecordingB: Record "BAS Recording";
        SnapshotA: Record "BAS Snapshot";
        SnapshotB: Record "BAS Snapshot";
        Builder: Codeunit "BAS Snapshot Builder";
        Stack: Text;
    begin
        // [SCENARIO] Posting 3 or 5 lines runs the same code: only kinds of writes count, not numbers.
        Stack := Library.Frame('Gen. Jnl.-Post Line', 'Codeunit', 12, 'InsertGLEntry', 60) + Library.Lf() + Library.Frame('Sales Order', 'Page', 42, '"Post - OnAction"(Trigger)', 2);
        RecordingA.Get(Library.CreateRecording('Count independence'));
        Library.AddWrite(RecordingA."No.", 1, Enum::"BAS Event Type"::Insert, 17, 'G/L Entry', Stack);
        Library.StopRecording(RecordingA."No.");
        RecordingB.Get(Library.CreateRecording('Count independence'));
        Library.AddWrite(RecordingB."No.", 1, Enum::"BAS Event Type"::Insert, 17, 'G/L Entry', Stack);
        Library.AddWrite(RecordingB."No.", 2, Enum::"BAS Event Type"::Insert, 17, 'G/L Entry', Stack);
        Library.AddWrite(RecordingB."No.", 3, Enum::"BAS Event Type"::Insert, 17, 'G/L Entry', Stack);
        Library.StopRecording(RecordingB."No.");

        SnapshotA.Get(Builder.CreateSnapshot(RecordingA));
        Clear(Builder);
        SnapshotB.Get(Builder.CreateSnapshot(RecordingB));
        Assert.AreEqual(SnapshotA.Fingerprint, SnapshotB.Fingerprint, 'same fingerprint for 1 and 3 inserts');
        Assert.IsFalse(SnapshotB."Drift Detected", 'no drift');
    end;

    [Test]
    procedure RecordingStillRunningCannotBeSnapshotted()
    var
        Recording: Record "BAS Recording";
        Builder: Codeunit "BAS Snapshot Builder";
    begin
        Recording.Get(Library.CreateRecording('Running'));
        Recording.Status := Recording.Status::Recording;
        Recording.Modify();
        asserterror Builder.CreateSnapshot(Recording);
        Assert.ExpectedError('before creating a snapshot');
    end;
}
