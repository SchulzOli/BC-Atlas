/// <summary>
/// Layered process documentation (Markdown): one document that goes from the most abstract view
/// down to every click, each layer linking to the one below.
///   L0 Use case    - why the process exists and what it changes
///   L1 Process map - the phases at a glance (flow diagram)
///   L2 Phases      - result, clicks and technical steps per phase
///   L3 User steps  - what the user does, in words
///   L4 Clicks      - exactly which control, with which value, on which page
///   L5 Code path   - which AL objects and methods run (BC Atlas object keys for the architecture overlay)
///   L6 Data        - which tables change
/// plus a traceability matrix phase x clicks x technical steps x tables.
/// </summary>
codeunit 50168 "BAS Doc Gen Layered" implements "BAS IDoc Generator"
{
    Access = Public;

    var
        T: Codeunit "BAS Text Helper";
        DocManager: Codeunit "BAS Doc Manager";
        Phrases: Codeunit "BAS Step Phrases";
        LayerRowTxt: Label '| [%1](#%2) | %3 | %4 |', Locked = true;
        FactLineTxt: Label '- **%1:** %2', Locked = true;
        PhaseNodeTxt: Label '    P%1["%1 · %2"]', Locked = true;
        PhaseEdgeTxt: Label '    %1 --> %2', Locked = true;
        PhaseHeadingTxt: Label '### <a id="phase-%1"></a>Phase %1 · %2', Locked = true;
        StepHeadingTxt: Label '#### Phase %1 · %2', Locked = true;
        StepLineTxt: Label '%1. <a id="step-%2"></a>%3', Locked = true;
        EffectLineTxt: Label '   - _What happens:_ %1 ([T%2](#tech-%2))', Locked = true;
        ClickRowTxt: Label '| [%1](#step-%1) | [%2](#phase-%2) | %3 | %4 | %5 | %6 | %7 | %8 |', Locked = true;
        TechHeadingTxt: Label '### <a id="tech-%1"></a>T%1 · %2', Locked = true;
        EntryTxt: Label '- **Entry point:** `%1` → `%2`', Locked = true;
        PhaseRefTxt: Label '- **Phase:** [%1](#phase-%1) · **Kind:** %2 · **Starts at:** %3', Locked = true;
        TriggeredByTxt: Label '- **Triggered by click:** [%1](#step-%1) %2', Locked = true;
        WritesTxt: Label '- **Writes (%1):** %2', Locked = true;
        ObjectRowTxt: Label '| %1 | %2 | %3 | %4 | %5 | `%6` |', Locked = true;
        AppRowTxt: Label '| %1 | %2 | %3 | %4 |', Locked = true;
        TableRowTxt: Label '| %1 | %2 | %3 | %4 | %5 | %6 |', Locked = true;
        TraceRowTxt: Label '| [%1 · %2](#phase-%1) | %3 | %4 | %5 |', Locked = true;
        LinkTxt: Label '[%1](#%2-%1)', Locked = true;
        CountTxt: Label '%1', Locked = true;
        TwoCountTxt: Label '%1 / %2', Locked = true;

    procedure FileExtension(): Text
    begin
        exit('md');
    end;

    procedure Generate(Snapshot: Record "BAS Snapshot"; var Content: TextBuilder)
    begin
        Snapshot.CalcFields("UI Steps", "Technical Steps", Objects, Methods, Tables, Phases, "Drift Facts");
        T.AppendLine(Content, '# ' + Snapshot."Process Name" + ' - Layered process documentation');
        T.AppendLine(Content, '');
        T.AppendLine(Content, DocManager.GeneratedNote(Snapshot));
        T.AppendLine(Content, '');
        T.AppendLine(Content, 'Read from the top for the big picture; go down for detail. Every layer links to the layer below, down to the single click and the AL method it ran.');
        T.AppendLine(Content, '');
        WriteLayerIndex(Snapshot, Content);
        WriteUseCase(Snapshot, Content);
        WriteProcessMap(Snapshot, Content);
        WritePhases(Snapshot, Content);
        WriteUserSteps(Snapshot, Content);
        WriteClicks(Snapshot, Content);
        WriteCodePath(Snapshot, Content);
        WriteData(Snapshot, Content);
        WriteTraceability(Snapshot, Content);
    end;

    local procedure WriteLayerIndex(Snapshot: Record "BAS Snapshot"; var Content: TextBuilder)
    begin
        T.AppendLine(Content, '| Layer | Answers | Size |');
        T.AppendLine(Content, '|---|---|---|');
        T.AppendLine(Content, StrSubstNo(LayerRowTxt, 'L0 Use case', 'l0', 'Why does the process exist, what does it change?', Snapshot.Feature));
        T.AppendLine(Content, StrSubstNo(LayerRowTxt, 'L1 Process map', 'l1', 'Which phases does it go through?', StrSubstNo(CountTxt, Snapshot.Phases) + ' phases'));
        T.AppendLine(Content, StrSubstNo(LayerRowTxt, 'L2 Phases', 'l2', 'What is the result of each phase?', StrSubstNo(CountTxt, Snapshot.Phases) + ' phases'));
        T.AppendLine(Content, StrSubstNo(LayerRowTxt, 'L3 User steps', 'l3', 'What does the user do?', StrSubstNo(CountTxt, StepCount(Snapshot)) + ' steps'));
        T.AppendLine(Content, StrSubstNo(LayerRowTxt, 'L4 Clicks', 'l4', 'Which control, which value, which page?', StrSubstNo(CountTxt, Snapshot."UI Steps") + ' clicks'));
        T.AppendLine(Content, StrSubstNo(LayerRowTxt, 'L5 Code path', 'l5', 'Which AL objects and methods run?', StrSubstNo(TwoCountTxt, Snapshot.Objects, Snapshot.Methods) + ' objects / methods'));
        T.AppendLine(Content, StrSubstNo(LayerRowTxt, 'L6 Data', 'l6', 'Which records change?', StrSubstNo(TwoCountTxt, Snapshot.Tables, Snapshot."Write Events") + ' tables / writes'));
        T.AppendLine(Content, '');
    end;

    local procedure WriteUseCase(Snapshot: Record "BAS Snapshot"; var Content: TextBuilder)
    var
        Fact: Record "BAS Snapshot Fact";
        Outcome: TextBuilder;
        DriftText: Text;
    begin
        T.AppendLine(Content, '<a id="l0"></a>');
        T.AppendLine(Content, '## L0 · Use case');
        T.AppendLine(Content, '');
        T.AppendLine(Content, StrSubstNo(FactLineTxt, 'Use case', Snapshot.Feature));
        T.AppendLine(Content, StrSubstNo(FactLineTxt, 'Process', Snapshot."Process Name"));
        if Snapshot.Description <> '' then
            T.AppendLine(Content, StrSubstNo(FactLineTxt, 'Purpose', Snapshot.Description));
        if DocManager.FindFacts(Fact, Snapshot."No.", Enum::"BAS Fact Type"::"Table Access") then
            repeat
                if Outcome.Length() > 0 then
                    Outcome.Append('; ');
                Outcome.Append(Fact."Table Name" + ' ' + Phrases.ResultText(Fact));
            until Fact.Next() = 0;
        if Outcome.Length() = 0 then
            Outcome.Append('no data changed');
        T.AppendLine(Content, StrSubstNo(FactLineTxt, 'Outcome', Outcome.ToText()));
        T.AppendLine(Content, StrSubstNo(FactLineTxt, 'Recorded', Format(Snapshot."Recorded At", 0, '<Year4>-<Month,2>-<Day,2>') + ' by ' + Snapshot."Recorded By" + ' in ' + Snapshot."Company Name" + ', ' + T.FormatMs(Snapshot."Duration (ms)")));
        case true of
            Snapshot."Previous Snapshot No." = 0:
                DriftText := 'baseline (first snapshot of this process)';
            Snapshot."Drift Detected":
                DriftText := StrSubstNo(CountTxt, Snapshot."Drift Facts") + ' differences to snapshot ' + Format(Snapshot."Previous Snapshot No.") + ' - the process changed';
            else
                DriftText := 'unchanged since snapshot ' + Format(Snapshot."Previous Snapshot No.");
        end;
        T.AppendLine(Content, StrSubstNo(FactLineTxt, 'Version state', DriftText + ' (fingerprint `' + CopyStr(Snapshot.Fingerprint, 1, 16) + '`)'));
        T.AppendLine(Content, '');
    end;

    local procedure WriteProcessMap(Snapshot: Record "BAS Snapshot"; var Content: TextBuilder)
    var
        Fact: Record "BAS Snapshot Fact";
        Previous: Text;
    begin
        T.AppendLine(Content, '<a id="l1"></a>');
        T.AppendLine(Content, '## L1 · Process map');
        T.AppendLine(Content, '');
        if not DocManager.FindFacts(Fact, Snapshot."No.", Enum::"BAS Fact Type"::Phase) then begin
            T.AppendLine(Content, '_No phases._');
            T.AppendLine(Content, '');
            exit;
        end;
        T.AppendLine(Content, '```mermaid');
        T.AppendLine(Content, 'flowchart LR');
        T.AppendLine(Content, '    S((Start))');
        Previous := 'S';
        repeat
            T.AppendLine(Content, StrSubstNo(PhaseNodeTxt, Fact.Sequence, T.MermaidLabel(T.Truncate(Fact.Description, 60))));
            T.AppendLine(Content, StrSubstNo(PhaseEdgeTxt, Previous, 'P' + Format(Fact.Sequence, 0, 9)));
            Previous := 'P' + Format(Fact.Sequence, 0, 9);
        until Fact.Next() = 0;
        T.AppendLine(Content, '    E(((Done)))');
        T.AppendLine(Content, StrSubstNo(PhaseEdgeTxt, Previous, 'E'));
        T.AppendLine(Content, '```');
        T.AppendLine(Content, '');
    end;

    local procedure WritePhases(Snapshot: Record "BAS Snapshot"; var Content: TextBuilder)
    var
        PhaseFact: Record "BAS Snapshot Fact";
    begin
        T.AppendLine(Content, '<a id="l2"></a>');
        T.AppendLine(Content, '## L2 · Phases');
        T.AppendLine(Content, '');
        if not DocManager.FindFacts(PhaseFact, Snapshot."No.", Enum::"BAS Fact Type"::Phase) then
            exit;
        repeat
            T.AppendLine(Content, StrSubstNo(PhaseHeadingTxt, PhaseFact.Sequence, PhaseFact.Description));
            T.AppendLine(Content, '');
            if PhaseFact."Data Summary" <> '' then
                T.AppendLine(Content, StrSubstNo(FactLineTxt, 'Result', PhaseFact."Data Summary"))
            else
                T.AppendLine(Content, StrSubstNo(FactLineTxt, 'Result', 'no data written'));
            T.AppendLine(Content, StrSubstNo(FactLineTxt, 'Clicks', Links(Snapshot."No.", Enum::"BAS Fact Type"::"UI Step", PhaseFact.Sequence, 'step')));
            T.AppendLine(Content, StrSubstNo(FactLineTxt, 'Technical steps', Links(Snapshot."No.", Enum::"BAS Fact Type"::"Technical Step", PhaseFact.Sequence, 'tech')));
            T.AppendLine(Content, StrSubstNo(FactLineTxt, 'Writes', StrSubstNo(CountTxt, PhaseFact."Hit Count") + ', starting at ' + T.FormatMs(PhaseFact."First Seen (ms)")));
            T.AppendLine(Content, '');
        until PhaseFact.Next() = 0;
    end;

    local procedure WriteUserSteps(Snapshot: Record "BAS Snapshot"; var Content: TextBuilder)
    var
        PhaseFact: Record "BAS Snapshot Fact";
        Fact: Record "BAS Snapshot Fact";
        TechFact: Record "BAS Snapshot Fact";
        UseClicks: Boolean;
        StepType: Enum "BAS Fact Type";
    begin
        T.AppendLine(Content, '<a id="l3"></a>');
        T.AppendLine(Content, '## L3 · User steps');
        T.AppendLine(Content, '');
        UseClicks := DocManager.FindFacts(Fact, Snapshot."No.", Enum::"BAS Fact Type"::"UI Step");
        StepType := Enum::"BAS Fact Type"::"Technical Step";
        if UseClicks then
            StepType := Enum::"BAS Fact Type"::"UI Step"
        else
            T.AppendLine(Content, '_No Page Scripting recording was imported; the steps are derived from the call stacks._');
        if not DocManager.FindFacts(PhaseFact, Snapshot."No.", Enum::"BAS Fact Type"::Phase) then
            exit;
        repeat
            T.AppendLine(Content, StrSubstNo(StepHeadingTxt, PhaseFact.Sequence, PhaseFact.Description));
            T.AppendLine(Content, '');
            if DocManager.FindFacts(Fact, Snapshot."No.", StepType) then
                repeat
                    if Fact."Phase No." = PhaseFact.Sequence then
                        if UseClicks then begin
                            T.AppendLine(Content, StrSubstNo(StepLineTxt, Fact.Sequence, Fact.Sequence, Phrases.UiInstruction(Fact, true)));
                            if (Fact."Linked Line No." <> 0) and TechFact.Get(Fact."Snapshot No.", Fact."Linked Line No.") then
                                if Phrases.SystemEffect(TechFact) <> '' then
                                    T.AppendLine(Content, StrSubstNo(EffectLineTxt, Phrases.SystemEffect(TechFact), TechFact.Sequence));
                        end else begin
                            T.AppendLine(Content, StrSubstNo(StepLineTxt, Fact.Sequence, Fact.Sequence, Phrases.TechnicalInstruction(Fact, true)));
                            if Phrases.SystemEffect(Fact) <> '' then
                                T.AppendLine(Content, StrSubstNo(EffectLineTxt, Phrases.SystemEffect(Fact), Fact.Sequence));
                        end;
                until Fact.Next() = 0;
            T.AppendLine(Content, '');
        until PhaseFact.Next() = 0;
    end;

    local procedure WriteClicks(Snapshot: Record "BAS Snapshot"; var Content: TextBuilder)
    var
        Fact: Record "BAS Snapshot Fact";
        TechLink: Text;
    begin
        T.AppendLine(Content, '<a id="l4"></a>');
        T.AppendLine(Content, '## L4 · Clicks');
        T.AppendLine(Content, '');
        if not DocManager.FindFacts(Fact, Snapshot."No.", Enum::"BAS Fact Type"::"UI Step") then begin
            T.AppendLine(Content, '_No clicks recorded. Record the run with the Page Scripting tool and use **Import Clicks (Page Script)** on the recording._');
            T.AppendLine(Content, '');
            exit;
        end;
        T.AppendLine(Content, '| # | Phase | Type | Page | Part | Control | Value | Ran technical step |');
        T.AppendLine(Content, '|---:|---:|---|---|---|---|---|---|');
        repeat
            TechLink := '-';
            if DocManager.LinkedSequence(Fact) <> 0 then
                TechLink := StrSubstNo(LinkTxt, DocManager.LinkedSequence(Fact), 'tech').Replace('[', '[T');
            T.AppendLine(Content, StrSubstNo(ClickRowTxt, Fact.Sequence, Fact."Phase No.", T.MdCell(Fact."Step Kind"), T.MdCell(Fact."Page Caption"),
                T.MdCell(Fact."Part Caption"), T.MdCell(Fact.Subject), T.MdCell(Fact.Value), TechLink));
        until Fact.Next() = 0;
        T.AppendLine(Content, '');
    end;

    local procedure WriteCodePath(Snapshot: Record "BAS Snapshot"; var Content: TextBuilder)
    var
        Fact: Record "BAS Snapshot Fact";
        UiFact: Record "BAS Snapshot Fact";
        PathPart: Text;
        Path: TextBuilder;
        Separators: List of [Text];
    begin
        T.AppendLine(Content, '<a id="l5"></a>');
        T.AppendLine(Content, '## L5 · Code path');
        T.AppendLine(Content, '');
        Separators.Add(' > ');
        if DocManager.FindFacts(Fact, Snapshot."No.", Enum::"BAS Fact Type"::"Technical Step") then
            repeat
                T.AppendLine(Content, StrSubstNo(TechHeadingTxt, Fact.Sequence, Fact.Description));
                T.AppendLine(Content, '');
                T.AppendLine(Content, StrSubstNo(PhaseRefTxt, Fact."Phase No.", Fact."Step Kind", T.FormatMs(Fact."First Seen (ms)")));
                if (Fact."Linked Line No." <> 0) and UiFact.Get(Fact."Snapshot No.", Fact."Linked Line No.") then
                    T.AppendLine(Content, StrSubstNo(TriggeredByTxt, UiFact.Sequence, Phrases.UiInstruction(UiFact, true)));
                if Fact."Object Type" <> '' then
                    T.AppendLine(Content, StrSubstNo(EntryTxt, Fact.ObjectLabel(), Fact."Method Name"));
                if Fact."Call Path" <> '' then begin
                    Path.Clear();
                    foreach PathPart in Fact."Call Path".Split(Separators) do begin
                        if Path.Length() > 0 then
                            Path.Append(' → ');
                        Path.Append('`' + PathPart + '`');
                    end;
                    T.AppendLine(Content, StrSubstNo(FactLineTxt, 'Call path', Path.ToText()));
                end;
                if Fact."Data Summary" <> '' then
                    T.AppendLine(Content, StrSubstNo(WritesTxt, Fact."Hit Count", Fact."Data Summary"));
                T.AppendLine(Content, '');
            until Fact.Next() = 0;
        WriteObjectsByApp(Snapshot, Content);
        WriteObjects(Snapshot, Content);
    end;

    local procedure WriteObjectsByApp(Snapshot: Record "BAS Snapshot"; var Content: TextBuilder)
    var
        Fact: Record "BAS Snapshot Fact";
        Apps: List of [Text];
        ObjectCount: Dictionary of [Text, Integer];
        MethodCount: Dictionary of [Text, Integer];
        HitCount: Dictionary of [Text, Integer];
        AppName: Text;
    begin
        if not DocManager.FindFacts(Fact, Snapshot."No.", Enum::"BAS Fact Type"::Object) then
            exit;
        repeat
            AppName := AppOf(Fact);
            if not Apps.Contains(AppName) then
                Apps.Add(AppName);
            Increment(ObjectCount, AppName, 1);
            Increment(HitCount, AppName, Fact."Hit Count");
        until Fact.Next() = 0;
        if DocManager.FindFacts(Fact, Snapshot."No.", Enum::"BAS Fact Type"::Method) then
            repeat
                Increment(MethodCount, AppOf(Fact), 1);
            until Fact.Next() = 0;

        T.AppendLine(Content, '### Code by app');
        T.AppendLine(Content, '');
        T.AppendLine(Content, '| App | Objects | Methods | Hits |');
        T.AppendLine(Content, '|---|---:|---:|---:|');
        foreach AppName in Apps do
            T.AppendLine(Content, StrSubstNo(AppRowTxt, T.MdCell(AppName), Value(ObjectCount, AppName), Value(MethodCount, AppName), Value(HitCount, AppName)));
        T.AppendLine(Content, '');
    end;

    local procedure WriteObjects(Snapshot: Record "BAS Snapshot"; var Content: TextBuilder)
    var
        Fact: Record "BAS Snapshot Fact";
    begin
        if not DocManager.FindFacts(Fact, Snapshot."No.", Enum::"BAS Fact Type"::Object) then
            exit;
        T.AppendLine(Content, '### Objects (BC Atlas keys)');
        T.AppendLine(Content, '');
        T.AppendLine(Content, 'The key column matches the `type::id` suffix of BC Atlas object ids, so the code path can be laid over the BC Atlas architecture (components and layers) by the `architecture` format of bc-atlas-sync (`bca sync run`).');
        T.AppendLine(Content, '');
        T.AppendLine(Content, '| Type | ID | Name | App | Hits | BC Atlas key |');
        T.AppendLine(Content, '|---|---:|---|---|---:|---|');
        repeat
            T.AppendLine(Content, StrSubstNo(ObjectRowTxt, Fact."Object Type", Fact."Object ID", T.MdCell(Fact."Object Name"), T.MdCell(Fact."App Name"),
                Fact."Hit Count", LowerCase(Fact."Object Type") + '::' + Format(Fact."Object ID", 0, 9)));
        until Fact.Next() = 0;
        T.AppendLine(Content, '');
    end;

    local procedure WriteData(Snapshot: Record "BAS Snapshot"; var Content: TextBuilder)
    var
        Fact: Record "BAS Snapshot Fact";
    begin
        T.AppendLine(Content, '<a id="l6"></a>');
        T.AppendLine(Content, '## L6 · Data');
        T.AppendLine(Content, '');
        if not DocManager.FindFacts(Fact, Snapshot."No.", Enum::"BAS Fact Type"::"Table Access") then begin
            T.AppendLine(Content, '_The process wrote no data._');
            T.AppendLine(Content, '');
            exit;
        end;
        T.AppendLine(Content, '| Table | ID | Created | Changed | Deleted | First write |');
        T.AppendLine(Content, '|---|---:|---:|---:|---:|---:|');
        repeat
            T.AppendLine(Content, StrSubstNo(TableRowTxt, T.MdCell(Fact."Table Name"), Fact."Table ID", Fact.Inserts, Fact.Modifies, Fact.Deletes, T.FormatMs(Fact."First Seen (ms)")));
        until Fact.Next() = 0;
        T.AppendLine(Content, '');
    end;

    local procedure WriteTraceability(Snapshot: Record "BAS Snapshot"; var Content: TextBuilder)
    var
        PhaseFact: Record "BAS Snapshot Fact";
    begin
        if not DocManager.FindFacts(PhaseFact, Snapshot."No.", Enum::"BAS Fact Type"::Phase) then
            exit;
        T.AppendLine(Content, '## Traceability');
        T.AppendLine(Content, '');
        T.AppendLine(Content, '| Phase | Clicks | Technical steps | Data |');
        T.AppendLine(Content, '|---|---|---|---|');
        repeat
            T.AppendLine(Content, StrSubstNo(TraceRowTxt, PhaseFact.Sequence, T.MdCell(PhaseFact.Description),
                Links(Snapshot."No.", Enum::"BAS Fact Type"::"UI Step", PhaseFact.Sequence, 'step'),
                Links(Snapshot."No.", Enum::"BAS Fact Type"::"Technical Step", PhaseFact.Sequence, 'tech'),
                T.MdCell(T.Truncate(PhaseFact."Data Summary", 200))));
        until PhaseFact.Next() = 0;
    end;

    /// <summary>Markdown links to the steps of one phase, e.g. [1](#step-1), [2](#step-2).</summary>
    local procedure Links(SnapshotNo: Integer; FactType: Enum "BAS Fact Type"; PhaseNo: Integer; Anchor: Text): Text
    var
        Fact: Record "BAS Snapshot Fact";
        Result: TextBuilder;
    begin
        if DocManager.FindFacts(Fact, SnapshotNo, FactType) then
            repeat
                if Fact."Phase No." = PhaseNo then begin
                    if Result.Length() > 0 then
                        Result.Append(', ');
                    Result.Append(StrSubstNo(LinkTxt, Fact.Sequence, Anchor));
                end;
            until Fact.Next() = 0;
        if Result.Length() = 0 then
            exit('-');
        exit(Result.ToText());
    end;

    local procedure StepCount(Snapshot: Record "BAS Snapshot"): Integer
    begin
        if Snapshot."UI Steps" > 0 then
            exit(Snapshot."UI Steps");
        exit(Snapshot."Technical Steps");
    end;

    local procedure AppOf(Fact: Record "BAS Snapshot Fact"): Text
    begin
        if Fact."App Name" = '' then
            exit('(unknown)');
        exit(Fact."App Name");
    end;

    local procedure Increment(var Counter: Dictionary of [Text, Integer]; KeyText: Text; Amount: Integer)
    var
        Current: Integer;
    begin
        if Counter.Get(KeyText, Current) then;
        Counter.Set(KeyText, Current + Amount);
    end;

    local procedure Value(Counter: Dictionary of [Text, Integer]; KeyText: Text): Integer
    var
        Current: Integer;
    begin
        if Counter.Get(KeyText, Current) then
            exit(Current);
        exit(0);
    end;
}
