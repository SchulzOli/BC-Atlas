/// <summary>
/// One wording for every step, shared by the user guide, the layered documentation, phase titles
/// and the BC Atlas UI test ([WHEN] tags). Markdown = true emphasises captions and values.
/// </summary>
codeunit 50167 "BAS Step Phrases"
{
    Access = Public;

    var
        OpenTxt: Label 'Open %1.', Locked = true;
        OnPageChooseTxt: Label 'On the %1 page, choose %2.', Locked = true;
        ChooseTxt: Label 'Choose %1.', Locked = true;
        FillInTxt: Label 'Fill in the %1 field.', Locked = true;
        EnterTxt: Label 'In the %1 field, enter %2.', Locked = true;
        EnterInPartTxt: Label 'In the %1 part, in the %2 field, enter %3.', Locked = true;
        CheckTxt: Label 'Check that %1 shows %2.', Locked = true;
        CloseTxt: Label 'Close the %1 page.', Locked = true;
        LookupTxt: Label 'Look up a value for %1.', Locked = true;
        AutosaveTxt: Label 'Enter the data on the page (saved to %1).', Locked = true;
        KindTargetTxt: Label '%1 %2', Locked = true;
        WhatHappensTxt: Label '%1 - %2', Locked = true;

    /// <summary>Instruction for a recorded click (UI Step fact).</summary>
    procedure UiInstruction(Fact: Record "BAS Snapshot Fact"; Markdown: Boolean): Text
    var
        Target: Text;
    begin
        Target := Fact.Subject;
        if Target = '' then
            Target := Fact."Page Caption";
        case LowerCase(Fact."Step Kind") of
            'navigate':
                exit(StrSubstNo(OpenTxt, Em(Target, Markdown)));
            'invoke':
                begin
                    if (Fact."Page Caption" <> '') and (Fact."Page Caption" <> Target) then
                        exit(StrSubstNo(OnPageChooseTxt, Em(Fact."Page Caption", Markdown), Em(Target, Markdown)));
                    exit(StrSubstNo(ChooseTxt, Em(Target, Markdown)));
                end;
            'input':
                begin
                    if Fact.Value = '' then
                        exit(StrSubstNo(FillInTxt, Em(Target, Markdown)));
                    if Fact."Part Caption" <> '' then
                        exit(StrSubstNo(EnterInPartTxt, Em(Fact."Part Caption", Markdown), Em(Target, Markdown), Val(Fact.Value, Markdown)));
                    exit(StrSubstNo(EnterTxt, Em(Target, Markdown), Val(Fact.Value, Markdown)));
                end;
            'validate':
                exit(StrSubstNo(CheckTxt, Em(Target, Markdown), Val(Fact.Value, Markdown)));
            'close-page', 'close':
                exit(StrSubstNo(CloseTxt, Em(Fact."Page Caption", Markdown)));
        end;
        if Fact.Description <> '' then
            exit(Fact.Description);
        exit(StrSubstNo(KindTargetTxt, Fact."Step Kind", Target));
    end;

    /// <summary>Instruction derived from a technical step when no click was recorded for it.</summary>
    procedure TechnicalInstruction(Fact: Record "BAS Snapshot Fact"; Markdown: Boolean): Text
    begin
        case Fact."Step Kind" of
            'Action':
                exit(StrSubstNo(OnPageChooseTxt, Em(Fact."Object Name", Markdown), Em(Fact.Subject, Markdown)));
            'Field Validation':
                exit(StrSubstNo(FillInTxt, Em(Fact.Subject, Markdown)));
            'Lookup':
                exit(StrSubstNo(LookupTxt, Em(Fact.Subject, Markdown)));
            'Page Autosave':
                exit(StrSubstNo(AutosaveTxt, Em(Fact.Subject, Markdown)));
            'Marker':
                exit(Em(Fact.Description, Markdown));
        end;
        exit(Fact.Description);
    end;

    /// <summary>"What happens in the system" sentence for a technical step, '' when it wrote nothing.</summary>
    procedure SystemEffect(TechFact: Record "BAS Snapshot Fact"): Text
    begin
        if TechFact."Data Summary" = '' then
            exit('');
        exit(StrSubstNo(WhatHappensTxt, TechFact.Description, TechFact."Data Summary"));
    end;

    /// <summary>created / changed / deleted counts of a Table Access fact.</summary>
    procedure ResultText(Fact: Record "BAS Snapshot Fact"): Text
    var
        Parts: TextBuilder;
    begin
        AddPart(Parts, Fact.Inserts, 'created');
        AddPart(Parts, Fact.Modifies, 'changed');
        AddPart(Parts, Fact.Deletes, 'deleted');
        AddPart(Parts, Fact.Renames, 'renamed');
        exit(Parts.ToText());
    end;

    local procedure AddPart(var Parts: TextBuilder; Counter: Integer; Verb: Text)
    begin
        if Counter = 0 then
            exit;
        if Parts.Length() > 0 then
            Parts.Append(', ');
        Parts.Append(StrSubstNo(KindTargetTxt, Counter, Verb));
    end;

    local procedure Em(Value: Text; Markdown: Boolean): Text
    begin
        if Markdown then
            exit('**' + Value + '**');
        exit(Value);
    end;

    local procedure Val(Value: Text; Markdown: Boolean): Text
    begin
        if Markdown then
            exit('`' + Value + '`');
        exit('"' + Value + '"');
    end;
}
