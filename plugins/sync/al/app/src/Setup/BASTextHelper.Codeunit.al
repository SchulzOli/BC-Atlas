/// <summary>Small text utilities shared by recorder, snapshot builder and documentation generators.</summary>
codeunit 50164 "BAS Text Helper"
{
    Access = Public;

    procedure Lf(): Text
    var
        Ch: Char;
    begin
        Ch := 10;
        exit(Format(Ch));
    end;

    procedure Cr(): Text
    var
        Ch: Char;
    begin
        Ch := 13;
        exit(Format(Ch));
    end;

    /// <summary>Appends a line terminated with LF (documents are generated with LF line endings).</summary>
    procedure AppendLine(var Content: TextBuilder; Value: Text)
    begin
        Content.Append(Value);
        Content.Append(Lf());
    end;

    /// <summary>Double-quoted YAML scalar.</summary>
    procedure YamlString(Value: Text): Text
    begin
        exit('"' + Value.Replace('\', '\\').Replace('"', '\"') + '"');
    end;

    /// <summary>Text inside an AL line comment: one line, no escaping.</summary>
    procedure CommentSafe(Value: Text): Text
    begin
        exit(Value.Replace(Cr(), ' ').Replace(Lf(), ' '));
    end;

    /// <summary>Text inside an AL single-quoted string literal.</summary>
    procedure AlSafe(Value: Text): Text
    begin
        Value := Value.Replace(Cr(), ' ').Replace(Lf(), ' ');
        exit(Value.Replace('''', ''''''));
    end;

    /// <summary>Reads a whole text stream, keeping line breaks as LF.</summary>
    procedure ReadAll(var InStr: InStream): Text
    var
        Result: TextBuilder;
        Line: Text;
        First: Boolean;
    begin
        First := true;
        while not InStr.EOS() do begin
            InStr.ReadText(Line);
            if not First then
                Result.Append(Lf());
            Result.Append(Line);
            First := false;
        end;
        exit(Result.ToText());
    end;

    /// <summary>Splits text into lines (CRLF, CR or LF).</summary>
    procedure SplitLines(Value: Text): List of [Text]
    begin
        Value := Value.Replace(Cr() + Lf(), Lf());
        Value := Value.Replace(Cr(), Lf());
        exit(Value.Split(Lf()));
    end;

    procedure Truncate(Value: Text; MaxLength: Integer): Text
    begin
        if StrLen(Value) <= MaxLength then
            exit(Value);
        if MaxLength <= 3 then
            exit(CopyStr(Value, 1, MaxLength));
        exit(CopyStr(Value, 1, MaxLength - 3) + '...');
    end;

    /// <summary>Removes surrounding YAML/JSON quotes.</summary>
    procedure Unquote(Value: Text): Text
    begin
        Value := Value.Trim();
        if StrLen(Value) >= 2 then begin
            if Value.StartsWith('"') and Value.EndsWith('"') then
                exit(CopyStr(Value, 2, StrLen(Value) - 2).Replace('\"', '"'));
            if Value.StartsWith('''') and Value.EndsWith('''') then
                exit(CopyStr(Value, 2, StrLen(Value) - 2).Replace('''''', ''''));
        end;
        exit(Value);
    end;

    /// <summary>Removes markup such as &lt;caption&gt;...&lt;/caption&gt; but keeps the inner text.</summary>
    procedure StripTags(Value: Text): Text
    var
        Result: TextBuilder;
        InTag: Boolean;
        i: Integer;
        Ch: Text[1];
    begin
        for i := 1 to StrLen(Value) do begin
            Ch := CopyStr(Value, i, 1);
            case true of
                Ch = '<':
                    InTag := true;
                Ch = '>':
                    InTag := false;
                not InTag:
                    Result.Append(Ch);
            end;
        end;
        exit(Result.ToText());
    end;

    /// <summary>Returns the inner text of the first &lt;Tag&gt;...&lt;/Tag&gt; element, or ''.</summary>
    procedure TagContent(Value: Text; Tag: Text): Text
    var
        StartPos: Integer;
        EndPos: Integer;
    begin
        StartPos := StrPos(Value, '<' + Tag + '>');
        if StartPos = 0 then
            exit('');
        StartPos += StrLen(Tag) + 2;
        EndPos := StrPos(CopyStr(Value, StartPos), '</' + Tag + '>');
        if EndPos = 0 then
            exit('');
        exit(CopyStr(Value, StartPos, EndPos - 1));
    end;

    /// <summary>Escapes a value for a Markdown table cell.</summary>
    procedure MdCell(Value: Text): Text
    begin
        Value := Value.Replace(Cr(), ' ').Replace(Lf(), ' ');
        exit(Value.Replace('|', '\|'));
    end;

    /// <summary>Quotes a value for CSV (RFC 4180).</summary>
    procedure CsvField(Value: Text): Text
    begin
        exit('"' + Value.Replace('"', '""') + '"');
    end;

    /// <summary>Label text that is safe inside a Mermaid diagram.</summary>
    procedure MermaidLabel(Value: Text): Text
    begin
        Value := Value.Replace(Cr(), ' ').Replace(Lf(), ' ');
        exit(DelChr(Value, '=', '";#<>{}[]|`'));
    end;

    /// <summary>PascalCase identifier from arbitrary text, letters and digits only.</summary>
    procedure Identifier(Value: Text; MaxLength: Integer): Text
    var
        Result: TextBuilder;
        Ch: Text[1];
        UpperNext: Boolean;
        i: Integer;
    begin
        UpperNext := true;
        for i := 1 to StrLen(Value) do begin
            Ch := CopyStr(Value, i, 1);
            if StrPos(AlphaNumTxt, Ch) > 0 then begin
                if UpperNext then
                    Ch := UpperCase(Ch);
                Result.Append(Ch);
                UpperNext := false;
            end else
                UpperNext := true;
        end;
        Value := Result.ToText();
        if Value = '' then
            Value := 'Process';
        if StrPos('0123456789', CopyStr(Value, 1, 1)) > 0 then
            Value := 'P' + Value;
        exit(CopyStr(Value, 1, MaxLength));
    end;

    /// <summary>Lowercase hyphenated id, as BC Atlas expects for [DOC-ID]: "Post Sales Order" becomes post-sales-order.</summary>
    procedure KebabId(Value: Text): Text
    var
        Result: TextBuilder;
        Ch: Text[1];
        PendingHyphen: Boolean;
        i: Integer;
    begin
        Value := LowerCase(Value);
        for i := 1 to StrLen(Value) do begin
            Ch := CopyStr(Value, i, 1);
            if StrPos('abcdefghijklmnopqrstuvwxyz0123456789', Ch) > 0 then begin
                if PendingHyphen and (Result.Length() > 0) then
                    Result.Append('-');
                Result.Append(Ch);
                PendingHyphen := false;
            end else
                PendingHyphen := true;
        end;
        if Result.Length() = 0 then
            exit('process');
        exit(CopyStr(Result.ToText(), 1, 80));
    end;

    /// <summary>File-name-safe version of a text.</summary>
    procedure FileSafe(Value: Text): Text
    var
        Result: TextBuilder;
        Ch: Text[1];
        i: Integer;
    begin
        for i := 1 to StrLen(Value) do begin
            Ch := CopyStr(Value, i, 1);
            if StrPos(AlphaNumTxt + '-_.', Ch) > 0 then
                Result.Append(Ch)
            else
                Result.Append('-');
        end;
        Value := Result.ToText();
        while StrPos(Value, '--') > 0 do
            Value := Value.Replace('--', '-');
        Value := Value.Trim().TrimStart('-').TrimEnd('-');
        if Value = '' then
            Value := 'process';
        exit(CopyStr(Value, 1, 80));
    end;

    procedure FormatMs(Milliseconds: BigInteger): Text
    begin
        if Milliseconds < 1000 then
            exit(StrSubstNo(MsTxt, Milliseconds));
        exit(StrSubstNo(SecondsTxt, Format(Round(Milliseconds / 1000, 0.1), 0, '<Precision,1:1><Standard Format,0>')));
    end;

    var
        MsTxt: Label '%1 ms', Comment = '%1 = milliseconds';
        SecondsTxt: Label '%1 s', Comment = '%1 = seconds';
        AlphaNumTxt: Label 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', Locked = true;
}
