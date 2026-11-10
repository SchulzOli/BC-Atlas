/// <summary>
/// Imports the user clicks of a process from a Business Central Page Scripting recording (.yml).
/// AL cannot observe clicks in the web client directly, but the built-in Page Scripting tool records
/// every navigation, action invocation and field input. Each step becomes a "UI Step" event; the
/// snapshot builder later links each click to the technical step (call stack origin) it triggered.
/// Expected shape:
///   steps:
///     - type: invoke
///       target:
///         - page: Sales Order
///         - action: Post
///       description: Invoke &lt;caption&gt;Post&lt;/caption&gt;
/// </summary>
codeunit 50154 "BAS Page Script Importer"
{
    Access = Public;

    var
        CurrentKind: Text;
        CurrentPage: Text;
        CurrentControl: Text;
        CurrentValue: Text;
        CurrentDescription: Text;
        CurrentPart: Text;
        StepOpen: Boolean;
        NextEntryNo: Integer;
        StepsImported: Integer;
        SelectFileTxt: Label 'Select a Page Scripting recording';
        ReplaceQst: Label 'Recording %1 already has %2 UI steps. Replace them with the steps of the new file?', Comment = '%1 = recording number, %2 = number of steps';
        NoStepsErr: Label 'The file contains no Page Scripting steps.';
        ImportedMsg: Label '%1 UI steps imported.', Comment = '%1 = number of steps';
        FormatTxt: Label '%1 %2 %3', Locked = true;
        YamlFilterTxt: Label 'Page Scripting recording (*.yml;*.yaml)|*.yml;*.yaml', Locked = true;

    procedure ImportFromFile(var Recording: Record "BAS Recording")
    var
        TextHelper: Codeunit "BAS Text Helper";
        InStr: InStream;
        FileName: Text;
    begin
        Recording.CalcFields("UI Step Count");
        if Recording."UI Step Count" > 0 then
            if not Confirm(ReplaceQst, false, Recording."No.", Recording."UI Step Count") then
                exit;
        if not UploadIntoStream(SelectFileTxt, '', YamlFilterTxt, FileName, InStr) then
            exit;
        Message(ImportedMsg, ImportFromText(Recording, TextHelper.ReadAll(InStr), FileName));
    end;

    /// <summary>Replaces the UI steps of the recording with the steps of the YAML text. Returns the number of steps.</summary>
    procedure ImportFromText(var Recording: Record "BAS Recording"; Yaml: Text; FileName: Text): Integer
    var
        RecordingEvent: Record "BAS Recording Event";
        TextHelper: Codeunit "BAS Text Helper";
        Line: Text;
        Trimmed: Text;
        InSteps: Boolean;
    begin
        RecordingEvent.SetRange("Recording No.", Recording."No.");
        RecordingEvent.SetRange("Event Type", RecordingEvent."Event Type"::"UI Step");
        RecordingEvent.DeleteAll(true);

        RecordingEvent.Reset();
        RecordingEvent.SetRange("Recording No.", Recording."No.");
        NextEntryNo := 0;
        if RecordingEvent.FindLast() then
            NextEntryNo := RecordingEvent."Entry No.";
        StepsImported := 0;
        StepOpen := false;

        foreach Line in TextHelper.SplitLines(Yaml) do begin
            Trimmed := Line.Trim();
            if Trimmed = 'steps:' then
                InSteps := true
            else
                if InSteps and (Trimmed <> '') and not Trimmed.StartsWith('#') then
                    ParseStepLine(Recording."No.", Trimmed);
        end;
        CloseStep(Recording."No.");

        if StepsImported = 0 then
            Error(NoStepsErr);

        Recording.Get(Recording."No.");
        Recording.SetPageScript(Yaml, FileName);
        Recording.Modify(true);
        exit(StepsImported);
    end;

    local procedure ParseStepLine(RecordingNo: Integer; Trimmed: Text)
    begin
        if Trimmed.StartsWith('- type:') then begin
            CloseStep(RecordingNo);
            StepOpen := true;
            CurrentKind := ValueOf(Trimmed, '- type:');
            exit;
        end;
        if not StepOpen then
            exit;
        case true of
            Trimmed.StartsWith('- page:'):
                if CurrentPage = '' then
                    CurrentPage := ValueOf(Trimmed, '- page:');
            Trimmed.StartsWith('- action:'):
                CurrentControl := ValueOf(Trimmed, '- action:');
            Trimmed.StartsWith('- field:'):
                CurrentControl := ValueOf(Trimmed, '- field:');
            Trimmed.StartsWith('- part:'):
                CurrentPart := ValueOf(Trimmed, '- part:');
            Trimmed.StartsWith('value:'):
                CurrentValue := ValueOf(Trimmed, 'value:');
            Trimmed.StartsWith('description:'):
                CurrentDescription := ValueOf(Trimmed, 'description:');
        end;
    end;

    local procedure CloseStep(RecordingNo: Integer)
    var
        RecordingEvent: Record "BAS Recording Event";
        TextHelper: Codeunit "BAS Text Helper";
    begin
        if not StepOpen then
            exit;
        StepOpen := false;

        // Captions in the description are what the user saw on screen; prefer them.
        if TextHelper.TagContent(CurrentDescription, 'caption') <> '' then
            if (CurrentControl = '') or (CurrentKind in ['invoke', 'input', 'validate']) then
                CurrentControl := TextHelper.TagContent(CurrentDescription, 'caption');
        if (CurrentValue = '') and (TextHelper.TagContent(CurrentDescription, 'value') <> '') then
            CurrentValue := TextHelper.TagContent(CurrentDescription, 'value');
        if (CurrentKind = 'navigate') and (CurrentControl <> '') and (CurrentPage = '') then
            CurrentPage := CurrentControl;
        if (CurrentControl = '') and (CurrentPart <> '') then
            CurrentControl := CurrentPart;

        NextEntryNo += 1;
        StepsImported += 1;
        RecordingEvent.Init();
        RecordingEvent."Recording No." := RecordingNo;
        RecordingEvent."Entry No." := NextEntryNo;
        RecordingEvent."Event Type" := RecordingEvent."Event Type"::"UI Step";
        RecordingEvent."Step Kind" := CopyStr(CurrentKind, 1, MaxStrLen(RecordingEvent."Step Kind"));
        RecordingEvent."Page Caption" := CopyStr(CurrentPage, 1, MaxStrLen(RecordingEvent."Page Caption"));
        RecordingEvent."Control Caption" := CopyStr(CurrentControl, 1, MaxStrLen(RecordingEvent."Control Caption"));
        RecordingEvent.Value := CopyStr(CurrentValue, 1, MaxStrLen(RecordingEvent.Value));
        if CurrentPart <> CurrentControl then
            RecordingEvent."Part Caption" := CopyStr(CurrentPart, 1, MaxStrLen(RecordingEvent."Part Caption"));
        RecordingEvent.Description := CopyStr(TextHelper.StripTags(CurrentDescription), 1, MaxStrLen(RecordingEvent.Description));
        if RecordingEvent.Description = '' then
            RecordingEvent.Description := CopyStr(StrSubstNo(FormatTxt, CurrentKind, CurrentControl, CurrentPage).Trim(), 1, MaxStrLen(RecordingEvent.Description));
        RecordingEvent."Origin Kind" := 'UI';
        RecordingEvent.Insert();

        Clear(CurrentKind);
        Clear(CurrentPage);
        Clear(CurrentControl);
        Clear(CurrentValue);
        Clear(CurrentDescription);
        Clear(CurrentPart);
    end;

    local procedure ValueOf(Trimmed: Text; KeyText: Text): Text
    var
        TextHelper: Codeunit "BAS Text Helper";
    begin
        exit(TextHelper.Unquote(CopyStr(Trimmed, StrLen(KeyText) + 1)));
    end;
}
