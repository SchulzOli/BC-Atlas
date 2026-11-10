enum 50152 "BAS Frame Source"
{
    Extensible = false;
    Caption = 'Atlas Sync Frame Source';

    /// <summary>Exact AL call stack captured at a database write.</summary>
    value(0; "Call Stack")
    {
        Caption = 'Call Stack';
    }
    /// <summary>Call tree node from the sampling performance profiler (also covers read-only code).</summary>
    value(1; Profiler)
    {
        Caption = 'Profiler';
    }
}
