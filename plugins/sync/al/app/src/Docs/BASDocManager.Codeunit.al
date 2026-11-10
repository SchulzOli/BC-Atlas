/// <summary>
/// Generates, stores and downloads the documentation of a snapshot. "All types" means every value
/// of the extensible enum "BAS Doc Type" - types added by other apps are included automatically.
/// </summary>
codeunit 50156 "BAS Doc Manager"
{
    Access = Public;

    var
        GeneratedNoteTxt: Label '> Generated from **Atlas Sync Fact Snapshot %1** (recording %2, fingerprint `%3`) on %4. Do not edit by hand: re-record the process and regenerate.', Comment = '%1 = snapshot, %2 = recording, %3 = fingerprint, %4 = date';
        NoDocumentsErr: Label 'Snapshot %1 has no documents yet.', Comment = '%1 = snapshot number';
        STxt: Label '%1-S%2', Locked = true;
        S2Txt: Label '%1-S%2-%3.%4', Locked = true;

    /// <summary>Generates every registered documentation type. Returns the number of documents.</summary>
    procedure GenerateAll(var Snapshot: Record "BAS Snapshot"): Integer
    var
        DocType: Enum "BAS Doc Type";
        Ordinal: Integer;
        Generated: Integer;
    begin
        foreach Ordinal in Enum::"BAS Doc Type".Ordinals() do begin
            DocType := Enum::"BAS Doc Type".FromInteger(Ordinal);
            Generate(Snapshot, DocType);
            Generated += 1;
        end;
        exit(Generated);
    end;

    procedure Generate(var Snapshot: Record "BAS Snapshot"; DocType: Enum "BAS Doc Type")
    var
        Document: Record "BAS Snapshot Document";
        Generator: Interface "BAS IDoc Generator";
        Content: TextBuilder;
    begin
        Generator := DocType;
        Generator.Generate(Snapshot, Content);

        if not Document.Get(Snapshot."No.", DocType) then begin
            Document.Init();
            Document."Snapshot No." := Snapshot."No.";
            Document."Doc Type" := DocType;
            Document.Insert();
        end;
        Document."File Name" := CopyStr(FileName(Snapshot, DocType, Generator.FileExtension()), 1, MaxStrLen(Document."File Name"));
        Document.SetContent(Content.ToText());
        Document."Generated At" := CurrentDateTime();
        Document.Modify();
    end;

    procedure Download(var Document: Record "BAS Snapshot Document")
    var
        InStr: InStream;
        ToFile: Text;
    begin
        Document.CalcFields(Content);
        Document.Content.CreateInStream(InStr, TextEncoding::UTF8);
        ToFile := Document."File Name";
        DownloadFromStream(InStr, '', '', '', ToFile);
    end;

    /// <summary>Downloads all documents plus the raw recording artefacts as one ZIP file.</summary>
    procedure DownloadAll(var Snapshot: Record "BAS Snapshot")
    var
        Document: Record "BAS Snapshot Document";
        Recording: Record "BAS Recording";
        DataCompression: Codeunit "Data Compression";
        TempBlob: Codeunit "Temp Blob";
        TextHelper: Codeunit "BAS Text Helper";
        InStr: InStream;
        OutStr: OutStream;
        ZipName: Text;
        Prefix: Text;
    begin
        Document.SetRange("Snapshot No.", Snapshot."No.");
        if Document.IsEmpty() then
            Error(NoDocumentsErr, Snapshot."No.");

        Prefix := StrSubstNo(STxt, TextHelper.FileSafe(Snapshot."Process Name"), Snapshot."No.");
        DataCompression.CreateZipArchive();
        if Document.FindSet() then
            repeat
                Document.CalcFields(Content);
                Document.Content.CreateInStream(InStr, TextEncoding::UTF8);
                DataCompression.AddEntry(InStr, Document."File Name");
            until Document.Next() = 0;

        if Recording.Get(Snapshot."Recording No.") then begin
            Recording.CalcFields("Page Script", "Profile Data");
            if Recording."Page Script".HasValue() then begin
                Recording."Page Script".CreateInStream(InStr, TextEncoding::UTF8);
                DataCompression.AddEntry(InStr, 'raw/' + Prefix + '-recording.yml');
            end;
            if Recording."Profile Data".HasValue() then begin
                Recording."Profile Data".CreateInStream(InStr);
                DataCompression.AddEntry(InStr, 'raw/' + Prefix + '.alcpuprofile');
            end;
        end;

        TempBlob.CreateOutStream(OutStr);
        DataCompression.SaveZipArchive(OutStr);
        DataCompression.CloseZipArchive();
        TempBlob.CreateInStream(InStr);
        ZipName := Prefix + '-documentation.zip';
        DownloadFromStream(InStr, '', '', '', ZipName);
    end;

    procedure FileName(Snapshot: Record "BAS Snapshot"; DocType: Enum "BAS Doc Type"; Extension: Text): Text
    var
        TextHelper: Codeunit "BAS Text Helper";
    begin
        exit(StrSubstNo(S2Txt, TextHelper.FileSafe(Snapshot."Process Name"), Snapshot."No.",
            TextHelper.FileSafe(Format(DocType)), Extension));
    end;

    /// <summary>Provenance line placed at the top of every human-readable document.</summary>
    procedure GeneratedNote(Snapshot: Record "BAS Snapshot"): Text
    begin
        exit(StrSubstNo(GeneratedNoteTxt, Snapshot."No.", Snapshot."Recording No.", CopyStr(Snapshot.Fingerprint, 1, 12), Format(Snapshot."Created At", 0, '<Year4>-<Month,2>-<Day,2> <Hours24,2>:<Minutes,2>')));
    end;

    /// <summary>Step number of the fact a step is linked to (UI step to technical step and back), 0 if none.</summary>
    procedure LinkedSequence(Fact: Record "BAS Snapshot Fact"): Integer
    var
        LinkedFact: Record "BAS Snapshot Fact";
    begin
        if Fact."Linked Line No." = 0 then
            exit(0);
        if LinkedFact.Get(Fact."Snapshot No.", Fact."Linked Line No.") then
            exit(LinkedFact.Sequence);
        exit(0);
    end;

    procedure FindFacts(var Fact: Record "BAS Snapshot Fact"; SnapshotNo: Integer; FactType: Enum "BAS Fact Type"): Boolean
    begin
        Fact.Reset();
        case FactType of
            Enum::"BAS Fact Type"::Object, Enum::"BAS Fact Type"::Method:
                Fact.SetCurrentKey("Snapshot No.", "Fact Type", "Object Type", "Object ID", "Method Name");
            Enum::"BAS Fact Type"::"Table Access":
                Fact.SetCurrentKey("Snapshot No.", "Fact Type", "Table ID");
            else
                Fact.SetCurrentKey("Snapshot No.", "Fact Type", Sequence);
        end;
        Fact.SetRange("Snapshot No.", SnapshotNo);
        Fact.SetRange("Fact Type", FactType);
        exit(Fact.FindSet());
    end;
}
