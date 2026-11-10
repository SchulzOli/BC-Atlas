enum 50151 "BAS Event Type"
{
    Extensible = false;
    Caption = 'Atlas Sync Event Type';

    /// <summary>A user interaction imported from a Page Scripting recording (click, input, navigation).</summary>
    value(0; "UI Step")
    {
        Caption = 'UI Step';
    }
    value(1; Insert)
    {
        Caption = 'Insert';
    }
    value(2; Modify)
    {
        Caption = 'Modify';
    }
    value(3; Delete)
    {
        Caption = 'Delete';
    }
    value(4; Rename)
    {
        Caption = 'Rename';
    }
    /// <summary>A manual step boundary the user added while recording.</summary>
    value(5; Marker)
    {
        Caption = 'Marker';
    }
}
