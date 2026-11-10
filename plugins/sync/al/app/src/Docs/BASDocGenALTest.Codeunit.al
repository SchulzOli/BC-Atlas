/// <summary>
/// BC Atlas UI test (.al): the recorded process as an AL TestPage test written in the BC Atlas
/// documentation convention ([DOC-ID], [FEATURE], [SCENARIO], [GIVEN], one [WHEN] per phase with
/// the clicks as TestPage calls, [THEN] per phase result). BC Atlas turns it into user guide,
/// test case, DITA, BPMN and journey documentation (bca docs generate); run in the test framework
/// it replays the clicks and asserts the recorded net data footprint per table.
/// Names come from the call stacks (exact AL action names) and from page/field metadata; what can
/// only be derived from a caption is marked "Atlas Sync: verify".
/// </summary>
codeunit 50163 "BAS Doc Gen AL Test" implements "BAS IDoc Generator"
{
    Access = Public;

    var
        T: Codeunit "BAS Text Helper";
        DocManager: Codeunit "BAS Doc Manager";
        Phrases: Codeunit "BAS Step Phrases";
        Resolver: Codeunit "BAS UI Name Resolver";
        PageVars: Dictionary of [Text, Text];
        PageVarOrder: List of [Text];
        Body: TextBuilder;
        VerifyTxt: Label ' // Atlas Sync: verify %1 name', Locked = true;
        PageVarDeclTxt: Label '        %1: TestPage %2;', Locked = true;
        InvokeTxt: Label '        %1.%2.Invoke();%3', Locked = true;
        SetValueTxt: Label '        %1.%2.SetValue(''%3'');%4', Locked = true;
        SetValueInPartTxt: Label '        %1.%2.%3.SetValue(''%4'');%5', Locked = true;
        AssertTxt: Label '        %1.%2.AssertEquals(''%3'');%4', Locked = true;
        CallTxt: Label '        %1.%2();', Locked = true;
        CommentTxt: Label '        // %1', Locked = true;
        TagTxt: Label '        // [%1] %2', Locked = true;
        CountTxt: Label '        Counts.Set(%1, CountRecords(%1));', Locked = true;
        VerifyNetTxt: Label '        VerifyNetChange(CountsBefore, %1, %2); // %3: %4 created, %5 deleted', Locked = true;
        HeaderTxt: Label '// Generated from Atlas Sync Fact Snapshot %1 (fingerprint %2) of "%3".', Locked = true;
        CodeunitTxt: Label 'codeunit 50000 "%1"', Locked = true;
        ProcedureTxt: Label '    procedure %1()', Locked = true;
        FeatureTagTxt: Label '        // [FEATURE] [%1] [UI]', Locked = true;
        GivenTxt: Label 'Data comparable to the recording in company %1 (recorded %2).', Locked = true;
        ScenarioTxt: Label '%1: %2', Locked = true;

    procedure FileExtension(): Text
    begin
        exit('al');
    end;

    procedure Generate(Snapshot: Record "BAS Snapshot"; var Content: TextBuilder)
    var
        ProcessId: Text;
        Alias: Text;
    begin
        Clear(PageVars);
        Clear(PageVarOrder);
        Body.Clear();
        ProcessId := T.Identifier(Snapshot."Process Name", 60);
        WriteScenarioBody(Snapshot);

        T.AppendLine(Content, StrSubstNo(HeaderTxt, Snapshot."No.", CopyStr(Snapshot.Fingerprint, 1, 12), Snapshot."Process Name"));
        T.AppendLine(Content, '// BC Atlas reads the tags below. Generate the documentation with:');
        T.AppendLine(Content, '//   bca docs generate <this file> --app <app-root> --export markdown,html,dita,bpmn');
        T.AppendLine(Content, '// Run it in the AL test framework to replay the clicks. Review lines marked "Atlas Sync: verify"');
        T.AppendLine(Content, '// and add [ConfirmHandler]/[StrMenuHandler]/[MessageHandler] functions for dialogs of the process.');
        T.AppendLine(Content, StrSubstNo(CodeunitTxt, CopyStr('BAS UITest ' + T.Identifier(Snapshot."Process Name", 19), 1, 30)));
        T.AppendLine(Content, '{');
        T.AppendLine(Content, '    Subtype = Test;');
        T.AppendLine(Content, '    TestPermissions = Disabled;');
        T.AppendLine(Content, '');
        T.AppendLine(Content, '    trigger OnRun()');
        T.AppendLine(Content, '    begin');
        T.AppendLine(Content, StrSubstNo(FeatureTagTxt, T.CommentSafe(FeatureOf(Snapshot)).Replace(']', ')').Replace('[', '(')));
        T.AppendLine(Content, '    end;');
        T.AppendLine(Content, '');
        T.AppendLine(Content, '    var');
        // Built by concatenation: the placeholders belong to the generated label.
        T.AppendLine(Content, '        NetChangeErr: Label ''Table %1: expected a net change of %2 records as in Atlas Sync snapshot ' + Format(Snapshot."No.", 0, 9) +
            ', but got %3.'', Comment = ''%1 = table, %2 = expected, %3 = actual'';');
        T.AppendLine(Content, '');
        T.AppendLine(Content, '    [Test]');
        T.AppendLine(Content, StrSubstNo(ProcedureTxt, CopyStr(ProcessId, 1, 100) + '_AsRecorded'));
        T.AppendLine(Content, '    var');
        foreach Alias in PageVarOrder do
            T.AppendLine(Content, StrSubstNo(PageVarDeclTxt, Alias, Resolver.Quote(PageVars.Get(Alias))));
        T.AppendLine(Content, '        CountsBefore: Dictionary of [Integer, Integer];');
        T.AppendLine(Content, '    begin');
        Content.Append(Body.ToText());
        T.AppendLine(Content, '    end;');
        T.AppendLine(Content, '');
        WriteHelpers(Snapshot, Content);
        T.AppendLine(Content, '}');
    end;

    local procedure WriteScenarioBody(Snapshot: Record "BAS Snapshot")
    var
        PhaseFact: Record "BAS Snapshot Fact";
        TableFact: Record "BAS Snapshot Fact";
        PhaseCount: Integer;
        PhaseIndex: Integer;
    begin
        T.AppendLine(Body, StrSubstNo(TagTxt, 'DOC-ID', T.KebabId(Snapshot."Process Name")));
        T.AppendLine(Body, StrSubstNo(TagTxt, 'FEATURE', T.CommentSafe(FeatureOf(Snapshot))));
        if Snapshot.Description <> '' then
            T.AppendLine(Body, StrSubstNo(TagTxt, 'SCENARIO', T.CommentSafe(T.Truncate(StrSubstNo(ScenarioTxt, Snapshot."Process Name", Snapshot.Description), 250))))
        else
            T.AppendLine(Body, StrSubstNo(TagTxt, 'SCENARIO', T.CommentSafe(Snapshot."Process Name")));
        T.AppendLine(Body, StrSubstNo(TagTxt, 'GIVEN] [STATE', T.CommentSafe(StrSubstNo(GivenTxt, Snapshot."Company Name", Format(Snapshot."Recorded At", 0, '<Year4>-<Month,2>-<Day,2>')))));
        T.AppendLine(Body, '        CaptureCounts(CountsBefore);');

        if DocManager.FindFacts(PhaseFact, Snapshot."No.", Enum::"BAS Fact Type"::Phase) then begin
            PhaseCount := PhaseFact.Count();
            repeat
                PhaseIndex += 1;
                T.AppendLine(Body, '');
                T.AppendLine(Body, StrSubstNo(TagTxt, 'WHEN', T.CommentSafe(PhaseFact.Description)));
                WritePhaseClicks(Snapshot."No.", PhaseFact.Sequence);
                if (PhaseIndex < PhaseCount) and (PhaseFact."Data Summary" <> '') then
                    T.AppendLine(Body, StrSubstNo(TagTxt, 'THEN', T.CommentSafe(T.Truncate('Business Central saves: ' + PhaseFact."Data Summary", 250))));
            until PhaseFact.Next() = 0;
        end;

        T.AppendLine(Body, '');
        T.AppendLine(Body, StrSubstNo(TagTxt, 'THEN', 'The data changes exactly as recorded (net records per table).'));
        if DocManager.FindFacts(TableFact, Snapshot."No.", Enum::"BAS Fact Type"::"Table Access") then
            repeat
                T.AppendLine(Body, StrSubstNo(VerifyNetTxt, TableFact."Table ID", TableFact.Inserts - TableFact.Deletes, T.CommentSafe(TableFact."Table Name"), TableFact.Inserts, TableFact.Deletes));
            until TableFact.Next() = 0;
    end;

    /// <summary>The clicks of one phase as TestPage calls; without clicks the technical entry points.</summary>
    local procedure WritePhaseClicks(SnapshotNo: Integer; PhaseNo: Integer)
    var
        UiFact: Record "BAS Snapshot Fact";
        NextUiFact: Record "BAS Snapshot Fact";
        TechFact: Record "BAS Snapshot Fact";
        Written: Boolean;
    begin
        if DocManager.FindFacts(UiFact, SnapshotNo, Enum::"BAS Fact Type"::"UI Step") then
            repeat
                if UiFact."Phase No." = PhaseNo then begin
                    NextUiFact.Copy(UiFact);
                    if NextUiFact.Next() = 0 then
                        Clear(NextUiFact);
                    WriteClick(UiFact, NextUiFact);
                    Written := true;
                end;
            until UiFact.Next() = 0;
        if Written then
            exit;

        if DocManager.FindFacts(TechFact, SnapshotNo, Enum::"BAS Fact Type"::"Technical Step") then
            repeat
                if TechFact."Phase No." = PhaseNo then
                    WriteTechnicalEntry(TechFact);
            until TechFact.Next() = 0;
    end;

    local procedure WriteClick(UiFact: Record "BAS Snapshot Fact"; NextUiFact: Record "BAS Snapshot Fact")
    var
        TechFact: Record "BAS Snapshot Fact";
        PageAlias: Text;
        ControlName: Text;
        Note: Text;
    begin
        T.AppendLine(Body, StrSubstNo(CommentTxt, T.CommentSafe(Phrases.UiInstruction(UiFact, false))));
        PageAlias := PageVar(UiFact."Page Caption");
        case LowerCase(UiFact."Step Kind") of
            'navigate':
                T.AppendLine(Body, StrSubstNo(CallTxt, PageAlias, 'OpenView'));
            'invoke':
                begin
                    if LowerCase(UiFact.Subject) in ['new', '+ new', 'new...'] then begin
                        if (NextUiFact."Page Caption" <> '') and (NextUiFact."Page Caption" <> UiFact."Page Caption") then
                            T.AppendLine(Body, StrSubstNo(CallTxt, PageVar(NextUiFact."Page Caption"), 'OpenNew'))
                        else
                            T.AppendLine(Body, StrSubstNo(CallTxt, PageAlias, 'New'));
                        exit;
                    end;
                    // The call stack knows the exact AL action name and page of a click that ran code.
                    if (UiFact."Linked Line No." <> 0) and TechFact.Get(UiFact."Snapshot No.", UiFact."Linked Line No.") and
                       (TechFact."Step Kind" = 'Action') and (TechFact."Object Type" = 'Page')
                    then begin
                        PageAlias := PageVarByName(TechFact."Object Name");
                        ControlName := TechFact.Subject;
                    end else begin
                        ControlName := UiFact.Subject.TrimEnd('.');
                        Note := StrSubstNo(VerifyTxt, 'action');
                    end;
                    T.AppendLine(Body, StrSubstNo(InvokeTxt, PageAlias, Resolver.Quote(ControlName), Note));
                end;
            'input', 'validate':
                begin
                    // A validation trigger on a page carries the exact control name ("Sell-to Customer Name - OnValidate").
                    if (UiFact."Linked Line No." <> 0) and TechFact.Get(UiFact."Snapshot No.", UiFact."Linked Line No.") and
                       (TechFact."Step Kind" in ['Field Validation', 'Lookup']) and (TechFact."Object Type" = 'Page')
                    then
                        ControlName := TechFact.Subject
                    else
                        ControlName := Resolver.FieldControlName(UiFact."Page Caption", UiFact.Subject);
                    if ControlName = '' then begin
                        ControlName := UiFact.Subject;
                        Note := StrSubstNo(VerifyTxt, 'control');
                    end;
                    if LowerCase(UiFact."Step Kind") = 'validate' then
                        T.AppendLine(Body, StrSubstNo(AssertTxt, PageAlias, Resolver.Quote(ControlName), T.AlSafe(UiFact.Value), Note))
                    else
                        if UiFact."Part Caption" <> '' then
                            T.AppendLine(Body, StrSubstNo(SetValueInPartTxt, PageAlias, Resolver.Quote(UiFact."Part Caption"), Resolver.Quote(ControlName), T.AlSafe(UiFact.Value), StrSubstNo(VerifyTxt, 'part')))
                        else
                            T.AppendLine(Body, StrSubstNo(SetValueTxt, PageAlias, Resolver.Quote(ControlName), T.AlSafe(UiFact.Value), Note));
                end;
            'close-page', 'close':
                T.AppendLine(Body, StrSubstNo(CallTxt, PageAlias, 'Close'));
        end;
    end;

    local procedure WriteTechnicalEntry(TechFact: Record "BAS Snapshot Fact")
    begin
        T.AppendLine(Body, StrSubstNo(CommentTxt, T.CommentSafe(Phrases.TechnicalInstruction(TechFact, false))));
        if (TechFact."Step Kind" = 'Action') and (TechFact."Object Type" = 'Page') then
            T.AppendLine(Body, StrSubstNo(InvokeTxt, PageVarByName(TechFact."Object Name"), Resolver.Quote(TechFact.Subject), ''));
    end;

    /// <summary>TestPage variable for a page caption from Page Scripting (resolved to the AL page name).</summary>
    local procedure PageVar(PageCaption: Text): Text
    begin
        if PageCaption = '' then
            PageCaption := 'Page';
        exit(PageVarByName(Resolver.PageName(PageCaption)));
    end;

    local procedure PageVarByName(PageName: Text): Text
    var
        Alias: Text;
    begin
        foreach Alias in PageVarOrder do
            if PageVars.Get(Alias) = PageName then
                exit(Alias);
        Alias := T.Identifier(PageName, 28) + 'Page';
        while PageVars.ContainsKey(Alias) do
            Alias := Alias + 'X';
        PageVars.Add(Alias, PageName);
        PageVarOrder.Add(Alias);
        exit(Alias);
    end;

    local procedure FeatureOf(Snapshot: Record "BAS Snapshot"): Text
    begin
        if Snapshot.Feature <> '' then
            exit(Snapshot.Feature);
        exit(Snapshot."Process Name");
    end;

    local procedure WriteHelpers(Snapshot: Record "BAS Snapshot"; var Content: TextBuilder)
    var
        TableFact: Record "BAS Snapshot Fact";
    begin
        T.AppendLine(Content, '    local procedure CaptureCounts(var Counts: Dictionary of [Integer, Integer])');
        T.AppendLine(Content, '    begin');
        if DocManager.FindFacts(TableFact, Snapshot."No.", Enum::"BAS Fact Type"::"Table Access") then
            repeat
                T.AppendLine(Content, StrSubstNo(CountTxt, TableFact."Table ID"));
            until TableFact.Next() = 0;
        T.AppendLine(Content, '    end;');
        T.AppendLine(Content, '');
        T.AppendLine(Content, '    local procedure VerifyNetChange(Counts: Dictionary of [Integer, Integer]; TableNo: Integer; Expected: Integer)');
        T.AppendLine(Content, '    var');
        T.AppendLine(Content, '        Actual: Integer;');
        T.AppendLine(Content, '    begin');
        T.AppendLine(Content, '        Actual := CountRecords(TableNo) - Counts.Get(TableNo);');
        T.AppendLine(Content, '        if Actual <> Expected then');
        T.AppendLine(Content, '            Error(NetChangeErr, TableNo, Expected, Actual);');
        T.AppendLine(Content, '    end;');
        T.AppendLine(Content, '');
        T.AppendLine(Content, '    local procedure CountRecords(TableNo: Integer): Integer');
        T.AppendLine(Content, '    var');
        T.AppendLine(Content, '        RecRef: RecordRef;');
        T.AppendLine(Content, '    begin');
        T.AppendLine(Content, '        RecRef.Open(TableNo);');
        T.AppendLine(Content, '        exit(RecRef.Count());');
        T.AppendLine(Content, '    end;');
    end;
}
