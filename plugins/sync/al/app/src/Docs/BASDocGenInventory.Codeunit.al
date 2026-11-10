/// <summary>
/// Object inventory (CSV): every object, method and table of the process in one flat list -
/// for impact analysis ("which processes use codeunit 80?"), upgrade planning and test coverage.
/// </summary>
codeunit 50161 "BAS Doc Gen Inventory" implements "BAS IDoc Generator"
{
    Access = Public;

    var
        T: Codeunit "BAS Text Helper";
        DocManager: Codeunit "BAS Doc Manager";

    procedure FileExtension(): Text
    begin
        exit('csv');
    end;

    procedure Generate(Snapshot: Record "BAS Snapshot"; var Content: TextBuilder)
    begin
        T.AppendLine(Content, 'Process,Snapshot,Fingerprint,Fact Type,Object Type,Object ID,Object Name,Method,App,Table ID,Table Name,Inserts,Modifies,Deletes,Renames,Hits,Source,In Fingerprint');
        WriteRows(Snapshot, Enum::"BAS Fact Type"::Object, Content);
        WriteRows(Snapshot, Enum::"BAS Fact Type"::Method, Content);
        WriteRows(Snapshot, Enum::"BAS Fact Type"::"Table Access", Content);
    end;

    local procedure WriteRows(Snapshot: Record "BAS Snapshot"; FactType: Enum "BAS Fact Type"; var Content: TextBuilder)
    var
        Fact: Record "BAS Snapshot Fact";
        Row: TextBuilder;
    begin
        if not DocManager.FindFacts(Fact, Snapshot."No.", FactType) then
            exit;
        repeat
            Row.Clear();
            Row.Append(T.CsvField(Snapshot."Process Name") + ',');
            Row.Append(Format(Snapshot."No.", 0, 9) + ',');
            Row.Append(T.CsvField(Snapshot.Fingerprint) + ',');
            Row.Append(T.CsvField(Format(Fact."Fact Type")) + ',');
            Row.Append(T.CsvField(Fact."Object Type") + ',');
            Row.Append(Format(Fact."Object ID", 0, 9) + ',');
            Row.Append(T.CsvField(Fact."Object Name") + ',');
            Row.Append(T.CsvField(Fact."Method Name") + ',');
            Row.Append(T.CsvField(Fact."App Name") + ',');
            Row.Append(Format(Fact."Table ID", 0, 9) + ',');
            Row.Append(T.CsvField(Fact."Table Name") + ',');
            Row.Append(Format(Fact.Inserts, 0, 9) + ',');
            Row.Append(Format(Fact.Modifies, 0, 9) + ',');
            Row.Append(Format(Fact.Deletes, 0, 9) + ',');
            Row.Append(Format(Fact.Renames, 0, 9) + ',');
            Row.Append(Format(Fact."Hit Count", 0, 9) + ',');
            Row.Append(T.CsvField(Fact.Source) + ',');
            Row.Append(Format(Fact."In Fingerprint", 0, 9));
            T.AppendLine(Content, Row.ToText());
        until Fact.Next() = 0;
    end;
}
