/// <summary>Admin cockpit: global switches plus the CRUD matrix for every entity.</summary>
page 50110 "OBI Setup"
{
    Caption = 'OpenBridge Setup';
    PageType = Card;
    SourceTable = "OBI Setup";
    UsageCategory = Administration;
    ApplicationArea = All;
    InsertAllowed = false;
    DeleteAllowed = false;

    layout
    {
        area(Content)
        {
            group(General)
            {
                Caption = 'General';

                field("API Enabled"; Rec."API Enabled")
                {
                }
                field("Read-Only Mode"; Rec."Read-Only Mode")
                {
                }
                field("Disabled Message"; Rec."Disabled Message")
                {
                    MultiLine = true;
                }
                field("Default Source System"; Rec."Default Source System")
                {
                }
            }
            group(Audit)
            {
                Caption = 'Audit';

                field("Audit Writes"; Rec."Audit Writes")
                {
                }
                field("Log Retention Days"; Rec."Log Retention Days")
                {
                }
            }
            part(EntityControls; "OBI Entity Controls Part")
            {
                Caption = 'Entities';
            }
        }
    }

    actions
    {
        area(Processing)
        {
            action(ResetEntityControls)
            {
                Caption = 'Reset Entity Controls';
                ToolTip = 'Sets every entity back to enabled with all operations it supports.';
                Image = Restore;

                trigger OnAction()
                var
                    Control: Codeunit "OBI Control";
                begin
                    if not Confirm(ResetQst) then
                        exit;
                    Control.ResetEntityControls();
                    CurrPage.Update(false);
                end;
            }
            action(PurgeLog)
            {
                Caption = 'Purge API Log';
                ToolTip = 'Deletes API log entries older than the retention period.';
                Image = Delete;

                trigger OnAction()
                var
                    PurgeLogCU: Codeunit "OBI Purge Log";
                begin
                    Message(PurgedMsg, PurgeLogCU.Purge());
                end;
            }
        }
        area(Navigation)
        {
            action(ApiLog)
            {
                Caption = 'API Log';
                ToolTip = 'Shows every write made through the OpenBridge API.';
                Image = Log;
                RunObject = page "OBI API Log";
            }
            action(ExternalMappings)
            {
                Caption = 'External ID Mappings';
                ToolTip = 'Shows the mappings between external ids and Business Central records.';
                Image = Relationship;
                RunObject = page "OBI External Mappings";
            }
        }
        area(Promoted)
        {
            group(Category_Process)
            {
                actionref(ResetEntityControls_Promoted; ResetEntityControls)
                {
                }
                actionref(ApiLog_Promoted; ApiLog)
                {
                }
                actionref(ExternalMappings_Promoted; ExternalMappings)
                {
                }
            }
        }
    }

    var
        ResetQst: Label 'Reset all entity controls to their defaults?';
        PurgedMsg: Label '%1 log entries deleted.', Comment = '%1 = number of entries';

    trigger OnOpenPage()
    var
        Control: Codeunit "OBI Control";
    begin
        Control.EnsureDefaults();
        Rec.Reset();
        Rec.Get();
    end;
}
