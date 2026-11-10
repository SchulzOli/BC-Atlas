/// <summary>A generated document of one documentation type for one snapshot.</summary>
table 50156 "BAS Snapshot Document"
{
    Caption = 'Atlas Sync Snapshot Document';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Snapshot No."; Integer)
        {
            Caption = 'Snapshot No.';
            TableRelation = "BAS Snapshot";
            ToolTip = 'Snapshot the document was generated from.';
        }
        field(2; "Doc Type"; Enum "BAS Doc Type")
        {
            Caption = 'Documentation Type';
            ToolTip = 'Kind of document.';
        }
        field(3; "File Name"; Text[250])
        {
            Caption = 'File Name';
            ToolTip = 'File name used for the download.';
        }
        field(4; Content; Blob)
        {
            Caption = 'Content';
        }
        field(5; "Generated At"; DateTime)
        {
            Caption = 'Generated At';
            ToolTip = 'When the document was generated.';
        }
        field(6; "Size (Chars)"; Integer)
        {
            Caption = 'Size (Characters)';
            ToolTip = 'Length of the document.';
        }
    }

    keys
    {
        key(PK; "Snapshot No.", "Doc Type")
        {
            Clustered = true;
        }
    }

    procedure SetContent(NewContent: Text)
    var
        OutStr: OutStream;
    begin
        Clear(Content);
        Content.CreateOutStream(OutStr, TextEncoding::UTF8);
        OutStr.WriteText(NewContent);
        "Size (Chars)" := StrLen(NewContent);
    end;

    procedure GetContent(): Text
    var
        TextHelper: Codeunit "BAS Text Helper";
        InStr: InStream;
    begin
        CalcFields(Content);
        if not Content.HasValue() then
            exit('');
        Content.CreateInStream(InStr, TextEncoding::UTF8);
        exit(TextHelper.ReadAll(InStr));
    end;
}
