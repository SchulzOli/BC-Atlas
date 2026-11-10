/// <summary>
/// Sequence diagram (Mermaid, .mmd): per technical step the call chain from the user through the
/// objects of the deepest call stack, followed by the writes each object made to each table.
/// Render it with any Mermaid viewer (GitHub, Azure DevOps wiki, VS Code, mermaid.live).
/// </summary>
codeunit 50160 "BAS Doc Gen Sequence" implements "BAS IDoc Generator"
{
    Access = Public;

    var
        T: Codeunit "BAS Text Helper";
        DocManager: Codeunit "BAS Doc Manager";
        ParticipantLabels: Dictionary of [Text, Text];
        ParticipantOrder: List of [Text];
        Messages: TextBuilder;
        ArrowsInStep: Integer;
        MaxArrowsPerStep: Integer;
        NoteOverUserStepTxt: Label '    Note over User: Step %1 - %2', Locked = true;
        SequenceDiagramTxt: Label ' %1 - sequence diagram', Locked = true;
        GeneratedFromAtlasSyncFactTxt: Label ' Generated from Atlas Sync Fact Snapshot %1, fingerprint %2', Locked = true;
        ParticipantAsTxt: Label '    participant %1 as %2', Locked = true;
        FormatTxt: Label '%1#%2#%3', Locked = true;
        XTxt: Label '%1 x%2', Locked = true;
        Format2Txt: Label '    %1->>%2: %3', Locked = true;
        Format3Txt: Label '%1 %2 %3', Locked = true;
        MermaidCommentTxt: Label '%%', Locked = true;

    procedure FileExtension(): Text
    begin
        exit('mmd');
    end;

    procedure Generate(Snapshot: Record "BAS Snapshot"; var Content: TextBuilder)
    var
        Fact: Record "BAS Snapshot Fact";
        Alias: Text;
    begin
        Clear(ParticipantLabels);
        Clear(ParticipantOrder);
        Messages.Clear();
        MaxArrowsPerStep := 40;

        if DocManager.FindFacts(Fact, Snapshot."No.", Enum::"BAS Fact Type"::"Technical Step") then
            repeat
                ArrowsInStep := 0;
                T.AppendLine(Messages, StrSubstNo(NoteOverUserStepTxt, Fact.Sequence, T.MermaidLabel(T.Truncate(Fact.Description, 70))));
                if Fact."Step Kind" <> 'Marker' then begin
                    WriteCallChain(Snapshot."Recording No.", Fact);
                    WriteWrites(Snapshot."Recording No.", Fact);
                end;
            until Fact.Next() = 0;

        // Mermaid comments start with two percent signs; kept outside StrSubstNo on purpose.
        T.AppendLine(Content, MermaidCommentTxt + StrSubstNo(SequenceDiagramTxt, T.MermaidLabel(Snapshot."Process Name")));
        T.AppendLine(Content, MermaidCommentTxt + StrSubstNo(GeneratedFromAtlasSyncFactTxt, Snapshot."No.", Snapshot.Fingerprint));
        T.AppendLine(Content, 'sequenceDiagram');
        T.AppendLine(Content, '    actor User');
        foreach Alias in ParticipantOrder do
            T.AppendLine(Content, StrSubstNo(ParticipantAsTxt, Alias, ParticipantLabels.Get(Alias)));
        Content.Append(Messages.ToText());
    end;

    local procedure WriteCallChain(RecordingNo: Integer; Fact: Record "BAS Snapshot Fact")
    var
        CallFrame: Record "BAS Call Frame";
        PreviousAlias: Text;
        Alias: Text;
        FirstLabel: Text;
    begin
        PreviousAlias := 'User';
        FirstLabel := Fact.Subject;
        if FirstLabel = '' then
            FirstLabel := Fact."Method Name";

        CallFrame.SetRange("Recording No.", RecordingNo);
        CallFrame.SetRange(Source, CallFrame.Source::"Call Stack");
        CallFrame.SetRange("Event Entry No.", Fact."Deepest Event Entry No.");
        if not CallFrame.Find('+') then begin
            if Fact."Step Kind" = 'Page Autosave' then
                Arrow('User', ClientAlias(), 'edit ' + Fact.Subject);
            exit;
        end;
        repeat
            Alias := ObjectAlias(CallFrame."Object Type", CallFrame."Object ID", CallFrame."Object Name");
            if Alias <> PreviousAlias then begin
                if PreviousAlias = 'User' then
                    Arrow(PreviousAlias, Alias, FirstLabel)
                else
                    Arrow(PreviousAlias, Alias, CallFrame."Method Name");
                PreviousAlias := Alias;
            end;
        until CallFrame.Next(-1) = 0;
    end;

    local procedure WriteWrites(RecordingNo: Integer; Fact: Record "BAS Snapshot Fact")
    var
        RecordingEvent: Record "BAS Recording Event";
        Counts: Dictionary of [Text, Integer];
        Order: List of [Text];
        Parts: List of [Text];
        Separator: List of [Text];
        KeyText: Text;
        WriterAlias: Text;
        Counter: Integer;
    begin
        RecordingEvent.SetRange("Recording No.", RecordingNo);
        RecordingEvent.SetRange("Entry No.", Fact."First Event Entry No.", Fact."Last Event Entry No.");
        RecordingEvent.SetFilter("Event Type", '%1|%2|%3|%4', RecordingEvent."Event Type"::Insert, RecordingEvent."Event Type"::Modify,
            RecordingEvent."Event Type"::Delete, RecordingEvent."Event Type"::Rename);
        if RecordingEvent.FindSet() then
            repeat
                if RecordingEvent."Leaf Object Type" = '' then
                    WriterAlias := ClientAlias()
                else
                    WriterAlias := ObjectAlias(RecordingEvent."Leaf Object Type", RecordingEvent."Leaf Object ID", RecordingEvent."Leaf Object Name");
                KeyText := StrSubstNo(FormatTxt, WriterAlias, ObjectAlias('Table', RecordingEvent."Table ID", RecordingEvent."Table Name"), LowerCase(Format(RecordingEvent."Event Type")));
                if not Counts.Get(KeyText, Counter) then begin
                    Counter := 0;
                    Order.Add(KeyText);
                end;
                Counts.Set(KeyText, Counter + 1);
            until RecordingEvent.Next() = 0;

        Separator.Add('#');
        foreach KeyText in Order do begin
            Parts := KeyText.Split(Separator);
            Arrow(Parts.Get(1), Parts.Get(2), StrSubstNo(XTxt, Parts.Get(3), Counts.Get(KeyText)));
        end;
    end;

    local procedure Arrow(FromAlias: Text; ToAlias: Text; MessageText: Text)
    begin
        ArrowsInStep += 1;
        if ArrowsInStep > MaxArrowsPerStep then begin
            if ArrowsInStep = MaxArrowsPerStep + 1 then
                T.AppendLine(Messages, '    Note over User: more calls omitted - see the technical documentation');
            exit;
        end;
        MessageText := T.MermaidLabel(T.Truncate(MessageText, 60));
        if MessageText = '' then
            MessageText := 'call';
        T.AppendLine(Messages, StrSubstNo(Format2Txt, FromAlias, ToAlias, MessageText));
    end;

    local procedure ObjectAlias(ObjectType: Text; ObjectId: Integer; ObjectName: Text): Text
    var
        Alias: Text;
        Prefix: Text;
    begin
        case ObjectType of
            'Codeunit':
                Prefix := 'CU';
            'Page':
                Prefix := 'PG';
            'PageExtension':
                Prefix := 'PX';
            'Table':
                Prefix := 'TB';
            'TableExtension':
                Prefix := 'TX';
            'Report':
                Prefix := 'RP';
            'ReportExtension':
                Prefix := 'RX';
            'XmlPort':
                Prefix := 'XP';
            'Query':
                Prefix := 'QY';
            else
                Prefix := 'OB';
        end;
        Alias := Prefix + Format(ObjectId, 0, 9);
        if not ParticipantLabels.ContainsKey(Alias) then begin
            ParticipantLabels.Add(Alias, T.MermaidLabel(StrSubstNo(Format3Txt, ObjectType, ObjectId, ObjectName)));
            ParticipantOrder.Add(Alias);
        end;
        exit(Alias);
    end;

    local procedure ClientAlias(): Text
    begin
        if not ParticipantLabels.ContainsKey('Client') then begin
            ParticipantLabels.Add('Client', 'Web client page');
            ParticipantOrder.Add('Client');
        end;
        exit('Client');
    end;
}
