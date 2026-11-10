page 50156 "BAS Snapshot Card"
{
    Caption = 'Atlas Sync Fact Snapshot';
    PageType = Card;
    SourceTable = "BAS Snapshot";
    ApplicationArea = All;
    InsertAllowed = false;

    layout
    {
        area(Content)
        {
            group(General)
            {
                Caption = 'General';

                field("No."; Rec."No.")
                {
                }
                field("Process Name"; Rec."Process Name")
                {
                }
                field(Feature; Rec.Feature)
                {
                }
                field(Description; Rec.Description)
                {
                    MultiLine = true;
                }
                field("Recording No."; Rec."Recording No.")
                {
                }
                field("Recorded At"; Rec."Recorded At")
                {
                }
                field("Recorded By"; Rec."Recorded By")
                {
                }
                field("Duration (ms)"; Rec."Duration (ms)")
                {
                }
                field("Company Name"; Rec."Company Name")
                {
                }
                field("Platform Version"; Rec."Platform Version")
                {
                }
            }
            group(AtlasSync)
            {
                Caption = 'Atlas Sync';

                field(Fingerprint; Rec.Fingerprint)
                {
                }
                field("Previous Snapshot No."; Rec."Previous Snapshot No.")
                {
                }
                field("Drift Detected"; Rec."Drift Detected")
                {
                    StyleExpr = DriftStyle;
                }
                field("Drift Facts"; Rec."Drift Facts")
                {
                }
                field("Created At"; Rec."Created At")
                {
                }
                field("Created By"; Rec."Created By")
                {
                }
            }
            group(Facts)
            {
                Caption = 'Facts';

                field("UI Steps"; Rec."UI Steps")
                {
                }
                field("Technical Steps"; Rec."Technical Steps")
                {
                }
                field(Objects; Rec.Objects)
                {
                }
                field(Methods; Rec.Methods)
                {
                }
                field(Tables; Rec.Tables)
                {
                }
                field("Write Events"; Rec."Write Events")
                {
                }
            }
            part(DocumentsPart; "BAS Snapshot Docs Part")
            {
                Caption = 'Documentation';
                SubPageLink = "Snapshot No." = field("No.");
            }
            part(FactsPart; "BAS Snapshot Facts Part")
            {
                Caption = 'Facts';
                SubPageLink = "Snapshot No." = field("No.");
            }
        }
    }

    actions
    {
        area(Processing)
        {
            action(GenerateAll)
            {
                Caption = 'Generate All Documentation';
                ToolTip = 'Generates every registered documentation type from the facts of this snapshot.';
                Image = CreateDocuments;

                trigger OnAction()
                var
                    DocManager: Codeunit "BAS Doc Manager";
                begin
                    Message(GeneratedMsg, DocManager.GenerateAll(Rec));
                    CurrPage.Update(false);
                end;
            }
            action(DownloadAll)
            {
                Caption = 'Download All (ZIP)';
                ToolTip = 'Downloads all documents together with the raw Page Script and profile as one ZIP file.';
                Image = ExportFile;

                trigger OnAction()
                var
                    DocManager: Codeunit "BAS Doc Manager";
                begin
                    DocManager.DownloadAll(Rec);
                end;
            }
            action(Recalculate)
            {
                Caption = 'Rebuild Snapshot';
                ToolTip = 'Builds a new snapshot from the same recording, for example after importing the Page Script or a profile.';
                Image = Refresh;

                trigger OnAction()
                var
                    Recording: Record "BAS Recording";
                    Snapshot: Record "BAS Snapshot";
                    Builder: Codeunit "BAS Snapshot Builder";
                    DocManager: Codeunit "BAS Doc Manager";
                begin
                    Recording.Get(Rec."Recording No.");
                    Snapshot.Get(Builder.CreateSnapshot(Recording));
                    DocManager.GenerateAll(Snapshot);
                    Commit();
                    Page.Run(Page::"BAS Snapshot Card", Snapshot);
                end;
            }
        }
        area(Navigation)
        {
            group(ShowFacts)
            {
                Caption = 'Show Facts';
                Image = FilterLines;

                action(ShowAll)
                {
                    Caption = 'All Facts';
                    ToolTip = 'Shows all facts.';
                    Image = ClearFilter;

                    trigger OnAction()
                    begin
                        CurrPage.FactsPart.Page.ShowAll();
                    end;
                }
                action(ShowUiSteps)
                {
                    Caption = 'UI Steps';
                    ToolTip = 'Shows the recorded clicks.';
                    Image = Navigate;

                    trigger OnAction()
                    begin
                        CurrPage.FactsPart.Page.ShowFactType(Enum::"BAS Fact Type"::"UI Step");
                    end;
                }
                action(ShowTechnicalSteps)
                {
                    Caption = 'Technical Steps';
                    ToolTip = 'Shows the steps derived from the call stacks.';
                    Image = Process;

                    trigger OnAction()
                    begin
                        CurrPage.FactsPart.Page.ShowFactType(Enum::"BAS Fact Type"::"Technical Step");
                    end;
                }
                action(ShowObjects)
                {
                    Caption = 'Objects';
                    ToolTip = 'Shows the objects involved.';
                    Image = Components;

                    trigger OnAction()
                    begin
                        CurrPage.FactsPart.Page.ShowFactType(Enum::"BAS Fact Type"::Object);
                    end;
                }
                action(ShowMethods)
                {
                    Caption = 'Methods';
                    ToolTip = 'Shows the methods and triggers executed.';
                    Image = CodesList;

                    trigger OnAction()
                    begin
                        CurrPage.FactsPart.Page.ShowFactType(Enum::"BAS Fact Type"::Method);
                    end;
                }
                action(ShowTables)
                {
                    Caption = 'Data Footprint';
                    ToolTip = 'Shows the tables written.';
                    Image = Database;

                    trigger OnAction()
                    begin
                        CurrPage.FactsPart.Page.ShowFactType(Enum::"BAS Fact Type"::"Table Access");
                    end;
                }
                action(ShowDrift)
                {
                    Caption = 'Drift';
                    ToolTip = 'Shows what changed compared with the previous snapshot.';
                    Image = Change;

                    trigger OnAction()
                    begin
                        CurrPage.FactsPart.Page.ShowDrift();
                    end;
                }
            }
            action(Recording)
            {
                Caption = 'Recording';
                ToolTip = 'Opens the recording of this snapshot.';
                Image = Log;
                RunObject = page "BAS Recording Card";
                RunPageLink = "No." = field("Recording No.");
            }
            action(PreviousSnapshot)
            {
                Caption = 'Previous Snapshot';
                ToolTip = 'Opens the snapshot this one was compared with.';
                Image = PreviousRecord;
                RunObject = page "BAS Snapshot Card";
                RunPageLink = "No." = field("Previous Snapshot No.");
            }
        }
        area(Promoted)
        {
            group(Category_Process)
            {
                actionref(GenerateAll_Promoted; GenerateAll)
                {
                }
                actionref(DownloadAll_Promoted; DownloadAll)
                {
                }
            }
            group(Category_Facts)
            {
                Caption = 'Facts';

                actionref(ShowUiSteps_Promoted; ShowUiSteps)
                {
                }
                actionref(ShowTechnicalSteps_Promoted; ShowTechnicalSteps)
                {
                }
                actionref(ShowTables_Promoted; ShowTables)
                {
                }
                actionref(ShowDrift_Promoted; ShowDrift)
                {
                }
            }
        }
    }

    var
        DriftStyle: Text;
        GeneratedMsg: Label '%1 documents generated.', Comment = '%1 = number of documents';

    trigger OnAfterGetRecord()
    begin
        DriftStyle := 'Favorable';
        if Rec."Drift Detected" then
            DriftStyle := 'Unfavorable';
    end;
}
