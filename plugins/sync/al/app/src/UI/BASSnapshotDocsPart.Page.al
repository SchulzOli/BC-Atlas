page 50158 "BAS Snapshot Docs Part"
{
    Caption = 'Documentation';
    PageType = ListPart;
    SourceTable = "BAS Snapshot Document";
    ApplicationArea = All;
    Editable = false;

    layout
    {
        area(Content)
        {
            repeater(Lines)
            {
                field("Doc Type"; Rec."Doc Type")
                {
                }
                field("File Name"; Rec."File Name")
                {
                    trigger OnDrillDown()
                    begin
                        PreviewDocument();
                    end;
                }
                field("Size (Chars)"; Rec."Size (Chars)")
                {
                }
                field("Generated At"; Rec."Generated At")
                {
                }
            }
        }
    }

    actions
    {
        area(Processing)
        {
            action(Preview)
            {
                Caption = 'Preview';
                ToolTip = 'Shows the content of the selected document.';
                Image = ViewDetails;

                trigger OnAction()
                begin
                    PreviewDocument();
                end;
            }
            action(Download)
            {
                Caption = 'Download';
                ToolTip = 'Downloads the selected document.';
                Image = ExportFile;

                trigger OnAction()
                var
                    DocManager: Codeunit "BAS Doc Manager";
                begin
                    DocManager.Download(Rec);
                end;
            }
            action(Regenerate)
            {
                Caption = 'Regenerate';
                ToolTip = 'Generates the selected document again from the facts.';
                Image = Refresh;

                trigger OnAction()
                var
                    Snapshot: Record "BAS Snapshot";
                    DocManager: Codeunit "BAS Doc Manager";
                begin
                    Snapshot.Get(Rec."Snapshot No.");
                    DocManager.Generate(Snapshot, Rec."Doc Type");
                    CurrPage.Update(false);
                end;
            }
        }
    }

    local procedure PreviewDocument()
    var
        TextPreview: Page "BAS Text Preview";
    begin
        TextPreview.SetContent(Rec."File Name", Rec.GetContent());
        TextPreview.Run();
    end;
}
