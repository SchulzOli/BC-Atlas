/// <summary>Result of one test method of the self-test run. Only used as a temporary table.</summary>
table 50250 "BAS Test Result"
{
    Caption = 'Atlas Sync Test Result';
    DataClassification = SystemMetadata;
    TableType = Temporary;

    fields
    {
        field(1; "Entry No."; Integer)
        {
            Caption = 'Entry No.';
        }
        field(2; "Codeunit ID"; Integer)
        {
            Caption = 'Codeunit ID';
            ToolTip = 'Test codeunit.';
        }
        field(3; "Codeunit Name"; Text[250])
        {
            Caption = 'Test Codeunit';
            ToolTip = 'Name of the test codeunit.';
        }
        field(4; "Function Name"; Text[250])
        {
            Caption = 'Test';
            ToolTip = 'Test method.';
        }
        field(5; Success; Boolean)
        {
            Caption = 'Passed';
            ToolTip = 'The test passed.';
        }
        field(6; "Error Message"; Text[2048])
        {
            Caption = 'Error Message';
            ToolTip = 'Why the test failed.';
        }
        field(7; "Duration (ms)"; Integer)
        {
            Caption = 'Duration (ms)';
            ToolTip = 'Run time of the test.';
        }
    }

    keys
    {
        key(PK; "Entry No.")
        {
            Clustered = true;
        }
    }
}
