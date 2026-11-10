/// <summary>Runs all Atlas Sync tests in the sandbox and shows one line per test.</summary>
page 50250 "BAS Self Test"
{
    Caption = 'Atlas Sync Self-Test';
    PageType = List;
    SourceTable = "BAS Test Result";
    SourceTableTemporary = true;
    UsageCategory = Tasks;
    ApplicationArea = All;
    Editable = false;

    layout
    {
        area(Content)
        {
            group(Summary)
            {
                Caption = 'Summary';

                field(SummaryText; SummaryText)
                {
                    Caption = 'Result';
                    ToolTip = 'Number of passed and failed tests of the last run.';
                    StyleExpr = SummaryStyle;
                }
            }
            repeater(Lines)
            {
                field(Success; Rec.Success)
                {
                    StyleExpr = LineStyle;
                }
                field("Codeunit Name"; Rec."Codeunit Name")
                {
                }
                field("Function Name"; Rec."Function Name")
                {
                    StyleExpr = LineStyle;
                }
                field("Duration (ms)"; Rec."Duration (ms)")
                {
                }
                field("Error Message"; Rec."Error Message")
                {
                }
            }
        }
    }

    actions
    {
        area(Processing)
        {
            action(RunAll)
            {
                Caption = 'Run All Tests';
                ToolTip = 'Runs every Atlas Sync test. Each test codeunit is rolled back, so no data is left behind.';
                Image = ExecuteBatch;

                trigger OnAction()
                var
                    ResultStore: Codeunit "BAS Test Result Store";
                begin
                    Codeunit.Run(Codeunit::"BAS Self Test Runner");
                    ResultStore.CopyTo(Rec);
                    UpdateSummary();
                    CurrPage.Update(false);
                end;
            }
        }
        area(Promoted)
        {
            actionref(RunAll_Promoted; RunAll)
            {
            }
        }
    }

    var
        SummaryText: Text;
        SummaryStyle: Text;
        LineStyle: Text;
        SummaryTxt: Label '%1 passed, %2 failed', Comment = '%1 = passed, %2 = failed';
        NotRunTxt: Label 'Not run yet - choose Run All Tests.';

    trigger OnOpenPage()
    begin
        SummaryText := NotRunTxt;
    end;

    trigger OnAfterGetRecord()
    begin
        LineStyle := 'Favorable';
        if not Rec.Success then
            LineStyle := 'Unfavorable';
    end;

    local procedure UpdateSummary()
    var
        Passed: Integer;
        Failed: Integer;
    begin
        Rec.Reset();
        if Rec.FindSet() then
            repeat
                if Rec.Success then
                    Passed += 1
                else
                    Failed += 1;
            until Rec.Next() = 0;
        SummaryText := StrSubstNo(SummaryTxt, Passed, Failed);
        SummaryStyle := 'Favorable';
        if Failed > 0 then
            SummaryStyle := 'Unfavorable';
        if Rec.FindFirst() then;
    end;
}
