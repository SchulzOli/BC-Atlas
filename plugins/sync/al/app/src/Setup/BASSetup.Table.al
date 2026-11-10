/// <summary>Singleton with the recorder switches. Read through ReadOrDefault(), which never writes.</summary>
table 50150 "BAS Setup"
{
    Caption = 'Atlas Sync Setup';
    DataClassification = SystemMetadata;
    DataPerCompany = false;
    // Read in every session (global trigger setup), also by users without the BAS permission set.
    InherentPermissions = R;

    fields
    {
        field(1; "Primary Key"; Code[10])
        {
            Caption = 'Primary Key';
        }
        field(10; "Recorder Enabled"; Boolean)
        {
            Caption = 'Recorder Enabled';
            ToolTip = 'Arms the global database triggers so that writes can be recorded. While on, every write in every session runs through the global trigger (ModifyAll/DeleteAll become row by row), so enable it in sandboxes or for documentation sessions only. Sessions pick up a change after signing in again.';
        }
        field(11; "Capture Call Stack"; Boolean)
        {
            Caption = 'Capture Call Stack';
            InitValue = true;
            ToolTip = 'Stores the full AL call stack for each recorded write. This is what links clicks to the objects and methods that ran.';
        }
        field(12; "Use Sampling Profiler"; Boolean)
        {
            Caption = 'Use Sampling Profiler';
            ToolTip = 'Also runs the sampling performance profiler while recording. Adds the call tree of code that only reads data (validations, calculations) to the snapshot. Needs permission to profile.';
        }
        field(13; "Include System Tables"; Boolean)
        {
            Caption = 'Include System Tables';
            ToolTip = 'Records writes to system tables (ID 2000000000 and above) as well.';
        }
        field(14; "Excluded Table Filter"; Text[250])
        {
            Caption = 'Excluded Table Filter';
            ToolTip = 'Table IDs that are never recorded, as a filter, for example 405|1000..1010. The tables of this app are always excluded.';
        }
        field(15; "Max Events per Recording"; Integer)
        {
            Caption = 'Max Events per Recording';
            InitValue = 20000;
            MinValue = 0;
            ToolTip = 'Stops buffering writes after this many events to protect the session. 0 means no limit.';
        }
    }

    keys
    {
        key(PK; "Primary Key")
        {
            Clustered = true;
        }
    }

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
