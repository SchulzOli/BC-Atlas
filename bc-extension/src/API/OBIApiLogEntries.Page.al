/// <summary>Read-only: GET .../api/openbridge/interop/v1.0/companies({companyId})/apiLogEntries</summary>
page 50104 "OBI API Log Entries"
{
    PageType = API;
    APIPublisher = 'openbridge';
    APIGroup = 'interop';
    APIVersion = 'v1.0';
    EntityName = 'apiLogEntry';
    EntitySetName = 'apiLogEntries';
    EntityCaption = 'API Log Entry';
    EntitySetCaption = 'API Log Entries';
    SourceTable = "OBI API Log";
    ODataKeyFields = SystemId;
    Editable = false;
    InsertAllowed = false;
    ModifyAllowed = false;
    DeleteAllowed = false;
    DataAccessIntent = ReadOnly;
    Extensible = false;

    layout
    {
        area(Content)
        {
            repeater(Records)
            {
                field(id; Rec.SystemId)
                {
                    Caption = 'Id';
                }
                field(entryNumber; Rec."Entry No.")
                {
                    Caption = 'Entry No.';
                }
                field(entity; Rec.Entity)
                {
                    Caption = 'Entity';
                }
                field(operation; Rec.Operation)
                {
                    Caption = 'Operation';
                }
                field(recordSystemId; Rec."Record System Id")
                {
                    Caption = 'Record System Id';
                }
                field(recordDescription; Rec."Record Description")
                {
                    Caption = 'Record Description';
                }
                field(userId; Rec."User ID")
                {
                    Caption = 'User ID';
                }
                field(clientType; Rec."Client Type")
                {
                    Caption = 'Client Type';
                }
                field(createdDateTime; Rec.SystemCreatedAt)
                {
                    Caption = 'Created Date Time';
                }
            }
        }
    }

    trigger OnOpenPage()
    var
        Control: Codeunit "OBI Control";
    begin
        Control.CheckAccess("OBI Entity"::ApiLog, "OBI Operation"::Read);
    end;
}
