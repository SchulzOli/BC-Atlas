/// <summary>
/// Wraps the System Application sampling performance profiler. The profile (.alcpuprofile) holds
/// the sampled call tree of everything that ran - including code that only reads data - and is
/// stored as profiler frames next to the exact call stacks of the writes.
/// Profiles can also be imported from the Performance Profiler page or a VS Code snapshot.
/// </summary>
codeunit 50153 "BAS Profiler Bridge"
{
    Access = Public;

    var
        InvalidProfileErr: Label 'The file is not a valid AL CPU profile (.alcpuprofile).';
        SelectProfileTxt: Label 'Select an AL CPU profile';
        NoProfileErr: Label 'Recording %1 has no profile.', Comment = '%1 = recording number';
        ProfileFilterTxt: Label 'AL CPU profile (*.alcpuprofile)|*.alcpuprofile|JSON (*.json)|*.json', Locked = true;

    procedure TryStart(): Boolean
    begin
        exit(TryStartProfiler());
    end;

    /// <summary>Stops the profiler, stores the raw profile on the recording and loads its call tree.</summary>
    procedure StopAndStore(var Recording: Record "BAS Recording")
    var
        SamplingPerformanceProfiler: Codeunit "Sampling Performance Profiler";
        TempBlob: Codeunit "Temp Blob";
        ProfileInStr: InStream;
        OutStr: OutStream;
    begin
        if not SamplingPerformanceProfiler.IsRecordingInProgress() then
            exit;
        SamplingPerformanceProfiler.Stop();
        ProfileInStr := SamplingPerformanceProfiler.GetData();
        TempBlob.CreateOutStream(OutStr);
        CopyStream(OutStr, ProfileInStr);
        StoreProfile(Recording, TempBlob);
    end;

    procedure ImportProfileFromFile(var Recording: Record "BAS Recording")
    var
        TempBlob: Codeunit "Temp Blob";
        FileInStr: InStream;
        OutStr: OutStream;
        FileName: Text;
    begin
        if not UploadIntoStream(SelectProfileTxt, '', ProfileFilterTxt, FileName, FileInStr) then
            exit;
        TempBlob.CreateOutStream(OutStr);
        CopyStream(OutStr, FileInStr);
        Recording.Get(Recording."No.");
        StoreProfile(Recording, TempBlob);
        Recording.Modify(true);
    end;

    procedure DownloadProfile(var Recording: Record "BAS Recording")
    var
        TextHelper: Codeunit "BAS Text Helper";
        InStr: InStream;
        FileName: Text;
    begin
        Recording.CalcFields("Profile Data");
        if not Recording."Profile Data".HasValue() then
            Error(NoProfileErr, Recording."No.");
        Recording."Profile Data".CreateInStream(InStr);
        FileName := TextHelper.FileSafe(Recording."Process Name") + '.alcpuprofile';
        DownloadFromStream(InStr, '', '', '', FileName);
    end;

    local procedure StoreProfile(var Recording: Record "BAS Recording"; var TempBlob: Codeunit "Temp Blob")
    var
        InStr: InStream;
        OutStr: OutStream;
    begin
        Clear(Recording."Profile Data");
        Recording."Profile Data".CreateOutStream(OutStr);
        TempBlob.CreateInStream(InStr);
        CopyStream(OutStr, InStr);
        Recording."Has Profile" := true;

        TempBlob.CreateInStream(InStr);
        LoadProfileFrames(Recording."No.", InStr);
    end;

    /// <summary>Parses the nodes of an .alcpuprofile into profiler frames (Frame No. = node id).</summary>
    procedure LoadProfileFrames(RecordingNo: Integer; var ProfileInStr: InStream)
    var
        CallFrame: Record "BAS Call Frame";
        Parser: Codeunit "BAS Call Stack Parser";
        Profile: JsonObject;
        NodesToken: JsonToken;
        NodeToken: JsonToken;
        ChildrenToken: JsonToken;
        ChildToken: JsonToken;
        Node: JsonObject;
        ParentOf: Dictionary of [Integer, Integer];
        NodeId: Integer;
        ParentId: Integer;
        Depth: Integer;
    begin
        CallFrame.SetRange("Recording No.", RecordingNo);
        CallFrame.SetRange(Source, CallFrame.Source::Profiler);
        CallFrame.DeleteAll();

        if not Profile.ReadFrom(ProfileInStr) then
            Error(InvalidProfileErr);
        if not Profile.Get('nodes', NodesToken) then
            Error(InvalidProfileErr);
        if not NodesToken.IsArray() then
            Error(InvalidProfileErr);

        foreach NodeToken in NodesToken.AsArray() do begin
            Node := NodeToken.AsObject();
            NodeId := JsonInt(Node, 'id');
            if Node.Get('children', ChildrenToken) then
                if ChildrenToken.IsArray() then
                    foreach ChildToken in ChildrenToken.AsArray() do
                        if ChildToken.IsValue() then
                            ParentOf.Set(ChildToken.AsValue().AsInteger(), NodeId);
        end;

        foreach NodeToken in NodesToken.AsArray() do begin
            Node := NodeToken.AsObject();
            NodeId := JsonInt(Node, 'id');
            CallFrame.Init();
            CallFrame."Recording No." := RecordingNo;
            CallFrame.Source := CallFrame.Source::Profiler;
            CallFrame."Event Entry No." := 0;
            CallFrame."Frame No." := NodeId;
            CallFrame."Object Type" := CopyStr(Parser.NormalizeObjectType(JsonText(Node, 'applicationDefinition.objectType')), 1, MaxStrLen(CallFrame."Object Type"));
            CallFrame."Object ID" := JsonInt(Node, 'applicationDefinition.objectId');
            CallFrame."Object Name" := CopyStr(JsonText(Node, 'applicationDefinition.objectName'), 1, MaxStrLen(CallFrame."Object Name"));
            CallFrame."Method Name" := CopyStr(Parser.CleanMethod(JsonText(Node, 'callFrame.functionName')), 1, MaxStrLen(CallFrame."Method Name"));
            CallFrame."Line No." := JsonInt(Node, 'callFrame.lineNumber');
            CallFrame."App Name" := CopyStr(JsonText(Node, 'declaringApplication.appName'), 1, MaxStrLen(CallFrame."App Name"));
            CallFrame."App Publisher" := CopyStr(JsonText(Node, 'declaringApplication.appPublisher'), 1, MaxStrLen(CallFrame."App Publisher"));
            CallFrame."Hit Count" := JsonInt(Node, 'hitCount');
            if ParentOf.Get(NodeId, ParentId) then
                CallFrame."Parent Frame No." := ParentId;

            Depth := 0;
            ParentId := NodeId;
            while ParentOf.Get(ParentId, ParentId) and (Depth < 1000) do
                Depth += 1;
            CallFrame.Depth := Depth;

            // Skip the synthetic "(root)" / "(idle)" nodes that carry no AL object.
            if CallFrame."Object Type" <> '' then
                CallFrame.Insert();
        end;
    end;

    [TryFunction]
    local procedure TryStartProfiler()
    var
        SamplingPerformanceProfiler: Codeunit "Sampling Performance Profiler";
    begin
        if SamplingPerformanceProfiler.IsRecordingInProgress() then
            SamplingPerformanceProfiler.Stop();
        SamplingPerformanceProfiler.Start();
    end;

    local procedure JsonText(Node: JsonObject; Path: Text): Text
    var
        Token: JsonToken;
    begin
        if not Node.SelectToken(Path, Token) then
            exit('');
        if not Token.IsValue() then
            exit('');
        if Token.AsValue().IsNull() then
            exit('');
        exit(Token.AsValue().AsText());
    end;

    local procedure JsonInt(Node: JsonObject; Path: Text): Integer
    var
        Token: JsonToken;
        RawValue: Text;
        Result: Integer;
    begin
        if not Node.SelectToken(Path, Token) then
            exit(0);
        if not Token.IsValue() then
            exit(0);
        if Token.AsValue().IsNull() then
            exit(0);
        Token.AsValue().WriteTo(RawValue);
        if Evaluate(Result, DelChr(RawValue, '=', '"')) then
            exit(Result);
        exit(0);
    end;
}
