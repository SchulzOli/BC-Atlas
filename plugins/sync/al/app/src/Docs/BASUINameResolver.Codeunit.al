/// <summary>
/// Turns what the user saw (page and field captions from Page Scripting) into the AL names a
/// TestPage needs: the page object name via AllObjWithCaption and the field control name via
/// Page Control Field + Field caption. Actions and parts have no metadata table; their caption is
/// used as best guess and the generated test marks them for review.
/// </summary>
codeunit 50169 "BAS UI Name Resolver"
{
    Access = Public;

    var
        PageNames: Dictionary of [Text, Text];
        PageIds: Dictionary of [Text, Integer];

    /// <summary>AL object name of the page with this caption (or name); the caption itself when unknown.</summary>
    procedure PageName(PageCaption: Text): Text
    begin
        Resolve(PageCaption);
        exit(PageNames.Get(PageCaption));
    end;

    procedure PageId(PageCaption: Text): Integer
    begin
        Resolve(PageCaption);
        exit(PageIds.Get(PageCaption));
    end;

    procedure IsKnownPage(PageCaption: Text): Boolean
    begin
        exit(PageId(PageCaption) <> 0);
    end;

    /// <summary>Control name of the field with this caption on the page; '' when it cannot be resolved.</summary>
    procedure FieldControlName(PageCaption: Text; FieldCaption: Text): Text
    var
        PageControlField: Record "Page Control Field";
        "Field": Record "Field";
        PageNo: Integer;
    begin
        PageNo := PageId(PageCaption);
        if (PageNo = 0) or (FieldCaption = '') then
            exit('');
        PageControlField.SetRange(PageNo, PageNo);
        if PageControlField.FindSet() then
            repeat
                if PageControlField.FieldNo <> 0 then
                    if "Field".Get(PageControlField.TableNo, PageControlField.FieldNo) then
                        if LowerCase("Field"."Field Caption") = LowerCase(FieldCaption) then
                            exit(PageControlField.ControlName);
                if LowerCase(PageControlField.ControlName) = LowerCase(FieldCaption) then
                    exit(PageControlField.ControlName);
            until PageControlField.Next() = 0;
        exit('');
    end;

    /// <summary>Quoted AL identifier, safe for any caption: Sell-to Customer Name becomes "Sell-to Customer Name".</summary>
    procedure Quote(Name: Text): Text
    begin
        exit('"' + DelChr(Name, '=', '"') + '"');
    end;

    local procedure Resolve(PageCaption: Text)
    var
        AllObjWithCaption: Record AllObjWithCaption;
    begin
        if PageNames.ContainsKey(PageCaption) then
            exit;
        AllObjWithCaption.SetRange("Object Type", AllObjWithCaption."Object Type"::Page);
        AllObjWithCaption.SetRange("Object Caption", CopyStr(PageCaption, 1, MaxStrLen(AllObjWithCaption."Object Caption")));
        if not AllObjWithCaption.FindFirst() then begin
            AllObjWithCaption.SetRange("Object Caption");
            AllObjWithCaption.SetRange("Object Name", CopyStr(PageCaption, 1, MaxStrLen(AllObjWithCaption."Object Name")));
            if not AllObjWithCaption.FindFirst() then begin
                PageNames.Add(PageCaption, PageCaption);
                PageIds.Add(PageCaption, 0);
                exit;
            end;
        end;
        PageNames.Add(PageCaption, AllObjWithCaption."Object Name");
        PageIds.Add(PageCaption, AllObjWithCaption."Object ID");
    end;
}
