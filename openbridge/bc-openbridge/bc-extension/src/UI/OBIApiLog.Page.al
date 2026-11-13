page 50112 "OBI API Log"
{
    Caption = 'OpenBridge API Log';
    PageType = List;
    SourceTable = "OBI API Log";
    SourceTableView = sorting("Entry No.") order(descending);
    UsageCategory = History;
    ApplicationArea = All;
    Editable = false;

    layout
    {
        area(Content)
        {
            repeater(Entries)
            {
                field("Entry No."; Rec."Entry No.")
                {
                }
                field(CreatedAt; Rec.SystemCreatedAt)
                {
                    Caption = 'Created At';
                    ToolTip = 'When the change was made.';
                }
                field(Entity; Rec.Entity)
                {
                }
                field(Operation; Rec.Operation)
                {
                }
                field("Record Description"; Rec."Record Description")
                {
                }
                field("Record System Id"; Rec."Record System Id")
                {
                }
                field("User ID"; Rec."User ID")
                {
                }
                field("Client Type"; Rec."Client Type")
                {
                }
            }
        }
    }
}
