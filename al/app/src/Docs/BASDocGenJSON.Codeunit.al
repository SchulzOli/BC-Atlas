/// <summary>Machine-readable fact sheet: the complete snapshot as JSON (schema bc-atlas-sync.fact-snapshot/1).</summary>
codeunit 50157 "BAS Doc Gen JSON" implements "BAS IDoc Generator"
{
    Access = Public;

    procedure FileExtension(): Text
    begin
        exit('json');
    end;

    procedure Generate(Snapshot: Record "BAS Snapshot"; var Content: TextBuilder)
    var
        Root: JsonObject;
        Drift: JsonObject;
        Json: Text;
    begin
        Root.Add('schema', 'bc-atlas-sync.fact-snapshot/1');
        Root.Add('snapshot', SnapshotHeader(Snapshot));
        Root.Add('phases', Phases(Snapshot."No."));
        Root.Add('uiSteps', UiSteps(Snapshot."No."));
        Root.Add('technicalSteps', TechnicalSteps(Snapshot));
        Root.Add('objects', Inventory(Snapshot."No.", Enum::"BAS Fact Type"::Object));
        Root.Add('methods', Inventory(Snapshot."No.", Enum::"BAS Fact Type"::Method));
        Root.Add('tables', Tables(Snapshot."No."));
        Drift.Add('previousSnapshotNo', Snapshot."Previous Snapshot No.");
        Drift.Add('detected', Snapshot."Drift Detected");
        Drift.Add('added', Inventory(Snapshot."No.", Enum::"BAS Fact Type"::"Drift Added"));
        Drift.Add('removed', Inventory(Snapshot."No.", Enum::"BAS Fact Type"::"Drift Removed"));
        Root.Add('drift', Drift);
        Root.WriteTo(Json);
        Content.Append(Json);
    end;

    local procedure SnapshotHeader(Snapshot: Record "BAS Snapshot"): JsonObject
    var
        Header: JsonObject;
    begin
        Header.Add('no', Snapshot."No.");
        Header.Add('processName', Snapshot."Process Name");
        Header.Add('feature', Snapshot.Feature);
        Header.Add('description', Snapshot.Description);
        Header.Add('recordingNo', Snapshot."Recording No.");
        Header.Add('recordedAt', Snapshot."Recorded At");
        Header.Add('recordedBy', Snapshot."Recorded By");
        Header.Add('createdAt', Snapshot."Created At");
        Header.Add('durationMs', Snapshot."Duration (ms)");
        Header.Add('company', Snapshot."Company Name");
        Header.Add('applicationVersion', Snapshot."Platform Version");
        Header.Add('fingerprint', Snapshot.Fingerprint);
        Header.Add('writeEvents', Snapshot."Write Events");
        exit(Header);
    end;

    local procedure Phases(SnapshotNo: Integer): JsonArray
    var
        Fact: Record "BAS Snapshot Fact";
        DocManager: Codeunit "BAS Doc Manager";
        Items: JsonArray;
        Item: JsonObject;
    begin
        if DocManager.FindFacts(Fact, SnapshotNo, Enum::"BAS Fact Type"::Phase) then
            repeat
                Clear(Item);
                Item.Add('phase', Fact.Sequence);
                Item.Add('title', Fact.Description);
                Item.Add('result', Fact."Data Summary");
                Item.Add('writes', Fact."Hit Count");
                Item.Add('firstSeenMs', Fact."First Seen (ms)");
                Items.Add(Item);
            until Fact.Next() = 0;
        exit(Items);
    end;

    local procedure UiSteps(SnapshotNo: Integer): JsonArray
    var
        Fact: Record "BAS Snapshot Fact";
        DocManager: Codeunit "BAS Doc Manager";
        Steps: JsonArray;
        Step: JsonObject;
    begin
        if DocManager.FindFacts(Fact, SnapshotNo, Enum::"BAS Fact Type"::"UI Step") then
            repeat
                Clear(Step);
                Step.Add('step', Fact.Sequence);
                Step.Add('kind', Fact."Step Kind");
                Step.Add('page', Fact."Page Caption");
                Step.Add('phase', Fact."Phase No.");
                Step.Add('part', Fact."Part Caption");
                Step.Add('control', Fact.Subject);
                Step.Add('value', Fact.Value);
                Step.Add('description', Fact.Description);
                Step.Add('technicalStep', DocManager.LinkedSequence(Fact));
                Steps.Add(Step);
            until Fact.Next() = 0;
        exit(Steps);
    end;

    local procedure TechnicalSteps(Snapshot: Record "BAS Snapshot"): JsonArray
    var
        Fact: Record "BAS Snapshot Fact";
        DocManager: Codeunit "BAS Doc Manager";
        Steps: JsonArray;
        Step: JsonObject;
    begin
        if DocManager.FindFacts(Fact, Snapshot."No.", Enum::"BAS Fact Type"::"Technical Step") then
            repeat
                Clear(Step);
                Step.Add('step', Fact.Sequence);
                Step.Add('kind', Fact."Step Kind");
                Step.Add('objectType', Fact."Object Type");
                Step.Add('objectId', Fact."Object ID");
                Step.Add('objectName', Fact."Object Name");
                Step.Add('method', Fact."Method Name");
                Step.Add('phase', Fact."Phase No.");
                Step.Add('subject', Fact.Subject);
                Step.Add('description', Fact.Description);
                Step.Add('firstSeenMs', Fact."First Seen (ms)");
                Step.Add('writes', Fact."Hit Count");
                Step.Add('dataFootprint', Fact."Data Summary");
                Step.Add('callPath', Fact."Call Path");
                Step.Add('uiStep', DocManager.LinkedSequence(Fact));
                Step.Add('callStack', CallStack(Snapshot."Recording No.", Fact."Deepest Event Entry No."));
                Steps.Add(Step);
            until Fact.Next() = 0;
        exit(Steps);
    end;

    local procedure CallStack(RecordingNo: Integer; EventEntryNo: Integer): JsonArray
    var
        CallFrame: Record "BAS Call Frame";
        Frames: JsonArray;
        Frame: JsonObject;
    begin
        CallFrame.SetRange("Recording No.", RecordingNo);
        CallFrame.SetRange(Source, CallFrame.Source::"Call Stack");
        CallFrame.SetRange("Event Entry No.", EventEntryNo);
        if CallFrame.Find('+') then
            repeat
                Clear(Frame);
                Frame.Add('depth', CallFrame.Depth);
                Frame.Add('objectType', CallFrame."Object Type");
                Frame.Add('objectId', CallFrame."Object ID");
                Frame.Add('objectName', CallFrame."Object Name");
                Frame.Add('method', CallFrame."Method Name");
                Frame.Add('line', CallFrame."Line No.");
                Frame.Add('app', CallFrame."App Name");
                Frames.Add(Frame);
            until CallFrame.Next(-1) = 0;
        exit(Frames);
    end;

    local procedure Inventory(SnapshotNo: Integer; FactType: Enum "BAS Fact Type"): JsonArray
    var
        Fact: Record "BAS Snapshot Fact";
        DocManager: Codeunit "BAS Doc Manager";
        Items: JsonArray;
        Item: JsonObject;
    begin
        if DocManager.FindFacts(Fact, SnapshotNo, FactType) then
            repeat
                Clear(Item);
                if Fact."Object Type" <> '' then begin
                    Item.Add('objectType', Fact."Object Type");
                    Item.Add('objectId', Fact."Object ID");
                    Item.Add('objectName', Fact."Object Name");
                    if Fact."Method Name" <> '' then
                        Item.Add('method', Fact."Method Name");
                    Item.Add('app', Fact."App Name");
                end;
                if Fact."Table ID" <> 0 then begin
                    Item.Add('tableId', Fact."Table ID");
                    Item.Add('tableName', Fact."Table Name");
                    Item.Add('operations', Fact.OperationFlags());
                end;
                Item.Add('hits', Fact."Hit Count");
                Item.Add('source', Fact.Source);
                Item.Add('inFingerprint', Fact."In Fingerprint");
                if FactType in [Enum::"BAS Fact Type"::"Drift Added", Enum::"BAS Fact Type"::"Drift Removed"] then
                    Item.Add('description', Fact.Description);
                Items.Add(Item);
            until Fact.Next() = 0;
        exit(Items);
    end;

    local procedure Tables(SnapshotNo: Integer): JsonArray
    var
        Fact: Record "BAS Snapshot Fact";
        DocManager: Codeunit "BAS Doc Manager";
        Items: JsonArray;
        Item: JsonObject;
    begin
        if DocManager.FindFacts(Fact, SnapshotNo, Enum::"BAS Fact Type"::"Table Access") then
            repeat
                Clear(Item);
                Item.Add('tableId', Fact."Table ID");
                Item.Add('tableName', Fact."Table Name");
                Item.Add('inserts', Fact.Inserts);
                Item.Add('modifies', Fact.Modifies);
                Item.Add('deletes', Fact.Deletes);
                Item.Add('renames', Fact.Renames);
                Item.Add('firstSeenMs', Fact."First Seen (ms)");
                Items.Add(Item);
            until Fact.Next() = 0;
        exit(Items);
    end;
}
