page 50155 "BAS Snapshots"
{
    Caption = 'Atlas Sync Fact Snapshots';
    PageType = List;
    SourceTable = "BAS Snapshot";
    CardPageId = "BAS Snapshot Card";
    UsageCategory = Lists;
    ApplicationArea = All;
    Editable = false;
    SourceTableView = sorting("No.") order(descending);

    layout
    {
        area(Content)
        {
            repeater(Lines)
            {
                field("No."; Rec."No.")
                {
                }
                field("Process Name"; Rec."Process Name")
                {
                }
                field("Recording No."; Rec."Recording No.")
                {
                }
                field("Created At"; Rec."Created At")
                {
                }
                field("Technical Steps"; Rec."Technical Steps")
                {
                }
                field(Objects; Rec.Objects)
                {
                }
                field(Tables; Rec.Tables)
                {
                }
                field(Fingerprint; Rec.Fingerprint)
                {
                }
                field("Drift Detected"; Rec."Drift Detected")
                {
                    StyleExpr = DriftStyle;
                }
                field("Previous Snapshot No."; Rec."Previous Snapshot No.")
                {
                }
                field(Documents; Rec.Documents)
                {
                }
            }
        }
    }

    var
        DriftStyle: Text;

    trigger OnAfterGetRecord()
    begin
        DriftStyle := 'Standard';
        if Rec."Drift Detected" then
            DriftStyle := 'Unfavorable';
    end;
}
