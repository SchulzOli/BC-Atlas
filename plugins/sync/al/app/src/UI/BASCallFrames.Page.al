page 50154 "BAS Call Frames"
{
    Caption = 'Atlas Sync Call Frames';
    PageType = List;
    SourceTable = "BAS Call Frame";
    ApplicationArea = All;
    Editable = false;

    layout
    {
        area(Content)
        {
            repeater(Lines)
            {
                IndentationColumn = Rec.Depth;
                IndentationControls = "Object Name";

                field(Source; Rec.Source)
                {
                }
                field("Event Entry No."; Rec."Event Entry No.")
                {
                }
                field("Frame No."; Rec."Frame No.")
                {
                }
                field(Depth; Rec.Depth)
                {
                }
                field("Object Type"; Rec."Object Type")
                {
                }
                field("Object ID"; Rec."Object ID")
                {
                }
                field("Object Name"; Rec."Object Name")
                {
                }
                field("Method Name"; Rec."Method Name")
                {
                }
                field("Line No."; Rec."Line No.")
                {
                }
                field("Hit Count"; Rec."Hit Count")
                {
                }
                field("App Name"; Rec."App Name")
                {
                }
                field("App Publisher"; Rec."App Publisher")
                {
                }
                field("Parent Frame No."; Rec."Parent Frame No.")
                {
                }
                field("Raw Line"; Rec."Raw Line")
                {
                    Visible = false;
                }
            }
        }
    }
}
