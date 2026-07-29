namespace Demo.Operations;

using Demo.Sales;

codeunit 50110 "Sales Operations"
{
    var
        Buffer: Record "Sales Buffer";
        Poster: Codeunit "Sales Poster";

    procedure Process()
    begin
        Poster.Post();
        Unknown.Run();
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"Sales Poster", 'OnPosted', '', false, false)]
    local procedure HandlePosted()
    begin
    end;
}
