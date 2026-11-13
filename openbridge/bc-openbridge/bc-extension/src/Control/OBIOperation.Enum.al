/// <summary>CRUD operations the control plane can allow or deny per entity.</summary>
enum 50101 "OBI Operation"
{
    Extensible = false;
    Caption = 'OpenBridge API Operation';

    value(0; Read)
    {
        Caption = 'Read';
    }
    value(1; Create)
    {
        Caption = 'Create';
    }
    value(2; Update)
    {
        Caption = 'Update';
    }
    value(3; Delete)
    {
        Caption = 'Delete';
    }
}
