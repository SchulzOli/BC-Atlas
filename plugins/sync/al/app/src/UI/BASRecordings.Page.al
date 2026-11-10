page 50151 "BAS Recordings"
{
    Caption = 'Atlas Sync Recordings';
    PageType = List;
    SourceTable = "BAS Recording";
    CardPageId = "BAS Recording Card";
    UsageCategory = Lists;
    ApplicationArea = All;
    Editable = false;
    SourceTableView = sorting("No.") order(descending);

    layout
    {
        area(Content)
        {
            repeater(Lines)
            {
                field("No."; Rec."No.")
                {
                }
                field("Process Name"; Rec."Process Name")
                {
                }
                field(Status; Rec.Status)
                {
                }
                field("User ID"; Rec."User ID")
                {
                }
                field("Started At"; Rec."Started At")
                {
                }
                field("Stopped At"; Rec."Stopped At")
                {
                }
                field("Event Count"; Rec."Event Count")
                {
                }
                field("UI Step Count"; Rec."UI Step Count")
                {
                }
                field("Has Profile"; Rec."Has Profile")
                {
                }
                field("Last Snapshot No."; Rec."Last Snapshot No.")
                {
                }
            }
        }
    }

    actions
    {
        area(Processing)
        {
            action(CreateDemoData)
            {
                Caption = 'Create Demo Data';
                ToolTip = 'Creates two recorded versions of "Demo: Post sales order" from realistic call stacks and a Page Scripting recording, builds both snapshots (the second shows drift) and generates all documentation. No real data is posted; the recorder does not need to be enabled.';
                Image = CreateDocuments;

                trigger OnAction()
                var
                    Snapshot: Record "BAS Snapshot";
                    DemoData: Codeunit "BAS Demo Data";
                begin
                    if not Confirm(CreateDemoQst) then
                        exit;
                    Snapshot.Get(DemoData.CreateDemo(true));
                    Commit();
                    Page.Run(Page::"BAS Snapshot Card", Snapshot);
                end;
            }
        }
        area(Navigation)
        {
            action(Snapshots)
            {
                Caption = 'Snapshots';
                ToolTip = 'Open the snapshots built from this recording.';
                Image = Documents;
                RunObject = page "BAS Snapshots";
                RunPageLink = "Recording No." = field("No.");
            }
            action(Setup)
            {
                Caption = 'Setup';
                ToolTip = 'Open the Atlas Sync setup.';
                Image = Setup;
                RunObject = page "BAS Setup";
            }
        }
    }

    var
        CreateDemoQst: Label 'Create the demo recordings, snapshots and documents for "Demo: Post sales order"?';
}
