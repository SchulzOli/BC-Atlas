namespace BCA.Example.UI;

using BCA.Example.Inventory;

page 50110 "Warehouse Requests"
{
    ApplicationArea = All;
    Caption = 'Warehouse Requests';
    PageType = List;
    SourceTable = "Warehouse Request";
    UsageCategory = Lists;

    layout
    {
        area(Content)
        {
            repeater(Requests)
            {
                field(EntryNo; Rec."Entry No.")
                {
                    ApplicationArea = All;
                    Caption = 'Entry No.';
                }
                field(Description; Rec.Description)
                {
                    ApplicationArea = All;
                    Caption = 'Description';
                }
                field(Processed; Rec.Processed)
                {
                    ApplicationArea = All;
                    Caption = 'Processed';
                    Editable = false;
                }
            }
        }
    }

    actions
    {
        area(Processing)
        {
            action(ProcessRequest)
            {
                ApplicationArea = All;
                Caption = 'Process';

                trigger OnAction()
                var
                    Processor: Codeunit "Warehouse Processor";
                begin
                    Processor.Process(Rec);
                    CurrPage.Update(false);
                end;
            }
        }
    }
}

pageextension 50111 "Warehouse Request Ext." extends "Warehouse Requests"
{
}
