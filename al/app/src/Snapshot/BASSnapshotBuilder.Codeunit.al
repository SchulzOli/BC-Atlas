/// <summary>
/// Condenses a recording into an Atlas Sync Fact Snapshot:
///  1. UI steps          - the clicks from the Page Scripting recording
///  2. Technical steps   - consecutive writes grouped by the trigger that started them (call stack origin)
///  3. Linking           - each click is matched to the technical step it caused
///  4. Code inventory    - distinct objects and methods from call stacks and profiler
///  5. Data footprint    - tables and kinds of writes
///  6. Fingerprint/drift - SHA-256 over the exact facts, compared with the previous snapshot of the process
/// </summary>
codeunit 50155 "BAS Snapshot Builder"
{
    Access = Public;

    var
        OpenStep: Record "BAS Snapshot Fact";
        StepTables: List of [Text];
        StepCounts: Dictionary of [Text, Integer];
        CurrentSnapshotNo: Integer;
        CurrentRecordingNo: Integer;
        NextLineNo: Integer;
        TechSequence: Integer;
        StepMaxDepth: Integer;
        StepKey: Text;
        StepIsOpen: Boolean;
        StillRecordingErr: Label 'Stop recording %1 before creating a snapshot.', Comment = '%1 = recording number';
        NothingRecordedErr: Label 'Recording %1 contains no events. Record the process or import a Page Scripting file first.', Comment = '%1 = recording number';
        ActionDescTxt: Label 'Action "%1" on %2', Comment = '%1 = action, %2 = object';
        ValidateDescTxt: Label 'Validate field "%1" on %2', Comment = '%1 = field, %2 = object';
        LookupDescTxt: Label 'Lookup on "%1" in %2', Comment = '%1 = field, %2 = object';
        AutosaveDescTxt: Label 'Page saved changes to %1 directly (no AL code)', Comment = '%1 = table';
        TriggerDescTxt: Label '%1 in %2', Comment = '%1 = method, %2 = object';
        NotCapturedDescTxt: Label 'Writes to %1 (call stack not captured)', Comment = '%1 = table';
        DriftAddedTxt: Label 'New since snapshot %1: %2', Comment = '%1 = previous snapshot, %2 = fact';
        DriftRemovedTxt: Label 'No longer used since snapshot %1: %2', Comment = '%1 = previous snapshot, %2 = fact';
        TableFactTxt: Label 'Table %1 "%2" (%3)', Comment = '%1 = id, %2 = name, %3 = operations';
        MethodFactTxt: Label '%1 %2 "%3".%4', Comment = '%1 = type, %2 = id, %3 = name, %4 = method';
        StartPhaseTxt: Label 'Start';
        FinishPhaseTxt: Label 'Finish the process';
        EnterDataPhaseTxt: Label 'Enter the data';
        EnterDataOnPageTxt: Label 'Enter the data on the %1 page', Comment = '%1 = page caption';
        XTxt: Label '%1x %2', Locked = true;
        FormatTxt: Label '%1: %2', Locked = true;
        BaseAppIdTxt: Label '437dbf0e-84ff-417a-965d-ed2bb9650972', Locked = true;

    procedure CreateSnapshot(var Recording: Record "BAS Recording"): Integer
    var
        Snapshot: Record "BAS Snapshot";
    begin
        Recording.Get(Recording."No.");
        if Recording.Status = Recording.Status::Recording then
            Error(StillRecordingErr, Recording."No.");
        Recording.CalcFields("Event Count", "Frame Count");
        if (Recording."Event Count" = 0) and (Recording."Frame Count" = 0) then
            Error(NothingRecordedErr, Recording."No.");

        Snapshot.Init();
        Snapshot."Recording No." := Recording."No.";
        Snapshot."Process Name" := Recording."Process Name";
        Snapshot.Description := Recording.Description;
        Snapshot.Feature := Recording.Feature;
        if Snapshot.Feature = '' then
            Snapshot.Feature := Recording."Process Name";
        Snapshot."Created At" := CurrentDateTime();
        Snapshot."Created By" := CopyStr(UserId(), 1, MaxStrLen(Snapshot."Created By"));
        Snapshot."Recorded By" := Recording."User ID";
        Snapshot."Recorded At" := Recording."Started At";
        if (Recording."Started At" <> 0DT) and (Recording."Stopped At" <> 0DT) then
            Snapshot."Duration (ms)" := Recording."Stopped At" - Recording."Started At";
        Snapshot."Company Name" := Recording."Company Name";
        Snapshot."Platform Version" := CopyStr(BaseAppVersion(), 1, MaxStrLen(Snapshot."Platform Version"));
        Snapshot.Insert(true);

        CurrentSnapshotNo := Snapshot."No.";
        CurrentRecordingNo := Recording."No.";
        NextLineNo := 0;
        TechSequence := 0;

        AddUiSteps();
        AddTechnicalSteps();
        LinkUiToTechnicalSteps();
        AssignPhases();
        AddCodeInventory();
        AddTableAccess();

        Snapshot."Write Events" := CountWriteEvents();
        Snapshot.Fingerprint := CopyStr(ComputeFingerprint(Snapshot."No."), 1, MaxStrLen(Snapshot.Fingerprint));
        CompareWithPrevious(Snapshot);
        Snapshot.Modify(true);

        Recording."Last Snapshot No." := Snapshot."No.";
        Recording.Modify(true);
        exit(Snapshot."No.");
    end;

    procedure ComputeFingerprint(SnapshotNo: Integer): Text
    var
        Fact: Record "BAS Snapshot Fact";
        CryptographyManagement: Codeunit "Cryptography Management";
        TextHelper: Codeunit "BAS Text Helper";
        Canonical: TextBuilder;
        HashAlgorithmType: Option MD5,SHA1,SHA256,SHA384,SHA512;
    begin
        Fact.SetCurrentKey("Snapshot No.", "Fact Type", "Object Type", "Object ID", "Method Name");
        Fact.SetRange("Snapshot No.", SnapshotNo);
        Fact.SetRange("Fact Type", Fact."Fact Type"::Method);
        Fact.SetRange("In Fingerprint", true);
        if Fact.FindSet() then
            repeat
                Canonical.Append(Fact.DriftKey() + TextHelper.Lf());
            until Fact.Next() = 0;

        Fact.SetCurrentKey("Snapshot No.", "Fact Type", "Table ID");
        Fact.SetRange("Fact Type", Fact."Fact Type"::"Table Access");
        if Fact.FindSet() then
            repeat
                Canonical.Append(Fact.DriftKey() + TextHelper.Lf());
            until Fact.Next() = 0;

        if Canonical.Length() = 0 then
            exit('');
        exit(LowerCase(CryptographyManagement.GenerateHash(Canonical.ToText(), HashAlgorithmType::SHA256)));
    end;

    // ---------------------------------------------------------------- UI steps

    local procedure AddUiSteps()
    var
        RecordingEvent: Record "BAS Recording Event";
        Fact: Record "BAS Snapshot Fact";
        Sequence: Integer;
    begin
        RecordingEvent.SetRange("Recording No.", CurrentRecordingNo);
        RecordingEvent.SetRange("Event Type", RecordingEvent."Event Type"::"UI Step");
        if RecordingEvent.FindSet() then
            repeat
                Sequence += 1;
                Fact.Init();
                Fact."Snapshot No." := CurrentSnapshotNo;
                Fact."Line No." := NextLine();
                Fact."Fact Type" := Fact."Fact Type"::"UI Step";
                Fact.Sequence := Sequence;
                Fact.Source := 'Page Script';
                Fact."Step Kind" := RecordingEvent."Step Kind";
                Fact."Page Caption" := RecordingEvent."Page Caption";
                Fact.Subject := RecordingEvent."Control Caption";
                Fact.Value := RecordingEvent.Value;
                Fact."Part Caption" := RecordingEvent."Part Caption";
                Fact.Description := RecordingEvent.Description;
                Fact."First Event Entry No." := RecordingEvent."Entry No.";
                Fact."Last Event Entry No." := RecordingEvent."Entry No.";
                Fact.Insert();
            until RecordingEvent.Next() = 0;
    end;

    // ---------------------------------------------------------------- technical steps

    local procedure AddTechnicalSteps()
    var
        RecordingEvent: Record "BAS Recording Event";
    begin
        RecordingEvent.SetRange("Recording No.", CurrentRecordingNo);
        RecordingEvent.SetFilter("Event Type", '<>%1', RecordingEvent."Event Type"::"UI Step");
        if RecordingEvent.FindSet() then
            repeat
                if RecordingEvent."Event Type" = RecordingEvent."Event Type"::Marker then begin
                    CloseTechnicalStep();
                    OpenTechnicalStep(RecordingEvent);
                    CloseTechnicalStep();
                end else begin
                    if (not StepIsOpen) or (RecordingEvent.OriginKey() <> StepKey) then begin
                        CloseTechnicalStep();
                        OpenTechnicalStep(RecordingEvent);
                    end;
                    AccumulateWrite(RecordingEvent);
                end;
            until RecordingEvent.Next() = 0;
        CloseTechnicalStep();
    end;

    local procedure OpenTechnicalStep(var RecordingEvent: Record "BAS Recording Event")
    var
        Parser: Codeunit "BAS Call Stack Parser";
        ObjectLabel: Text;
        Subject: Text;
    begin
        TechSequence += 1;
        OpenStep.Init();
        OpenStep."Snapshot No." := CurrentSnapshotNo;
        OpenStep."Line No." := NextLine();
        OpenStep."Fact Type" := OpenStep."Fact Type"::"Technical Step";
        OpenStep.Sequence := TechSequence;
        OpenStep.Source := 'Call Stack';
        OpenStep."Step Kind" := RecordingEvent."Origin Kind";
        OpenStep."Object Type" := RecordingEvent."Origin Object Type";
        OpenStep."Object ID" := RecordingEvent."Origin Object ID";
        OpenStep."Object Name" := RecordingEvent."Origin Object Name";
        OpenStep."Method Name" := RecordingEvent."Origin Method";
        OpenStep."First Seen (ms)" := RecordingEvent."Elapsed (ms)";
        OpenStep."First Event Entry No." := RecordingEvent."Entry No.";
        OpenStep."Last Event Entry No." := RecordingEvent."Entry No.";
        OpenStep."Deepest Event Entry No." := RecordingEvent."Entry No.";
        if RecordingEvent."Origin Object Type" in ['Page', 'PageExtension'] then
            OpenStep."Page Caption" := RecordingEvent."Origin Object Name";

        Subject := Parser.TriggerSubject(RecordingEvent."Origin Method");
        ObjectLabel := OpenStep.ObjectLabel();
        case RecordingEvent."Origin Kind" of
            'Marker':
                begin
                    Subject := RecordingEvent.Description;
                    OpenStep.Description := RecordingEvent.Description;
                end;
            'Action':
                OpenStep.Description := StrSubstNo(ActionDescTxt, Subject, ObjectLabel);
            'Field Validation':
                OpenStep.Description := StrSubstNo(ValidateDescTxt, Subject, ObjectLabel);
            'Lookup':
                OpenStep.Description := StrSubstNo(LookupDescTxt, Subject, ObjectLabel);
            'Page Autosave':
                begin
                    Subject := RecordingEvent."Table Name";
                    OpenStep.Description := StrSubstNo(AutosaveDescTxt, RecordingEvent."Table Name");
                end;
            'Not Captured':
                begin
                    Subject := RecordingEvent."Table Name";
                    OpenStep.Description := StrSubstNo(NotCapturedDescTxt, RecordingEvent."Table Name");
                end;
            else
                OpenStep.Description := StrSubstNo(TriggerDescTxt, RecordingEvent."Origin Method", ObjectLabel);
        end;
        OpenStep.Subject := CopyStr(Subject, 1, MaxStrLen(OpenStep.Subject));

        StepKey := RecordingEvent.OriginKey();
        StepMaxDepth := RecordingEvent."Stack Depth";
        Clear(StepTables);
        Clear(StepCounts);
        StepIsOpen := true;
    end;

    local procedure AccumulateWrite(var RecordingEvent: Record "BAS Recording Event")
    var
        CountKey: Text;
        Counter: Integer;
    begin
        OpenStep."Hit Count" += 1;
        OpenStep."Last Event Entry No." := RecordingEvent."Entry No.";
        if RecordingEvent."Stack Depth" > StepMaxDepth then begin
            StepMaxDepth := RecordingEvent."Stack Depth";
            OpenStep."Deepest Event Entry No." := RecordingEvent."Entry No.";
        end;

        if not StepTables.Contains(RecordingEvent."Table Name") then
            StepTables.Add(RecordingEvent."Table Name");
        CountKey := RecordingEvent."Table Name" + '|' + LowerCase(Format(RecordingEvent."Event Type"));
        if StepCounts.Get(CountKey, Counter) then;
        StepCounts.Set(CountKey, Counter + 1);
    end;

    local procedure CloseTechnicalStep()
    begin
        if not StepIsOpen then
            exit;
        StepIsOpen := false;
        OpenStep."Data Summary" := CopyStr(BuildDataSummary(), 1, MaxStrLen(OpenStep."Data Summary"));
        OpenStep."Call Path" := CopyStr(BuildCallPath(OpenStep."Deepest Event Entry No."), 1, MaxStrLen(OpenStep."Call Path"));
        OpenStep.Insert();
    end;

    local procedure BuildDataSummary(): Text
    var
        Summary: TextBuilder;
        TablePart: TextBuilder;
        TableName: Text;
        Operation: Text;
        Counter: Integer;
    begin
        foreach TableName in StepTables do begin
            TablePart.Clear();
            foreach Operation in OperationNames() do
                if StepCounts.Get(TableName + '|' + Operation, Counter) then begin
                    if TablePart.Length() > 0 then
                        TablePart.Append(', ');
                    TablePart.Append(StrSubstNo(XTxt, Counter, Operation));
                end;
            if Summary.Length() > 0 then
                Summary.Append('; ');
            Summary.Append(StrSubstNo(FormatTxt, TableName, TablePart.ToText()));
        end;
        exit(Summary.ToText());
    end;

    local procedure OperationNames(): List of [Text]
    var
        Names: List of [Text];
    begin
        Names.Add(LowerCase(Format(Enum::"BAS Event Type"::Insert)));
        Names.Add(LowerCase(Format(Enum::"BAS Event Type"::Modify)));
        Names.Add(LowerCase(Format(Enum::"BAS Event Type"::Delete)));
        Names.Add(LowerCase(Format(Enum::"BAS Event Type"::Rename)));
        exit(Names);
    end;

    /// <summary>Root-to-leaf chain of distinct objects of one event, e.g. Page 42 "Sales Order".Post - OnAction > Codeunit 81 ...</summary>
    local procedure BuildCallPath(EventEntryNo: Integer): Text
    var
        CallFrame: Record "BAS Call Frame";
        Path: TextBuilder;
        LastKey: Text;
    begin
        CallFrame.SetRange("Recording No.", CurrentRecordingNo);
        CallFrame.SetRange(Source, CallFrame.Source::"Call Stack");
        CallFrame.SetRange("Event Entry No.", EventEntryNo);
        if CallFrame.Find('+') then
            repeat
                if CallFrame.ObjectKey() <> LastKey then begin
                    if Path.Length() > 0 then
                        Path.Append(' > ');
                    Path.Append(StrSubstNo(MethodFactTxt, CallFrame."Object Type", CallFrame."Object ID", CallFrame."Object Name", CallFrame."Method Name"));
                    LastKey := CallFrame.ObjectKey();
                end;
            until CallFrame.Next(-1) = 0;
        exit(Path.ToText());
    end;

    // ---------------------------------------------------------------- linking clicks to technical steps

    local procedure LinkUiToTechnicalSteps()
    var
        UiFact: Record "BAS Snapshot Fact";
        TechFact: Record "BAS Snapshot Fact";
        TechLines: List of [Integer];
        Cursor: Integer;
        i: Integer;
        LastCandidate: Integer;
        Found: Boolean;
    begin
        TechFact.SetCurrentKey("Snapshot No.", "Fact Type", Sequence);
        TechFact.SetRange("Snapshot No.", CurrentSnapshotNo);
        TechFact.SetRange("Fact Type", TechFact."Fact Type"::"Technical Step");
        if TechFact.FindSet() then
            repeat
                TechLines.Add(TechFact."Line No.");
            until TechFact.Next() = 0;
        if TechLines.Count() = 0 then
            exit;

        // Clicks and technical steps happen in the same order: walk both lists with a cursor,
        // looking a limited distance ahead so that one unmatched click cannot swallow the rest.
        Cursor := 1;
        UiFact.SetCurrentKey("Snapshot No.", "Fact Type", Sequence);
        UiFact.SetRange("Snapshot No.", CurrentSnapshotNo);
        UiFact.SetRange("Fact Type", UiFact."Fact Type"::"UI Step");
        if UiFact.FindSet() then
            repeat
                LastCandidate := Cursor + 25;
                if LastCandidate > TechLines.Count() then
                    LastCandidate := TechLines.Count();
                Found := false;
                i := Cursor;
                while (not Found) and (i <= LastCandidate) do begin
                    TechFact.Get(CurrentSnapshotNo, TechLines.Get(i));
                    if (TechFact."Linked Line No." = 0) and Matches(UiFact, TechFact) then begin
                        UiFact."Linked Line No." := TechFact."Line No.";
                        UiFact.Modify();
                        TechFact."Linked Line No." := UiFact."Line No.";
                        TechFact.Modify();
                        Cursor := i + 1;
                        Found := true;
                    end;
                    i += 1;
                end;
            until (UiFact.Next() = 0) or (Cursor > TechLines.Count());
    end;

    local procedure Matches(UiFact: Record "BAS Snapshot Fact"; TechFact: Record "BAS Snapshot Fact"): Boolean
    var
        Control: Text;
        Subject: Text;
        SamePage: Boolean;
    begin
        case LowerCase(UiFact."Step Kind") of
            'invoke':
                if TechFact."Step Kind" <> 'Action' then
                    exit(false);
            'input', 'validate':
                if not (TechFact."Step Kind" in ['Field Validation', 'Lookup']) then
                    exit(false);
            'lookup', 'drilldown', 'assistedit':
                if TechFact."Step Kind" <> 'Lookup' then
                    exit(false);
            else
                exit(false);
        end;

        Control := NormalizeCaption(UiFact.Subject);
        Subject := NormalizeCaption(TechFact.Subject);
        if (Control = '') or (Subject = '') then
            exit(false);

        SamePage := (UiFact."Page Caption" = '') or (TechFact."Page Caption" = '') or
                    (NormalizeCaption(UiFact."Page Caption") = NormalizeCaption(TechFact."Page Caption"));
        if not SamePage then
            exit(Control = Subject);
        exit((Control = Subject) or Control.Contains(Subject) or Subject.Contains(Control));
    end;

    local procedure NormalizeCaption(Value: Text): Text
    begin
        exit(LowerCase(DelChr(Value, '=', '.&"''')).Trim());
    end;

    // ---------------------------------------------------------------- inventory

    local procedure AddCodeInventory()
    var
        CallFrame: Record "BAS Call Frame";
        TempObjectFact: Record "BAS Snapshot Fact" temporary;
        TempMethodFact: Record "BAS Snapshot Fact" temporary;
        ObjectLines: Dictionary of [Text, Integer];
        MethodLines: Dictionary of [Text, Integer];
        Hits: Integer;
    begin
        CallFrame.SetRange("Recording No.", CurrentRecordingNo);
        if CallFrame.FindSet() then
            repeat
                if (CallFrame."Object Type" <> '') and not IsOwnObject(CallFrame."Object ID") then begin
                    Hits := 1;
                    if CallFrame.Source = CallFrame.Source::Profiler then
                        Hits := CallFrame."Hit Count";
                    Upsert(TempObjectFact, ObjectLines, CallFrame.ObjectKey(), CallFrame, false, Hits);
                    Upsert(TempMethodFact, MethodLines, CallFrame.MethodKey(), CallFrame, true, Hits);
                end;
            until CallFrame.Next() = 0;

        CopyInventory(TempObjectFact, Enum::"BAS Fact Type"::Object);
        CopyInventory(TempMethodFact, Enum::"BAS Fact Type"::Method);
    end;

    local procedure Upsert(var TempFact: Record "BAS Snapshot Fact" temporary; var Lines: Dictionary of [Text, Integer]; KeyText: Text; CallFrame: Record "BAS Call Frame"; IsMethod: Boolean; Hits: Integer)
    var
        LineNo: Integer;
    begin
        if Lines.Get(KeyText, LineNo) then begin
            TempFact.Get(0, LineNo);
            TempFact."Hit Count" += Hits;
            if TempFact."Object Name" = '' then
                TempFact."Object Name" := CallFrame."Object Name";
            if TempFact."App Name" = '' then
                TempFact."App Name" := CallFrame."App Name";
            if TempFact.Source <> SourceText(CallFrame.Source) then
                TempFact.Source := 'Call Stack + Profiler';
            if CallFrame.Source = CallFrame.Source::"Call Stack" then
                TempFact."In Fingerprint" := true;
            TempFact.Modify();
            exit;
        end;

        LineNo := Lines.Count() + 1;
        TempFact.Init();
        TempFact."Snapshot No." := 0;
        TempFact."Line No." := LineNo;
        TempFact."Object Type" := CallFrame."Object Type";
        TempFact."Object ID" := CallFrame."Object ID";
        TempFact."Object Name" := CallFrame."Object Name";
        TempFact."App Name" := CallFrame."App Name";
        if IsMethod then
            TempFact."Method Name" := CallFrame."Method Name";
        TempFact."Hit Count" := Hits;
        TempFact.Source := SourceText(CallFrame.Source);
        TempFact."In Fingerprint" := CallFrame.Source = CallFrame.Source::"Call Stack";
        TempFact.Insert();
        Lines.Add(KeyText, LineNo);
    end;

    local procedure CopyInventory(var TempFact: Record "BAS Snapshot Fact" temporary; FactType: Enum "BAS Fact Type")
    var
        Fact: Record "BAS Snapshot Fact";
    begin
        TempFact.Reset();
        if TempFact.FindSet() then
            repeat
                Fact := TempFact;
                Fact."Snapshot No." := CurrentSnapshotNo;
                Fact."Line No." := NextLine();
                Fact."Fact Type" := FactType;
                if FactType = Enum::"BAS Fact Type"::Method then
                    Fact.Description := CopyStr(StrSubstNo(MethodFactTxt, Fact."Object Type", Fact."Object ID", Fact."Object Name", Fact."Method Name"), 1, MaxStrLen(Fact.Description))
                else
                    Fact.Description := CopyStr(Fact.ObjectLabel(), 1, MaxStrLen(Fact.Description));
                Fact.Insert();
            until TempFact.Next() = 0;
    end;

    local procedure AddTableAccess()
    var
        RecordingEvent: Record "BAS Recording Event";
        TempTableFact: Record "BAS Snapshot Fact" temporary;
        Fact: Record "BAS Snapshot Fact";
        TableLines: Dictionary of [Integer, Integer];
        LineNo: Integer;
    begin
        RecordingEvent.SetRange("Recording No.", CurrentRecordingNo);
        RecordingEvent.SetFilter("Event Type", '%1|%2|%3|%4', RecordingEvent."Event Type"::Insert, RecordingEvent."Event Type"::Modify,
            RecordingEvent."Event Type"::Delete, RecordingEvent."Event Type"::Rename);
        if RecordingEvent.FindSet() then
            repeat
                if not TableLines.Get(RecordingEvent."Table ID", LineNo) then begin
                    LineNo := TableLines.Count() + 1;
                    TempTableFact.Init();
                    TempTableFact."Line No." := LineNo;
                    TempTableFact."Fact Type" := TempTableFact."Fact Type"::"Table Access";
                    TempTableFact."Table ID" := RecordingEvent."Table ID";
                    TempTableFact."Table Name" := RecordingEvent."Table Name";
                    TempTableFact."First Seen (ms)" := RecordingEvent."Elapsed (ms)";
                    TempTableFact.Source := 'Database Trigger';
                    TempTableFact."In Fingerprint" := true;
                    TempTableFact.Insert();
                    TableLines.Add(RecordingEvent."Table ID", LineNo);
                end else
                    TempTableFact.Get(0, LineNo);
                case RecordingEvent."Event Type" of
                    RecordingEvent."Event Type"::Insert:
                        TempTableFact.Inserts += 1;
                    RecordingEvent."Event Type"::Modify:
                        TempTableFact.Modifies += 1;
                    RecordingEvent."Event Type"::Delete:
                        TempTableFact.Deletes += 1;
                    RecordingEvent."Event Type"::Rename:
                        TempTableFact.Renames += 1;
                end;
                TempTableFact."Hit Count" += 1;
                TempTableFact.Modify();
            until RecordingEvent.Next() = 0;

        TempTableFact.SetCurrentKey("Snapshot No.", "Fact Type", "Table ID");
        if TempTableFact.FindSet() then
            repeat
                Fact := TempTableFact;
                Fact."Snapshot No." := CurrentSnapshotNo;
                Fact."Line No." := NextLine();
                Fact.Description := CopyStr(StrSubstNo(TableFactTxt, Fact."Table ID", Fact."Table Name", Fact.OperationFlags()), 1, MaxStrLen(Fact.Description));
                Fact.Insert();
            until TempTableFact.Next() = 0;
    end;

    // ---------------------------------------------------------------- drift

    local procedure CompareWithPrevious(var Snapshot: Record "BAS Snapshot")
    var
        PreviousSnapshot: Record "BAS Snapshot";
        OldKeys: Dictionary of [Text, Integer];
        NewKeys: Dictionary of [Text, Integer];
        KeyText: Text;
    begin
        PreviousSnapshot.SetCurrentKey("Process Name", "No.");
        PreviousSnapshot.SetRange("Process Name", Snapshot."Process Name");
        PreviousSnapshot.SetFilter("No.", '<%1', Snapshot."No.");
        if not PreviousSnapshot.FindLast() then
            exit;

        Snapshot."Previous Snapshot No." := PreviousSnapshot."No.";
        Snapshot."Drift Detected" := PreviousSnapshot.Fingerprint <> Snapshot.Fingerprint;
        if not Snapshot."Drift Detected" then
            exit;

        CollectDriftKeys(PreviousSnapshot."No.", OldKeys);
        CollectDriftKeys(Snapshot."No.", NewKeys);
        foreach KeyText in NewKeys.Keys() do
            if not OldKeys.ContainsKey(KeyText) then
                AddDriftFact(Snapshot."No.", NewKeys.Get(KeyText), Enum::"BAS Fact Type"::"Drift Added", PreviousSnapshot."No.");
        foreach KeyText in OldKeys.Keys() do
            if not NewKeys.ContainsKey(KeyText) then
                AddDriftFact(PreviousSnapshot."No.", OldKeys.Get(KeyText), Enum::"BAS Fact Type"::"Drift Removed", PreviousSnapshot."No.");
    end;

    local procedure CollectDriftKeys(SnapshotNo: Integer; var Keys: Dictionary of [Text, Integer])
    var
        Fact: Record "BAS Snapshot Fact";
    begin
        Fact.SetRange("Snapshot No.", SnapshotNo);
        Fact.SetFilter("Fact Type", '%1|%2', Fact."Fact Type"::Method, Fact."Fact Type"::"Table Access");
        Fact.SetRange("In Fingerprint", true);
        if Fact.FindSet() then
            repeat
                Keys.Set(Fact.DriftKey(), Fact."Line No.");
            until Fact.Next() = 0;
    end;

    local procedure AddDriftFact(SourceSnapshotNo: Integer; SourceLineNo: Integer; DriftType: Enum "BAS Fact Type"; PreviousSnapshotNo: Integer)
    var
        SourceFact: Record "BAS Snapshot Fact";
        Fact: Record "BAS Snapshot Fact";
    begin
        SourceFact.Get(SourceSnapshotNo, SourceLineNo);
        Fact := SourceFact;
        Fact."Snapshot No." := CurrentSnapshotNo;
        Fact."Line No." := NextLine();
        Fact."Fact Type" := DriftType;
        Fact."Linked Line No." := 0;
        if DriftType = Enum::"BAS Fact Type"::"Drift Added" then
            Fact.Description := CopyStr(StrSubstNo(DriftAddedTxt, PreviousSnapshotNo, SourceFact.Description), 1, MaxStrLen(Fact.Description))
        else
            Fact.Description := CopyStr(StrSubstNo(DriftRemovedTxt, PreviousSnapshotNo, SourceFact.Description), 1, MaxStrLen(Fact.Description));
        Fact.Insert();
    end;

    // ---------------------------------------------------------------- helpers

    local procedure CountWriteEvents(): Integer
    var
        RecordingEvent: Record "BAS Recording Event";
    begin
        RecordingEvent.SetRange("Recording No.", CurrentRecordingNo);
        RecordingEvent.SetFilter("Event Type", '%1|%2|%3|%4', RecordingEvent."Event Type"::Insert, RecordingEvent."Event Type"::Modify,
            RecordingEvent."Event Type"::Delete, RecordingEvent."Event Type"::Rename);
        exit(RecordingEvent.Count());
    end;

    local procedure SourceText(Source: Enum "BAS Frame Source"): Text[30]
    begin
        exit(CopyStr(Format(Source), 1, 30));
    end;

    local procedure IsOwnObject(ObjectId: Integer): Boolean
    begin
        exit((ObjectId >= 50150) and (ObjectId <= 50199));
    end;

    // ---------------------------------------------------------------- phases (abstraction layer above the steps)

    /// <summary>
    /// Groups clicks and technical steps into business phases:
    ///  - with markers: each marker starts a phase named like the marker;
    ///  - with clicks: a phase ends with the click that made the system write data, named by that click;
    ///  - otherwise: one phase per action or validation; client autosaves join the next phase.
    /// Steps between two phase-closing steps belong to the next phase.
    /// </summary>
    local procedure AssignPhases()
    var
        TechFact: Record "BAS Snapshot Fact";
        UiFact: Record "BAS Snapshot Fact";
        PhaseCount: Integer;
    begin
        FilterSteps(TechFact, Enum::"BAS Fact Type"::"Technical Step");
        FilterSteps(UiFact, Enum::"BAS Fact Type"::"UI Step");
        TechFact.SetRange("Step Kind", 'Marker');
        if not TechFact.IsEmpty() then begin
            TechFact.SetRange("Step Kind");
            PhaseCount := PhasesFromMarkers(TechFact);
        end else begin
            TechFact.SetRange("Step Kind");
            if not UiFact.IsEmpty() then
                PhaseCount := PhasesFromClicks(UiFact)
            else
                PhaseCount := PhasesFromTechnicalSteps(TechFact);
        end;
        PhaseCount := AssignPendingByNextPhase(TechFact, PhaseCount);
        SetClickPhasesFromLinks(UiFact);
        AssignPendingByNextPhase(UiFact, PhaseCount);
        SummarizePhases();
    end;

    /// <summary>A click belongs to the phase of the technical step it triggered.</summary>
    local procedure SetClickPhasesFromLinks(var UiFact: Record "BAS Snapshot Fact")
    var
        TechFact: Record "BAS Snapshot Fact";
    begin
        if UiFact.FindSet() then
            repeat
                if (UiFact."Phase No." = 0) and (UiFact."Linked Line No." <> 0) then
                    if TechFact.Get(CurrentSnapshotNo, UiFact."Linked Line No.") and (TechFact."Phase No." <> 0) then begin
                        UiFact."Phase No." := TechFact."Phase No.";
                        UiFact.Modify();
                    end;
            until UiFact.Next() = 0;
    end;

    local procedure PhasesFromMarkers(var TechFact: Record "BAS Snapshot Fact"): Integer
    var
        PhaseNo: Integer;
    begin
        if TechFact.FindSet() then
            repeat
                if TechFact."Step Kind" = 'Marker' then begin
                    PhaseNo += 1;
                    NewPhase(PhaseNo, TechFact.Description);
                end else
                    if PhaseNo = 0 then begin
                        PhaseNo := 1;
                        NewPhase(PhaseNo, StartPhaseTxt);
                    end;
                TechFact."Phase No." := PhaseNo;
                TechFact.Modify();
            until TechFact.Next() = 0;
        exit(PhaseNo);
    end;

    /// <summary>
    /// A click that runs an action (post, release, report ...) is a phase of its own; the clicks
    /// before it (navigation, data entry, validations) form one "Enter the data" phase.
    /// </summary>
    local procedure PhasesFromClicks(var UiFact: Record "BAS Snapshot Fact"): Integer
    var
        TechFact: Record "BAS Snapshot Fact";
        Phrases: Codeunit "BAS Step Phrases";
        PhaseNo: Integer;
        EntryPhaseLine: Integer;
        Linked: Boolean;
    begin
        if UiFact.FindSet() then
            repeat
                Linked := (UiFact."Linked Line No." <> 0) and TechFact.Get(CurrentSnapshotNo, UiFact."Linked Line No.");
                if Linked and IsActionKind(TechFact."Step Kind") then begin
                    PhaseNo += 1;
                    NewPhase(PhaseNo, Phrases.UiInstruction(UiFact, false));
                    EntryPhaseLine := 0;
                end else
                    if EntryPhaseLine = 0 then begin
                        PhaseNo += 1;
                        EntryPhaseLine := NewPhase(PhaseNo, EnterDataTitle(UiFact."Page Caption"));
                    end else
                        if (UiFact."Page Caption" <> '') and (LowerCase(UiFact."Step Kind") in ['input', 'validate']) then
                            RenamePhase(EntryPhaseLine, EnterDataTitle(UiFact."Page Caption"));
                UiFact."Phase No." := PhaseNo;
                UiFact.Modify();
                if Linked then begin
                    TechFact."Phase No." := PhaseNo;
                    TechFact.Modify();
                end;
            until UiFact.Next() = 0;
        exit(PhaseNo);
    end;

    /// <summary>Same grouping without clicks: actions are phases, validations and autosaves in between are data entry.</summary>
    local procedure PhasesFromTechnicalSteps(var TechFact: Record "BAS Snapshot Fact"): Integer
    var
        Phrases: Codeunit "BAS Step Phrases";
        PhaseNo: Integer;
        EntryPhaseLine: Integer;
    begin
        if TechFact.FindSet() then
            repeat
                if IsActionKind(TechFact."Step Kind") then begin
                    PhaseNo += 1;
                    NewPhase(PhaseNo, Phrases.TechnicalInstruction(TechFact, false));
                    EntryPhaseLine := 0;
                end else
                    if EntryPhaseLine = 0 then begin
                        PhaseNo += 1;
                        EntryPhaseLine := NewPhase(PhaseNo, EnterDataTitle(TechFact."Page Caption"));
                    end;
                TechFact."Phase No." := PhaseNo;
                TechFact.Modify();
            until TechFact.Next() = 0;
        exit(PhaseNo);
    end;

    local procedure IsActionKind(StepKind: Text): Boolean
    begin
        exit(StepKind in ['Action', 'Report', 'Codeunit Run', 'Code']);
    end;

    local procedure EnterDataTitle(PageCaption: Text): Text
    begin
        if PageCaption = '' then
            exit(EnterDataPhaseTxt);
        exit(StrSubstNo(EnterDataOnPageTxt, PageCaption));
    end;

    local procedure RenamePhase(LineNo: Integer; Title: Text)
    var
        Fact: Record "BAS Snapshot Fact";
    begin
        Fact.Get(CurrentSnapshotNo, LineNo);
        Fact.Description := CopyStr(Title, 1, MaxStrLen(Fact.Description));
        Fact.Modify();
    end;

    /// <summary>Steps without a phase join the next phase in step order; trailing steps join a final phase.</summary>
    local procedure AssignPendingByNextPhase(var StepFact: Record "BAS Snapshot Fact"; PhaseCount: Integer): Integer
    var
        PendingFact: Record "BAS Snapshot Fact";
        Pending: List of [Integer];
        LineNo: Integer;
        TargetPhase: Integer;
    begin
        if StepFact.FindSet() then
            repeat
                if StepFact."Phase No." = 0 then
                    Pending.Add(StepFact."Line No.")
                else begin
                    foreach LineNo in Pending do
                        SetPhase(PendingFact, LineNo, StepFact."Phase No.");
                    Clear(Pending);
                end;
            until StepFact.Next() = 0;

        if Pending.Count() = 0 then
            exit(PhaseCount);
        TargetPhase := PhaseCount;
        if TargetPhase = 0 then begin
            TargetPhase := 1;
            NewPhase(TargetPhase, EnterDataPhaseTxt);
        end else
            if StepFact."Fact Type" = StepFact."Fact Type"::"UI Step" then begin
                // Clicks after the last click with a system effect form their own closing phase.
                TargetPhase += 1;
                NewPhase(TargetPhase, FinishPhaseTxt);
            end;
        foreach LineNo in Pending do
            SetPhase(PendingFact, LineNo, TargetPhase);
        exit(TargetPhase);
    end;

    local procedure SetPhase(var Fact: Record "BAS Snapshot Fact"; LineNo: Integer; PhaseNo: Integer)
    begin
        Fact.Get(CurrentSnapshotNo, LineNo);
        Fact."Phase No." := PhaseNo;
        Fact.Modify();
    end;

    local procedure NewPhase(PhaseNo: Integer; Title: Text): Integer
    var
        Fact: Record "BAS Snapshot Fact";
    begin
        Fact.Init();
        Fact."Snapshot No." := CurrentSnapshotNo;
        Fact."Line No." := NextLine();
        Fact."Fact Type" := Fact."Fact Type"::Phase;
        Fact.Sequence := PhaseNo;
        Fact."Phase No." := PhaseNo;
        Fact."Step Kind" := 'Phase';
        Fact.Source := 'Derived';
        Fact.Description := CopyStr(Title.TrimEnd('.'), 1, MaxStrLen(Fact.Description));
        Fact.Insert();
        exit(Fact."Line No.");
    end;

    /// <summary>Totals per phase: writes, start time and the combined data footprint of its technical steps.</summary>
    local procedure SummarizePhases()
    var
        PhaseFact: Record "BAS Snapshot Fact";
        TechFact: Record "BAS Snapshot Fact";
        Summary: TextBuilder;
    begin
        FilterSteps(PhaseFact, Enum::"BAS Fact Type"::Phase);
        FilterSteps(TechFact, Enum::"BAS Fact Type"::"Technical Step");
        if PhaseFact.FindSet() then
            repeat
                Summary.Clear();
                TechFact.SetRange("Phase No.", PhaseFact.Sequence);
                if TechFact.FindSet() then begin
                    PhaseFact."First Seen (ms)" := TechFact."First Seen (ms)";
                    repeat
                        PhaseFact."Hit Count" += TechFact."Hit Count";
                        if TechFact."Data Summary" <> '' then begin
                            if Summary.Length() > 0 then
                                Summary.Append('; ');
                            Summary.Append(TechFact."Data Summary");
                        end;
                    until TechFact.Next() = 0;
                end;
                PhaseFact."Data Summary" := CopyStr(Summary.ToText(), 1, MaxStrLen(PhaseFact."Data Summary"));
                PhaseFact.Modify();
            until PhaseFact.Next() = 0;
    end;

    local procedure FilterSteps(var Fact: Record "BAS Snapshot Fact"; FactType: Enum "BAS Fact Type")
    begin
        Fact.SetCurrentKey("Snapshot No.", "Fact Type", Sequence);
        Fact.SetRange("Snapshot No.", CurrentSnapshotNo);
        Fact.SetRange("Fact Type", FactType);
    end;

    local procedure NextLine(): Integer
    begin
        NextLineNo += 1;
        exit(NextLineNo);
    end;

    local procedure BaseAppVersion(): Text
    var
        Info: ModuleInfo;
        BaseAppId: Guid;
    begin
        if not Evaluate(BaseAppId, BaseAppIdTxt) then
            exit('');
        if not NavApp.GetModuleInfo(BaseAppId, Info) then
            exit('');
        exit(Format(Info.AppVersion()));
    end;
}
