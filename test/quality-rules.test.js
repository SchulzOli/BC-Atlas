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

test("undocumented-public-api is the one quality rule; what the AL analyzers check is not repeated", () => {
  const report = check();
  const rules = new Set(report.findings.map(({ rule }) => rule));
  for (const rule of ["missing-data-classification", "missing-tooltip", "obsolete-without-tag", "obsolete-without-reason", "high-complexity"]) {
    assert.equal(rules.has(rule), false, `${rule} is left to the AL analyzers`);
  }
  // GetItem's summary survives the #pragma and the attribute; internal codeunits are no API.
  const [finding, ...rest] = report.findings.filter(({ rule }) => rule === "undocumented-public-api");
  assert.deepEqual(rest, []);
  assert.equal(finding.message, "codeunit 50104 Q Item API: 2 public procedure(s) without a /// summary: Undocumented, Legacy");
  assert.equal(finding.severity, "info");
  assert.equal(finding.file, "Quality.al");
  assert.equal(report.thresholds.maxComplexity, undefined);
});

test("check.severities tunes undocumented-public-api", () => {
  const error = check({ severities: { "undocumented-public-api": "error" } });
  assert.equal(error.findings.find(({ rule }) => rule === "undocumented-public-api").severity, "error");
  assert.equal(error.passed, false, "an error fails the check");
  const off = check({ severities: { "undocumented-public-api": "off" } });
  assert.deepEqual(off.findings.filter(({ rule }) => rule === "undocumented-public-api"), []);
});
