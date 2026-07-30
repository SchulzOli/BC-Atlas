namespace BCA.Example.UI;

using BCA.Example.Inventory;

page 50110 "Warehouse Requests"
{
    PageType = List;
    SourceTable = "Warehouse Request";

    actions
    {
        area(Processing)
        {
            action(ProcessRequest)
            {
                trigger OnAction()
                var
                    Processor: Codeunit "Warehouse Processor";
                begin
                    Processor.Process();
                end;
            }
        }
    }
}

pageextension 50111 "Warehouse Request Ext." extends "Warehouse Requests"
{
}
