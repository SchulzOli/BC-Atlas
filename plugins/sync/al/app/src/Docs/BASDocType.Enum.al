/// <summary>
/// All documentation types produced from a snapshot. Extensible: other apps add their own
/// value + "BAS IDoc Generator" implementation and become part of "Generate All Documentation".
/// </summary>
enum 50154 "BAS Doc Type" implements "BAS IDoc Generator"
{
    Extensible = true;
    Caption = 'Atlas Sync Documentation Type';

    value(0; "JSON Facts")
    {
        Caption = 'JSON Fact Sheet';
        Implementation = "BAS IDoc Generator" = "BAS Doc Gen JSON";
    }
    value(1; "Technical Markdown")
    {
        Caption = 'Technical Documentation';
        Implementation = "BAS IDoc Generator" = "BAS Doc Gen Technical";
    }
    value(2; "User Guide Markdown")
    {
        Caption = 'User Guide';
        Implementation = "BAS IDoc Generator" = "BAS Doc Gen User Guide";
    }
    value(3; "Mermaid Sequence")
    {
        Caption = 'Sequence Diagram (Mermaid)';
        Implementation = "BAS IDoc Generator" = "BAS Doc Gen Sequence";
    }
    value(4; "Object Inventory CSV")
    {
        Caption = 'Object Inventory (CSV)';
        Implementation = "BAS IDoc Generator" = "BAS Doc Gen Inventory";
    }
    value(5; "Page Script YAML")
    {
        Caption = 'Page Script (replayable test)';
        Implementation = "BAS IDoc Generator" = "BAS Doc Gen Page Script";
    }
    value(6; "AL Test Codeunit")
    {
        Caption = 'BC Atlas UI Test (AL)';
        Implementation = "BAS IDoc Generator" = "BAS Doc Gen AL Test";
    }
    value(7; "Layered Markdown")
    {
        Caption = 'Layered Documentation (use case to clicks)';
        Implementation = "BAS IDoc Generator" = "BAS Doc Gen Layered";
    }
}
