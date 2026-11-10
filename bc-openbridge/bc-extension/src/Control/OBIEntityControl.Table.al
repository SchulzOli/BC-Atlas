/// <summary>
/// One row per data entity: is it exposed at all, and which CRUD operations are allowed.
/// Rows are seeded from the "OBI Entity" enum by "OBI Control".EnsureDefaults().
/// </summary>
table 50101 "OBI Entity Control"
{
    Caption = 'OpenBridge Entity Control';
    DataClassification = SystemMetadata;
    DataPerCompany = true;

    fields
    {
        field(1; Entity; Enum "OBI Entity")
        {
            Caption = 'Entity';
            ToolTip = 'The API entity these settings apply to.';
        }
        field(10; Enabled; Boolean)
        {
            Caption = 'Enabled';
            InitValue = true;
            ToolTip = 'When off, the entity is not reachable through the API at all.';
        }
        field(11; "Allow Read"; Boolean)
        {
            Caption = 'Allow Read';
            ToolTip = 'Allows GET requests. Every request opens the API page, so reading is also required for create, update and delete.';

            trigger OnValidate()
            begin
                if Rec."Allow Read" then
                    TestSupported("OBI Operation"::Read);
            end;
        }
        field(12; "Allow Create"; Boolean)
        {
            Caption = 'Allow Create';
            ToolTip = 'Allows POST requests.';

            trigger OnValidate()
            begin
                if Rec."Allow Create" then
                    TestSupported("OBI Operation"::Create);
            end;
        }
        field(13; "Allow Update"; Boolean)
        {
            Caption = 'Allow Update';
            ToolTip = 'Allows PATCH requests.';

            trigger OnValidate()
            begin
                if Rec."Allow Update" then
                    TestSupported("OBI Operation"::Update);
            end;
        }
        field(14; "Allow Delete"; Boolean)
        {
            Caption = 'Allow Delete';
            ToolTip = 'Allows DELETE requests.';

            trigger OnValidate()
            begin
                if Rec."Allow Delete" then
                    TestSupported("OBI Operation"::Delete);
            end;
        }
    }

    keys
    {
        key(PK; Entity)
        {
            Clustered = true;
        }
    }

    var
        NotSupportedErr: Label 'The entity %1 does not support the operation %2.', Comment = '%1 = entity, %2 = operation';

    /// <summary>Loads the row, or in-memory defaults if it does not exist. Never writes.</summary>
    procedure ReadOrDefault(NewEntity: Enum "OBI Entity")
    begin
        if not Rec.Get(NewEntity) then
            ApplyDefaults(NewEntity);
    end;

    procedure InsertIfNotExists(NewEntity: Enum "OBI Entity")
    begin
        if Rec.Get(NewEntity) then
            exit;
        ApplyDefaults(NewEntity);
        Rec.Insert(true);
    end;

    procedure ResetToDefault()
    begin
        ApplyDefaults(Rec.Entity);
        Rec.Modify(true);
    end;

    procedure IsAllowed(Operation: Enum "OBI Operation"): Boolean
    begin
        case Operation of
            Operation::Read:
                exit(Rec."Allow Read");
            Operation::Create:
                exit(Rec."Allow Create");
            Operation::Update:
                exit(Rec."Allow Update");
            Operation::Delete:
                exit(Rec."Allow Delete");
        end;
        exit(false);
    end;

    local procedure ApplyDefaults(NewEntity: Enum "OBI Entity")
    var
        Control: Codeunit "OBI Control";
        KeepSystemId: Guid;
    begin
        KeepSystemId := Rec.SystemId;
        Rec.Init();
        Rec.SystemId := KeepSystemId;
        Rec.Entity := NewEntity;
        Rec.Enabled := true;
        Rec."Allow Read" := Control.Supports(NewEntity, "OBI Operation"::Read);
        Rec."Allow Create" := Control.Supports(NewEntity, "OBI Operation"::Create);
        Rec."Allow Update" := Control.Supports(NewEntity, "OBI Operation"::Update);
        Rec."Allow Delete" := Control.Supports(NewEntity, "OBI Operation"::Delete);
    end;

    local procedure TestSupported(Operation: Enum "OBI Operation")
    var
        Control: Codeunit "OBI Control";
    begin
        if not Control.Supports(Rec.Entity, Operation) then
            Error(NotSupportedErr, Rec.Entity, Operation);
    end;
}
