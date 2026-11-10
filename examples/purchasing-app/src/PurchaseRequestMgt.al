namespace BCA.Example.Purchasing;

/// <summary>
/// Releases and approves purchase requests.
/// </summary>
codeunit 50220 "Purchase Request Mgt."
{
    // Approving writes the approval log on behalf of the approver.
    Permissions = tabledata "Request Approval Entry" = ri;

    /// <summary>
    /// Hands an open request over to the approver.
    /// </summary>
    procedure Release(var PurchaseRequest: Record "Purchase Request")
    begin
        PurchaseRequest.TestField(Status, PurchaseRequest.Status::Open);
        PurchaseRequest.TestField(Amount);
        PurchaseRequest.Validate(Status, PurchaseRequest.Status::Released);
        PurchaseRequest.Modify(true);
        OnAfterReleaseRequest(PurchaseRequest);
    end;

    /// <summary>
    /// Approves a released request up to the approval limit and logs the approval.
    /// </summary>
    procedure Approve(var PurchaseRequest: Record "Purchase Request")
    var
        PurchaseRequestSetup: Record "Purchase Request Setup";
    begin
        PurchaseRequest.TestField(Status, PurchaseRequest.Status::Released);
        if PurchaseRequestSetup.Get() then
            if (PurchaseRequestSetup."Approval Limit" <> 0) and (PurchaseRequest.Amount > PurchaseRequestSetup."Approval Limit") then
                Error(AboveLimitErr, PurchaseRequestSetup."Approval Limit");
        PurchaseRequest.Validate(Status, PurchaseRequest.Status::Approved);
        PurchaseRequest."Approved By" := CopyStr(UserId(), 1, MaxStrLen(PurchaseRequest."Approved By"));
        PurchaseRequest.Modify(true);
        LogApproval(PurchaseRequest);
        OnAfterApproveRequest(PurchaseRequest);
    end;

    local procedure LogApproval(PurchaseRequest: Record "Purchase Request")
    var
        RequestApprovalEntry: Record "Request Approval Entry";
    begin
        RequestApprovalEntry.Init();
        RequestApprovalEntry."Request No." := PurchaseRequest."No.";
        RequestApprovalEntry."Approved By" := PurchaseRequest."Approved By";
        RequestApprovalEntry."Approved At" := CurrentDateTime();
        RequestApprovalEntry.Insert(true);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterReleaseRequest(var PurchaseRequest: Record "Purchase Request")
    begin
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterApproveRequest(var PurchaseRequest: Record "Purchase Request")
    begin
    end;

    var
        AboveLimitErr: Label 'The amount is above the approval limit of %1.', Comment = '%1 = the approval limit';
}

/// <summary>
/// Turns an approved request into an order.
/// </summary>
codeunit 50221 "Purchase Order Creation"
{
    /// <summary>
    /// Marks an approved request as ordered.
    /// </summary>
    procedure CreateOrder(var PurchaseRequest: Record "Purchase Request")
    begin
        PurchaseRequest.TestField(Status, PurchaseRequest.Status::Approved);
        PurchaseRequest.Validate(Status, PurchaseRequest.Status::Ordered);
        PurchaseRequest.Modify(true);
    end;
}

/// <summary>
/// Tells the requester that the request was approved.
/// </summary>
codeunit 50222 "Request Notifications"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"Purchase Request Mgt.", 'OnAfterApproveRequest', '', false, false)]
    local procedure NotifyRequester(var PurchaseRequest: Record "Purchase Request")
    begin
        SendApprovalNotification(PurchaseRequest);
    end;

    local procedure SendApprovalNotification(PurchaseRequest: Record "Purchase Request")
    var
        ApprovedNotification: Notification;
    begin
        ApprovedNotification.Message := StrSubstNo(ApprovedMsg, PurchaseRequest."No.");
        ApprovedNotification.Send();
    end;

    var
        ApprovedMsg: Label 'Purchase request %1 was approved.', Comment = '%1 = the number of the purchase request';
}
