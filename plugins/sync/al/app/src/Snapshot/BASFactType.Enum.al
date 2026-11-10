enum 50153 "BAS Fact Type"
{
    Extensible = false;
    Caption = 'Atlas Sync Fact Type';

    value(0; "UI Step")
    {
        Caption = 'UI Step';
    }
    value(1; "Technical Step")
    {
        Caption = 'Technical Step';
    }
    value(2; Object)
    {
        Caption = 'Object';
    }
    value(3; Method)
    {
        Caption = 'Method';
    }
    value(4; "Table Access")
    {
        Caption = 'Table Access';
    }
    value(5; "Drift Added")
    {
        Caption = 'Drift Added';
    }
    value(6; "Drift Removed")
    {
        Caption = 'Drift Removed';
    }
    /// <summary>A business phase of the process (named by a marker or by the click that triggered it).</summary>
    value(7; Phase)
    {
        Caption = 'Phase';
    }
}
