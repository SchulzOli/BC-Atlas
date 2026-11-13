page 50113 "OBI External Mappings"
{
    Caption = 'OpenBridge External ID Mappings';
    PageType = List;
    SourceTable = "OBI External Mapping";
    UsageCategory = Lists;
    ApplicationArea = All;

    layout
    {
        area(Content)
        {
            repeater(Mappings)
            {
                field("Source System"; Rec."Source System")
                {
                }
                field("Entity Set"; Rec."Entity Set")
                {
                }
                field("External Id"; Rec."External Id")
                {
                }
                field("BC System Id"; Rec."BC System Id")
                {
                }
                field(Description; Rec.Description)
                {
                }
                field("Sync Status"; Rec."Sync Status")
                {
                }
                field("Last Synced At"; Rec."Last Synced At")
                {
                }
                field("Last Error"; Rec."Last Error")
                {
                }
            }
        }
    }
}
