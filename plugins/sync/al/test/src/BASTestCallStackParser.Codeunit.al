codeunit 50253 "BAS Test Call Stack Parser"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "BAS Test Assert";
        Library: Codeunit "BAS Test Library";
        Parser: Codeunit "BAS Call Stack Parser";

    trigger OnRun()
    begin
        // [FEATURE] [Atlas Sync] [Call stack parser] [UT]
    end;

    [Test]
    procedure ParsesQuotedTriggerLine()
    var
        ObjType: Text;
        ObjName: Text;
        Method: Text;
        AppName: Text;
        AppPublisher: Text;
        ObjId: Integer;
        LineNo: Integer;
    begin
        // [SCENARIO] A page action trigger line yields object, method, line and app.
        Assert.IsTrue(Parser.ParseFrameLine('"Sales Order"(Page 42)."Post - OnAction"(Trigger) line 2 - Base Application by Microsoft version 26.5.1.2',
            ObjType, ObjId, ObjName, Method, LineNo, AppName, AppPublisher), 'parsed');
        Assert.AreEqual('Page', ObjType, 'type');
        Assert.AreEqual(42, ObjId, 'id');
        Assert.AreEqual('Sales Order', ObjName, 'name');
        Assert.AreEqual('Post - OnAction', Method, 'method without quotes and (Trigger)');
        Assert.AreEqual(2, LineNo, 'line');
        Assert.AreEqual('Base Application', AppName, 'app');
        Assert.AreEqual('Microsoft', AppPublisher, 'publisher without version');
    end;

    [Test]
    procedure ParsesNamesWithParenthesesAndUnquotedNames()
    var
        ObjType: Text;
        ObjName: Text;
        Method: Text;
        AppName: Text;
        AppPublisher: Text;
        ObjId: Integer;
        LineNo: Integer;
    begin
        Assert.IsTrue(Parser.ParseFrameLine('"Sales-Post (Yes/No)"(CodeUnit 81).Code line 20 - Base Application by Microsoft',
            ObjType, ObjId, ObjName, Method, LineNo, AppName, AppPublisher), 'quoted with parentheses');
        Assert.AreEqual('Sales-Post (Yes/No)', ObjName, 'name keeps parentheses');
        Assert.AreEqual('Codeunit', ObjType, 'CodeUnit is normalized');
        Assert.IsTrue(Parser.ParseFrameLine('GlobalTriggerManagement(CodeUnit 49).OnDatabaseInsert line 3 - Base Application by Microsoft',
            ObjType, ObjId, ObjName, Method, LineNo, AppName, AppPublisher), 'unquoted');
        Assert.AreEqual(49, ObjId, 'unquoted id');
        Assert.IsTrue(Parser.ParseFrameLine('"My Ext"(PageExtension 50100)."Foo - OnAction"(Trigger) line 1 - My App by Me',
            ObjType, ObjId, ObjName, Method, LineNo, AppName, AppPublisher), 'extension');
        Assert.AreEqual('PageExtension', ObjType, 'extension type');
        Assert.IsFalse(Parser.ParseFrameLine('AL call stack:', ObjType, ObjId, ObjName, Method, LineNo, AppName, AppPublisher), 'header line is ignored');
    end;

    [Test]
    procedure SkipsRecorderFramesAndNumbersFromInnermost()
    var
        TempFrame: Record "BAS Call Frame" temporary;
    begin
        // [SCENARIO] The recorder's own frames at the top of the stack are not part of the process.
        Parser.ParseCallStack(RecorderFrames() + Library.Lf() + PostStack(), TempFrame);
        Assert.AreEqual(4, TempFrame.Count(), 'recorder and global trigger frames skipped');
        TempFrame.FindFirst();
        Assert.AreEqual('Gen. Jnl.-Post Line', TempFrame."Object Name", 'frame 1 is the innermost (writer)');
        Assert.AreEqual(3, TempFrame.Depth, 'innermost depth');
        TempFrame.FindLast();
        Assert.AreEqual('Post - OnAction', TempFrame."Method Name", 'last frame is the outermost (origin)');
        Assert.AreEqual(0, TempFrame.Depth, 'outermost depth');
    end;

    [Test]
    procedure AcceptsBackslashSeparatedStacks()
    var
        TempFrame: Record "BAS Call Frame" temporary;
    begin
        Parser.ParseCallStack(PostStack().Replace(Library.Lf(), '\'), TempFrame);
        Assert.AreEqual(4, TempFrame.Count(), 'backslash separated');
    end;

    [Test]
    procedure AnnotatesOriginAndWriter()
    var
        TempFrame: Record "BAS Call Frame" temporary;
        RecordingEvent: Record "BAS Recording Event";
    begin
        Parser.ParseCallStack(RecorderFrames() + Library.Lf() + PostStack(), TempFrame);
        RecordingEvent."Event Type" := RecordingEvent."Event Type"::Insert;
        Parser.AnnotateEvent(RecordingEvent, TempFrame, true);
        Assert.AreEqual('Action', RecordingEvent."Origin Kind", 'origin kind');
        Assert.AreEqual(42, RecordingEvent."Origin Object ID", 'origin page');
        Assert.AreEqual(12, RecordingEvent."Leaf Object ID", 'writer codeunit');
        Assert.AreEqual('InsertGLEntry', RecordingEvent."Leaf Method", 'writer method');
        Assert.AreEqual(4, RecordingEvent."Stack Depth", 'depth');
    end;

    [Test]
    procedure WriteWithoutAlCodeIsPageAutosave()
    var
        TempFrame: Record "BAS Call Frame" temporary;
        RecordingEvent: Record "BAS Recording Event";
    begin
        // [SCENARIO] Only recorder frames on the stack: the web client wrote the record itself.
        Parser.ParseCallStack(RecorderFrames(), TempFrame);
        RecordingEvent."Event Type" := RecordingEvent."Event Type"::Insert;
        RecordingEvent."Table Name" := 'Sales Header';
        Parser.AnnotateEvent(RecordingEvent, TempFrame, true);
        Assert.AreEqual('Page Autosave', RecordingEvent."Origin Kind", 'autosave');
        Clear(RecordingEvent);
        RecordingEvent."Event Type" := RecordingEvent."Event Type"::Insert;
        Parser.AnnotateEvent(RecordingEvent, TempFrame, false);
        Assert.AreEqual('Not Captured', RecordingEvent."Origin Kind", 'capture switched off');
    end;

    [Test]
    procedure ClassifiesTriggersAndSubjects()
    begin
        Assert.AreEqual('Action', Parser.ClassifyTrigger('Page', 'Post - OnAction'), 'action');
        Assert.AreEqual('Field Validation', Parser.ClassifyTrigger('Table', 'No. - OnValidate'), 'validation');
        Assert.AreEqual('Lookup', Parser.ClassifyTrigger('Page', 'No. - OnLookup'), 'lookup');
        Assert.AreEqual('Page Trigger', Parser.ClassifyTrigger('Page', 'OnOpenPage'), 'page trigger');
        Assert.AreEqual('Codeunit Run', Parser.ClassifyTrigger('Codeunit', 'OnRun'), 'codeunit run');
        Assert.AreEqual('Code', Parser.ClassifyTrigger('Codeunit', 'Post'), 'code');
        Assert.AreEqual('Sell-to Customer Name', Parser.TriggerSubject('Sell-to Customer Name - OnValidate'), 'subject');
    end;

    local procedure RecorderFrames(): Text
    begin
        exit('"BAS Recorder"(CodeUnit 50150).LogDatabaseWrite line 16 - BC Atlas Sync by OpenBridge' + Library.Lf() +
             '"BAS Recorder Subscribers"(CodeUnit 50151).OnAfterOnDatabaseInsert line 6 - BC Atlas Sync by OpenBridge' + Library.Lf() +
             'GlobalTriggerManagement(CodeUnit 49).OnAfterOnDatabaseInsert line 2 - Base Application by Microsoft');
    end;

    local procedure PostStack(): Text
    begin
        exit(Library.Frame('Gen. Jnl.-Post Line', 'CodeUnit', 12, 'InsertGLEntry', 60) + Library.Lf() +
             Library.Frame('Sales-Post', 'CodeUnit', 80, 'PostInvoice', 45) + Library.Lf() +
             Library.Frame('Sales Order', 'Page', 42, 'PostDocument', 12) + Library.Lf() +
             Library.Frame('Sales Order', 'Page', 42, '"Post - OnAction"(Trigger)', 2));
    end;
}
