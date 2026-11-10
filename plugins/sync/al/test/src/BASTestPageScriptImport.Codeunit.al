codeunit 50254 "BAS Test Page Script Import"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "BAS Test Assert";
        Library: Codeunit "BAS Test Library";

    trigger OnRun()
    begin
        // [FEATURE] [Atlas Sync] [Clicks] [UT]
    end;

    [Test]
    procedure ImportsEveryClickWithCaptionsValuesAndParts()
    var
        Recording: Record "BAS Recording";
        RecordingEvent: Record "BAS Recording Event";
        Importer: Codeunit "BAS Page Script Importer";
        DemoData: Codeunit "BAS Demo Data";
    begin
        // [SCENARIO] The demo Page Scripting recording becomes one UI step per click.
        Recording.Get(Library.CreateRecording('Import test'));
        Assert.AreEqual(7, Importer.ImportFromText(Recording, DemoData.DemoPageScript(), 'demo.yml'), 'steps imported');

        RecordingEvent.SetRange("Recording No.", Recording."No.");
        RecordingEvent.SetRange("Event Type", RecordingEvent."Event Type"::"UI Step");
        RecordingEvent.FindSet();
        Assert.AreEqual('navigate', RecordingEvent."Step Kind", 'step 1 kind');
        Assert.AreEqual('Sales Orders', RecordingEvent."Page Caption", 'step 1 page');
        RecordingEvent.Next();
        Assert.AreEqual('New', RecordingEvent."Control Caption", 'step 2 action');
        RecordingEvent.Next();
        Assert.AreEqual('Customer Name', RecordingEvent."Control Caption", 'step 3 field from caption tag');
        Assert.AreEqual('Adatum Corporation', RecordingEvent.Value, 'step 3 value');
        RecordingEvent.Next();
        Assert.AreEqual('Lines', RecordingEvent."Part Caption", 'step 4 part');
        Assert.AreEqual('Type', RecordingEvent."Control Caption", 'step 4 field');
        RecordingEvent.FindLast();
        Assert.AreEqual('Post...', RecordingEvent."Control Caption", 'last step action');
        Assert.AreEqual('Invoke Post... on Sales Order', RecordingEvent.Description, 'tags stripped from description');

        Recording.Get(Recording."No.");
        Assert.AreEqual('demo.yml', Recording."Page Script File Name", 'file name stored');
        Assert.Contains(Recording.GetPageScript(), 'steps:', 'raw YAML stored');
    end;

    [Test]
    procedure ReimportReplacesClicks()
    var
        Recording: Record "BAS Recording";
        Importer: Codeunit "BAS Page Script Importer";
        DemoData: Codeunit "BAS Demo Data";
    begin
        Recording.Get(Library.CreateRecording('Reimport test'));
        Importer.ImportFromText(Recording, DemoData.DemoPageScript(), 'a.yml');
        Importer.ImportFromText(Recording, DemoData.DemoPageScript(), 'b.yml');
        Recording.CalcFields("UI Step Count");
        Assert.AreEqual(7, Recording."UI Step Count", 'old clicks replaced, not appended');
    end;

    [Test]
    procedure FileWithoutStepsIsRejected()
    var
        Recording: Record "BAS Recording";
        Importer: Codeunit "BAS Page Script Importer";
    begin
        Recording.Get(Library.CreateRecording('Empty import'));
        asserterror Importer.ImportFromText(Recording, 'name: nothing' + Library.Lf() + 'steps:', 'empty.yml');
        Assert.ExpectedError('no Page Scripting steps');
    end;
}
