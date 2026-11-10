/// <summary>
/// One fact of a snapshot. The Fact Type decides which fields are used:
/// UI Step / Technical Step = timeline, Object / Method = code inventory,
/// Table Access = data footprint, Drift Added / Drift Removed = change against the previous snapshot.
/// </summary>
table 50155 "BAS Snapshot Fact"
{
    Caption = 'Atlas Sync Snapshot Fact';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Snapshot No."; Integer)
        {
            Caption = 'Snapshot No.';
            TableRelation = "BAS Snapshot";
            ToolTip = 'Snapshot the fact belongs to.';
        }
        field(2; "Line No."; Integer)
        {
            Caption = 'Line No.';
            ToolTip = 'Line number of the fact.';
        }
        field(3; "Fact Type"; Enum "BAS Fact Type")
        {
            Caption = 'Fact Type';
            ToolTip = 'Kind of fact.';
        }
        field(4; Sequence; Integer)
        {
            Caption = 'Step No.';
            ToolTip = 'Order of the step within the process.';
        }
        field(5; Source; Text[30])
        {
            Caption = 'Source';
            DataClassification = SystemMetadata;
            ToolTip = 'Where the fact comes from: Page Script, Call Stack, Profiler or Call Stack + Profiler.';
        }
        field(10; "Object Type"; Text[30])
        {
            Caption = 'Object Type';
            DataClassification = SystemMetadata;
            ToolTip = 'Object type.';
        }
        field(11; "Object ID"; Integer)
        {
            Caption = 'Object ID';
            DataClassification = SystemMetadata;
            ToolTip = 'Object ID.';
        }
        field(12; "Object Name"; Text[250])
        {
            Caption = 'Object Name';
            DataClassification = SystemMetadata;
            ToolTip = 'Object name.';
        }
        field(13; "Method Name"; Text[250])
        {
            Caption = 'Method';
            DataClassification = SystemMetadata;
            ToolTip = 'Method or trigger.';
        }
        field(14; "App Name"; Text[250])
        {
            Caption = 'App';
            DataClassification = SystemMetadata;
            ToolTip = 'Extension that contains the object.';
        }
        field(20; "Table ID"; Integer)
        {
            Caption = 'Table ID';
            DataClassification = SystemMetadata;
            ToolTip = 'Table that was written.';
        }
        field(21; "Table Name"; Text[100])
        {
            Caption = 'Table Name';
            DataClassification = SystemMetadata;
            ToolTip = 'Name of the table that was written.';
        }
        field(22; Inserts; Integer)
        {
            Caption = 'Inserts';
            ToolTip = 'Number of inserted records.';
        }
        field(23; Modifies; Integer)
        {
            Caption = 'Modifies';
            ToolTip = 'Number of modified records.';
        }
        field(24; Deletes; Integer)
        {
            Caption = 'Deletes';
            ToolTip = 'Number of deleted records.';
        }
        field(25; Renames; Integer)
        {
            Caption = 'Renames';
            ToolTip = 'Number of renamed records.';
        }
        field(30; "Step Kind"; Text[50])
        {
            Caption = 'Step Kind';
            DataClassification = SystemMetadata;
            ToolTip = 'UI steps: navigate, invoke, input ... Technical steps: Action, Field Validation, Page Trigger, Page Autosave, Marker, Code.';
        }
        field(31; "Page Caption"; Text[250])
        {
            Caption = 'Page';
            DataClassification = SystemMetadata;
            ToolTip = 'Page of the UI step.';
        }
        field(32; Subject; Text[250])
        {
            Caption = 'Subject';
            DataClassification = SystemMetadata;
            ToolTip = 'Action or field the step is about.';
        }
        field(33; Value; Text[250])
        {
            Caption = 'Value';
            ToolTip = 'Value entered in a UI step.';
        }
        field(34; Description; Text[2048])
        {
            Caption = 'Description';
            ToolTip = 'Readable description of the fact.';
        }
        field(35; "Call Path"; Text[2048])
        {
            Caption = 'Call Path';
            DataClassification = SystemMetadata;
            ToolTip = 'Deepest call chain of the step, from the trigger to the code that wrote the data.';
        }
        field(36; "Data Summary"; Text[2048])
        {
            Caption = 'Data Footprint';
            ToolTip = 'Tables written by the step with the number of inserts, modifies and deletes.';
        }
        field(38; "Part Caption"; Text[250])
        {
            Caption = 'Part';
            DataClassification = SystemMetadata;
            ToolTip = 'Page part of the UI step, for example the lines.';
        }
        field(39; "Phase No."; Integer)
        {
            Caption = 'Phase No.';
            ToolTip = 'Business phase the step belongs to.';
        }
        field(37; "Linked Line No."; Integer)
        {
            Caption = 'Linked Line No.';
            ToolTip = 'UI step linked to the technical step that it triggered, and vice versa.';
        }
        field(40; "Hit Count"; Integer)
        {
            Caption = 'Hits';
            ToolTip = 'Technical steps: number of writes. Objects and methods: number of call stack frames plus profiler samples.';
        }
        field(41; "First Seen (ms)"; BigInteger)
        {
            Caption = 'First Seen (ms)';
            ToolTip = 'Milliseconds after the start of the recording at which the step started.';
        }
        field(42; "First Event Entry No."; Integer)
        {
            Caption = 'First Event Entry No.';
            ToolTip = 'First recorded event of the technical step.';
        }
        field(43; "Last Event Entry No."; Integer)
        {
            Caption = 'Last Event Entry No.';
            ToolTip = 'Last recorded event of the technical step.';
        }
        field(44; "Deepest Event Entry No."; Integer)
        {
            Caption = 'Deepest Event Entry No.';
            ToolTip = 'Event of the step with the longest call stack; its call path is shown.';
        }
        field(45; "In Fingerprint"; Boolean)
        {
            Caption = 'In Fingerprint';
            ToolTip = 'The fact is exact (from call stacks or data writes) and part of the fingerprint. Sampled profiler facts are not.';
        }
    }

    keys
    {
        key(PK; "Snapshot No.", "Line No.")
        {
            Clustered = true;
        }
        key(ByType; "Snapshot No.", "Fact Type", Sequence)
        {
        }
        key(ByObject; "Snapshot No.", "Fact Type", "Object Type", "Object ID", "Method Name")
        {
        }
        key(ByTable; "Snapshot No.", "Fact Type", "Table ID")
        {
        }
    }

    var
        FormatTxt: Label '%1 %2 "%3"', Locked = true;
        TableTxt: Label 'Table|%1|%2', Locked = true;
        Format2Txt: Label '%1|%2|%3', Locked = true;

    procedure ObjectLabel(): Text
    begin
        if "Object Type" = '' then
            exit('');
        exit(StrSubstNo(FormatTxt, "Object Type", "Object ID", "Object Name"));
    end;

    procedure DriftKey(): Text
    begin
        if "Fact Type" = "Fact Type"::"Table Access" then
            exit(StrSubstNo(TableTxt, "Table ID", OperationFlags()));
        exit(StrSubstNo(Format2Txt, "Object Type", "Object ID", "Method Name"));
    end;

    /// <summary>Which kinds of writes happened (not how many - counts depend on the test data).</summary>
    procedure OperationFlags(): Text
    var
        Flags: Text;
    begin
        if Inserts > 0 then
            Flags += 'I';
        if Modifies > 0 then
            Flags += 'M';
        if Deletes > 0 then
            Flags += 'D';
        if Renames > 0 then
            Flags += 'R';
        exit(Flags);
    end;
}
