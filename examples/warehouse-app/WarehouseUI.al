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
                    ToolTip = 'Specifies the number that identifies the warehouse request.';
                }
                field(Description; Rec.Description)
                {
                    ApplicationArea = All;
                    Caption = 'Description';
                    ToolTip = 'Specifies what the warehouse needs to do.';
                }
                field(Processed; Rec.Processed)
                {
                    ApplicationArea = All;
                    Caption = 'Processed';
                    ToolTip = 'Specifies whether the request has been processed.';
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
                ToolTip = 'Process the selected warehouse request and mark it as processed.';

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
