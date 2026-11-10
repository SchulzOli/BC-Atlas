page 50160 "BAS Recording Events Part"
{
    Caption = 'Timeline';
    PageType = ListPart;
    SourceTable = "BAS Recording Event";
    ApplicationArea = All;
    Editable = false;

    layout
    {
        area(Content)
        {
            repeater(Lines)
            {
                field("Entry No."; Rec."Entry No.")
                {
                }
                field("Event Type"; Rec."Event Type")
                {
                    StyleExpr = TypeStyle;
                }
                field("Elapsed (ms)"; Rec."Elapsed (ms)")
                {
                }
                field("Table Name"; Rec."Table Name")
                {
                }
                field("Origin Kind"; Rec."Origin Kind")
                {
                }
                field("Origin Object Name"; Rec."Origin Object Name")
                {
                }
                field("Origin Method"; Rec."Origin Method")
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
                field(Description; Rec.Description)
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

                trigger OnAction()
                var
                    EventActions: Codeunit "BAS Event Actions";
                begin
                    EventActions.ShowFrames(Rec);
                end;
            }
        }
    }

    var
        TypeStyle: Text;

    trigger OnAfterGetRecord()
    begin
        case Rec."Event Type" of
            Rec."Event Type"::"UI Step":
                TypeStyle := 'StrongAccent';
            Rec."Event Type"::Marker:
                TypeStyle := 'Attention';
            Rec."Event Type"::Delete:
                TypeStyle := 'Unfavorable';
            else
                TypeStyle := 'Standard';
        end;
    end;
}
