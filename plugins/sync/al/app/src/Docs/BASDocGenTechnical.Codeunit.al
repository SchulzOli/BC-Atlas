/// <summary>
/// Technical process documentation (Markdown): summary, process flow diagram, every technical step
/// with the click that triggered it, its call path and data footprint, the object and method
/// inventory, the data footprint and the drift against the previous snapshot.
/// </summary>
codeunit 50158 "BAS Doc Gen Technical" implements "BAS IDoc Generator"
{
    Access = Public;

    var
        T: Codeunit "BAS Text Helper";
        DocManager: Codeunit "BAS Doc Manager";
        RecordedByInCompanyTxt: Label '| Recorded | %1 by %2 in company %3 |', Locked = true;
        DurationTxt: Label '| Duration | %1 |', Locked = true;
        ApplicationVersionTxt: Label '| Application version | %1 |', Locked = true;
        UserInteractionsUIStepsTxt: Label '| User interactions (UI steps) | %1 |', Locked = true;
        TechnicalStepsTxt: Label '| Technical steps | %1 |', Locked = true;
        ObjectsMethodsInvolvedTxt: Label '| Objects / methods involved | %1 / %2 |', Locked = true;
        TablesWrittenWriteEventsTxt: Label '| Tables written / write events | %1 / %2 |', Locked = true;
        FingerprintTxt: Label '| Fingerprint | `%1` |', Locked = true;
        ChangedSinceSnapshotDifferencesTxt: Label '**Changed** since snapshot %1 (%2 differences, see section 8)', Locked = true;
        UnchangedSinceSnapshotTxt: Label 'Unchanged since snapshot %1', Locked = true;
        DriftTxt: Label '| Drift | %1 |', Locked = true;
        STxt: Label '    S%1["%1. %2"]', Locked = true;
        SSTxt: Label '    S%1 --> S%2', Locked = true;
        StepTxt: Label '### Step %1 - %2', Locked = true;
        TriggeredByUserStepTxt: Label '- **Triggered by user step %1:** %2', Locked = true;
        KindStartsAtTxt: Label '- **Kind:** %1, starts at %2', Locked = true;
        EntryPointTxt: Label '- **Entry point:** `%1` - `%2`', Locked = true;
        DataFootprintWritesTxt: Label '- **Data footprint (%1 writes):** %2', Locked = true;
        Step2Txt: Label 'Step %1', Locked = true;
        FormatTxt: Label '| %1 | %2 | %3 | %4 | %5 | %6 |', Locked = true;
        Format2Txt: Label '| %1 | %2 | %3 | %4 |', Locked = true;
        Format3Txt: Label '| %1 | %2 | %3 | %4 | %5 | %6 | %7 |', Locked = true;
        TheProcessRunsExactlyTxt: Label '_The process runs exactly as in snapshot %1 (same fingerprint)._', Locked = true;

    procedure FileExtension(): Text
    begin
        exit('md');
    end;

    procedure Generate(Snapshot: Record "BAS Snapshot"; var Content: TextBuilder)
    begin
        Snapshot.CalcFields("UI Steps", "Technical Steps", Objects, Methods, Tables, "Drift Facts");
        T.AppendLine(Content, '# ' + Snapshot."Process Name" + ' - Technical Process Documentation');
        T.AppendLine(Content, '');
        T.AppendLine(Content, DocManager.GeneratedNote(Snapshot));
        T.AppendLine(Content, '');
        if Snapshot.Description <> '' then begin
            T.AppendLine(Content, Snapshot.Description);
            T.AppendLine(Content, '');
        end;
        WriteSummary(Snapshot, Content);
        WriteFlow(Snapshot, Content);
        WriteSteps(Snapshot, Content);
        WriteUnlinkedUiSteps(Snapshot, Content);
        WriteObjects(Snapshot, Content);
        WriteMethods(Snapshot, Content);
        WriteTables(Snapshot, Content);
        WriteDrift(Snapshot, Content);
    end;

    local procedure WriteSummary(Snapshot: Record "BAS Snapshot"; var Content: TextBuilder)
    var
        DriftText: Text;
    begin
        T.AppendLine(Content, '## 1. Summary');
        T.AppendLine(Content, '');
        T.AppendLine(Content, '| Fact | Value |');
        T.AppendLine(Content, '|---|---|');
        T.AppendLine(Content, StrSubstNo(RecordedByInCompanyTxt, Format(Snapshot."Recorded At", 0, '<Year4>-<Month,2>-<Day,2> <Hours24,2>:<Minutes,2>'), T.MdCell(Snapshot."Recorded By"), T.MdCell(Snapshot."Company Name")));
        T.AppendLine(Content, StrSubstNo(DurationTxt, T.FormatMs(Snapshot."Duration (ms)")));
        T.AppendLine(Content, StrSubstNo(ApplicationVersionTxt, Snapshot."Platform Version"));
        T.AppendLine(Content, StrSubstNo(UserInteractionsUIStepsTxt, Snapshot."UI Steps"));
        T.AppendLine(Content, StrSubstNo(TechnicalStepsTxt, Snapshot."Technical Steps"));
        T.AppendLine(Content, StrSubstNo(ObjectsMethodsInvolvedTxt, Snapshot.Objects, Snapshot.Methods));
        T.AppendLine(Content, StrSubstNo(TablesWrittenWriteEventsTxt, Snapshot.Tables, Snapshot."Write Events"));
        T.AppendLine(Content, StrSubstNo(FingerprintTxt, Snapshot.Fingerprint));
        case true of
            Snapshot."Previous Snapshot No." = 0:
                DriftText := 'First snapshot of this process';
            Snapshot."Drift Detected":
                DriftText := StrSubstNo(ChangedSinceSnapshotDifferencesTxt, Snapshot."Previous Snapshot No.", Snapshot."Drift Facts");
            else
                DriftText := StrSubstNo(UnchangedSinceSnapshotTxt, Snapshot."Previous Snapshot No.");
        end;
        T.AppendLine(Content, StrSubstNo(DriftTxt, DriftText));
        T.AppendLine(Content, '');
    end;

    local procedure WriteFlow(Snapshot: Record "BAS Snapshot"; var Content: TextBuilder)
    var
        Fact: Record "BAS Snapshot Fact";
        Nodes: Integer;
    begin
        T.AppendLine(Content, '## 2. Process flow');
        T.AppendLine(Content, '');
        if not DocManager.FindFacts(Fact, Snapshot."No.", Enum::"BAS Fact Type"::"Technical Step") then begin
            T.AppendLine(Content, '_No database writes were recorded._');
            T.AppendLine(Content, '');
            exit;
        end;
        T.AppendLine(Content, '```mermaid');
        T.AppendLine(Content, 'flowchart TD');
        repeat
            Nodes += 1;
            T.AppendLine(Content, StrSubstNo(STxt, Fact.Sequence, T.MermaidLabel(T.Truncate(Fact.Description, 80))));
            if Nodes > 1 then
                T.AppendLine(Content, StrSubstNo(SSTxt, Fact.Sequence - 1, Fact.Sequence));
        until (Fact.Next() = 0) or (Nodes >= 60);
        T.AppendLine(Content, '```');
        T.AppendLine(Content, '');
    end;

    local procedure WriteSteps(Snapshot: Record "BAS Snapshot"; var Content: TextBuilder)
    var
        Fact: Record "BAS Snapshot Fact";
        UiFact: Record "BAS Snapshot Fact";
        PathPart: Text;
        Path: TextBuilder;
        PathSeparators: List of [Text];
    begin
        PathSeparators.Add(' > ');
        T.AppendLine(Content, '## 3. Step by step');
        T.AppendLine(Content, '');
        if not DocManager.FindFacts(Fact, Snapshot."No.", Enum::"BAS Fact Type"::"Technical Step") then begin
            T.AppendLine(Content, '_No technical steps._');
            T.AppendLine(Content, '');
            exit;
        end;
        repeat
            T.AppendLine(Content, StrSubstNo(StepTxt, Fact.Sequence, Fact.Description));
            T.AppendLine(Content, '');
            if (Fact."Linked Line No." <> 0) and UiFact.Get(Fact."Snapshot No.", Fact."Linked Line No.") then
                T.AppendLine(Content, StrSubstNo(TriggeredByUserStepTxt, UiFact.Sequence, UiFact.Description));
            T.AppendLine(Content, StrSubstNo(KindStartsAtTxt, Fact."Step Kind", T.FormatMs(Fact."First Seen (ms)")));
            if Fact."Object Type" <> '' then
                T.AppendLine(Content, StrSubstNo(EntryPointTxt, Fact.ObjectLabel(), Fact."Method Name"));
            if Fact."Data Summary" <> '' then
                T.AppendLine(Content, StrSubstNo(DataFootprintWritesTxt, Fact."Hit Count", Fact."Data Summary"));
            if Fact."Call Path" <> '' then begin
                Path.Clear();
                foreach PathPart in Fact."Call Path".Split(PathSeparators) do begin
                    if Path.Length() > 0 then
                        Path.Append(' -> ');
                    Path.Append('`' + PathPart + '`');
                end;
                T.AppendLine(Content, '- **Deepest call path:** ' + Path.ToText());
            end;
            T.AppendLine(Content, '');
        until Fact.Next() = 0;
    end;

    local procedure WriteUnlinkedUiSteps(Snapshot: Record "BAS Snapshot"; var Content: TextBuilder)
    var
        Fact: Record "BAS Snapshot Fact";
        LinkedStep: Integer;
        LinkedText: Text;
    begin
        if not DocManager.FindFacts(Fact, Snapshot."No.", Enum::"BAS Fact Type"::"UI Step") then
            exit;
        T.AppendLine(Content, '## 4. User interactions');
        T.AppendLine(Content, '');
        T.AppendLine(Content, '| # | Kind | Page | Control | Value | Technical step |');
        T.AppendLine(Content, '|---|---|---|---|---|---|');
        repeat
            LinkedStep := DocManager.LinkedSequence(Fact);
            LinkedText := '-';
            if LinkedStep <> 0 then
                LinkedText := StrSubstNo(Step2Txt, LinkedStep);
            T.AppendLine(Content, StrSubstNo(FormatTxt, Fact.Sequence, T.MdCell(Fact."Step Kind"), T.MdCell(Fact."Page Caption"),
                T.MdCell(Fact.Subject), T.MdCell(Fact.Value), LinkedText));
        until Fact.Next() = 0;
        T.AppendLine(Content, '');
    end;

    local procedure WriteObjects(Snapshot: Record "BAS Snapshot"; var Content: TextBuilder)
    var
        Fact: Record "BAS Snapshot Fact";
    begin
        T.AppendLine(Content, '## 5. Objects involved');
        T.AppendLine(Content, '');
        if not DocManager.FindFacts(Fact, Snapshot."No.", Enum::"BAS Fact Type"::Object) then begin
            T.AppendLine(Content, '_No call stacks were captured._');
            T.AppendLine(Content, '');
            exit;
        end;
        T.AppendLine(Content, '| Type | ID | Name | App | Hits | Source |');
        T.AppendLine(Content, '|---|---:|---|---|---:|---|');
        repeat
            T.AppendLine(Content, StrSubstNo(FormatTxt, Fact."Object Type", Fact."Object ID", T.MdCell(Fact."Object Name"),
                T.MdCell(Fact."App Name"), Fact."Hit Count", Fact.Source));
        until Fact.Next() = 0;
        T.AppendLine(Content, '');
    end;

    local procedure WriteMethods(Snapshot: Record "BAS Snapshot"; var Content: TextBuilder)
    var
        Fact: Record "BAS Snapshot Fact";
    begin
        if not DocManager.FindFacts(Fact, Snapshot."No.", Enum::"BAS Fact Type"::Method) then
            exit;
        T.AppendLine(Content, '## 6. Methods and triggers executed');
        T.AppendLine(Content, '');
        T.AppendLine(Content, '| Object | Method | Hits | Source |');
        T.AppendLine(Content, '|---|---|---:|---|');
        repeat
            T.AppendLine(Content, StrSubstNo(Format2Txt, T.MdCell(Fact.ObjectLabel()), T.MdCell(Fact."Method Name"), Fact."Hit Count", Fact.Source));
        until Fact.Next() = 0;
        T.AppendLine(Content, '');
    end;

    local procedure WriteTables(Snapshot: Record "BAS Snapshot"; var Content: TextBuilder)
    var
        Fact: Record "BAS Snapshot Fact";
    begin
        T.AppendLine(Content, '## 7. Data footprint');
        T.AppendLine(Content, '');
        if not DocManager.FindFacts(Fact, Snapshot."No.", Enum::"BAS Fact Type"::"Table Access") then begin
            T.AppendLine(Content, '_The process wrote no data._');
            T.AppendLine(Content, '');
            exit;
        end;
        T.AppendLine(Content, '| Table | ID | Inserts | Modifies | Deletes | Renames | First write |');
        T.AppendLine(Content, '|---|---:|---:|---:|---:|---:|---:|');
        repeat
            T.AppendLine(Content, StrSubstNo(Format3Txt, T.MdCell(Fact."Table Name"), Fact."Table ID", Fact.Inserts, Fact.Modifies,
                Fact.Deletes, Fact.Renames, T.FormatMs(Fact."First Seen (ms)")));
        until Fact.Next() = 0;
        T.AppendLine(Content, '');
    end;

    local procedure WriteDrift(Snapshot: Record "BAS Snapshot"; var Content: TextBuilder)
    var
        Fact: Record "BAS Snapshot Fact";
    begin
        T.AppendLine(Content, '## 8. Drift against the previous snapshot');
        T.AppendLine(Content, '');
        if Snapshot."Previous Snapshot No." = 0 then begin
            T.AppendLine(Content, '_This is the first snapshot of the process; it is the baseline for future comparisons._');
            exit;
        end;
        if not Snapshot."Drift Detected" then begin
            T.AppendLine(Content, StrSubstNo(TheProcessRunsExactlyTxt, Snapshot."Previous Snapshot No."));
            exit;
        end;
        if DocManager.FindFacts(Fact, Snapshot."No.", Enum::"BAS Fact Type"::"Drift Added") then
            repeat
                T.AppendLine(Content, '- **added:** ' + Fact.Description);
            until Fact.Next() = 0;
        if DocManager.FindFacts(Fact, Snapshot."No.", Enum::"BAS Fact Type"::"Drift Removed") then
            repeat
                T.AppendLine(Content, '- **removed:** ' + Fact.Description);
            until Fact.Next() = 0;
    end;
}
