/// <summary>One recorded run of a business process. Owns the events, call frames and raw artefacts.</summary>
table 50151 "BAS Recording"
{
    Caption = 'Atlas Sync Recording';
    DataClassification = CustomerContent;
    DrillDownPageId = "BAS Recordings";
    LookupPageId = "BAS Recordings";

    fields
    {
        field(1; "No."; Integer)
        {
            Caption = 'No.';
            AutoIncrement = true;
            Editable = false;
            ToolTip = 'Number of the recording.';
        }
        field(2; "Process Name"; Text[100])
        {
            Caption = 'Process Name';
            NotBlank = true;
            ToolTip = 'Name of the business process, for example "Post sales order". Snapshots of the same process are compared with each other to detect drift.';
        }
        field(3; Description; Text[2048])
        {
            Caption = 'Description';
            ToolTip = 'Purpose and scope of the process. Used as introduction in the generated documentation.';
        }
        field(14; Feature; Text[100])
        {
            Caption = 'Feature (Use Case)';
            ToolTip = 'Use case the process belongs to, for example "Order to cash". It is the top layer of the layered documentation and the [FEATURE] of the BC Atlas UI test, which groups scenarios into use cases. Empty means the process name.';
        }
        field(4; Status; Enum "BAS Recording Status")
        {
            Caption = 'Status';
            Editable = false;
            ToolTip = 'New, Recording or Stopped.';
        }
        field(5; "User ID"; Code[50])
        {
            Caption = 'User ID';
            DataClassification = EndUserIdentifiableInformation;
            Editable = false;
            ToolTip = 'User who recorded the process.';
        }
        field(6; "Session ID"; Integer)
        {
            Caption = 'Session ID';
            DataClassification = SystemMetadata;
            Editable = false;
            ToolTip = 'Session in which the recording runs.';
        }
        field(7; "Started At"; DateTime)
        {
            Caption = 'Started At';
            Editable = false;
            ToolTip = 'When the recording was started.';
        }
        field(8; "Stopped At"; DateTime)
        {
            Caption = 'Stopped At';
            Editable = false;
            ToolTip = 'When the recording was stopped.';
        }
        field(9; "Company Name"; Text[30])
        {
            Caption = 'Company Name';
            Editable = false;
            ToolTip = 'Company in which the process was recorded.';
        }
        field(10; "Event Count"; Integer)
        {
            Caption = 'Events';
            FieldClass = FlowField;
            CalcFormula = count("BAS Recording Event" where("Recording No." = field("No.")));
            Editable = false;
            ToolTip = 'Number of recorded events (writes, markers and UI steps).';
        }
        field(11; "UI Step Count"; Integer)
        {
            Caption = 'UI Steps';
            FieldClass = FlowField;
            CalcFormula = count("BAS Recording Event" where("Recording No." = field("No."), "Event Type" = const("UI Step")));
            Editable = false;
            ToolTip = 'Number of user interactions imported from a Page Scripting recording.';
        }
        field(12; "Frame Count"; Integer)
        {
            Caption = 'Call Frames';
            FieldClass = FlowField;
            CalcFormula = count("BAS Call Frame" where("Recording No." = field("No.")));
            Editable = false;
            ToolTip = 'Number of stored call stack frames and profiler nodes.';
        }
        field(13; "Limit Reached"; Boolean)
        {
            Caption = 'Event Limit Reached';
            Editable = false;
            ToolTip = 'The maximum number of events was reached; later writes were not recorded.';
        }
        field(20; "Profile Data"; Blob)
        {
            Caption = 'Profile Data';
        }
        field(21; "Has Profile"; Boolean)
        {
            Caption = 'Has Profile';
            Editable = false;
            ToolTip = 'A sampling profile (.alcpuprofile) was captured. Download it to open it in VS Code.';
        }
        field(22; "Page Script"; Blob)
        {
            Caption = 'Page Script';
        }
        field(23; "Page Script File Name"; Text[250])
        {
            Caption = 'Page Script File';
            Editable = false;
            ToolTip = 'Name of the imported Page Scripting recording (YAML) that holds the user clicks.';
        }
        field(30; "Last Snapshot No."; Integer)
        {
            Caption = 'Last Snapshot No.';
            Editable = false;
            TableRelation = "BAS Snapshot";
            ToolTip = 'Most recent snapshot created from this recording.';
        }
    }

    keys
    {
        key(PK; "No.")
        {
            Clustered = true;
        }
        key(Process; "Process Name", "Started At")
        {
        }
    }

    fieldgroups
    {
        fieldgroup(DropDown; "No.", "Process Name", Status)
        {
        }
    }

    var
        DeleteWhileRecordingErr: Label 'Stop the recording before deleting it.';

    trigger OnInsert()
    begin
        if "User ID" = '' then
            "User ID" := CopyStr(UserId(), 1, MaxStrLen("User ID"));
        if "Company Name" = '' then
            "Company Name" := CopyStr(CompanyName(), 1, MaxStrLen("Company Name"));
    end;

    trigger OnDelete()
    var
        RecordingEvent: Record "BAS Recording Event";
        CallFrame: Record "BAS Call Frame";
    begin
        if Status = Status::Recording then
            Error(DeleteWhileRecordingErr);
        RecordingEvent.SetRange("Recording No.", "No.");
        RecordingEvent.DeleteAll();
        CallFrame.SetRange("Recording No.", "No.");
        CallFrame.DeleteAll();
    end;

    procedure SetPageScript(YamlText: Text; FileName: Text)
    var
        OutStr: OutStream;
    begin
        Clear("Page Script");
        "Page Script".CreateOutStream(OutStr, TextEncoding::UTF8);
        OutStr.WriteText(YamlText);
        "Page Script File Name" := CopyStr(FileName, 1, MaxStrLen("Page Script File Name"));
    end;

    procedure GetPageScript(): Text
    var
        TextHelper: Codeunit "BAS Text Helper";
        InStr: InStream;
    begin
        CalcFields("Page Script");
        if not "Page Script".HasValue() then
            exit('');
        "Page Script".CreateInStream(InStr, TextEncoding::UTF8);
        exit(TextHelper.ReadAll(InStr));
    end;
}
