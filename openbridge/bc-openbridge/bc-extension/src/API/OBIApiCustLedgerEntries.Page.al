/// <summary>
/// Read-only: GET .../api/openbridge/interop/v1.0/companies({companyId})/customerLedgerEntries
/// Field names match the gateway registry (src/bc/entities.ts → customerLedgerEntries).
/// </summary>
page 50103 "OBI API Cust. Ledger Entries"
{
    PageType = API;
    APIPublisher = 'openbridge';
    APIGroup = 'interop';
    APIVersion = 'v1.0';
    EntityName = 'customerLedgerEntry';
    EntitySetName = 'customerLedgerEntries';
    EntityCaption = 'Customer Ledger Entry';
    EntitySetCaption = 'Customer Ledger Entries';
    SourceTable = "Cust. Ledger Entry";
    ODataKeyFields = SystemId;
    Editable = false;
    InsertAllowed = false;
    ModifyAllowed = false;
    DeleteAllowed = false;
    DataAccessIntent = ReadOnly;
    Extensible = false;

    layout
    {
        area(Content)
        {
            repeater(Records)
            {
                field(id; Rec.SystemId)
                {
                    Caption = 'Id';
                }
                field(entryNumber; Rec."Entry No.")
                {
                    Caption = 'Entry No.';
                }
                field(customerNumber; Rec."Customer No.")
                {
                    Caption = 'Customer No.';
                }
                field(postingDate; Rec."Posting Date")
                {
                    Caption = 'Posting Date';
                }
                field(documentType; Rec."Document Type")
                {
                    Caption = 'Document Type';
                }
                field(documentNumber; Rec."Document No.")
                {
                    Caption = 'Document No.';
                }
                field(description; Rec.Description)
                {
                    Caption = 'Description';
                }
                field(currencyCode; Rec."Currency Code")
                {
                    Caption = 'Currency Code';
                }
                field(amount; Rec.Amount)
                {
                    Caption = 'Amount';
                }
                field(remainingAmount; Rec."Remaining Amount")
                {
                    Caption = 'Remaining Amount';
                }
                field(dueDate; Rec."Due Date")
                {
                    Caption = 'Due Date';
                }
                field(open; Rec.Open)
                {
                    Caption = 'Open';
                }
                field(lastModifiedDateTime; Rec.SystemModifiedAt)
                {
                    Caption = 'Last Modified Date Time';
                }
            }
        }
    }

    trigger OnOpenPage()
    var
        Control: Codeunit "OBI Control";
    begin
        Control.CheckAccess("OBI Entity"::CustomerLedgerEntry, "OBI Operation"::Read);
    end;
}
