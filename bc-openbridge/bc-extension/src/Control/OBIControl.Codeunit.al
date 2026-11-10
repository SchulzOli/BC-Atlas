/// <summary>
/// The gatekeeper. Every API page of this app calls CheckAccess() before it reads or writes,
/// and LogWrite() after a successful write. All control-plane actions (enable/disable,
/// reset, purge) also live here so that the UI pages and the API pages share one implementation.
/// </summary>
codeunit 50100 "OBI Control"
{
    Access = Public;
    Permissions = tabledata "OBI Setup" = rim,
                  tabledata "OBI Entity Control" = rim,
                  tabledata "OBI API Log" = ri;

    var
        AccessDeniedTitleLbl: Label 'OpenBridge API access denied';
        ApiDisabledErr: Label 'The OpenBridge API is disabled in this company.';
        ReadOnlyModeErr: Label 'The OpenBridge API is in read-only mode. %1 is not allowed.', Comment = '%1 = operation';
        NotSupportedErr: Label 'The entity %1 does not support %2.', Comment = '%1 = entity, %2 = operation';
        EntityDisabledErr: Label 'The entity %1 is disabled.', Comment = '%1 = entity';
        OperationDeniedErr: Label '%1 is not allowed for the entity %2.', Comment = '%1 = operation, %2 = entity';
        SetupDescriptionLbl: Label 'API enabled: %1, read-only: %2', Comment = '%1 = yes/no, %2 = yes/no';

    /// <summary>Throws a client error unless the operation on the entity is currently allowed.</summary>
    procedure CheckAccess(Entity: Enum "OBI Entity"; Operation: Enum "OBI Operation")
    var
        Setup: Record "OBI Setup";
        EntityControl: Record "OBI Entity Control";
        IsHandled: Boolean;
    begin
        OnBeforeCheckAccess(Entity, Operation, IsHandled);
        if IsHandled then
            exit;

        // The control plane is protected by permission sets only. It must stay reachable
        // while the API is disabled, otherwise nobody could switch it back on via API.
        if IsControlPlane(Entity) then
            exit;

        Setup.ReadOrDefault();
        if not Setup."API Enabled" then
            if Setup."Disabled Message" <> '' then
                Deny(Setup."Disabled Message")
            else
                Deny(ApiDisabledErr);

        if Setup."Read-Only Mode" and (Operation <> Operation::Read) then
            Deny(StrSubstNo(ReadOnlyModeErr, Operation));

        if not Supports(Entity, Operation) then
            Deny(StrSubstNo(NotSupportedErr, Entity, Operation));

        EntityControl.ReadOrDefault(Entity);
        if not EntityControl.Enabled then
            Deny(StrSubstNo(EntityDisabledErr, Entity));
        if not EntityControl.IsAllowed(Operation) then
            Deny(StrSubstNo(OperationDeniedErr, Operation, Entity));

        OnAfterCheckAccess(Entity, Operation);
    end;

    /// <summary>What an entity can do in principle (independent of the switches).</summary>
    procedure Supports(Entity: Enum "OBI Entity"; Operation: Enum "OBI Operation"): Boolean
    var
        Supported: Boolean;
        IsHandled: Boolean;
    begin
        OnBeforeSupports(Entity, Operation, Supported, IsHandled);
        if IsHandled then
            exit(Supported);

        case Entity of
            Entity::ExternalMapping:
                exit(true);
            Entity::CustomerLedgerEntry,
            Entity::ApiLog:
                exit(Operation = Operation::Read);
            Entity::Setup,
            Entity::EntityControl:
                exit(Operation in [Operation::Read, Operation::Update]);
        end;
        exit(false);
    end;

    procedure IsControlPlane(Entity: Enum "OBI Entity"): Boolean
    begin
        exit(Entity in [Entity::Setup, Entity::EntityControl]);
    end;

    /// <summary>Appends an API log entry if write auditing is on.</summary>
    procedure LogWrite(Entity: Enum "OBI Entity"; Operation: Enum "OBI Operation"; RecordSystemId: Guid; RecordDescription: Text)
    var
        Setup: Record "OBI Setup";
        ApiLog: Record "OBI API Log";
    begin
        Setup.ReadOrDefault();
        if not Setup."Audit Writes" then
            exit;

        ApiLog.Init();
        ApiLog.Entity := Entity;
        ApiLog.Operation := Operation;
        ApiLog."Record System Id" := RecordSystemId;
        ApiLog."Record Description" := CopyStr(RecordDescription, 1, MaxStrLen(ApiLog."Record Description"));
        ApiLog."User ID" := CopyStr(UserId(), 1, MaxStrLen(ApiLog."User ID"));
        ApiLog."Client Type" := CopyStr(Format(CurrentClientType()), 1, MaxStrLen(ApiLog."Client Type"));
        ApiLog.Insert(true);

        OnAfterLogWrite(ApiLog);
    end;

    /// <summary>Creates the setup and one control row per data entity. Safe to run repeatedly.</summary>
    procedure EnsureDefaults()
    var
        Setup: Record "OBI Setup";
        EntityControl: Record "OBI Entity Control";
        Entity: Enum "OBI Entity";
        Ordinal: Integer;
    begin
        Setup.InsertIfNotExists();
        foreach Ordinal in Enum::"OBI Entity".Ordinals() do begin
            Entity := Enum::"OBI Entity".FromInteger(Ordinal);
            if not IsControlPlane(Entity) then
                EntityControl.InsertIfNotExists(Entity);
        end;
    end;

    procedure SetApiEnabled(NewEnabled: Boolean)
    var
        Setup: Record "OBI Setup";
    begin
        Setup.InsertIfNotExists();
        Setup.Validate("API Enabled", NewEnabled);
        Setup.Modify(true);
        LogWrite("OBI Entity"::Setup, "OBI Operation"::Update, Setup.SystemId, DescribeSetup(Setup));
    end;

    procedure ResetEntityControls()
    var
        EntityControl: Record "OBI Entity Control";
    begin
        EnsureDefaults();
        if EntityControl.FindSet(true) then
            repeat
                EntityControl.ResetToDefault();
                LogWrite("OBI Entity"::EntityControl, "OBI Operation"::Update, EntityControl.SystemId, Format(EntityControl.Entity));
            until EntityControl.Next() = 0;
    end;

    procedure DescribeSetup(Setup: Record "OBI Setup"): Text
    begin
        exit(StrSubstNo(SetupDescriptionLbl, Setup."API Enabled", Setup."Read-Only Mode"));
    end;

    local procedure Deny(Message: Text)
    var
        DeniedError: ErrorInfo;
    begin
        DeniedError := ErrorInfo.Create(Message);
        DeniedError.Title := AccessDeniedTitleLbl;
        DeniedError.ErrorType := ErrorType::Client;
        DeniedError.Verbosity := Verbosity::Warning;
        DeniedError.DataClassification := DataClassification::SystemMetadata;
        Error(DeniedError);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"Company-Initialize", 'OnCompanyInitialize', '', false, false)]
    local procedure HandleCompanyInitialize()
    begin
        EnsureDefaults();
    end;

    /// <summary>Replace or extend the access check, e.g. to restrict an entity to certain users.</summary>
    [IntegrationEvent(false, false)]
    local procedure OnBeforeCheckAccess(Entity: Enum "OBI Entity"; Operation: Enum "OBI Operation"; var IsHandled: Boolean)
    begin
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterCheckAccess(Entity: Enum "OBI Entity"; Operation: Enum "OBI Operation")
    begin
    end;

    /// <summary>Declare the supported operations of entities added by enum extensions.</summary>
    [IntegrationEvent(false, false)]
    local procedure OnBeforeSupports(Entity: Enum "OBI Entity"; Operation: Enum "OBI Operation"; var Supported: Boolean; var IsHandled: Boolean)
    begin
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterLogWrite(var ApiLog: Record "OBI API Log")
    begin
    end;
}
