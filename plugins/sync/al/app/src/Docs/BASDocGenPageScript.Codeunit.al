/// <summary>
/// Page Script (YAML): a replayable UI test of the process. If the recording has an imported
/// Page Scripting file it is returned as recorded (replay it with the Page Scripting tool or
/// bc-replay in a pipeline). Otherwise a skeleton is derived from the technical steps.
/// </summary>
codeunit 50162 "BAS Doc Gen Page Script" implements "BAS IDoc Generator"
{
    Access = Public;

    var
        T: Codeunit "BAS Text Helper";
        DocManager: Codeunit "BAS Doc Manager";
        AtlasSyncFactSnapshotTxt: Label '# Atlas Sync Fact Snapshot %1 - %2', Locked = true;
        FingerprintTxt: Label '# Fingerprint: %1', Locked = true;
        GeneratedFromAtlasSyncFactTxt: Label 'Generated from Atlas Sync Fact Snapshot %1', Locked = true;
        InvokeTxt: Label 'Invoke %1', Locked = true;
        InputIntoTxt: Label 'Input into %1', Locked = true;

    procedure FileExtension(): Text
    begin
        exit('yml');
    end;

    procedure Generate(Snapshot: Record "BAS Snapshot"; var Content: TextBuilder)
    var
        Recording: Record "BAS Recording";
        Yaml: Text;
    begin
        if Recording.Get(Snapshot."Recording No.") then
            Yaml := Recording.GetPageScript();

        T.AppendLine(Content, StrSubstNo(AtlasSyncFactSnapshotTxt, Snapshot."No.", Snapshot."Process Name"));
        T.AppendLine(Content, StrSubstNo(FingerprintTxt, Snapshot.Fingerprint));
        if Yaml <> '' then begin
            T.AppendLine(Content, '# Original Page Scripting recording. Replay it with the Page Scripting tool or bc-replay.');
            Content.Append(Yaml);
            exit;
        end;

        T.AppendLine(Content, '# SKELETON derived from the call stacks - no Page Scripting recording was imported.');
        T.AppendLine(Content, '# Captions may differ from the object names below; open it in the Page Scripting tool and adjust before replaying.');
        T.AppendLine(Content, 'name: ' + T.YamlString(Snapshot."Process Name"));
        T.AppendLine(Content, 'description: ' + T.YamlString(StrSubstNo(GeneratedFromAtlasSyncFactTxt, Snapshot."No.")));
        T.AppendLine(Content, 'steps:');
        WriteSkeletonSteps(Snapshot, Content);
    end;

    local procedure WriteSkeletonSteps(Snapshot: Record "BAS Snapshot"; var Content: TextBuilder)
    var
        Fact: Record "BAS Snapshot Fact";
        LastPage: Text;
    begin
        if not DocManager.FindFacts(Fact, Snapshot."No.", Enum::"BAS Fact Type"::"Technical Step") then
            exit;
        repeat
            if Fact."Page Caption" <> '' then
                LastPage := Fact."Page Caption";
            case Fact."Step Kind" of
                'Action':
                    begin
                        T.AppendLine(Content, '  - type: invoke');
                        T.AppendLine(Content, '    target:');
                        T.AppendLine(Content, '      - page: ' + T.YamlString(Fact."Object Name"));
                        T.AppendLine(Content, '      - action: ' + T.YamlString(Fact.Subject));
                        T.AppendLine(Content, '    description: ' + T.YamlString(StrSubstNo(InvokeTxt, Fact.Subject)));
                    end;
                'Field Validation':
                    begin
                        T.AppendLine(Content, '  - type: input');
                        T.AppendLine(Content, '    target:');
                        if LastPage <> '' then
                            T.AppendLine(Content, '      - page: ' + T.YamlString(LastPage));
                        T.AppendLine(Content, '      - field: ' + T.YamlString(Fact.Subject));
                        T.AppendLine(Content, '    value: ""  # TODO: value used in the recording');
                        T.AppendLine(Content, '    description: ' + T.YamlString(StrSubstNo(InputIntoTxt, Fact.Subject)));
                    end;
                else
                    T.AppendLine(Content, '  # ' + T.Truncate(Fact.Description, 200).Replace(T.Lf(), ' '));
            end;
        until Fact.Next() = 0;
    end;
}
