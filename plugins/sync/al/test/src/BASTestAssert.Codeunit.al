/// <summary>Minimal assertions, so the tests need no dependency on Microsoft's test libraries.</summary>
codeunit 50250 "BAS Test Assert"
{
    Access = Public;

    var
        NotEqualErr: Label 'Assert.AreEqual failed. Expected: <%1>, actual: <%2>. %3', Comment = '%1 = expected, %2 = actual, %3 = message';
        EqualErr: Label 'Assert.AreNotEqual failed. Both values are <%1>.', Comment = '%1 = value';
        NotTrueErr: Label 'Assert.IsTrue failed. %1', Comment = '%1 = message';
        NotFalseErr: Label 'Assert.IsFalse failed. %1', Comment = '%1 = message';
        NotContainsErr: Label 'Assert.Contains failed. <%1> not found in the text (%2 characters). %3', Comment = '%1 = expected part, %2 = length, %3 = message';
        ContainsErr: Label 'Assert.NotContains failed. <%1> was found. %2', Comment = '%1 = unexpected part, %2 = message';
        ErrorTextErr: Label 'Assert.ExpectedError failed. Expected an error containing <%1>, got <%2>.', Comment = '%1 = expected, %2 = actual';

    procedure AreEqual(Expected: Variant; Actual: Variant; Message: Text)
    begin
        if Format(Expected, 0, 9) <> Format(Actual, 0, 9) then
            Error(NotEqualErr, Format(Expected, 0, 9), Format(Actual, 0, 9), Message);
    end;

    procedure AreNotEqualText(NotExpected: Text; Actual: Text)
    begin
        if NotExpected = Actual then
            Error(EqualErr, Actual);
    end;

    procedure IsTrue(Condition: Boolean; Message: Text)
    begin
        if not Condition then
            Error(NotTrueErr, Message);
    end;

    procedure IsFalse(Condition: Boolean; Message: Text)
    begin
        if Condition then
            Error(NotFalseErr, Message);
    end;

    procedure Contains(Value: Text; ExpectedPart: Text; Message: Text)
    begin
        if StrPos(Value, ExpectedPart) = 0 then
            Error(NotContainsErr, ExpectedPart, StrLen(Value), Message);
    end;

    procedure NotContains(Value: Text; UnexpectedPart: Text; Message: Text)
    begin
        if StrPos(Value, UnexpectedPart) <> 0 then
            Error(ContainsErr, UnexpectedPart, Message);
    end;

    /// <summary>Call directly after an asserterror statement.</summary>
    procedure ExpectedError(ExpectedPart: Text)
    begin
        if StrPos(GetLastErrorText(), ExpectedPart) = 0 then
            Error(ErrorTextErr, ExpectedPart, GetLastErrorText());
    end;
}
