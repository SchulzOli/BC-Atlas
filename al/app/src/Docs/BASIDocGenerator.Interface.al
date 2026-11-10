/// <summary>
/// One documentation type that can be rendered from an Atlas Sync Fact Snapshot.
/// Register a new type by extending enum "BAS Doc Type" with an implementation of this interface;
/// "Generate All Documentation" picks it up automatically.
/// </summary>
interface "BAS IDoc Generator"
{
    /// <summary>Renders the document for the snapshot into Content.</summary>
    procedure Generate(Snapshot: Record "BAS Snapshot"; var Content: TextBuilder);

    /// <summary>File extension without dot, e.g. 'md'.</summary>
    procedure FileExtension(): Text;
}
