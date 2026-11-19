import test from "node:test";
import assert from "node:assert/strict";

import { testing } from "../src/analyzer.js";
import { dependencyLens } from "../src/graph/lenses/dependency.js";
import { aggregateRelations } from "../src/relation-aggregation.js";
import { resolveModel } from "../src/resolver.js";
import { createView } from "../src/views.js";

test("dependency graph preserves binding evidence without inflating operation coupling", async () => {
  const source = `
namespace Demo;
enum 50100 Choice
{
    DefaultImplementation = "Demo.Contract" = Handler;
    UnknownValueImplementation = "Demo.Contract" = Handler;
    value(0; Explicit)
    {
        Implementation = "Demo.Contract" = Handler;
    }
}
interface "Demo.Contract"
{
    procedure Execute();
}
codeunit 50101 Handler
{
    procedure Execute()
    begin
    end;
}
codeunit 50102 Caller
{
    var
        HandlerRef: Codeunit Handler;
    procedure Run()
    begin
        HandlerRef.Execute();
    end;
}
`;
  const parsed = await testing.objectsFromSource(source, "contracts.al");
  const model = resolveModel({ objects: parsed.objects, apps: [], diagnostics: [] });
  const choice = model.objects.find(({ name }) => name === "Choice");
  const handler = model.objects.find(({ name }) => name === "Handler");
  const caller = model.objects.find(({ name }) => name === "Caller");
  const projection = dependencyLens(model);
  const choiceEdge = projection.object.edges.find(({ source, target }) =>
    source === choice.key && target === handler.key
  );
  const bindingEvidence = choiceEdge.evidence.filter(({ kind }) => kind === "selects");

  assert.equal(choiceEdge.kinds.selects, 3);
  assert.deepEqual(bindingEvidence.map(({ bindingKind, contract, member, line }) => ({
    bindingKind,
    contract,
    ...(member ? { member } : {}),
    line
  })), [
    { bindingKind: "default", contract: "Demo.Contract", line: 5 },
    { bindingKind: "unknownValue", contract: "Demo.Contract", line: 6 },
    { bindingKind: "explicit", contract: "Demo.Contract", member: "Explicit", line: 9 }
  ]);
  assert.ok(bindingEvidence.every(({ file }) => file === "contracts.al"));

  const resolvedBindings = model.edges.filter(({ from, to, kind }) =>
    from === choice.key && to === handler.key && kind === "selects"
  );
  const aggregated = aggregateRelations(resolvedBindings, {
    identity: (edge) => `${edge.from}|${edge.to}|${edge.kind}`
  })[0];
  assert.deepEqual(aggregated.evidence.map(({ bindingKind, contract, member, location }) => ({
    bindingKind,
    contract,
    ...(member ? { member } : {}),
    file: location.file,
    line: location.line
  })), [
    { bindingKind: "default", contract: "Demo.Contract", file: "contracts.al", line: 5 },
    { bindingKind: "unknownValue", contract: "Demo.Contract", file: "contracts.al", line: 6 },
    { bindingKind: "explicit", contract: "Demo.Contract", member: "Explicit", file: "contracts.al", line: 9 }
  ]);

  const callerEdge = projection.object.edges.find(({ source, target }) =>
    source === caller.key && target === handler.key
  );
  assert.equal(callerEdge.kinds.calls, 1);
  const calls = createView(model, "call");
  assert.equal(calls.edges.filter(({ kind, to }) => kind === "calls" && to).length, 1);
});
