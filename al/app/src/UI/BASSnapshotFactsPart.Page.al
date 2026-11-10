page 50157 "BAS Snapshot Facts Part"
{
    Caption = 'Facts';
    PageType = ListPart;
    SourceTable = "BAS Snapshot Fact";
    SourceTableView = sorting("Snapshot No.", "Fact Type", Sequence);
    ApplicationArea = All;
    Editable = false;

    layout
    {
        area(Content)
        {
            repeater(Lines)
            {
                field("Fact Type"; Rec."Fact Type")
                {
                    StyleExpr = FactStyle;
                }
                field(Sequence; Rec.Sequence)
                {
                }
                field("Step Kind"; Rec."Step Kind")
                {
                }
                field(Description; Rec.Description)
                {
                }
                field("Page Caption"; Rec."Page Caption")
                {
                }
                field(Subject; Rec.Subject)
                {
                }
                field(Value; Rec.Value)
                {
                }
                field("Object Type"; Rec."Object Type")
                {
                }
                field("Object ID"; Rec."Object ID")
                {
                }
                field("Object Name"; Rec."Object Name")
                {
                }
                field("Method Name"; Rec."Method Name")
                {
                }
                field("App Name"; Rec."App Name")
                {
                    Visible = false;
                }
                field("Table ID"; Rec."Table ID")
                {
                }
                field("Table Name"; Rec."Table Name")
                {
                }
                field(Inserts; Rec.Inserts)
                {
                }
                field(Modifies; Rec.Modifies)
                {
                }
                field(Deletes; Rec.Deletes)
                {
                }
                field("Data Summary"; Rec."Data Summary")
                {
                }
                field("Call Path"; Rec."Call Path")
                {
                }
                field("Linked Line No."; Rec."Linked Line No.")
                {
                    Visible = false;
                }
                field("Hit Count"; Rec."Hit Count")
                {
                }
                field("First Seen (ms)"; Rec."First Seen (ms)")
                {
                }
                field(Source; Rec.Source)
                {
                }
                field("In Fingerprint"; Rec."In Fingerprint")
                {
                    Visible = false;
                }
            }
        }
    }

    var
        FactStyle: Text;

    trigger OnAfterGetRecord()
    begin
        case Rec."Fact Type" of
            Rec."Fact Type"::"UI Step":
                FactStyle := 'StrongAccent';
            Rec."Fact Type"::"Technical Step":
                FactStyle := 'Strong';
            Rec."Fact Type"::"Drift Added":
                FactStyle := 'Favorable';
            Rec."Fact Type"::"Drift Removed":
                FactStyle := 'Unfavorable';
            else
                FactStyle := 'Standard';
        end;
    end;

    procedure ShowAll()
    begin
        Rec.SetRange("Fact Type");
        CurrPage.Update(false);
    end;

    procedure ShowFactType(FactType: Enum "BAS Fact Type")
    begin
        Rec.SetRange("Fact Type", FactType);
        CurrPage.Update(false);
    end;

    procedure ShowDrift()
    begin
        Rec.SetFilter("Fact Type", '%1|%2', Rec."Fact Type"::"Drift Added", Rec."Fact Type"::"Drift Removed");
        CurrPage.Update(false);
    end;
}
