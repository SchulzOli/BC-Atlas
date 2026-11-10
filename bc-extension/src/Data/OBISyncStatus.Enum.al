enum 50102 "OBI Sync Status"
{
    Extensible = true;
    Caption = 'OpenBridge Sync Status';

    value(0; Pending)
    {
        Caption = 'Pending';
    }
    value(1; Synced)
    {
        Caption = 'Synced';
    }
    value(2; Failed)
    {
        Caption = 'Failed';
    }
}
