/// <summary>
/// Control plane: GET/PATCH .../api/openbridge/interop/v1.0/companies({companyId})/entityControls({id})
/// One row per data entity; switch the entity on/off and allow/deny each CRUD operation.
/// Bound action: POST .../entityControls({id})/Microsoft.NAV.resetToDefault
/// Requires the OBI ADMIN permission set.
/// </summary>
page 50101 "OBI API Entity Controls"
{
    PageType = API;
    APIPublisher = 'openbridge';
    APIGroup = 'interop';
    APIVersion = 'v1.0';
    EntityName = 'entityControl';
    EntitySetName = 'entityControls';
    EntityCaption = 'Entity Control';
    EntitySetCaption = 'Entity Controls';
    SourceTable = "OBI Entity Control";
    ODataKeyFields = SystemId;
    InsertAllowed = false;
    DeleteAllowed = false;
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
                field(entity; Rec.Entity)
                {
                    Caption = 'Entity';
                    Editable = false;
                }
                field(enabled; Rec.Enabled)
                {
                    Caption = 'Enabled';
                }
                field(allowRead; Rec."Allow Read")
                {
                    Caption = 'Allow Read';
                }
                field(allowCreate; Rec."Allow Create")
                {
                    Caption = 'Allow Create';
                }
                field(allowUpdate; Rec."Allow Update")
                {
                    Caption = 'Allow Update';
                }
                field(allowDelete; Rec."Allow Delete")
                {
                    Caption = 'Allow Delete';
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
        Control.CheckAccess("OBI Entity"::EntityControl, "OBI Operation"::Read);
    end;

    trigger OnModifyRecord(): Boolean
    begin
        Control.CheckAccess("OBI Entity"::EntityControl, "OBI Operation"::Update);
        Rec.Modify(true);
        Control.LogWrite("OBI Entity"::EntityControl, "OBI Operation"::Update, Rec.SystemId, Format(Rec.Entity));
        exit(false);
    end;

    [ServiceEnabled]
    [Scope('Cloud')]
    procedure resetToDefault(var ActionContext: WebServiceActionContext)
    begin
        Rec.ResetToDefault();
        Control.LogWrite("OBI Entity"::EntityControl, "OBI Operation"::Update, Rec.SystemId, Format(Rec.Entity));
        ActionContext.SetObjectType(ObjectType::Page);
        ActionContext.SetObjectId(Page::"OBI API Entity Controls");
        ActionContext.AddEntityKey(Rec.FieldNo(SystemId), Rec.SystemId);
        ActionContext.SetResultCode(WebServiceActionResultCode::Updated);
    end;
}
