codeunit 50252 "BAS Test Text Helper"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "BAS Test Assert";
        TextHelper: Codeunit "BAS Text Helper";

    trigger OnRun()
    begin
        // [FEATURE] [Atlas Sync] [Text helper] [UT]
    end;

    [Test]
    procedure KebabIdIsLowercaseHyphenated()
    begin
        // [SCENARIO] Process names become valid BC Atlas [DOC-ID] values.
        Assert.AreEqual('demo-post-sales-order', TextHelper.KebabId('Demo: Post sales order'), 'KebabId');
        Assert.AreEqual('process', TextHelper.KebabId('---'), 'empty input falls back');
    end;

    [Test]
    procedure IdentifierIsPascalCaseAndStartsWithLetter()
    begin
        Assert.AreEqual('PostSalesOrder', TextHelper.Identifier('post sales-order', 30), 'Identifier');
        Assert.AreEqual('P2ndRun', TextHelper.Identifier('2nd run', 30), 'leading digit');
        Assert.AreEqual('Post', TextHelper.Identifier('Post Sales Order', 4), 'max length');
    end;

    [Test]
    procedure FileSafeReplacesSpecialCharacters()
    begin
        Assert.AreEqual('Demo-Post-sales-order', TextHelper.FileSafe('Demo: Post sales order'), 'FileSafe');
    end;

    [Test]
    procedure MarkdownAndCsvEscaping()
    begin
        Assert.AreEqual('a \| b', TextHelper.MdCell('a | b'), 'MdCell');
        Assert.AreEqual('"say ""hi"""', TextHelper.CsvField('say "hi"'), 'CsvField');
        Assert.AreEqual('ab', TextHelper.MermaidLabel('a"[b]'), 'MermaidLabel');
    end;

    [Test]
    procedure UnquoteAndTags()
    begin
        Assert.AreEqual('Post...', TextHelper.Unquote('"Post..."'), 'double quotes');
        Assert.AreEqual('it''s', TextHelper.Unquote('''it''''s'''), 'single quotes');
        Assert.AreEqual('Invoke Post on Sales Order', TextHelper.StripTags('Invoke <caption>Post</caption> on <caption>Sales Order</caption>'), 'StripTags');
        Assert.AreEqual('Post', TextHelper.TagContent('Invoke <caption>Post</caption> on <caption>X</caption>', 'caption'), 'first caption');
        Assert.AreEqual('', TextHelper.TagContent('no tags', 'value'), 'missing tag');
    end;

    [Test]
    procedure SplitLinesHandlesAllLineEndings()
    var
        Lines: List of [Text];
    begin
        Lines := TextHelper.SplitLines('a' + TextHelper.Cr() + TextHelper.Lf() + 'b' + TextHelper.Cr() + 'c' + TextHelper.Lf() + 'd');
        Assert.AreEqual(4, Lines.Count(), 'line count');
        Assert.AreEqual('c', Lines.Get(3), 'third line');
    end;

    [Test]
    procedure TruncateAddsEllipsis()
    begin
        Assert.AreEqual('abcdefg...', TextHelper.Truncate('abcdefghijklmnop', 10), 'Truncate');
        Assert.AreEqual('short', TextHelper.Truncate('short', 10), 'no truncation');
    end;
}
