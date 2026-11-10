codeunit 50258 "BAS Test Doc Generation"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "BAS Test Assert";
        Library: Codeunit "BAS Test Library";
        DemoData: Codeunit "BAS Demo Data";
        SnapshotNo: Integer;

    trigger OnRun()
    begin
        // [FEATURE] [Atlas Sync] [Documentation] [UT]
    end;

    [Test]
    procedure EveryDocumentationTypeIsGenerated()
    var
        Document: Record "BAS Snapshot Document";
    begin
        // [SCENARIO] "All types we have" = every value of the extensible enum, each with content.
        Initialize();
        Document.SetRange("Snapshot No.", SnapshotNo);
        Assert.AreEqual(Enum::"BAS Doc Type".Ordinals().Count(), Document.Count(), 'one document per type');
        Document.FindSet();
        repeat
            Assert.IsTrue(Document."Size (Chars)" > 100, Format(Document."Doc Type"));
            Assert.Contains(Document."File Name", 'Demo-Post-sales-order-S', 'file name');
        until Document.Next() = 0;
    end;

    [Test]
    procedure LayeredDocumentGoesFromUseCaseDownToClicks()
    var
        Content: Text;
    begin
        Initialize();
        Content := Library.DocumentContent(SnapshotNo, Enum::"BAS Doc Type"::"Layered Markdown");
        Assert.Contains(Content, '## L0 · Use case', 'L0');
        Assert.Contains(Content, '## L1 · Process map', 'L1');
        Assert.Contains(Content, '## L2 · Phases', 'L2');
        Assert.Contains(Content, '## L3 · User steps', 'L3');
        Assert.Contains(Content, '## L4 · Clicks', 'L4');
        Assert.Contains(Content, '## L5 · Code path', 'L5');
        Assert.Contains(Content, '## L6 · Data', 'L6');
        Assert.Contains(Content, '- **Use case:** Order to cash', 'feature on top');
        Assert.Contains(Content, '<a id="phase-2"></a>Phase 2 · On the Sales Order page, choose Post', 'phase anchor');
        Assert.Contains(Content, '| [7](#step-7) | [2](#phase-2) | invoke | Sales Order |  | Post... |  | [T7](#tech-7) |', 'click row links phase and technical step');
        Assert.Contains(Content, '`codeunit::80`', 'BC Atlas object key');
    end;

    [Test]
    procedure BcAtlasUiTestFollowsTheTagConvention()
    var
        Content: Text;
    begin
        // [SCENARIO] The AL UI test carries the BC Atlas tags and TestPage calls with exact names where known.
        Initialize();
        Content := Library.DocumentContent(SnapshotNo, Enum::"BAS Doc Type"::"AL Test Codeunit");
        Assert.Contains(Content, '// [FEATURE] [Order to cash] [UI]', 'feature in OnRun');
        Assert.Contains(Content, '// [DOC-ID] demo-post-sales-order', 'doc id');
        Assert.Contains(Content, '// [SCENARIO] Demo: Post sales order', 'scenario');
        Assert.Contains(Content, '// [WHEN] Enter the data on the Sales Order page', 'phase 1 as WHEN');
        Assert.Contains(Content, '// [WHEN] On the Sales Order page, choose Post', 'phase 2 as WHEN');
        Assert.Contains(Content, '// [THEN] Business Central saves:', 'result between phases');
        Assert.Contains(Content, '."Sell-to Customer Name".SetValue(''Adatum Corporation'');', 'control name from the validation trigger');
        Assert.Contains(Content, '."Post".Invoke();', 'action name from the call stack');
        Assert.Contains(Content, 'VerifyNetChange(CountsBefore, 17, 3);', 'G/L Entry footprint');
        Assert.Contains(Content, ': TestPage "Sales Order";', 'TestPage variable');
    end;

    [Test]
    procedure JsonFactSheetIsValidAndComplete()
    var
        Json: JsonObject;
        Token: JsonToken;
    begin
        Initialize();
        Assert.IsTrue(Json.ReadFrom(Library.DocumentContent(SnapshotNo, Enum::"BAS Doc Type"::"JSON Facts")), 'valid JSON');
        Json.SelectToken('schema', Token);
        Assert.AreEqual('bc-atlas-sync.fact-snapshot/1', Token.AsValue().AsText(), 'schema');
        Json.SelectToken('phases', Token);
        Assert.AreEqual(2, Token.AsArray().Count(), 'phases');
        Json.SelectToken('uiSteps', Token);
        Assert.AreEqual(7, Token.AsArray().Count(), 'clicks');
        Json.SelectToken('technicalSteps[6].callStack', Token);
        Assert.IsTrue(Token.AsArray().Count() >= 6, 'posting step carries its call stack');
        Json.SelectToken('snapshot.feature', Token);
        Assert.AreEqual('Order to cash', Token.AsValue().AsText(), 'feature');
    end;

    [Test]
    procedure OtherFormatsHaveTheirStructure()
    var
        Content: Text;
    begin
        Initialize();
        Content := Library.DocumentContent(SnapshotNo, Enum::"BAS Doc Type"::"Mermaid Sequence");
        Assert.Contains(Content, 'sequenceDiagram', 'mermaid');
        Assert.Contains(Content, 'actor User', 'user actor');
        Assert.Contains(Content, 'participant CU80 as Codeunit 80 Sales-Post', 'codeunit participant');

        Content := Library.DocumentContent(SnapshotNo, Enum::"BAS Doc Type"::"Object Inventory CSV");
        Assert.Contains(Content, 'Process,Snapshot,Fingerprint,Fact Type', 'CSV header');

        Content := Library.DocumentContent(SnapshotNo, Enum::"BAS Doc Type"::"Page Script YAML");
        Assert.Contains(Content, '# Original Page Scripting recording', 'original clicks returned');

        Content := Library.DocumentContent(SnapshotNo, Enum::"BAS Doc Type"::"User Guide Markdown");
        Assert.Contains(Content, '### Phase 1 - Enter the data on the Sales Order page', 'guide grouped by phase');
        Assert.Contains(Content, 'In the **Customer Name** field, enter `Adatum Corporation`.', 'click wording');

        Content := Library.DocumentContent(SnapshotNo, Enum::"BAS Doc Type"::"Technical Markdown");
        Assert.Contains(Content, '## 3. Step by step', 'technical doc');
    end;

    local procedure Initialize()
    begin
        if SnapshotNo <> 0 then
            exit;
        SnapshotNo := DemoData.CreateVersion(1);
    end;
}
