page 50111 "OBI Entity Controls Part"
{
    Caption = 'Entities';
    PageType = ListPart;
    SourceTable = "OBI Entity Control";
    ApplicationArea = All;
    InsertAllowed = false;
    DeleteAllowed = false;

    layout
    {
        area(Content)
        {
            repeater(Entities)
            {
                field(Entity; Rec.Entity)
                {
                    Editable = false;
                }
                field(Enabled; Rec.Enabled)
                {
                }
                field("Allow Read"; Rec."Allow Read")
                {
                }
                field("Allow Create"; Rec."Allow Create")
                {
                }
                field("Allow Update"; Rec."Allow Update")
                {
                }
                field("Allow Delete"; Rec."Allow Delete")
                {
                }
            }
        }
    }

    actions
    {
        area(Processing)
        {
            action(ResetToDefault)
            {
                Caption = 'Reset to Default';
                ToolTip = 'Sets the selected entity back to enabled with all operations it supports.';
                Image = Restore;

                trigger OnAction()
                begin
                    Rec.ResetToDefault();
                    CurrPage.Update(false);
                end;
            }
        }
    }
}
