/// <summary>
/// Control plane: GET/PATCH .../api/openbridge/interop/v1.0/companies({companyId})/setup({id})
/// Bound actions (POST .../setup({id})/Microsoft.NAV.&lt;name&gt;):
///   enableApi, disableApi, resetEntityControls, purgeApiLog
/// Requires the OBI ADMIN permission set; never gated by the API switch itself.
/// </summary>
page 50100 "OBI API Setup"
{
    PageType = API;
    APIPublisher = 'openbridge';
    APIGroup = 'interop';
    APIVersion = 'v1.0';
    EntityName = 'setup';
    EntitySetName = 'setup';
    EntityCaption = 'Setup';
    EntitySetCaption = 'Setup';
    SourceTable = "OBI Setup";
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
                field(apiEnabled; Rec."API Enabled")
                {
                    Caption = 'API Enabled';
                }
                field(readOnlyMode; Rec."Read-Only Mode")
                {
                    Caption = 'Read-Only Mode';
                }
                field(auditWrites; Rec."Audit Writes")
                {
                    Caption = 'Audit Writes';
                }
                field(logRetentionDays; Rec."Log Retention Days")
                {
                    Caption = 'Log Retention Days';
                }
                field(defaultSourceSystem; Rec."Default Source System")
                {
                    Caption = 'Default Source System';
                }
                field(disabledMessage; Rec."Disabled Message")
                {
                    Caption = 'Disabled Message';
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
        Control.CheckAccess("OBI Entity"::Setup, "OBI Operation"::Read);
    end;

    trigger OnModifyRecord(): Boolean
    begin
        Control.CheckAccess("OBI Entity"::Setup, "OBI Operation"::Update);
        Rec.Modify(true);
        Control.LogWrite("OBI Entity"::Setup, "OBI Operation"::Update, Rec.SystemId, Control.DescribeSetup(Rec));
        exit(false);
    end;

    [ServiceEnabled]
    [Scope('Cloud')]
    procedure enableApi(var ActionContext: WebServiceActionContext)
    begin
        Control.SetApiEnabled(true);
        SetResponse(ActionContext);
    end;

    [ServiceEnabled]
    [Scope('Cloud')]
    procedure disableApi(var ActionContext: WebServiceActionContext)
    begin
        Control.SetApiEnabled(false);
        SetResponse(ActionContext);
    end;

    [ServiceEnabled]
    [Scope('Cloud')]
    procedure resetEntityControls(var ActionContext: WebServiceActionContext)
    begin
        Control.ResetEntityControls();
        SetResponse(ActionContext);
    end;

    [ServiceEnabled]
    [Scope('Cloud')]
    procedure purgeApiLog(var ActionContext: WebServiceActionContext)
    var
        PurgeLog: Codeunit "OBI Purge Log";
    begin
        PurgeLog.Purge();
        SetResponse(ActionContext);
    end;

    local procedure SetResponse(var ActionContext: WebServiceActionContext)
    begin
        Rec.Get();
        ActionContext.SetObjectType(ObjectType::Page);
        ActionContext.SetObjectId(Page::"OBI API Setup");
        ActionContext.AddEntityKey(Rec.FieldNo(SystemId), Rec.SystemId);
        ActionContext.SetResultCode(WebServiceActionResultCode::Updated);
    end;
}
