namespace BCA.Example.Purchasing.Test;

using BCA.Example.Purchasing;

/// <summary>
/// Verifies and documents the purchase request process through the user interface: request, release, approve, order.
/// </summary>
codeunit 50240 "Purchase Request UI Tests"
{
    Access = Internal;
    Subtype = Test;

    [Test]
    procedure PurchaseRequests_CreateRequest_SavesRequest()
    var
        PurchaseRequest: Record "Purchase Request";
        PurchaseRequests: TestPage "Purchase Requests";
    begin
        // [DOC-ID] purchase-request-create
        // [FEATURE] purchase-requests
        // [SCENARIO] Create a purchase request for something you need.
        // [PERMISSIONS] PR - REQUEST

        // [GIVEN] [STATE] No purchase request PR-1000 exists.
        PurchaseRequest.DeleteAll(false);

        // [WHEN] The employee enters what to buy and the expected amount.
        PurchaseRequests.OpenNew();
        PurchaseRequests."No.".SetValue('PR-1000');
        PurchaseRequests.Description.SetValue('Standing desk');
        PurchaseRequests.Amount.SetValue(640);
        PurchaseRequests.Close();

        // [THEN] The purchase request is saved with the status Open.
        PurchaseRequest.Get('PR-1000');
        PurchaseRequest.TestField(Status, PurchaseRequest.Status::Open);

        // [NEXT] purchase-request-release
    end;

    [Test]
    procedure PurchaseRequests_ReleaseRequest_HandsOverToApprover()
    var
        PurchaseRequest: Record "Purchase Request";
        PurchaseRequests: TestPage "Purchase Requests";
    begin
        // [DOC-ID] purchase-request-release
        // [FEATURE] purchase-requests
        // [SCENARIO] Release a purchase request so that it can be approved.
        // [PERMISSIONS] PR - REQUEST

        // [GIVEN] [MASTER-DATA] An open purchase request with an amount exists.
        CreateRequest(PurchaseRequest, PurchaseRequest.Status::Open);

        // [WHEN] The employee chooses Release on the purchase request.
        PurchaseRequests.OpenEdit();
        PurchaseRequests.GoToRecord(PurchaseRequest);
        PurchaseRequests.Release.Invoke();
        PurchaseRequests.Close();

        // [THEN] The purchase request has the status Released.
        PurchaseRequest.Get(PurchaseRequest."No.");
        PurchaseRequest.TestField(Status, PurchaseRequest.Status::Released);

        // [REQUIRES] purchase-request-create
        // [NEXT] purchase-request-approve
    end;

    [Test]
    procedure PurchaseRequests_ApproveRequest_LogsApproval()
    var
        PurchaseRequest: Record "Purchase Request";
        RequestApprovalEntry: Record "Request Approval Entry";
        PurchaseRequests: TestPage "Purchase Requests";
    begin
        // [DOC-ID] purchase-request-approve
        // [FEATURE] purchase-requests
        // [SCENARIO] Approve a released purchase request.
        // [PERMISSIONS] PR - APPROVE

        // [GIVEN] [MASTER-DATA] A released purchase request below the approval limit exists.
        CreateRequest(PurchaseRequest, PurchaseRequest.Status::Released);

        // [WHEN] The approver chooses Approve on the purchase request.
        PurchaseRequests.OpenEdit();
        PurchaseRequests.GoToRecord(PurchaseRequest);
        PurchaseRequests.Approve.Invoke();
        PurchaseRequests.Close();

        // [THEN] The purchase request has the status Approved, and the approval is logged.
        PurchaseRequest.Get(PurchaseRequest."No.");
        PurchaseRequest.TestField(Status, PurchaseRequest.Status::Approved);
        RequestApprovalEntry.SetRange("Request No.", PurchaseRequest."No.");
        RequestApprovalEntry.FindFirst();

        // [REQUIRES] purchase-request-release
        // [NEXT] purchase-request-order
    end;

    [Test]
    procedure PurchaseRequests_CreateOrder_MarksRequestOrdered()
    var
        PurchaseRequest: Record "Purchase Request";
        PurchaseRequests: TestPage "Purchase Requests";
    begin
        // [DOC-ID] purchase-request-order
        // [FEATURE] purchase-requests
        // [SCENARIO] Order what an approved purchase request asks for.
        // [PERMISSIONS] PR - ORDER

        // [GIVEN] [MASTER-DATA] An approved purchase request exists.
        CreateRequest(PurchaseRequest, PurchaseRequest.Status::Approved);

        // [WHEN] The purchaser chooses Create Order on the purchase request.
        PurchaseRequests.OpenEdit();
        PurchaseRequests.GoToRecord(PurchaseRequest);
        PurchaseRequests.CreateOrder.Invoke();
        PurchaseRequests.Close();

        // [THEN] The purchase request has the status Ordered.
        PurchaseRequest.Get(PurchaseRequest."No.");
        PurchaseRequest.TestField(Status, PurchaseRequest.Status::Ordered);

        // [REQUIRES] purchase-request-approve
    end;

    [Test]
    procedure PurchaseRequestSetup_SetApprovalLimit_SavesLimit()
    var
        PurchaseRequestSetup: Record "Purchase Request Setup";
        PurchaseRequestSetupPage: TestPage "Purchase Request Setup";
    begin
        // [DOC-ID] purchase-request-setup
        // [FEATURE] purchase-setup
        // [SCENARIO] Set the highest amount that can be approved.
        // [PERMISSIONS] PR - SETUP

        // [WHEN] The administrator enters the approval limit.
        PurchaseRequestSetupPage.OpenEdit();
        PurchaseRequestSetupPage."Approval Limit".SetValue(1000);
        PurchaseRequestSetupPage.Close();

        // [THEN] The approval limit is saved.
        PurchaseRequestSetup.Get();
        PurchaseRequestSetup.TestField("Approval Limit", 1000);
    end;

    local procedure CreateRequest(var PurchaseRequest: Record "Purchase Request"; Status: Enum "Purchase Request Status")
    begin
        PurchaseRequest.DeleteAll(false);
        PurchaseRequest.Init();
        PurchaseRequest."No." := 'PR-1000';
        PurchaseRequest.Description := 'Standing desk';
        PurchaseRequest.Amount := 640;
        PurchaseRequest.Status := Status;
        PurchaseRequest.Insert(false);
    end;
}
