import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "src", "cli.js");

const SOURCE = `namespace Contoso.Quality;

table 50100 "Q Item"
{
    fields
    {
        field(1; "No."; Code[20]) { }
        field(2; Description; Text[100]) { ToolTip = 'Specifies the description.'; DataClassification = CustomerContent; }
        field(3; Inventory; Decimal) { FieldClass = FlowField; CalcFormula = sum("Q Entry".Quantity where("Item No." = field("No."))); }
        field(4; Old; Integer) { DataClassification = CustomerContent; ObsoleteState = Pending; }
    }
}

table 50101 "Q Buffer"
{
    TableType = Temporary;
    fields { field(1; "Entry No."; Integer) { } }
}

tableextension 50102 "Q Buffer Ext" extends "Q Buffer"
{
    fields { field(50100; Extra; Integer) { } }
}

page 50103 "Q Item Card"
{
    PageType = Card;
    SourceTable = "Q Item";
    layout
    {
        area(Content)
        {
            field("No."; Rec."No.") { ApplicationArea = All; }
            field(Description; Rec.Description) { ApplicationArea = All; }
            field(LearnMore; LearnMoreTxt) { ApplicationArea = All; ShowCaption = false; }
        }
    }
    var
        LearnMoreTxt: Label 'Learn more';
}

/// <summary>The item API.</summary>
codeunit 50104 "Q Item API"
{
    /// <summary>Gets an item.</summary>
#pragma warning disable AS0022
    [Scope('OnPrem')]
    procedure GetItem()
    begin
    end;

    procedure Undocumented()
    begin
    end;

    [Obsolete('Use GetItem')]
    procedure Legacy()
    begin
    end;

    local procedure Branchy(A: Integer)
    begin
        if A = 1 then exit; if A = 2 then exit; if A = 3 then exit; if A = 4 then exit;
    end;
}

codeunit 50105 "Q Internal"
{
    Access = Internal;
    procedure NotApi() begin end;
}
`;

function check(settings) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bca-quality-"));
  try {
    writeFileSync(path.join(directory, "app.json"), JSON.stringify({ id: "00000000-0000-0000-0000-0000000000cc", name: "Quality", publisher: "Test", version: "1.0.0.0" }));
    writeFileSync(path.join(directory, "Quality.al"), SOURCE);
    if (settings) writeFileSync(path.join(directory, ".bca.json"), JSON.stringify({ check: settings }));
    const result = spawnSync(process.execPath, [cli, "check", directory, "--format", "json"], { encoding: "utf8", env: { ...process.env, BCA_AL_COMPILER: "off" } });
    return JSON.parse(result.stdout);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("quality rules report what the metadata shows, once per object, and leave the exceptions alone", () => {
  const report = check();
  const by = (rule) => report.findings.filter((finding) => finding.rule === rule);

  // No. has no classification; FlowFields and temporary tables (and their extensions) need none.
  assert.deepEqual(by("missing-data-classification").map(({ message }) => message), ["table 50100 Q Item: 1 field(s) without DataClassification: No."]);
  assert.equal(by("missing-data-classification")[0].severity, "warning");
  assert.equal(by("missing-data-classification")[0].file, "Quality.al");
  assert.equal(by("missing-data-classification")[0].line, 7);

  // The table field's ToolTip counts; the label field is no data field.
  assert.deepEqual(by("missing-tooltip").map(({ message }) => message), ["page 50103 Q Item Card: 1 field(s) without a ToolTip: No."]);
  assert.equal(by("missing-tooltip")[0].severity, "info");

  assert.deepEqual(by("obsolete-without-tag").map(({ message }) => message).sort(), [
    "codeunit 50104 Q Item API: obsolete without an ObsoleteTag (the version it was marked in): procedure Legacy",
    "table 50100 Q Item: obsolete without an ObsoleteTag (the version it was marked in): field Old"
  ]);
  assert.deepEqual(by("obsolete-without-reason").map(({ message }) => message), ["table 50100 Q Item: obsolete without an ObsoleteReason (what to use instead): field Old"]);

  // GetItem's summary survives the #pragma and the attribute; internal codeunits are no API.
  assert.deepEqual(by("undocumented-public-api").map(({ message }) => message), ["codeunit 50104 Q Item API: 2 public procedure(s) without a /// summary: Undocumented, Legacy"]);
  assert.deepEqual(by("high-complexity"), [], "complexity 5 is below the default of 25");
  assert.equal(report.thresholds.maxComplexity, 25);
});

test("check.severities and check.maxComplexity tune the quality rules", () => {
  const report = check({ maxComplexity: 4, severities: { "missing-tooltip": "error", "undocumented-public-api": "off" } });
  const by = (rule) => report.findings.filter((finding) => finding.rule === rule);
  assert.equal(by("missing-tooltip")[0].severity, "error");
  assert.equal(report.passed, false, "an error fails the check");
  assert.deepEqual(by("undocumented-public-api"), []);
  assert.deepEqual(by("high-complexity").map(({ message }) => message), ["codeunit 50104 Q Item API: 1 procedure(s) above complexity 4: Branchy (5)"]);
});
