page 50153 "BAS Recording Events"
{
    Caption = 'Atlas Sync Recording Events';
    PageType = List;
    SourceTable = "BAS Recording Event";
    ApplicationArea = All;
    Editable = false;

    layout
    {
        area(Content)
        {
            repeater(Lines)
            {
                field("Recording No."; Rec."Recording No.")
                {
                }
                field("Entry No."; Rec."Entry No.")
                {
                }
                field("Event Type"; Rec."Event Type")
                {
                }
                field("Elapsed (ms)"; Rec."Elapsed (ms)")
                {
                }
                field("Table ID"; Rec."Table ID")
                {
                }
                field("Table Name"; Rec."Table Name")
                {
                }
                field("Record ID"; Rec."Record ID")
                {
                }
                field("Origin Kind"; Rec."Origin Kind")
                {
                }
                field("Origin Object Type"; Rec."Origin Object Type")
                {
                }
                field("Origin Object ID"; Rec."Origin Object ID")
                {
                }
                field("Origin Object Name"; Rec."Origin Object Name")
                {
                }
                field("Origin Method"; Rec."Origin Method")
                {
                }
                field("Leaf Object Type"; Rec."Leaf Object Type")
                {
                }
                field("Leaf Object ID"; Rec."Leaf Object ID")
                {
                }
                field("Leaf Object Name"; Rec."Leaf Object Name")
                {
                }
                field("Leaf Method"; Rec."Leaf Method")
                {
                }
                field("Stack Depth"; Rec."Stack Depth")
                {
                }
                field("Step Kind"; Rec."Step Kind")
                {
                }
                field("Page Caption"; Rec."Page Caption")
                {
                }
                field("Control Caption"; Rec."Control Caption")
                {
                }
                field(Value; Rec.Value)
                {
                }
                field(Description; Rec.Description)
                {
                }
                field("Occurred At"; Rec."Occurred At")
                {
                }
            }
        }
    }

    actions
    {
        area(Processing)
        {
            action(ShowCallStack)
            {
                Caption = 'Show Call Stack';
                ToolTip = 'Shows the raw AL call stack of the selected event.';
                Image = ViewDetails;
                Scope = Repeater;

                trigger OnAction()
                var
                    EventActions: Codeunit "BAS Event Actions";
                begin
                    EventActions.ShowCallStack(Rec);
                end;
            }
            action(Frames)
            {
                Caption = 'Call Frames';
                ToolTip = 'Shows the parsed frames of the selected event.';
                Image = Hierarchy;
                Scope = Repeater;

                trigger OnAction()
                var
                    EventActions: Codeunit "BAS Event Actions";
                begin
                    EventActions.ShowFrames(Rec);
                end;
            }
        }
    }
}
