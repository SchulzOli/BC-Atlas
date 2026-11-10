/// <summary>
/// End-user guide (Markdown): numbered instructions from the recorded clicks, grouped by phase,
/// each with a short "what happens in the system" note from the linked technical step, and the
/// resulting data. Falls back to the technical steps when no Page Scripting recording was imported.
/// </summary>
codeunit 50159 "BAS Doc Gen User Guide" implements "BAS IDoc Generator"
{
    Access = Public;

    var
        T: Codeunit "BAS Text Helper";
        DocManager: Codeunit "BAS Doc Manager";
        Phrases: Codeunit "BAS Step Phrases";
        StepLineTxt: Label '%1. %2', Locked = true;
        PhaseHeadingTxt: Label '### Phase %1 - %2', Locked = true;
        ResultLineTxt: Label '- **%1**: %2', Locked = true;
        TechnicalDocumentationTxt: Label '- Technical documentation: `%1`', Locked = true;
        LayeredDocumentationTxt: Label '- Layered documentation (use case down to every click): `%1`', Locked = true;
        WhatHappensTxt: Label '   - _What happens:_ %1', Locked = true;

    procedure FileExtension(): Text
    begin
        exit('md');
    end;

    procedure Generate(Snapshot: Record "BAS Snapshot"; var Content: TextBuilder)
    var
        Fact: Record "BAS Snapshot Fact";
        UseUiSteps: Boolean;
        StepNo: Integer;
    begin
        T.AppendLine(Content, '# How to: ' + Snapshot."Process Name");
        T.AppendLine(Content, '');
        T.AppendLine(Content, DocManager.GeneratedNote(Snapshot));
        T.AppendLine(Content, '');
        if Snapshot.Description <> '' then begin
            T.AppendLine(Content, Snapshot.Description);
            T.AppendLine(Content, '');
        end;

        T.AppendLine(Content, '## Steps');
        T.AppendLine(Content, '');
        UseUiSteps := DocManager.FindFacts(Fact, Snapshot."No.", Enum::"BAS Fact Type"::"UI Step");
        if DocManager.FindFacts(Fact, Snapshot."No.", Enum::"BAS Fact Type"::Phase) and (Fact.Count() > 1) then
            repeat
                T.AppendLine(Content, StrSubstNo(PhaseHeadingTxt, Fact.Sequence, Fact.Description));
                T.AppendLine(Content, '');
                WritePhaseSteps(Snapshot."No.", Fact.Sequence, UseUiSteps, StepNo, Content);
                T.AppendLine(Content, '');
            until Fact.Next() = 0
        else begin
            WritePhaseSteps(Snapshot."No.", -1, UseUiSteps, StepNo, Content);
            T.AppendLine(Content, '');
        end;
        if StepNo = 0 then begin
            T.AppendLine(Content, '_No steps were recorded._');
            T.AppendLine(Content, '');
        end;

        if DocManager.FindFacts(Fact, Snapshot."No.", Enum::"BAS Fact Type"::"Table Access") then begin
            T.AppendLine(Content, '## Result');
            T.AppendLine(Content, '');
            T.AppendLine(Content, 'When you have completed the steps, Business Central has changed the following data:');
            T.AppendLine(Content, '');
            repeat
                T.AppendLine(Content, StrSubstNo(ResultLineTxt, Fact."Table Name", Phrases.ResultText(Fact)));
            until Fact.Next() = 0;
            T.AppendLine(Content, '');
        end;

        T.AppendLine(Content, '## See also');
        T.AppendLine(Content, '');
        T.AppendLine(Content, StrSubstNo(LayeredDocumentationTxt, DocManager.FileName(Snapshot, Enum::"BAS Doc Type"::"Layered Markdown", 'md')));
        T.AppendLine(Content, StrSubstNo(TechnicalDocumentationTxt, DocManager.FileName(Snapshot, Enum::"BAS Doc Type"::"Technical Markdown", 'md')));
    end;

    /// <summary>Writes the steps of one phase (PhaseNo = -1: all steps). Numbering continues across phases.</summary>
    local procedure WritePhaseSteps(SnapshotNo: Integer; PhaseNo: Integer; UseUiSteps: Boolean; var StepNo: Integer; var Content: TextBuilder)
    var
        Fact: Record "BAS Snapshot Fact";
        TechFact: Record "BAS Snapshot Fact";
        StepType: Enum "BAS Fact Type";
    begin
        StepType := Enum::"BAS Fact Type"::"Technical Step";
        if UseUiSteps then
            StepType := Enum::"BAS Fact Type"::"UI Step";
        if not DocManager.FindFacts(Fact, SnapshotNo, StepType) then
            exit;
        repeat
            if (PhaseNo = -1) or (Fact."Phase No." = PhaseNo) then begin
                StepNo += 1;
                if UseUiSteps then begin
                    T.AppendLine(Content, StrSubstNo(StepLineTxt, StepNo, Phrases.UiInstruction(Fact, true)));
                    if (Fact."Linked Line No." <> 0) and TechFact.Get(Fact."Snapshot No.", Fact."Linked Line No.") then
                        WriteSystemNote(TechFact, Content);
                end else begin
                    T.AppendLine(Content, StrSubstNo(StepLineTxt, StepNo, Phrases.TechnicalInstruction(Fact, true)));
                    WriteSystemNote(Fact, Content);
                end;
            end;
        until Fact.Next() = 0;
    end;

    local procedure WriteSystemNote(TechFact: Record "BAS Snapshot Fact"; var Content: TextBuilder)
    begin
        if Phrases.SystemEffect(TechFact) <> '' then
            T.AppendLine(Content, StrSubstNo(WhatHappensTxt, Phrases.SystemEffect(TechFact)));
    end;
}
