/// <summary>Read-only viewer for a call stack or a generated document.</summary>
page 50161 "BAS Text Preview"
{
    Caption = 'Preview';
    PageType = Card;
    ApplicationArea = All;
    Editable = false;

    layout
    {
        area(Content)
        {
            field(Title; Title)
            {
                Caption = 'Title';
                ToolTip = 'What is shown.';
            }
            field(ContentText; ContentText)
            {
                ShowCaption = false;
                MultiLine = true;
                ToolTip = 'The text.';
            }
        }
    }

    var
        Title: Text;
        ContentText: Text;

    procedure SetContent(NewTitle: Text; NewContent: Text)
    begin
        Title := NewTitle;
        ContentText := NewContent;
    end;
}
