namespace BCA.Example.Purchasing;

permissionset 50230 "PR - REQUEST"
{
    Assignable = true;
    Caption = 'Purchase requests: create and release';
    Permissions =
        tabledata "Purchase Request" = RIM,
        tabledata "Purchase Request Setup" = R,
        page "Purchase Requests" = X,
        codeunit "Purchase Request Mgt." = X;
}

permissionset 50231 "PR - APPROVE"
{
    Assignable = true;
    Caption = 'Purchase requests: approve';
    Permissions =
        tabledata "Purchase Request" = RM,
        tabledata "Purchase Request Setup" = R,
        tabledata "Request Approval Entry" = Ri,
        page "Purchase Requests" = X,
        page "Request Approval Entries" = X,
        codeunit "Purchase Request Mgt." = X;
}

permissionset 50232 "PR - ORDER"
{
    Assignable = true;
    Caption = 'Purchase requests: order';
    Permissions =
        tabledata "Purchase Request" = RM,
        page "Purchase Requests" = X,
        codeunit "Purchase Order Creation" = X;
}

permissionset 50233 "PR - SETUP"
{
    Assignable = true;
    Caption = 'Purchase requests: setup';
    Permissions =
        tabledata "Purchase Request Setup" = RIMD,
        page "Purchase Request Setup" = X;
}

permissionset 50234 "PR - ADMIN"
{
    Assignable = true;
    Caption = 'Purchase requests: everything';
    IncludedPermissionSets = "PR - REQUEST", "PR - APPROVE", "PR - ORDER", "PR - SETUP";
    Permissions =
        tabledata "Purchase Request" = RIMD,
        tabledata "Request Approval Entry" = RIMD,
        codeunit "Request Notifications" = X;
}
