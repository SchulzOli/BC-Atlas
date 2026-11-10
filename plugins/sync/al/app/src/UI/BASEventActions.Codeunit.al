/// <summary>Shared actions of the event list and the timeline part.</summary>
codeunit 50166 "BAS Event Actions"
{
    Access = Internal;

    var
        NoCallStackMsg: Label 'No call stack was captured for this event.';
        FormatTxt: Label '%1 %2 %3', Locked = true;

    procedure ShowCallStack(RecordingEvent: Record "BAS Recording Event")
    var
        Preview: Page "BAS Text Preview";
        CallStack: Text;
    begin
        CallStack := RecordingEvent.GetCallStack();
        if CallStack = '' then begin
            Message(NoCallStackMsg);
            exit;
        end;
        Preview.SetContent(StrSubstNo(FormatTxt, RecordingEvent."Event Type", RecordingEvent."Table Name", RecordingEvent."Record ID"), CallStack);
        Preview.Run();
    end;

    procedure ShowFrames(RecordingEvent: Record "BAS Recording Event")
    var
        CallFrame: Record "BAS Call Frame";
    begin
        CallFrame.SetRange("Recording No.", RecordingEvent."Recording No.");
        CallFrame.SetRange(Source, CallFrame.Source::"Call Stack");
        CallFrame.SetRange("Event Entry No.", RecordingEvent."Entry No.");
        Page.Run(Page::"BAS Call Frames", CallFrame);
    end;
}
