import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { testing } from "../src/analyzer.js";
import { createArchitectureModel } from "../src/architecture.js";
import { renderD2 } from "../src/d2.js";
import { prepareScene, sceneToSvg } from "../src/diagram/index.js";
import { resolveModel } from "../src/resolver.js";
import { createView } from "../src/views.js";
import { analyzeVisibility, compactVisibility, LEVEL_COLORS, reachKind } from "../src/visibility.js";

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

  const { model } = await createArchitectureModel(multiApp, { view: "visibility" });
  const crossing = model.visibility.uses.filter(({ level }) => level === "public");
  assert.ok(crossing.length > 0, "uses between the apps of a workspace are public");
  assert.ok(crossing.every(({ from, to }) => from.split("::")[0] !== to.split("::")[0]));
  const quoteMgt = model.visibility.points.find(({ name: label, kind }) => kind === "object" && label === "CON Quote Mgt.");
  assert.equal(quoteMgt.canBe, undefined, "another app uses it");
  assert.equal(model.visibility.points.find(({ name: label }) => label === "Recalculate").canBe, undefined);
});

test("the visibility view draws objects, or every member inside its object, in the level colors", async () => {
  const { model } = await analysis();
  const objects = createView(model, "visibility");
  const calculator = objects.objects.find(({ name }) => name === "Calculator");
  assert.equal(objects.objects.length, 8);
  assert.equal(calculator.level, "internal");
  assert.deepEqual(calculator.notes, ["internal", "members: 3 internal, 1 local", "1 can be narrower"]);
  assert.ok(objects.edges.every(({ kind }) => kind === reachKind("internal")), "one app: every relation between objects is internal");

  const d2 = renderD2(objects, { groupBy: "namespace" });
  assert.match(d2, new RegExp(`style.fill: "${LEVEL_COLORS.internal.fill}"`, "u"));
  assert.match(d2, /public \(other apps\) #D55E00, internal \(this app\) #0072B2, local \(this object\) #009E73/u, "the legend names all three levels");
  assert.match(d2, /Dashed border: the uses found need less/u);

  const members = createView(model, "visibility", { expandProcedures: true });
  const hidden = members.objects.find(({ name }) => name === "Hidden");
  assert.equal(hidden.viewGroup, "codeunit 50101 Calculator (internal)");
  assert.equal(hidden.level, "local");
  assert.ok(members.objects.some(({ name, type }) => name === "Mode" && type === "enum"), "an object without members is its own data point");
  assert.ok(members.edges.some(({ kind }) => kind === reachKind("local")));
  const prepared = prepareScene(members, { groupBy: "namespace" }, { expand: "all" });
  const group = prepared.scene.groups.find(({ label }) => label.startsWith("codeunit 50101"));
  assert.equal(group.stroke, LEVEL_COLORS.internal.color, "the box of an object wears its level");
  const svg = await sceneToSvg(prepared.scene);
  assert.ok(svg.includes(`stroke="${LEVEL_COLORS.local.color}"`));

  const focused = createView(model, "visibility", { focus: "Listener" });
  assert.ok(["Listener", "Publisher"].every((name) => focused.objects.some((object) => object.name === name)), "what matches, and what it is connected to");
  assert.equal(focused.objects.some(({ name }) => name === "Mode"), false);
  assert.throws(() => createView(model, "visibility", { focus: "Nowhere" }), /did not match/u);
});

test("a path filter keeps the uses from outside it", async () => {
  const { model } = await createArchitectureModel(`${multiApp}/core`, { view: "visibility", projectRoot: multiApp });
  const pricing = model.visibility.points.find(({ name, kind }) => kind === "object" && name === "CON Pricing Mgt.");
  assert.ok(pricing, "the objects of the selected folder are the data points");
  assert.equal(model.visibility.points.some(({ name }) => name === "CON Quote Mgt."), false);
  assert.equal(model.visibility.points.find(({ name }) => name === "Calculate").canBe, undefined, "the sales app outside the filter calls it");
});

test("the canvas gets the data points as arrays and packs circles without overlap", async () => {
  const { result } = await analysis();
  const compact = compactVisibility(result);
  assert.equal(compact.points.length, result.points.length);
  const [kind, parent, , , level] = compact.points[0];
  assert.deepEqual([kind, parent, level], ["app", -1, 0]);
  assert.ok(compact.points.every(([, owner], index) => owner < index), "a point comes after what it is in");
  assert.ok(compact.uses.every(([from, to, reach]) => compact.points[from] && compact.points[to] && reach >= 0 && reach <= 2));
  const calculator = compact.points.find(([, , name]) => name === "codeunit 50101 Calculator");
  assert.equal(typeof calculator[7], "string", "an object links to its page");

  await import("../src/app/ui/visibility-canvas.js");
  const { pack, index } = globalThis.BCA_VISIBILITY;
  const indexed = index(compact);
  assert.equal(indexed.roots.length, 1);
  const total = indexed.points.find(({ name }) => name === "Total");
  assert.ok(total.out.length >= 2 && total.in.length >= 1, "a procedure opens to what it uses and what uses it");
  for (const radii of [[1], [2, 1], Array.from({ length: 300 }, (_, position) => 1 + (position % 5))]) {
    const circles = pack(radii);
    assert.equal(circles.length, radii.length);
    assert.ok(circles.every(({ x, y, r }) => Math.hypot(x, y) + r <= 0.931), "inside the unit circle");
    for (let a = 0; a < circles.length; a++) {
      for (let b = a + 1; b < circles.length; b++) {
        assert.ok(Math.hypot(circles[a].x - circles[b].x, circles[a].y - circles[b].y) >= circles[a].r + circles[b].r, "no two circles overlap");
      }
    }
  }
});
