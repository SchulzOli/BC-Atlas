namespace BCA.Example.Purchasing;

page 50210 "Purchase Requests"
{
    ApplicationArea = All;
    Caption = 'Purchase Requests';
    PageType = List;
    SourceTable = "Purchase Request";
    UsageCategory = Lists;

    layout
    {
        area(Content)
        {
            repeater(Requests)
            {
                field("No."; Rec."No.")
                {
                    Caption = 'No.';
                    ToolTip = 'Specifies the number of the purchase request.';
                }
                field(Description; Rec.Description)
                {
                    Caption = 'Description';
                    ToolTip = 'Specifies what to buy.';
                }
                field(Amount; Rec.Amount)
                {
                    Caption = 'Amount';
                    ToolTip = 'Specifies the expected amount of the purchase.';
                }
                field(Status; Rec.Status)
                {
                    Caption = 'Status';
                    ToolTip = 'Specifies how far the request is: open, released, approved, or ordered.';
                }
                field("Requested By"; Rec."Requested By")
                {
                    Caption = 'Requested By';
                    ToolTip = 'Specifies who created the request.';
                }
                field("Approved By"; Rec."Approved By")
                {
                    Caption = 'Approved By';
                    ToolTip = 'Specifies who approved the request.';
                }
            }
        }
    }

    actions
    {
        area(Processing)
        {
            action(Release)
            {
                Caption = 'Release';
                Image = ReleaseDoc;
                ToolTip = 'Hand the request over to the approver.';

                trigger OnAction()
                var
                    PurchaseRequestMgt: Codeunit "Purchase Request Mgt.";
                begin
                    PurchaseRequestMgt.Release(Rec);
                    CurrPage.Update(false);
                end;
            }
            action(Approve)
            {
                Caption = 'Approve';
                Image = Approve;
                ToolTip = 'Approve the released request.';

                trigger OnAction()
                var
                    PurchaseRequestMgt: Codeunit "Purchase Request Mgt.";
                begin
                    PurchaseRequestMgt.Approve(Rec);
                    CurrPage.Update(false);
                end;
            }
            action(CreateOrder)
            {
                Caption = 'Create Order';
                Image = MakeOrder;
                ToolTip = 'Order what the approved request asks for.';

                trigger OnAction()
                var
                    PurchaseOrderCreation: Codeunit "Purchase Order Creation";
                begin
                    PurchaseOrderCreation.CreateOrder(Rec);
                    CurrPage.Update(false);
                end;
            }
        }
    }
}

page 50212 "Purchase Request Setup"
{
    ApplicationArea = All;
    Caption = 'Purchase Request Setup';
    DeleteAllowed = false;
    InsertAllowed = false;
    PageType = Card;
    SourceTable = "Purchase Request Setup";
    UsageCategory = Administration;

    layout
    {
        area(Content)
        {
            group(General)
            {
                Caption = 'General';

                field("Approval Limit"; Rec."Approval Limit")
                {
                    Caption = 'Approval Limit';
                    ToolTip = 'Specifies the highest amount a request may have to be approved.';
                }
            }
        }
    }

    trigger OnOpenPage()
    begin
        if not Rec.Get() then begin
            Rec.Init();
            Rec.Insert();
        end;
    end;
}

page 50213 "Request Approval Entries"
{
    ApplicationArea = All;
    Caption = 'Request Approval Entries';
    Editable = false;
    PageType = List;
    SourceTable = "Request Approval Entry";
    UsageCategory = History;

    layout
    {
        area(Content)
        {
            repeater(Entries)
            {
                field("Request No."; Rec."Request No.")
                {
                    Caption = 'Request No.';
                    ToolTip = 'Specifies the approved purchase request.';
                }
                field("Approved By"; Rec."Approved By")
                {
                    Caption = 'Approved By';
                    ToolTip = 'Specifies who approved the request.';
                }
                field("Approved At"; Rec."Approved At")
                {
                    Caption = 'Approved At';
                    ToolTip = 'Specifies when the request was approved.';
                }
            }
        }
    }
}
