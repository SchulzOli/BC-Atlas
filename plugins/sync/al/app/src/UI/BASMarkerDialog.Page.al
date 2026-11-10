page 50159 "BAS Marker Dialog"
{
    Caption = 'Add Step Marker';
    PageType = StandardDialog;
    ApplicationArea = All;

    layout
    {
        area(Content)
        {
            field(MarkerText; MarkerText)
            {
                Caption = 'Step';
                ToolTip = 'Name of the step that starts now, for example "Release the sales order".';
            }
        }
    }

    var
        MarkerText: Text[250];

    procedure GetMarkerText(): Text
    begin
        exit(MarkerText);
    end;
}
