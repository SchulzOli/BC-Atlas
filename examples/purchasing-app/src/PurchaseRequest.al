namespace BCA.Example.Purchasing;

enum 50200 "Purchase Request Status"
{
    Extensible = false;

    value(0; Open) { Caption = 'Open'; }
    value(1; Released) { Caption = 'Released'; }
    value(2; Approved) { Caption = 'Approved'; }
    value(3; Ordered) { Caption = 'Ordered'; }
}

/// <summary>
/// A request of an employee to buy something; it is released, approved, and ordered.
/// </summary>
table 50200 "Purchase Request"
{
    Caption = 'Purchase Request';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { Caption = 'No.'; }
        field(2; Description; Text[100]) { Caption = 'Description'; }
        field(3; Amount; Decimal)
        {
            Caption = 'Amount';

            trigger OnValidate()
            begin
                TestField(Status, Status::Open);
            end;
        }
        field(4; Status; Enum "Purchase Request Status")
        {
            Caption = 'Status';
            Editable = false;
        }
        field(5; "Requested By"; Code[50])
        {
            Caption = 'Requested By';
            DataClassification = EndUserIdentifiableInformation;
            Editable = false;
        }
        field(6; "Approved By"; Code[50])
        {
            Caption = 'Approved By';
            DataClassification = EndUserIdentifiableInformation;
            Editable = false;
        }
    }

    keys
    {
        key(PK; "No.")
        {
            Clustered = true;
        }
    }

    trigger OnInsert()
    begin
        "Requested By" := CopyStr(UserId(), 1, MaxStrLen("Requested By"));
    end;
}

/// <summary>
/// Company settings of the purchase request process.
/// </summary>
table 50201 "Purchase Request Setup"
{
    Caption = 'Purchase Request Setup';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Primary Key"; Code[10]) { Caption = 'Primary Key'; }
        field(2; "Approval Limit"; Decimal) { Caption = 'Approval Limit'; }
    }

    keys
    {
        key(PK; "Primary Key")
        {
            Clustered = true;
        }
    }
}

/// <summary>
/// Who approved which purchase request, and when.
/// </summary>
table 50202 "Request Approval Entry"
{
    Caption = 'Request Approval Entry';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer)
        {
            AutoIncrement = true;
            Caption = 'Entry No.';
        }
        field(2; "Request No."; Code[20])
        {
            Caption = 'Request No.';
            TableRelation = "Purchase Request";
        }
        field(3; "Approved By"; Code[50])
        {
            Caption = 'Approved By';
            DataClassification = EndUserIdentifiableInformation;
        }
        field(4; "Approved At"; DateTime) { Caption = 'Approved At'; }
    }

    keys
    {
        key(PK; "Entry No.")
        {
            Clustered = true;
        }
    }
}
