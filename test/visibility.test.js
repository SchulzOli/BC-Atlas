import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { testing } from "../src/analyzer.js";
import { loadProject } from "../src/project.js";
import { resolveModel } from "../src/resolver.js";
import { analyzeVisibility } from "../src/visibility.js";

const multiApp = fileURLToPath(new URL("../examples/multi-app", import.meta.url));

const SOURCE = `
  namespace Demo;
  interface "Price Rule" { procedure Price(): Decimal; }
  codeunit 50100 "Standard Rule" implements "Price Rule" {
    procedure Price(): Decimal begin exit(Rounded()); end;
    procedure Rounded(): Decimal begin exit(1); end;
  }
  codeunit 50101 Calculator {
    Access = Internal;
    procedure Total(): Decimal
    var Rule: Codeunit "Standard Rule";
    begin
      exit(Rule.Price() + Helper());
    end;
    internal procedure Helper(): Decimal begin exit(Hidden()); end;
    local procedure Hidden(): Decimal begin exit(0); end;
    procedure Shared(): Decimal begin exit(0); end;
  }
  codeunit 50102 Publisher {
    procedure Run() var Calc: Codeunit Calculator; begin Calc.Shared(); OnDone(); end;
    [IntegrationEvent(false, false)]
    local procedure OnDone() begin end;
    [InternalEvent(false)]
    internal procedure OnInside() begin end;
  }
  codeunit 50103 Listener {
    [EventSubscriber(ObjectType::Codeunit, Codeunit::Publisher, 'OnDone', '', false, false)]
    procedure Handle() begin end;
  }
  table 50104 Ledger {
    fields {
      field(1; "Entry No."; Integer) { }
      field(2; Secret; Text[30]) { Access = Internal; }
      field(3; Scratch; Integer) { Access = Local; }
    }
    trigger OnInsert() var Calc: Codeunit Calculator; begin Calc.Total(); end;
  }
  enum 50105 Mode { Extensible = true; value(0; A) { } }
  query 50106 Entries { elements { dataitem(Ledger; Ledger) { column(EntryNo; "Entry No.") { } } } }
`;

async function analysis() {
  const parsed = await testing.objectsFromSource(SOURCE, "visibility.al");
  const model = resolveModel({ objects: parsed.objects, diagnostics: [] });
  return { model, result: analyzeVisibility(model) };
}

test("every object, procedure, event, and field has one of three levels", async () => {
  const { result } = await analysis();
  const point = (name, parent) => result.points.find((candidate) => candidate.name === name && (!parent || result.points.find(({ id }) => id === candidate.parent)?.name === parent));
  const level = (name, parent) => point(name, parent).level;

  assert.deepEqual(result.levels, ["public", "internal", "local"]);
  assert.equal(level("Standard Rule"), "public");
  assert.equal(level("Calculator"), "internal", "Access = Internal");
  assert.equal(level("Total"), "internal", "a member is never wider than its object");
  assert.equal(level("Hidden"), "local");
  assert.equal(level("Rounded"), "public");
  assert.equal(level("OnDone"), "public", "an event is as wide as who may subscribe, whoever may raise it");
  assert.equal(level("OnInside"), "internal");
  assert.equal(level("Entry No."), "public");
  assert.equal(level("Secret"), "internal");
  assert.equal(level("Scratch"), "local");
  assert.equal(result.points.some(({ name }) => name === "OnInsert"), false, "a trigger has no level");
  assert.equal(result.points.filter(({ kind }) => kind === "app").length, 1);
});

test("says what a data point can be, and why not where it is no choice", async () => {
  const { result } = await analysis();
  const point = (name) => result.points.find((candidate) => candidate.name === name);

  assert.equal(point("Rounded").canBe, "local", "only its own object calls it");
  assert.equal(point("Helper").canBe, "local");
  assert.equal(point("Shared").canBe, undefined, "another object of the app calls it, and it is internal already");
  assert.equal(point("Total").canBe, undefined, "a trigger of another object calls it");
  assert.equal(point("Handle").canBe, "local");
  assert.match(point("Handle").why, /subscriber/u);
  assert.equal(point("Price").canBe, undefined);
  assert.deepEqual(result.points.filter(({ name }) => name === "Price").map(({ why }) => why).sort(), ["implements an interface", "part of an interface"]);
  assert.equal(point("OnDone").canBe, undefined, "events are extension points");

  assert.equal(point("Standard Rule").canBe, "internal", "no other app uses it");
  assert.equal(point("Publisher").why, "publishes events");
  assert.equal(point("Mode").why, "extensible enum");
  assert.equal(point("Entries").canBe, "internal");
  assert.equal(point("Ledger").canBe, undefined, "tables stay public: other apps extend them");
  assert.equal(point("Price Rule").canBe, undefined);
  assert.equal(result.summary.canBe.internal + result.summary.canBe.local, result.points.filter(({ canBe }) => canBe).length);
});

test("a use is as wide as the border it crosses", async () => {
  const { result } = await analysis();
  const name = (id) => result.points.find((point) => point.id === id).name;
  const use = (from, to) => result.uses.find((entry) => name(entry.from) === from && name(entry.to) === to);

  assert.equal(use("Helper", "Hidden").level, "local");
  assert.equal(use("Total", "Helper").level, "local");
  assert.equal(use("Run", "Shared").level, "internal");
  assert.deepEqual(use("Handle", "OnDone").kinds, { subscribes: 1 });
  assert.equal(use("Ledger", "Total").level, "internal", "what a trigger calls is used by its object");
  assert.ok(use("Standard Rule", "Price Rule").kinds.implements);

  const visibility = analyzeVisibility((await loadProject(multiApp)).project);
  const crossing = visibility.uses.filter(({ level }) => level === "public");
  assert.ok(crossing.length > 0, "uses between the apps of a workspace are public");
  assert.ok(crossing.every(({ from, to }) => from.split("::")[0] !== to.split("::")[0]));
  const quoteMgt = visibility.points.find(({ name: label, kind }) => kind === "object" && label === "CON Quote Mgt.");
  assert.equal(quoteMgt.canBe, undefined, "another app uses it");
  assert.equal(visibility.points.find(({ name: label }) => label === "Recalculate").canBe, undefined);
});
