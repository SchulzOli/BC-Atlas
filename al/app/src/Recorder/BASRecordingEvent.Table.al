/// <summary>
/// One point on the recording timeline: a database write with its AL call stack, a manual marker,
/// or a user interaction (click / input / navigation) imported from Page Scripting.
/// </summary>
table 50152 "BAS Recording Event"
{
    Caption = 'Atlas Sync Recording Event';
    DataClassification = CustomerContent;
    DrillDownPageId = "BAS Recording Events";
    LookupPageId = "BAS Recording Events";

    fields
    {
        field(1; "Recording No."; Integer)
        {
            Caption = 'Recording No.';
            TableRelation = "BAS Recording";
            ToolTip = 'Recording the event belongs to.';
        }
        field(2; "Entry No."; Integer)
        {
            Caption = 'Entry No.';
            ToolTip = 'Position of the event on the timeline.';
        }
        field(3; "Event Type"; Enum "BAS Event Type")
        {
            Caption = 'Event Type';
            ToolTip = 'UI step, database write (insert, modify, delete, rename) or marker.';
        }
        field(4; "Occurred At"; DateTime)
        {
            Caption = 'Occurred At';
            ToolTip = 'When the event happened. Empty for imported UI steps.';
        }
        field(5; "Elapsed (ms)"; BigInteger)
        {
            Caption = 'Elapsed (ms)';
            ToolTip = 'Milliseconds since the recording was started.';
        }
        field(10; "Table ID"; Integer)
        {
            Caption = 'Table ID';
            DataClassification = SystemMetadata;
            ToolTip = 'Table that was written.';
        }
        field(11; "Table Name"; Text[100])
        {
            Caption = 'Table Name';
            DataClassification = SystemMetadata;
            ToolTip = 'Name of the table that was written.';
        }
        field(12; "Record ID"; Text[250])
        {
            Caption = 'Record ID';
            ToolTip = 'Primary key of the written record.';
        }
        field(20; "Step Kind"; Text[50])
        {
            Caption = 'Step Kind';
            DataClassification = SystemMetadata;
            ToolTip = 'For UI steps the Page Scripting step type (navigate, invoke, input, validate ...).';
        }
        field(21; "Page Caption"; Text[250])
        {
            Caption = 'Page';
            DataClassification = SystemMetadata;
            ToolTip = 'Page on which the user interaction happened.';
        }
        field(22; "Control Caption"; Text[250])
        {
            Caption = 'Control';
            DataClassification = SystemMetadata;
            ToolTip = 'Action, field or part the user interacted with.';
        }
        field(23; Value; Text[250])
        {
            Caption = 'Value';
            ToolTip = 'Value entered by the user.';
        }
        field(24; "Part Caption"; Text[250])
        {
            Caption = 'Part';
            DataClassification = SystemMetadata;
            ToolTip = 'Page part (for example the lines) that contains the control the user interacted with.';
        }
        field(30; Description; Text[2048])
        {
            Caption = 'Description';
            ToolTip = 'Readable description of the event.';
        }
        field(40; "Call Stack"; Blob)
        {
            Caption = 'Call Stack';
        }
        field(41; "Stack Depth"; Integer)
        {
            Caption = 'Stack Depth';
            DataClassification = SystemMetadata;
            ToolTip = 'Number of AL frames that led to the write.';
        }
        field(50; "Origin Object Type"; Text[30])
        {
            Caption = 'Origin Object Type';
            DataClassification = SystemMetadata;
            ToolTip = 'Object type of the outermost frame - the trigger the user started (usually a page action or field validation).';
        }
        field(51; "Origin Object ID"; Integer)
        {
            Caption = 'Origin Object ID';
            DataClassification = SystemMetadata;
            ToolTip = 'Object ID of the outermost frame.';
        }
        field(52; "Origin Object Name"; Text[250])
        {
            Caption = 'Origin Object';
            DataClassification = SystemMetadata;
            ToolTip = 'Name of the object whose trigger started the code.';
        }
        field(53; "Origin Method"; Text[250])
        {
            Caption = 'Origin Method';
            DataClassification = SystemMetadata;
            ToolTip = 'Trigger or method that started the code, for example "Post - OnAction".';
        }
        field(54; "Origin Kind"; Text[30])
        {
            Caption = 'Origin Kind';
            DataClassification = SystemMetadata;
            ToolTip = 'Classification of the origin: Action, Field Validation, Page Trigger, Page Autosave, Code.';
        }
        field(60; "Leaf Object Type"; Text[30])
        {
            Caption = 'Writer Object Type';
            DataClassification = SystemMetadata;
            ToolTip = 'Object type of the innermost frame - the code that executed the write.';
        }
        field(61; "Leaf Object ID"; Integer)
        {
            Caption = 'Writer Object ID';
            DataClassification = SystemMetadata;
            ToolTip = 'Object ID of the code that executed the write.';
        }
        field(62; "Leaf Object Name"; Text[250])
        {
            Caption = 'Writer Object';
            DataClassification = SystemMetadata;
            ToolTip = 'Name of the object that executed the write.';
        }
        field(63; "Leaf Method"; Text[250])
        {
            Caption = 'Writer Method';
            DataClassification = SystemMetadata;
            ToolTip = 'Method that executed the write.';
        }
    }

    keys
    {
        key(PK; "Recording No.", "Entry No.")
        {
            Clustered = true;
        }
        key(ByType; "Recording No.", "Event Type", "Entry No.")
        {
        }
        key(ByTable; "Recording No.", "Table ID")
        {
        }
    }

    var
        FormatTxt: Label '%1|%2|%3', Locked = true;

    trigger OnDelete()
    var
        CallFrame: Record "BAS Call Frame";
    begin
        CallFrame.SetRange("Recording No.", "Recording No.");
        CallFrame.SetRange(Source, CallFrame.Source::"Call Stack");
        CallFrame.SetRange("Event Entry No.", "Entry No.");
        CallFrame.DeleteAll();
    end;

    procedure SetCallStack(CallStack: Text)
    var
        OutStr: OutStream;
    begin
        Clear("Call Stack");
        if CallStack = '' then
            exit;
        "Call Stack".CreateOutStream(OutStr, TextEncoding::UTF8);
        OutStr.WriteText(CallStack);
    end;

    procedure GetCallStack(): Text
    var
        TextHelper: Codeunit "BAS Text Helper";
        InStr: InStream;
    begin
        CalcFields("Call Stack");
        if not "Call Stack".HasValue() then
            exit('');
        "Call Stack".CreateInStream(InStr, TextEncoding::UTF8);
        exit(TextHelper.ReadAll(InStr));
    end;

    procedure IsWrite(): Boolean
    begin
        exit("Event Type" in ["Event Type"::Insert, "Event Type"::Modify, "Event Type"::Delete, "Event Type"::Rename]);
    end;

    procedure OriginKey(): Text
    begin
        exit(StrSubstNo(FormatTxt, "Origin Object Type", "Origin Object ID", "Origin Method"));
    end;
}
