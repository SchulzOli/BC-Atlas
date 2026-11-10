/// <summary>
/// Recreates a complete documentation session without recording by hand: two versions of the
/// process "Post sales order" (Feature "Order to cash") built from realistic AL call stacks and a
/// Page Scripting recording, each turned into a snapshot with all documentation types.
///   Version 1 - standard Base Application posting.
///   Version 2 - the same clicks, but an extension ("Contoso Sales Audit") subscribes to
///               OnAfterPostSalesDoc and writes a log table: snapshot 2 shows drift against 1.
/// The call stacks pass through the real parser (including the recorder's own leading frames), so
/// the demo exercises exactly the code path of a live recording.
/// </summary>
codeunit 50170 "BAS Demo Data"
{
    Access = Public;

    var
        T: Codeunit "BAS Text Helper";
        RecordingNo: Integer;
        EntryNo: Integer;
        ElapsedMs: Integer;
        ProcessNameTxt: Label 'Demo: Post sales order', Locked = true;
        FeatureTxt: Label 'Order to cash', Locked = true;
        DescriptionTxt: Label 'Create a sales order for a customer, add an item line and post it (ship and invoice).', Locked = true;
        BaseAppTxt: Label 'Base Application by Microsoft version 26.5.38752.40541', Locked = true;
        RecorderAppTxt: Label 'BC Atlas Sync by OpenBridge version 1.0.0.0', Locked = true;
        ContosoAppTxt: Label 'Contoso Sales Extension by Contoso version 1.1.0.0', Locked = true;
        FrameTxt: Label '"%1"(%2 %3).%4 line %5 - %6', Locked = true;
        FrameUnquotedTxt: Label '%1(%2 %3).%4 line %5 - %6', Locked = true;
        DoneMsg: Label 'Demo data created: snapshot %1 (version 1) and snapshot %2 (version 2, with drift).', Comment = '%1 = snapshot 1, %2 = snapshot 2';

    /// <summary>Creates both versions, their snapshots and all documents. Returns the second snapshot number.</summary>
    procedure CreateDemo(ShowMessage: Boolean): Integer
    var
        SnapshotV1: Integer;
        SnapshotV2: Integer;
    begin
        SnapshotV1 := CreateVersion(1);
        SnapshotV2 := CreateVersion(2);
        if ShowMessage then
            Message(DoneMsg, SnapshotV1, SnapshotV2);
        exit(SnapshotV2);
    end;

    /// <summary>Creates one recorded version (1 or 2) and its snapshot with all documents. Returns the snapshot number.</summary>
    procedure CreateVersion(Version: Integer): Integer
    var
        Recording: Record "BAS Recording";
        Snapshot: Record "BAS Snapshot";
        Importer: Codeunit "BAS Page Script Importer";
        Builder: Codeunit "BAS Snapshot Builder";
        DocManager: Codeunit "BAS Doc Manager";
    begin
        Recording.Init();
        Recording."Process Name" := ProcessNameTxt;
        Recording.Feature := FeatureTxt;
        Recording.Description := DescriptionTxt;
        Recording."Started At" := CurrentDateTime() - 60000;
        Recording.Insert(true);
        RecordingNo := Recording."No.";
        EntryNo := 0;
        ElapsedMs := 0;

        RecordWrites(Version, Recording."Started At");
        Importer.ImportFromText(Recording, DemoPageScript(), 'demo-sales-order-post.yml');

        Recording.Get(RecordingNo);
        Recording.Status := Recording.Status::Stopped;
        Recording."Stopped At" := Recording."Started At" + ElapsedMs + 1500;
        Recording.Modify(true);

        Snapshot.Get(Builder.CreateSnapshot(Recording));
        DocManager.GenerateAll(Snapshot);
        exit(Snapshot."No.");
    end;

    /// <summary>The Page Scripting recording of the demo (also in demo/sales-order-post.yml).</summary>
    procedure DemoPageScript(): Text
    var
        Yaml: TextBuilder;
    begin
        T.AppendLine(Yaml, 'name: Post sales order');
        T.AppendLine(Yaml, 'description: Create a sales order for Adatum Corporation and post it');
        T.AppendLine(Yaml, 'start:');
        T.AppendLine(Yaml, '  profile: BUSINESS MANAGER');
        T.AppendLine(Yaml, 'steps:');
        AddStep(Yaml, 'navigate', 'Sales Orders', '', '', '', '', 'Navigate to <caption>Sales Orders</caption>');
        AddStep(Yaml, 'invoke', 'Sales Orders', '', 'action', 'New', '', 'Invoke <caption>New</caption> on <caption>Sales Orders</caption>');
        AddStep(Yaml, 'input', 'Sales Order', '', 'field', 'Customer Name', 'Adatum Corporation', 'Input <value>Adatum Corporation</value> into <caption>Customer Name</caption>');
        AddStep(Yaml, 'input', 'Sales Order', 'Lines', 'field', 'Type', 'Item', 'Input <value>Item</value> into <caption>Type</caption>');
        AddStep(Yaml, 'input', 'Sales Order', 'Lines', 'field', 'No.', '1896-S', 'Input <value>1896-S</value> into <caption>No.</caption>');
        AddStep(Yaml, 'input', 'Sales Order', 'Lines', 'field', 'Quantity', '1', 'Input <value>1</value> into <caption>Quantity</caption>');
        AddStep(Yaml, 'invoke', 'Sales Order', '', 'action', 'Post...', '', 'Invoke <caption>Post...</caption> on <caption>Sales Order</caption>');
        exit(Yaml.ToText());
    end;

    local procedure AddStep(var Yaml: TextBuilder; StepType: Text; PageCaption: Text; PartCaption: Text; ControlKind: Text; ControlCaption: Text; Value: Text; Description: Text)
    begin
        T.AppendLine(Yaml, '  - type: ' + StepType);
        T.AppendLine(Yaml, '    target:');
        T.AppendLine(Yaml, '      - page: ' + PageCaption);
        if PartCaption <> '' then
            T.AppendLine(Yaml, '      - part: ' + PartCaption);
        if ControlKind <> '' then
            T.AppendLine(Yaml, '      - ' + ControlKind + ': ' + T.YamlString(ControlCaption));
        if Value <> '' then
            T.AppendLine(Yaml, '    value: ' + T.YamlString(Value));
        T.AppendLine(Yaml, '    description: ' + T.YamlString(Description));
    end;

    // ---------------------------------------------------------------- recorded writes

    local procedure RecordWrites(Version: Integer; StartedAt: DateTime)
    var
        PageEntry: Text;
        LineEntry: Text;
    begin
        // Data entry: the client inserts the header, the customer is validated, the line is entered.
        Write(Enum::"BAS Event Type"::Insert, 36, 'Sales Header', 'Sales Header: Order,S-ORD101009', StartedAt, '');
        PageEntry := Frame('Sales Order', 'Page', 42, '"Sell-to Customer Name - OnValidate"(Trigger)', 2);
        Write(Enum::"BAS Event Type"::Modify, 36, 'Sales Header', 'Sales Header: Order,S-ORD101009', StartedAt,
            Frame('Sales Header', 'Table', 36, 'Modify', 0) + Lf() +
            Frame('Sales Header', 'Table', 36, '"Sell-to Customer No. - OnValidate"(Trigger)', 118) + Lf() +
            Frame('Sales Header', 'Table', 36, 'Validate', 1) + Lf() +
            PageEntry);
        Write(Enum::"BAS Event Type"::Insert, 37, 'Sales Line', 'Sales Line: Order,S-ORD101009,10000', StartedAt, '');
        LineEntry := Frame('Sales Order Subform', 'Page', 46, '"Type - OnValidate"(Trigger)', 3);
        Write(Enum::"BAS Event Type"::Modify, 37, 'Sales Line', 'Sales Line: Order,S-ORD101009,10000', StartedAt,
            Frame('Sales Line', 'Table', 37, '"Type - OnValidate"(Trigger)', 40) + Lf() + LineEntry);
        LineEntry := Frame('Sales Order Subform', 'Page', 46, '"No. - OnValidate"(Trigger)', 4);
        Write(Enum::"BAS Event Type"::Modify, 37, 'Sales Line', 'Sales Line: Order,S-ORD101009,10000', StartedAt,
            Frame('Sales Line', 'Table', 37, 'UpdateUnitPrice', 22) + Lf() +
            Frame('Sales Line', 'Table', 37, '"No. - OnValidate"(Trigger)', 95) + Lf() + LineEntry);
        LineEntry := Frame('Sales Order Subform', 'Page', 46, '"Quantity - OnValidate"(Trigger)', 6);
        Write(Enum::"BAS Event Type"::Modify, 37, 'Sales Line', 'Sales Line: Order,S-ORD101009,10000', StartedAt,
            Frame('Sales Line', 'Table', 37, 'UpdateAmounts', 51) + Lf() +
            Frame('Sales Line', 'Table', 37, '"Quantity - OnValidate"(Trigger)', 73) + Lf() + LineEntry);

        // Posting: Post... on the Sales Order page runs Sales-Post (Yes/No) and Sales-Post.
        ElapsedMs += 4000;
        Write(Enum::"BAS Event Type"::Modify, 309, 'No. Series Line', 'No. Series Line: S-SHPT,10000', StartedAt,
            Frame('No. Series', 'Codeunit', 310, 'GetNextNo', 12) + Lf() + Frame('Sales-Post', 'Codeunit', 80, 'UpdatePostingNos', 30) + Lf() + PostTail());
        Write(Enum::"BAS Event Type"::Insert, 110, 'Sales Shipment Header', 'Sales Shipment Header: 102045', StartedAt,
            Frame('Sales-Post', 'Codeunit', 80, 'InsertShipmentHeader', 25) + Lf() + PostTail());
        Write(Enum::"BAS Event Type"::Insert, 111, 'Sales Shipment Line', 'Sales Shipment Line: 102045,10000', StartedAt,
            Frame('Sales-Post', 'Codeunit', 80, 'InsertShipmentLine', 31) + Lf() + PostTail());
        Write(Enum::"BAS Event Type"::Insert, 32, 'Item Ledger Entry', 'Item Ledger Entry: 621', StartedAt,
            Frame('Item Jnl.-Post Line', 'Codeunit', 22, 'InsertItemLedgEntry', 48) + Lf() +
            Frame('Item Jnl.-Post Line', 'Codeunit', 22, 'PostItem', 90) + Lf() +
            Frame('Sales-Post', 'Codeunit', 80, 'PostItemJnlLine', 66) + Lf() + PostTail());
        Write(Enum::"BAS Event Type"::Insert, 5802, 'Value Entry', 'Value Entry: 1288', StartedAt,
            Frame('Item Jnl.-Post Line', 'Codeunit', 22, 'InsertValueEntry', 35) + Lf() +
            Frame('Item Jnl.-Post Line', 'Codeunit', 22, 'PostItem', 112) + Lf() +
            Frame('Sales-Post', 'Codeunit', 80, 'PostItemJnlLine', 66) + Lf() + PostTail());
        Write(Enum::"BAS Event Type"::Insert, 112, 'Sales Invoice Header', 'Sales Invoice Header: 103033', StartedAt,
            Frame('Sales-Post', 'Codeunit', 80, 'InsertInvoiceHeader', 27) + Lf() + PostTail());
        Write(Enum::"BAS Event Type"::Insert, 113, 'Sales Invoice Line', 'Sales Invoice Line: 103033,10000', StartedAt,
            Frame('Sales-Post', 'Codeunit', 80, 'InsertInvoiceLine', 33) + Lf() + PostTail());
        Write(Enum::"BAS Event Type"::Insert, 45, 'G/L Register', 'G/L Register: 412', StartedAt,
            Frame('Gen. Jnl.-Post Line', 'Codeunit', 12, 'InsertRegister', 18) + Lf() + GLPostTail());
        Write(Enum::"BAS Event Type"::Insert, 17, 'G/L Entry', 'G/L Entry: 2851', StartedAt,
            Frame('Gen. Jnl.-Post Line', 'Codeunit', 12, 'InsertGLEntry', 60) + Lf() + Frame('Gen. Jnl.-Post Line', 'Codeunit', 12, 'PostGLAcc', 22) + Lf() + GLPostTail());
        Write(Enum::"BAS Event Type"::Insert, 17, 'G/L Entry', 'G/L Entry: 2852', StartedAt,
            Frame('Gen. Jnl.-Post Line', 'Codeunit', 12, 'InsertGLEntry', 60) + Lf() + Frame('Gen. Jnl.-Post Line', 'Codeunit', 12, 'PostGLAcc', 22) + Lf() + GLPostTail());
        Write(Enum::"BAS Event Type"::Insert, 17, 'G/L Entry', 'G/L Entry: 2853', StartedAt,
            Frame('Gen. Jnl.-Post Line', 'Codeunit', 12, 'InsertGLEntry', 60) + Lf() + Frame('Gen. Jnl.-Post Line', 'Codeunit', 12, 'PostCust', 41) + Lf() + GLPostTail());
        Write(Enum::"BAS Event Type"::Insert, 21, 'Cust. Ledger Entry', 'Cust. Ledger Entry: 1907', StartedAt,
            Frame('Gen. Jnl.-Post Line', 'Codeunit', 12, 'PostCust', 55) + Lf() + GLPostTail());
        if Version >= 2 then
            // Version 2: an extension subscribes to the posting and writes an audit log.
            Write(Enum::"BAS Event Type"::Insert, 50200, 'Contoso Posting Log', 'Contoso Posting Log: 1', StartedAt,
                FrameIn('Contoso Sales Audit', 'Codeunit', 50201, 'OnAfterPostSalesDoc', 5, ContosoAppTxt) + Lf() +
                Frame('Sales-Post', 'Codeunit', 80, 'OnAfterPostSalesDoc', 2) + Lf() +
                Frame('Sales-Post', 'Codeunit', 80, 'RunWithCheck', 160) + Lf() + PostTail());
        Write(Enum::"BAS Event Type"::Delete, 37, 'Sales Line', 'Sales Line: Order,S-ORD101009,10000', StartedAt,
            Frame('Sales-Post', 'Codeunit', 80, 'DeleteAfterPosting', 14) + Lf() + PostTail());
        Write(Enum::"BAS Event Type"::Delete, 36, 'Sales Header', 'Sales Header: Order,S-ORD101009', StartedAt,
            Frame('Sales-Post', 'Codeunit', 80, 'DeleteAfterPosting', 20) + Lf() + PostTail());
    end;

    local procedure Write(EventType: Enum "BAS Event Type"; TableId: Integer; TableName: Text; RecordIdText: Text; StartedAt: DateTime; InnerFrames: Text)
    var
        TempEvent: Record "BAS Recording Event" temporary;
        Recorder: Codeunit "BAS Recorder";
        CallStack: Text;
    begin
        EntryNo += 1;
        ElapsedMs += 350;
        TempEvent."Entry No." := EntryNo;
        TempEvent."Event Type" := EventType;
        TempEvent."Elapsed (ms)" := ElapsedMs;
        TempEvent."Occurred At" := StartedAt + ElapsedMs;
        TempEvent."Table ID" := TableId;
        TempEvent."Table Name" := CopyStr(TableName, 1, MaxStrLen(TempEvent."Table Name"));
        TempEvent."Record ID" := CopyStr(RecordIdText, 1, MaxStrLen(TempEvent."Record ID"));
        // Every real stack starts with the recorder's own frames; the parser must skip them.
        CallStack := RecorderFrames();
        if InnerFrames <> '' then
            CallStack += Lf() + InnerFrames;
        Recorder.PersistEvent(RecordingNo, TempEvent, CallStack, true);
    end;

    local procedure RecorderFrames(): Text
    begin
        exit(
            FrameIn('BAS Recorder', 'CodeUnit', 50150, 'LogDatabaseWrite', 16, RecorderAppTxt) + Lf() +
            FrameIn('BAS Recorder Subscribers', 'CodeUnit', 50151, 'OnAfterOnDatabaseInsert', 6, RecorderAppTxt) + Lf() +
            StrSubstNo(FrameUnquotedTxt, 'GlobalTriggerManagement', 'CodeUnit', 49, 'OnAfterOnDatabaseInsert', 2, BaseAppTxt) + Lf() +
            StrSubstNo(FrameUnquotedTxt, 'GlobalTriggerManagement', 'CodeUnit', 49, 'OnDatabaseInsert', 3, BaseAppTxt));
    end;

    local procedure PostTail(): Text
    begin
        exit(
            Frame('Sales-Post', 'Codeunit', 80, 'RunWithCheck', 120) + Lf() +
            Frame('Sales-Post', 'Codeunit', 80, 'OnRun(Trigger)', 3) + Lf() +
            Frame('Sales-Post (Yes/No)', 'Codeunit', 81, 'Code', 20) + Lf() +
            Frame('Sales-Post (Yes/No)', 'Codeunit', 81, 'OnRun(Trigger)', 4) + Lf() +
            Frame('Sales Order', 'Page', 42, 'PostDocument', 12) + Lf() +
            Frame('Sales Order', 'Page', 42, '"Post - OnAction"(Trigger)', 2));
    end;

    local procedure GLPostTail(): Text
    begin
        exit(
            Frame('Gen. Jnl.-Post Line', 'Codeunit', 12, 'RunWithCheck', 10) + Lf() +
            Frame('Sales Post Invoice', 'Codeunit', 815, 'PostLedgerEntry', 30) + Lf() +
            Frame('Sales-Post', 'Codeunit', 80, 'PostInvoice', 45) + Lf() + PostTail());
    end;

    local procedure Frame(ObjectName: Text; ObjectType: Text; ObjectId: Integer; Method: Text; LineNo: Integer): Text
    begin
        exit(FrameIn(ObjectName, ObjectType, ObjectId, Method, LineNo, BaseAppTxt));
    end;

    local procedure FrameIn(ObjectName: Text; ObjectType: Text; ObjectId: Integer; Method: Text; LineNo: Integer; AppText: Text): Text
    begin
        exit(StrSubstNo(FrameTxt, ObjectName, ObjectType, ObjectId, Method, LineNo, AppText));
    end;

    local procedure Lf(): Text
    begin
        exit(T.Lf());
    end;
}
