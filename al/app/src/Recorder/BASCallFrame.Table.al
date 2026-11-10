/// <summary>
/// One frame of an AL call stack (Source = Call Stack, per event, Frame No. 1 = innermost)
/// or one node of the sampling profiler call tree (Source = Profiler, Event Entry No. = 0).
/// </summary>
table 50153 "BAS Call Frame"
{
    Caption = 'Atlas Sync Call Frame';
    DataClassification = SystemMetadata;
    DrillDownPageId = "BAS Call Frames";
    LookupPageId = "BAS Call Frames";

    fields
    {
        field(1; "Recording No."; Integer)
        {
            Caption = 'Recording No.';
            TableRelation = "BAS Recording";
            ToolTip = 'Recording the frame belongs to.';
        }
        field(2; Source; Enum "BAS Frame Source")
        {
            Caption = 'Source';
            ToolTip = 'Call Stack (exact, captured at a write) or Profiler (sampled call tree).';
        }
        field(3; "Event Entry No."; Integer)
        {
            Caption = 'Event Entry No.';
            ToolTip = 'Event whose call stack contains the frame. 0 for profiler nodes.';
        }
        field(4; "Frame No."; Integer)
        {
            Caption = 'Frame No.';
            ToolTip = 'Position in the call stack (1 = innermost) or profiler node ID.';
        }
        field(10; "Object Type"; Text[30])
        {
            Caption = 'Object Type';
            ToolTip = 'Codeunit, Page, Table, Report ...';
        }
        field(11; "Object ID"; Integer)
        {
            Caption = 'Object ID';
            ToolTip = 'ID of the object.';
        }
        field(12; "Object Name"; Text[250])
        {
            Caption = 'Object Name';
            ToolTip = 'Name of the object.';
        }
        field(13; "Method Name"; Text[250])
        {
            Caption = 'Method';
            ToolTip = 'Procedure or trigger.';
        }
        field(14; "Line No."; Integer)
        {
            Caption = 'Line No.';
            ToolTip = 'Line within the method that was executing.';
        }
        field(15; "App Name"; Text[250])
        {
            Caption = 'App';
            ToolTip = 'Extension that contains the object.';
        }
        field(16; "App Publisher"; Text[250])
        {
            Caption = 'Publisher';
            ToolTip = 'Publisher of the extension.';
        }
        field(20; Depth; Integer)
        {
            Caption = 'Depth';
            ToolTip = 'Distance from the outermost frame (0 = the trigger that started the code).';
        }
        field(21; "Parent Frame No."; Integer)
        {
            Caption = 'Parent Frame No.';
            ToolTip = 'Calling frame (profiler) or next outer frame (call stack).';
        }
        field(22; "Hit Count"; Integer)
        {
            Caption = 'Hit Count';
            ToolTip = 'Profiler samples taken in this node. 1 for call stack frames.';
        }
        field(30; "Raw Line"; Text[2048])
        {
            Caption = 'Raw Line';
            ToolTip = 'Original call stack line.';
        }
    }

    keys
    {
        key(PK; "Recording No.", Source, "Event Entry No.", "Frame No.")
        {
            Clustered = true;
        }
        key(ByObject; "Recording No.", "Object Type", "Object ID")
        {
        }
    }

    var
        FormatTxt: Label '%1|%2', Locked = true;
        Format2Txt: Label '%1|%2|%3', Locked = true;
        Format3Txt: Label '%1 %2 "%3"', Locked = true;

    procedure ObjectKey(): Text
    begin
        exit(StrSubstNo(FormatTxt, "Object Type", "Object ID"));
    end;

    procedure MethodKey(): Text
    begin
        exit(StrSubstNo(Format2Txt, "Object Type", "Object ID", "Method Name"));
    end;

    procedure ObjectLabel(): Text
    begin
        exit(StrSubstNo(Format3Txt, "Object Type", "Object ID", "Object Name"));
    end;
}
