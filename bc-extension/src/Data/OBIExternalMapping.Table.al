/// <summary>
/// Maps an id in an external system (shop, CRM, PIM, ...) to a Business Central record.
/// "Entity Set" uses the gateway's entity names (customers, items, salesOrders, ...),
/// "BC System Id" is the record's SystemId = the id in the BC API URL.
/// </summary>
table 50103 "OBI External Mapping"
{
    Caption = 'OpenBridge External ID Mapping';
    DataClassification = CustomerContent;
    DataPerCompany = true;
    LookupPageId = "OBI External Mappings";
    DrillDownPageId = "OBI External Mappings";

    fields
    {
        field(1; "Entry No."; BigInteger)
        {
            Caption = 'Entry No.';
            AutoIncrement = true;
            DataClassification = SystemMetadata;
            ToolTip = 'Sequential number of the mapping.';
        }
        field(10; "Source System"; Code[20])
        {
            Caption = 'Source System';
            ToolTip = 'The external system the id comes from, e.g. SHOPIFY or SALESFORCE.';
        }
        field(11; "External Id"; Text[250])
        {
            Caption = 'External Id';
            ToolTip = 'The id of the record in the external system.';
        }
        field(12; "Entity Set"; Text[50])
        {
            Caption = 'Entity Set';
            ToolTip = 'The API entity set of the Business Central record, e.g. customers, items or salesOrders.';
        }
        field(13; "BC System Id"; Guid)
        {
            Caption = 'BC System Id';
            ToolTip = 'The id of the Business Central record as used in the API URL.';
        }
        field(14; Description; Text[100])
        {
            Caption = 'Description';
            ToolTip = 'Free text describing the mapping.';
        }
        field(15; "Sync Status"; Enum "OBI Sync Status")
        {
            Caption = 'Sync Status';
            DataClassification = SystemMetadata;
            ToolTip = 'The result of the last synchronisation.';

            trigger OnValidate()
            begin
                if Rec."Sync Status" = Rec."Sync Status"::Synced then begin
                    Rec."Last Synced At" := CurrentDateTime();
                    Rec."Last Error" := '';
                end;
            end;
        }
        field(16; "Last Synced At"; DateTime)
        {
            Caption = 'Last Synced At';
            DataClassification = SystemMetadata;
            ToolTip = 'When the record was last synchronised successfully.';
        }
        field(17; "Last Error"; Text[250])
        {
            Caption = 'Last Error';
            ToolTip = 'The error of the last failed synchronisation.';
        }
    }

    keys
    {
        key(PK; "Entry No.")
        {
            Clustered = true;
        }
        key(ExternalKey; "Source System", "Entity Set", "External Id")
        {
            Unique = true;
        }
        key(BcRecord; "Entity Set", "BC System Id")
        {
        }
    }

    var
        DuplicateErr: Label 'A mapping for %1 / %2 / %3 already exists.', Comment = '%1 = source system, %2 = entity set, %3 = external id';
        AuditDescriptionLbl: Label '%1/%2/%3', Locked = true;

    trigger OnInsert()
    var
        Setup: Record "OBI Setup";
    begin
        if Rec."Source System" = '' then begin
            Setup.ReadOrDefault();
            Rec."Source System" := Setup."Default Source System";
        end;
        Rec.TestField("Source System");
        Rec.TestField("External Id");
        Rec.TestField("Entity Set");
        TestUnique();
    end;

    trigger OnModify()
    begin
        Rec.TestField("Source System");
        Rec.TestField("External Id");
        Rec.TestField("Entity Set");
        TestUnique();
    end;

    procedure AuditDescription(): Text
    begin
        exit(StrSubstNo(AuditDescriptionLbl, Rec."Source System", Rec."Entity Set", Rec."External Id"));
    end;

    local procedure TestUnique()
    var
        Other: Record "OBI External Mapping";
    begin
        Other.SetRange("Source System", Rec."Source System");
        Other.SetRange("Entity Set", Rec."Entity Set");
        Other.SetRange("External Id", Rec."External Id");
        Other.SetFilter("Entry No.", '<>%1', Rec."Entry No.");
        if not Other.IsEmpty() then
            Error(DuplicateErr, Rec."Source System", Rec."Entity Set", Rec."External Id");
    end;
}
