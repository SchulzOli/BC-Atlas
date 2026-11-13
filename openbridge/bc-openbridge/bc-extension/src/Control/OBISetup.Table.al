/// <summary>
/// Singleton that holds the global switches of the app. Read through ReadOrDefault():
/// the gateway sends GET requests with Data-Access-Intent: ReadOnly, so read paths must never insert.
/// </summary>
table 50100 "OBI Setup"
{
    Caption = 'OpenBridge Setup';
    DataClassification = SystemMetadata;
    DataPerCompany = true;

    fields
    {
        field(1; "Primary Key"; Code[10])
        {
            Caption = 'Primary Key';
        }
        field(10; "API Enabled"; Boolean)
        {
            Caption = 'API Enabled';
            InitValue = true;
            ToolTip = 'Master switch. When off, every data API of this app is rejected. The control-plane APIs (setup, entityControls) stay available so the app can be switched back on.';
        }
        field(11; "Read-Only Mode"; Boolean)
        {
            Caption = 'Read-Only Mode';
            ToolTip = 'When on, all create, update and delete requests are rejected regardless of the entity settings.';
        }
        field(12; "Audit Writes"; Boolean)
        {
            Caption = 'Audit Writes';
            InitValue = true;
            ToolTip = 'Writes an entry to the API log for every create, update and delete made through the API.';
        }
        field(13; "Log Retention Days"; Integer)
        {
            Caption = 'Log Retention Days';
            InitValue = 90;
            MinValue = 0;
            ToolTip = 'API log entries older than this are removed by the purge job. 0 keeps them forever.';
        }
        field(14; "Default Source System"; Code[20])
        {
            Caption = 'Default Source System';
            ToolTip = 'Used for new external ID mappings when the client does not send a source system.';
        }
        field(15; "Disabled Message"; Text[250])
        {
            Caption = 'Disabled Message';
            ToolTip = 'Optional message returned to API clients while the API is disabled, e.g. a maintenance notice.';
        }
    }

    keys
    {
        key(PK; "Primary Key")
        {
            Clustered = true;
        }
    }

    /// <summary>Loads the setup, or in-memory defaults if it does not exist. Never writes.</summary>
    procedure ReadOrDefault()
    begin
        if not Rec.Get() then
            Rec.Init();
    end;

    procedure InsertIfNotExists()
    begin
        if Rec.Get() then
            exit;
        Rec.Init();
        Rec.Insert(true);
    end;
}
