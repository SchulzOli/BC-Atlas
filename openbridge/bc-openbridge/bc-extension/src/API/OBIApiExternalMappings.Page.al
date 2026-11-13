/// <summary>
/// Full CRUD: GET/POST/PATCH/DELETE
/// .../api/openbridge/interop/v1.0/companies({companyId})/externalMappings({id})
/// Every operation is checked against the control plane and every write is audited.
/// </summary>
page 50102 "OBI API External Mappings"
{
    PageType = API;
    APIPublisher = 'openbridge';
    APIGroup = 'interop';
    APIVersion = 'v1.0';
    EntityName = 'externalMapping';
    EntitySetName = 'externalMappings';
    EntityCaption = 'External Mapping';
    EntitySetCaption = 'External Mappings';
    SourceTable = "OBI External Mapping";
    ODataKeyFields = SystemId;
    DelayedInsert = true;
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
                    Editable = false;
                }
                field(sourceSystem; Rec."Source System")
                {
                    Caption = 'Source System';
                }
                field(externalId; Rec."External Id")
                {
                    Caption = 'External Id';
                }
                field(entitySet; Rec."Entity Set")
                {
                    Caption = 'Entity Set';
                }
                field(bcSystemId; Rec."BC System Id")
                {
                    Caption = 'BC System Id';
                }
                field(description; Rec.Description)
                {
                    Caption = 'Description';
                }
                field(syncStatus; Rec."Sync Status")
                {
                    Caption = 'Sync Status';
                }
                field(lastSyncedAt; Rec."Last Synced At")
                {
                    Caption = 'Last Synced At';
                }
                field(lastError; Rec."Last Error")
                {
                    Caption = 'Last Error';
                }
                field(lastModifiedDateTime; Rec.SystemModifiedAt)
                {
                    Caption = 'Last Modified Date Time';
                    Editable = false;
                }
            }
        }
    }

    var
        Control: Codeunit "OBI Control";

    trigger OnOpenPage()
    begin
        Control.CheckAccess("OBI Entity"::ExternalMapping, "OBI Operation"::Read);
    end;

    trigger OnInsertRecord(BelowxRec: Boolean): Boolean
    begin
        Control.CheckAccess("OBI Entity"::ExternalMapping, "OBI Operation"::Create);
        Rec.Insert(true);
        Control.LogWrite("OBI Entity"::ExternalMapping, "OBI Operation"::Create, Rec.SystemId, Rec.AuditDescription());
        exit(false);
    end;

    trigger OnModifyRecord(): Boolean
    begin
        Control.CheckAccess("OBI Entity"::ExternalMapping, "OBI Operation"::Update);
        Rec.Modify(true);
        Control.LogWrite("OBI Entity"::ExternalMapping, "OBI Operation"::Update, Rec.SystemId, Rec.AuditDescription());
        exit(false);
    end;

    trigger OnDeleteRecord(): Boolean
    begin
        Control.CheckAccess("OBI Entity"::ExternalMapping, "OBI Operation"::Delete);
        Control.LogWrite("OBI Entity"::ExternalMapping, "OBI Operation"::Delete, Rec.SystemId, Rec.AuditDescription());
        Rec.Delete(true);
        exit(false);
    end;
}
