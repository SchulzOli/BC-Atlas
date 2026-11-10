/// <summary>
/// Atlas Sync Fact Snapshot: the condensed, fingerprinted set of facts about one recorded process.
/// Every documentation type is generated from these facts only, so all documents of a snapshot
/// describe exactly the same technical state. The fingerprint changes when the code path or the
/// data footprint of the process changes (drift).
/// </summary>
table 50154 "BAS Snapshot"
{
    Caption = 'Atlas Sync Fact Snapshot';
    DataClassification = CustomerContent;
    DrillDownPageId = "BAS Snapshots";
    LookupPageId = "BAS Snapshots";

    fields
    {
        field(1; "No."; Integer)
        {
            Caption = 'No.';
            AutoIncrement = true;
            Editable = false;
            ToolTip = 'Number of the snapshot.';
        }
        field(2; "Recording No."; Integer)
        {
            Caption = 'Recording No.';
            TableRelation = "BAS Recording";
            Editable = false;
            ToolTip = 'Recording the snapshot was built from.';
        }
        field(3; "Process Name"; Text[100])
        {
            Caption = 'Process Name';
            ToolTip = 'Name of the documented process.';
        }
        field(4; Description; Text[2048])
        {
            Caption = 'Description';
            ToolTip = 'Purpose and scope of the process.';
        }
        field(12; Feature; Text[100])
        {
            Caption = 'Feature (Use Case)';
            ToolTip = 'Use case the process belongs to; the top layer of the layered documentation.';
        }
        field(5; "Created At"; DateTime)
        {
            Caption = 'Created At';
            Editable = false;
            ToolTip = 'When the snapshot was built.';
        }
        field(6; "Created By"; Code[50])
        {
            Caption = 'Created By';
            DataClassification = EndUserIdentifiableInformation;
            Editable = false;
            ToolTip = 'User who built the snapshot.';
        }
        field(7; "Recorded By"; Code[50])
        {
            Caption = 'Recorded By';
            DataClassification = EndUserIdentifiableInformation;
            Editable = false;
            ToolTip = 'User who performed the recorded process.';
        }
        field(8; "Recorded At"; DateTime)
        {
            Caption = 'Recorded At';
            Editable = false;
            ToolTip = 'When the process was recorded.';
        }
        field(9; "Duration (ms)"; BigInteger)
        {
            Caption = 'Duration (ms)';
            Editable = false;
            ToolTip = 'Length of the recording in milliseconds.';
        }
        field(10; "Company Name"; Text[30])
        {
            Caption = 'Company Name';
            Editable = false;
            ToolTip = 'Company in which the process was recorded.';
        }
        field(11; "Platform Version"; Text[50])
        {
            Caption = 'Application Version';
            DataClassification = SystemMetadata;
            Editable = false;
            ToolTip = 'Base Application version at the time of the snapshot.';
        }
        field(20; Fingerprint; Text[100])
        {
            Caption = 'Fingerprint';
            DataClassification = SystemMetadata;
            Editable = false;
            ToolTip = 'SHA-256 over the exact code path (objects and methods from call stacks) and the data footprint (tables and kinds of writes). Equal fingerprints mean the process runs the same way.';
        }
        field(21; "Previous Snapshot No."; Integer)
        {
            Caption = 'Previous Snapshot No.';
            TableRelation = "BAS Snapshot";
            Editable = false;
            ToolTip = 'Latest earlier snapshot of the same process that this one was compared with.';
        }
        field(22; "Drift Detected"; Boolean)
        {
            Caption = 'Drift Detected';
            Editable = false;
            ToolTip = 'The fingerprint differs from the previous snapshot of the same process: the documentation of the previous snapshot is outdated.';
        }
        field(30; "UI Steps"; Integer)
        {
            Caption = 'UI Steps';
            FieldClass = FlowField;
            CalcFormula = count("BAS Snapshot Fact" where("Snapshot No." = field("No."), "Fact Type" = const("UI Step")));
            Editable = false;
            ToolTip = 'Number of user interactions.';
        }
        field(31; "Technical Steps"; Integer)
        {
            Caption = 'Technical Steps';
            FieldClass = FlowField;
            CalcFormula = count("BAS Snapshot Fact" where("Snapshot No." = field("No."), "Fact Type" = const("Technical Step")));
            Editable = false;
            ToolTip = 'Number of steps derived from the call stacks (one per triggered action, validation or autosave).';
        }
        field(32; Objects; Integer)
        {
            Caption = 'Objects';
            FieldClass = FlowField;
            CalcFormula = count("BAS Snapshot Fact" where("Snapshot No." = field("No."), "Fact Type" = const(Object)));
            Editable = false;
            ToolTip = 'Number of distinct AL objects involved.';
        }
        field(33; Methods; Integer)
        {
            Caption = 'Methods';
            FieldClass = FlowField;
            CalcFormula = count("BAS Snapshot Fact" where("Snapshot No." = field("No."), "Fact Type" = const(Method)));
            Editable = false;
            ToolTip = 'Number of distinct methods and triggers involved.';
        }
        field(34; Tables; Integer)
        {
            Caption = 'Tables Written';
            FieldClass = FlowField;
            CalcFormula = count("BAS Snapshot Fact" where("Snapshot No." = field("No."), "Fact Type" = const("Table Access")));
            Editable = false;
            ToolTip = 'Number of distinct tables written.';
        }
        field(35; "Drift Facts"; Integer)
        {
            Caption = 'Drift Facts';
            FieldClass = FlowField;
            CalcFormula = count("BAS Snapshot Fact" where("Snapshot No." = field("No."), "Fact Type" = filter("Drift Added" | "Drift Removed")));
            Editable = false;
            ToolTip = 'Number of methods or tables added or removed compared with the previous snapshot.';
        }
        field(36; Documents; Integer)
        {
            Caption = 'Documents';
            FieldClass = FlowField;
            CalcFormula = count("BAS Snapshot Document" where("Snapshot No." = field("No.")));
            Editable = false;
            ToolTip = 'Number of generated documents.';
        }
        field(38; Phases; Integer)
        {
            Caption = 'Phases';
            FieldClass = FlowField;
            CalcFormula = count("BAS Snapshot Fact" where("Snapshot No." = field("No."), "Fact Type" = const(Phase)));
            Editable = false;
            ToolTip = 'Number of business phases of the process.';
        }
        field(37; "Write Events"; Integer)
        {
            Caption = 'Write Events';
            Editable = false;
            ToolTip = 'Number of recorded database writes.';
        }
    }

    keys
    {
        key(PK; "No.")
        {
            Clustered = true;
        }
        key(Process; "Process Name", "No.")
        {
        }
    }

    fieldgroups
    {
        fieldgroup(DropDown; "No.", "Process Name", "Created At", Fingerprint)
        {
        }
    }

    trigger OnDelete()
    var
        Fact: Record "BAS Snapshot Fact";
        Document: Record "BAS Snapshot Document";
    begin
        Fact.SetRange("Snapshot No.", "No.");
        Fact.DeleteAll();
        Document.SetRange("Snapshot No.", "No.");
        Document.DeleteAll();
    end;
}
