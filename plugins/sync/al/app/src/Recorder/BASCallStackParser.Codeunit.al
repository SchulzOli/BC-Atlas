/// <summary>
/// Turns the text of an AL call stack (SessionInformation.Callstack) into frames and derives
/// the origin (outermost frame = what the user triggered) and the writer (innermost frame).
/// Call stack lines look like:
///   "Sales-Post"(CodeUnit 80).CheckAndUpdate line 87 - Base Application by Microsoft version 26.0.1.2
///   "Sales Order"(Page 42)."Post - OnAction"(Trigger) line 2 - Base Application by Microsoft
/// The first lines belong to the recorder itself (global trigger plumbing) and are skipped.
/// </summary>
codeunit 50152 "BAS Call Stack Parser"
{
    Access = Public;

    procedure ParseCallStack(CallStack: Text; var TempFrame: Record "BAS Call Frame" temporary)
    var
        TextHelper: Codeunit "BAS Text Helper";
        Lines: List of [Text];
        Line: Text;
        ObjType: Text;
        ObjName: Text;
        Method: Text;
        AppName: Text;
        AppPublisher: Text;
        ObjId: Integer;
        LineNo: Integer;
        FrameNo: Integer;
        Total: Integer;
        SkippingRecorderFrames: Boolean;
    begin
        TempFrame.Reset();
        TempFrame.DeleteAll();
        if CallStack = '' then
            exit;

        // Some platform APIs separate stack lines with a backslash instead of a line break.
        if (StrPos(CallStack, TextHelper.Lf()) = 0) and (StrPos(CallStack, TextHelper.Cr()) = 0) then
            CallStack := CallStack.Replace('\', TextHelper.Lf());
        Lines := TextHelper.SplitLines(CallStack);

        SkippingRecorderFrames := true;
        foreach Line in Lines do
            if ParseFrameLine(Line, ObjType, ObjId, ObjName, Method, LineNo, AppName, AppPublisher) then
                if not (SkippingRecorderFrames and IsRecorderFrame(ObjType, ObjId)) then begin
                    SkippingRecorderFrames := false;
                    FrameNo += 1;
                    TempFrame.Init();
                    TempFrame.Source := TempFrame.Source::"Call Stack";
                    TempFrame."Frame No." := FrameNo;
                    TempFrame."Object Type" := CopyStr(ObjType, 1, MaxStrLen(TempFrame."Object Type"));
                    TempFrame."Object ID" := ObjId;
                    TempFrame."Object Name" := CopyStr(ObjName, 1, MaxStrLen(TempFrame."Object Name"));
                    TempFrame."Method Name" := CopyStr(Method, 1, MaxStrLen(TempFrame."Method Name"));
                    TempFrame."Line No." := LineNo;
                    TempFrame."App Name" := CopyStr(AppName, 1, MaxStrLen(TempFrame."App Name"));
                    TempFrame."App Publisher" := CopyStr(AppPublisher, 1, MaxStrLen(TempFrame."App Publisher"));
                    TempFrame."Hit Count" := 1;
                    TempFrame."Raw Line" := CopyStr(Line.Trim(), 1, MaxStrLen(TempFrame."Raw Line"));
                    TempFrame.Insert();
                end;

        Total := FrameNo;
        if TempFrame.FindSet() then
            repeat
                TempFrame.Depth := Total - TempFrame."Frame No.";
                if TempFrame."Frame No." < Total then
                    TempFrame."Parent Frame No." := TempFrame."Frame No." + 1;
                TempFrame.Modify();
            until TempFrame.Next() = 0;
    end;

    /// <summary>Fills origin, writer and depth of an event from its parsed frames.</summary>
    procedure AnnotateEvent(var RecordingEvent: Record "BAS Recording Event"; var TempFrame: Record "BAS Call Frame" temporary; CallStackCaptured: Boolean)
    begin
        TempFrame.Reset();
        RecordingEvent."Stack Depth" := TempFrame.Count();

        if RecordingEvent."Event Type" = RecordingEvent."Event Type"::Marker then begin
            RecordingEvent."Origin Kind" := 'Marker';
            exit;
        end;

        if TempFrame.IsEmpty() then begin
            if not CallStackCaptured then begin
                RecordingEvent."Origin Kind" := 'Not Captured';
                RecordingEvent."Origin Object Name" := RecordingEvent."Table Name";
                RecordingEvent."Origin Method" := 'Call stack capture off';
                exit;
            end;
            // No AL code on the stack: the client wrote the record directly (page autosave / inline edit).
            RecordingEvent."Origin Kind" := 'Page Autosave';
            RecordingEvent."Origin Object Type" := 'Client';
            RecordingEvent."Origin Object Name" := RecordingEvent."Table Name";
            RecordingEvent."Origin Method" := CopyStr(StrSubstNo(AutosaveTxt, RecordingEvent."Table Name"), 1, MaxStrLen(RecordingEvent."Origin Method"));
            exit;
        end;

        TempFrame.FindLast(); // outermost
        RecordingEvent."Origin Object Type" := TempFrame."Object Type";
        RecordingEvent."Origin Object ID" := TempFrame."Object ID";
        RecordingEvent."Origin Object Name" := TempFrame."Object Name";
        RecordingEvent."Origin Method" := TempFrame."Method Name";
        RecordingEvent."Origin Kind" := CopyStr(ClassifyTrigger(TempFrame."Object Type", TempFrame."Method Name"), 1, MaxStrLen(RecordingEvent."Origin Kind"));

        TempFrame.FindFirst(); // innermost = the code that executed the write
        RecordingEvent."Leaf Object Type" := TempFrame."Object Type";
        RecordingEvent."Leaf Object ID" := TempFrame."Object ID";
        RecordingEvent."Leaf Object Name" := TempFrame."Object Name";
        RecordingEvent."Leaf Method" := TempFrame."Method Name";
    end;

    procedure ParseFrameLine(Line: Text; var ObjType: Text; var ObjId: Integer; var ObjName: Text; var Method: Text; var LineNo: Integer; var AppName: Text; var AppPublisher: Text): Boolean
    var
        Inside: Text;
        Rest: Text;
        AppPart: Text;
        NameEnd: Integer;
        ParenOpen: Integer;
        ParenClose: Integer;
        SpacePos: Integer;
        LinePos: Integer;
        DashPos: Integer;
        ByPos: Integer;
        VersionPos: Integer;
    begin
        Clear(ObjType);
        Clear(ObjId);
        Clear(ObjName);
        Clear(Method);
        Clear(LineNo);
        Clear(AppName);
        Clear(AppPublisher);

        Line := Line.Trim();
        if Line = '' then
            exit(false);

        if Line.StartsWith('"') then begin
            NameEnd := StrPos(CopyStr(Line, 2), '"') + 1;
            if NameEnd <= 1 then
                exit(false);
            ObjName := CopyStr(Line, 2, NameEnd - 2);
            ParenOpen := NameEnd + 1;
            if CopyStr(Line, ParenOpen, 1) <> '(' then
                exit(false);
        end else begin
            ParenOpen := StrPos(Line, '(');
            if ParenOpen <= 1 then
                exit(false);
            ObjName := CopyStr(Line, 1, ParenOpen - 1);
        end;

        ParenClose := StrPos(CopyStr(Line, ParenOpen), ')');
        if ParenClose = 0 then
            exit(false);
        ParenClose += ParenOpen - 1;
        Inside := CopyStr(Line, ParenOpen + 1, ParenClose - ParenOpen - 1); // e.g. CodeUnit 80
        SpacePos := Inside.LastIndexOf(' ');
        if SpacePos = 0 then
            exit(false);
        ObjType := NormalizeObjectType(CopyStr(Inside, 1, SpacePos - 1));
        if not Evaluate(ObjId, CopyStr(Inside, SpacePos + 1)) then
            exit(false);

        Rest := CopyStr(Line, ParenClose + 1);
        if Rest.StartsWith('.') then
            Rest := CopyStr(Rest, 2);

        LinePos := StrPos(Rest, ' line ');
        if LinePos = 0 then begin
            Method := CleanMethod(Rest);
            exit(true);
        end;

        Method := CleanMethod(CopyStr(Rest, 1, LinePos - 1));
        Rest := CopyStr(Rest, LinePos + StrLen(' line '));
        SpacePos := StrPos(Rest, ' ');
        if SpacePos = 0 then
            SpacePos := StrLen(Rest) + 1;
        if not Evaluate(LineNo, CopyStr(Rest, 1, SpacePos - 1)) then
            LineNo := 0;

        DashPos := StrPos(Rest, ' - ');
        if DashPos > 0 then begin
            AppPart := CopyStr(Rest, DashPos + 3);
            ByPos := AppPart.LastIndexOf(' by ');
            if ByPos > 0 then begin
                AppName := CopyStr(AppPart, 1, ByPos - 1);
                AppPublisher := CopyStr(AppPart, ByPos + 4);
                VersionPos := StrPos(AppPublisher, ' version ');
                if VersionPos > 0 then
                    AppPublisher := CopyStr(AppPublisher, 1, VersionPos - 1);
            end else
                AppName := AppPart;
        end;
        exit(true);
    end;

    procedure NormalizeObjectType(Value: Text): Text
    begin
        case LowerCase(DelChr(Value, '=', ' ')) of
            'codeunit':
                exit('Codeunit');
            'page':
                exit('Page');
            'table':
                exit('Table');
            'report':
                exit('Report');
            'xmlport':
                exit('XmlPort');
            'query':
                exit('Query');
            'pageextension':
                exit('PageExtension');
            'tableextension':
                exit('TableExtension');
            'reportextension':
                exit('ReportExtension');
            'enumextension':
                exit('EnumExtension');
        end;
        exit(Value.Trim());
    end;

    /// <summary>Removes quotes and the "(Trigger)" suffix: "Post - OnAction"(Trigger) becomes Post - OnAction.</summary>
    procedure CleanMethod(Value: Text): Text
    begin
        Value := Value.Trim();
        if Value.EndsWith('(Trigger)') then
            Value := CopyStr(Value, 1, StrLen(Value) - StrLen('(Trigger)'));
        exit(DelChr(Value, '=', '"').Trim());
    end;

    /// <summary>Action, Field Validation, Lookup, Page Trigger, Report, Codeunit Run or Code.</summary>
    procedure ClassifyTrigger(ObjType: Text; Method: Text): Text
    begin
        case true of
            Method.Contains('- OnAction'):
                exit('Action');
            Method.Contains('- OnValidate'):
                exit('Field Validation');
            Method.Contains('- OnLookup'), Method.Contains('- OnDrillDown'), Method.Contains('- OnAssistEdit'):
                exit('Lookup');
            ObjType in ['Page', 'PageExtension']:
                exit('Page Trigger');
            ObjType in ['Report', 'ReportExtension']:
                exit('Report');
            (ObjType = 'Codeunit') and (Method = 'OnRun'):
                exit('Codeunit Run');
        end;
        exit('Code');
    end;

    /// <summary>The action or field a trigger belongs to: "Post - OnAction" gives Post.</summary>
    procedure TriggerSubject(Method: Text): Text
    var
        Pos: Integer;
    begin
        Pos := StrPos(Method, ' - On');
        if Pos > 0 then
            exit(CopyStr(Method, 1, Pos - 1));
        exit(Method);
    end;

    /// <summary>Frames of the recorder plumbing: this app, GlobalTriggerManagement and system codeunits.</summary>
    local procedure IsRecorderFrame(ObjType: Text; ObjId: Integer): Boolean
    begin
        if (ObjId >= 50150) and (ObjId <= 50199) then
            exit(true);
        if (ObjType = 'Codeunit') and ((ObjId = Codeunit::GlobalTriggerManagement) or (ObjId >= 2000000000)) then
            exit(true);
        exit(false);
    end;

    var
        AutosaveTxt: Label 'Client write to %1', Comment = '%1 = table name';
}
