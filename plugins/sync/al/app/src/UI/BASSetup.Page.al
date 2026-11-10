page 50150 "BAS Setup"
{
    Caption = 'Atlas Sync Setup';
    PageType = Card;
    SourceTable = "BAS Setup";
    UsageCategory = Administration;
    ApplicationArea = All;
    InsertAllowed = false;
    DeleteAllowed = false;

    layout
    {
        area(Content)
        {
            group(Recorder)
            {
                Caption = 'Recorder';

                field("Recorder Enabled"; Rec."Recorder Enabled")
                {
                }
                field("Capture Call Stack"; Rec."Capture Call Stack")
                {
                }
                field("Use Sampling Profiler"; Rec."Use Sampling Profiler")
                {
                }
            }
            group(Scope)
            {
                Caption = 'Scope';

                field("Include System Tables"; Rec."Include System Tables")
                {
                }
                field("Excluded Table Filter"; Rec."Excluded Table Filter")
                {
                }
                field("Max Events per Recording"; Rec."Max Events per Recording")
                {
                }
            }
        }
    }

    actions
    {
        area(Navigation)
        {
            action(Recordings)
            {
                Caption = 'Recordings';
                ToolTip = 'Open the process recordings.';
                Image = Log;
                RunObject = page "BAS Recordings";
            }
            action(Snapshots)
            {
                Caption = 'Snapshots';
                ToolTip = 'Open the Atlas Sync Fact Snapshots.';
                Image = Documents;
                RunObject = page "BAS Snapshots";
            }
        }
        area(Promoted)
        {
            group(Category_Process)
            {
                actionref(Recordings_Promoted; Recordings)
                {
                }
                actionref(Snapshots_Promoted; Snapshots)
                {
                }
            }
        }
    }

    trigger OnOpenPage()
    begin
        Rec.InsertIfNotExists();
        Rec.Reset();
        Rec.Get();
    end;

    trigger OnModifyRecord(): Boolean
    var
        BASRecorder: Codeunit "BAS Recorder";
    begin
        if Rec."Recorder Enabled" <> xRec."Recorder Enabled" then
            Message(SignInAgainMsg);
        BASRecorder.ReloadSetup();
    end;

    var
        SignInAgainMsg: Label 'Sign out and in again (or open a new browser session) so that the change applies to your session. Business Central decides once per session which tables use the global database triggers.';
}
