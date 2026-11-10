/// <summary>
/// Cockpit of one recording: start it, perform the process anywhere in the client (same browser
/// session), add markers, stop it, import the Page Scripting clicks and build the snapshot.
/// </summary>
page 50152 "BAS Recording Card"
{
    Caption = 'Atlas Sync Recording';
    PageType = Card;
    SourceTable = "BAS Recording";
    ApplicationArea = All;

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
                field(Status; Rec.Status)
                {
                    StyleExpr = StatusStyle;
                }
                field(SessionState; SessionState)
                {
                    Caption = 'This Session';
                    ToolTip = 'Whether the recording runs in your current session and how many events are buffered. Events are saved when you stop the recording.';
                    Editable = false;
                    StyleExpr = StatusStyle;
                }
            }
            group(Run)
            {
                Caption = 'Run';

                field("User ID"; Rec."User ID")
                {
                }
                field("Company Name"; Rec."Company Name")
                {
                }
                field("Session ID"; Rec."Session ID")
                {
                }
                field("Started At"; Rec."Started At")
                {
                }
                field("Stopped At"; Rec."Stopped At")
                {
                }
                field("Limit Reached"; Rec."Limit Reached")
                {
                }
            }
            group(Captured)
            {
                Caption = 'Captured';

                field("Event Count"; Rec."Event Count")
                {
                }
                field("UI Step Count"; Rec."UI Step Count")
                {
                }
                field("Frame Count"; Rec."Frame Count")
                {
                }
                field("Page Script File Name"; Rec."Page Script File Name")
                {
                }
                field("Has Profile"; Rec."Has Profile")
                {
                }
                field("Last Snapshot No."; Rec."Last Snapshot No.")
                {
                    trigger OnDrillDown()
                    var
                        Snapshot: Record "BAS Snapshot";
                    begin
                        if Snapshot.Get(Rec."Last Snapshot No.") then
                            Page.Run(Page::"BAS Snapshot Card", Snapshot);
                    end;
                }
            }
            part(Events; "BAS Recording Events Part")
            {
                Caption = 'Timeline';
                SubPageLink = "Recording No." = field("No.");
                UpdatePropagation = Both;
            }
        }
    }

    actions
    {
        area(Processing)
        {
            action(StartRecording)
            {
                Caption = 'Start Recording';
                ToolTip = 'Starts recording in your current session. Then perform the process anywhere in Business Central - every write is captured with its AL call stack. Come back here to stop.';
                Image = Start;
                Enabled = not IsRecordingHere;

                trigger OnAction()
                var
                    Recorder: Codeunit "BAS Recorder";
                begin
                    CurrPage.SaveRecord();
                    Recorder.StartRecording(Rec);
                    CurrPage.Update(false);
                    Message(StartedMsg);
                end;
            }
            action(StopRecording)
            {
                Caption = 'Stop Recording';
                ToolTip = 'Stops the recording and saves the buffered events, call stacks and profile.';
                Image = Stop;
                Enabled = IsRecordingHere;

                trigger OnAction()
                var
                    Recorder: Codeunit "BAS Recorder";
                begin
                    Recorder.StopRecording(Rec);
                    CurrPage.Update(false);
                end;
            }
            action(AddMarker)
            {
                Caption = 'Add Step Marker';
                ToolTip = 'Adds a named step boundary to the timeline, for example "Release the order". Markers become their own steps in the documentation.';
                Image = Comment;
                Enabled = IsRecordingHere;

                trigger OnAction()
                var
                    Recorder: Codeunit "BAS Recorder";
                    MarkerDialog: Page "BAS Marker Dialog";
                begin
                    if MarkerDialog.RunModal() <> Action::OK then
                        exit;
                    if MarkerDialog.GetMarkerText() = '' then
                        exit;
                    Recorder.AddMarker(MarkerDialog.GetMarkerText());
                    CurrPage.Update(false);
                end;
            }
            action(ImportPageScript)
            {
                Caption = 'Import Clicks (Page Script)';
                ToolTip = 'Imports the user clicks from a Page Scripting recording (.yml). Record the same run with the Page Scripting tool (Settings > Page Scripting) while this recording runs, save it, and import it here.';
                Image = Import;

                trigger OnAction()
                var
                    Importer: Codeunit "BAS Page Script Importer";
                begin
                    Importer.ImportFromFile(Rec);
                    CurrPage.Update(false);
                end;
            }
            action(ImportProfile)
            {
                Caption = 'Import Profile';
                ToolTip = 'Imports an .alcpuprofile file, for example from the Performance Profiler page or a VS Code profiling snapshot, to add the full call tree.';
                Image = ImportCodes;

                trigger OnAction()
                var
                    ProfilerBridge: Codeunit "BAS Profiler Bridge";
                begin
                    ProfilerBridge.ImportProfileFromFile(Rec);
                    CurrPage.Update(false);
                end;
            }
            action(DownloadProfile)
            {
                Caption = 'Download Profile';
                ToolTip = 'Downloads the captured .alcpuprofile to open it in VS Code.';
                Image = ExportFile;
                Enabled = Rec."Has Profile";

                trigger OnAction()
                var
                    ProfilerBridge: Codeunit "BAS Profiler Bridge";
                begin
                    ProfilerBridge.DownloadProfile(Rec);
                end;
            }
            action(CreateSnapshot)
            {
                Caption = 'Create Snapshot';
                ToolTip = 'Builds an Atlas Sync Fact Snapshot from this recording, compares it with the previous snapshot of the process and generates all documentation types.';
                Image = Document;
                Enabled = not IsRecordingHere;

                trigger OnAction()
                var
                    Snapshot: Record "BAS Snapshot";
                    Builder: Codeunit "BAS Snapshot Builder";
                    DocManager: Codeunit "BAS Doc Manager";
                begin
                    Snapshot.Get(Builder.CreateSnapshot(Rec));
                    DocManager.GenerateAll(Snapshot);
                    Commit();
                    CurrPage.Update(false);
                    Page.Run(Page::"BAS Snapshot Card", Snapshot);
                end;
            }
            action(ForceStop)
            {
                Caption = 'Force Stop';
                ToolTip = 'Marks the recording as stopped when the session that recorded it no longer exists. Events that session had not saved are lost.';
                Image = Cancel;

                trigger OnAction()
                var
                    Recorder: Codeunit "BAS Recorder";
                begin
                    if not Confirm(ForceStopQst, false) then
                        exit;
                    Recorder.ForceStop(Rec);
                    CurrPage.Update(false);
                end;
            }
        }
        area(Navigation)
        {
            action(CallFrames)
            {
                Caption = 'Call Frames';
                ToolTip = 'Shows all captured call stack frames and profiler nodes.';
                Image = Hierarchy;
                RunObject = page "BAS Call Frames";
                RunPageLink = "Recording No." = field("No.");
            }
            action(Snapshots)
            {
                Caption = 'Snapshots';
                ToolTip = 'Shows the snapshots built from this recording.';
                Image = Documents;
                RunObject = page "BAS Snapshots";
                RunPageLink = "Recording No." = field("No.");
            }
        }
        area(Promoted)
        {
            group(Category_Process)
            {
                Caption = 'Record';

                actionref(StartRecording_Promoted; StartRecording)
                {
                }
                actionref(AddMarker_Promoted; AddMarker)
                {
                }
                actionref(StopRecording_Promoted; StopRecording)
                {
                }
                actionref(ImportPageScript_Promoted; ImportPageScript)
                {
                }
            }
            group(Category_Snapshot)
            {
                Caption = 'Document';

                actionref(CreateSnapshot_Promoted; CreateSnapshot)
                {
                }
                actionref(Snapshots_Promoted; Snapshots)
                {
                }
            }
        }
    }

    var
        IsRecordingHere: Boolean;
        SessionState: Text;
        StatusStyle: Text;
        StartedMsg: Label 'Recording started. Perform the process now - in this browser tab or any page of this session. Optionally record the same run with the Page Scripting tool to capture the clicks. Return here and choose Stop Recording when done.';
        ForceStopQst: Label 'Mark the recording as stopped? Events that were not saved by the recording session are lost.';
        HereTxt: Label 'Recording in this session - %1 events buffered', Comment = '%1 = number of events';
        ElsewhereTxt: Label 'Recording in session %1', Comment = '%1 = session id';
        IdleTxt: Label 'Not recording';

    trigger OnAfterGetCurrRecord()
    var
        Recorder: Codeunit "BAS Recorder";
    begin
        IsRecordingHere := (Rec."No." <> 0) and (Recorder.ActiveRecording() = Rec."No.");
        StatusStyle := 'Standard';
        case true of
            IsRecordingHere:
                begin
                    SessionState := StrSubstNo(HereTxt, Recorder.BufferedEventCount());
                    StatusStyle := 'Unfavorable';
                end;
            Rec.Status = Rec.Status::Recording:
                begin
                    SessionState := StrSubstNo(ElsewhereTxt, Rec."Session ID");
                    StatusStyle := 'Ambiguous';
                end;
            else
                SessionState := IdleTxt;
        end;
    end;
}
