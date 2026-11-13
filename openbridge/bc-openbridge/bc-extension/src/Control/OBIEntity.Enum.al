/// <summary>
/// Registry of every entity this app exposes through its API.
/// Data entities get a row in "OBI Entity Control" (CRUD switches);
/// control-plane entities (Setup, EntityControl) are governed by permission sets only,
/// so the API can never lock itself out.
/// Other extensions can add entities: extend this enum and subscribe to
/// "OBI Control".OnBeforeSupports to declare which operations they support.
/// </summary>
enum 50100 "OBI Entity"
{
    Extensible = true;
    Caption = 'OpenBridge API Entity';

    value(0; ExternalMapping)
    {
        Caption = 'External ID Mapping';
    }
    value(1; CustomerLedgerEntry)
    {
        Caption = 'Customer Ledger Entry';
    }
    value(2; ApiLog)
    {
        Caption = 'API Log';
    }
    value(100; Setup)
    {
        Caption = 'Setup (control plane)';
    }
    value(101; EntityControl)
    {
        Caption = 'Entity Control (control plane)';
    }
}
