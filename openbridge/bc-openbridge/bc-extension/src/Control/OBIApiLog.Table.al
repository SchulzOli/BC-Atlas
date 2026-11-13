/// <summary>Audit trail of every write made through this app's APIs (append-only for API users).</summary>
table 50102 "OBI API Log"
{
    Caption = 'OpenBridge API Log';
    DataClassification = SystemMetadata;
    DataPerCompany = true;

    fields
    {
        field(1; "Entry No."; BigInteger)
        {
            Caption = 'Entry No.';
            AutoIncrement = true;
            ToolTip = 'Sequential number of the log entry.';
        }
        field(10; Entity; Enum "OBI Entity")
        {
            Caption = 'Entity';
            ToolTip = 'The API entity that was changed.';
        }
        field(11; Operation; Enum "OBI Operation")
        {
            Caption = 'Operation';
            ToolTip = 'The operation that was performed.';
        }
        field(12; "Record System Id"; Guid)
        {
            Caption = 'Record System Id';
            ToolTip = 'The id of the changed record as used in the API URL.';
        }
        field(13; "Record Description"; Text[100])
        {
            Caption = 'Record Description';
            DataClassification = CustomerContent;
            ToolTip = 'A short description of the changed record.';
        }
        field(14; "User ID"; Code[50])
        {
            Caption = 'User ID';
            DataClassification = EndUserIdentifiableInformation;
            ToolTip = 'The user or Microsoft Entra application that made the change.';
        }
        field(15; "Client Type"; Text[30])
        {
            Caption = 'Client Type';
            ToolTip = 'The client that made the change, e.g. Api or Web.';
        }
    }

    keys
    {
        key(PK; "Entry No.")
        {
            Clustered = true;
        }
        key(ByRecord; Entity, "Record System Id")
        {
        }
    }
}
