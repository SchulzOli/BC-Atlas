/// <summary>
/// Hooks the global database triggers. The platform asks once per table and session whether the
/// global triggers are needed; while the recorder is armed every tracked table answers yes.
/// The write handlers return immediately unless a recording runs in the current session.
/// </summary>
codeunit 50151 "BAS Recorder Subscribers"
{
    Access = Internal;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::GlobalTriggerManagement, 'OnAfterGetDatabaseTableTriggerSetup', '', false, false)]
    local procedure OnAfterGetDatabaseTableTriggerSetup(TableId: Integer; var OnDatabaseInsert: Boolean; var OnDatabaseModify: Boolean; var OnDatabaseDelete: Boolean; var OnDatabaseRename: Boolean)
    var
        Recorder: Codeunit "BAS Recorder";
    begin
        if not Recorder.IsRecorderArmed() then
            exit;
        if not Recorder.IsTableTracked(TableId) then
            exit;
        // Only ever switch on - other features (e.g. Change Log) may rely on these flags.
        OnDatabaseInsert := true;
        OnDatabaseModify := true;
        OnDatabaseDelete := true;
        OnDatabaseRename := true;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::GlobalTriggerManagement, 'OnAfterOnDatabaseInsert', '', false, false)]
    local procedure OnAfterOnDatabaseInsert(RecRef: RecordRef)
    var
        Recorder: Codeunit "BAS Recorder";
    begin
        if Recorder.IsRecording() then
            Recorder.LogDatabaseWrite(Enum::"BAS Event Type"::Insert, RecRef);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::GlobalTriggerManagement, 'OnAfterOnDatabaseModify', '', false, false)]
    local procedure OnAfterOnDatabaseModify(RecRef: RecordRef)
    var
        Recorder: Codeunit "BAS Recorder";
    begin
        if Recorder.IsRecording() then
            Recorder.LogDatabaseWrite(Enum::"BAS Event Type"::Modify, RecRef);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::GlobalTriggerManagement, 'OnAfterOnDatabaseDelete', '', false, false)]
    local procedure OnAfterOnDatabaseDelete(RecRef: RecordRef)
    var
        Recorder: Codeunit "BAS Recorder";
    begin
        if Recorder.IsRecording() then
            Recorder.LogDatabaseWrite(Enum::"BAS Event Type"::Delete, RecRef);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::GlobalTriggerManagement, 'OnAfterOnDatabaseRename', '', false, false)]
    local procedure OnAfterOnDatabaseRename(RecRef: RecordRef; xRecRef: RecordRef)
    var
        Recorder: Codeunit "BAS Recorder";
    begin
        if Recorder.IsRecording() then
            Recorder.LogDatabaseWrite(Enum::"BAS Event Type"::Rename, RecRef);
    end;
}
