import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assessArchitecture, evaluateArchitecture, proposeArchitecture } from "../src/blueprint/index.js";
import { compareWithBaseline, createBaseline } from "../src/blueprint/baseline.js";
import { componentMatcher } from "../src/blueprint/components.js";
import { createGraphDocument } from "../src/graph/document.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspace = path.join(root, "examples", "multi-app");
const cli = path.join(root, "src", "cli.js");

const LAYERED = {
  components: [
    { name: "Core", layer: 0, match: ["app:Contoso Core"] },
    { name: "Sales", layer: 1, match: ["app:Contoso Sales"], dependsOn: ["Core"] },
    { name: "Integration", layer: 2, match: ["app:Contoso Integration"], dependsOn: ["Sales"] }
  ]
};

function copyWorkspace(architecture) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-blueprint-"));
  cpSync(workspace, directory, { recursive: true });
  if (architecture) writeFileSync(path.join(directory, ".bca.json"), JSON.stringify({ architecture }, null, 2));
  return directory;
}

test("checks dependencies against components, layers, and dependsOn", async () => {
  const directory = copyWorkspace(LAYERED);
  try {
    const { result } = await assessArchitecture(directory);
    assert.equal(result.summary.components, 3);
    assert.equal(result.summary.unassigned, 0);
    assert.equal(result.violations.length, 1);
    const [violation] = result.violations;
    assert.equal(violation.rule, "undeclared-component-dependency");
    assert.equal(`${violation.source.label} -> ${violation.target.label}`, "CON Item Sync -> CON Item");
    // Core lies further in, so declaring the dependency is the simple fix.
    assert.equal(violation.resolution.strategy, "declare-dependency");
    assert.equal(violation.resolution.alternatives[0].strategy, "use-facade");

    const components = new Map(result.components.map((component) => [component.name, component]));
    assert.equal(components.get("Core").metrics.instability, 0);
    assert.equal(components.get("Integration").metrics.instability, 1);
    assert.equal(components.get("Integration").extractable, false);
    assert.equal(components.get("Sales").extractable, true);
    assert.equal(result.workItems.length, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("explains how to resolve outward dependencies in AL terms", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-outward-"));
  try {
    mkdirSync(path.join(directory, "Core"));
    mkdirSync(path.join(directory, "Sales"));
    writeFileSync(path.join(directory, "app.json"), JSON.stringify({ id: "c0000000-0000-0000-0000-000000000001", name: "Monolith", publisher: "Contoso" }));
    writeFileSync(path.join(directory, "Sales", "Sales.al"), `
namespace Contoso.Sales;
table 50100 "Sales Doc" { fields { field(1; "No."; Code[20]) { } } }
codeunit 50101 "Sales Post"
{
    procedure Post() begin end;
    [IntegrationEvent(false, false)]
    procedure OnPosted() begin end;
}
`);
    writeFileSync(path.join(directory, "Core", "Core.al"), `
namespace Contoso.Core;
using Contoso.Sales;
table 50000 "Core Setup" { fields { field(1; "Last Doc"; Code[20]) { TableRelation = "Sales Doc"."No."; } } }
tableextension 50001 "Sales Doc Ext" extends "Sales Doc" { fields { field(50000; Flag; Boolean) { } } }
codeunit 50002 "Core Caller"
{
    procedure Run()
    var
        Posting: Codeunit "Sales Post";
    begin
        Posting.Post();
    end;
}
codeunit 50003 "Core Subscriber"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"Sales Post", 'OnPosted', '', false, false)]
    local procedure HandlePosted() begin end;
}
permissionset 50004 "CORE ALL" { Permissions = tabledata "Sales Doc" = R; }
`);
    writeFileSync(path.join(directory, ".bca.json"), JSON.stringify({
      architecture: {
        components: [
          { name: "Core", layer: 0, match: ["namespace:Contoso.Core"] },
          { name: "Sales", layer: 1, match: ["namespace:Contoso.Sales"] }
        ]
      }
    }));
    const { result } = await assessArchitecture(directory);
    const strategy = (label) => result.violations.find(({ source }) => source.label === label)?.resolution.strategy;
    assert.ok(result.violations.every(({ rule }) => rule === "outward-dependency"));
    assert.equal(strategy("Core Setup"), "move-field-to-extension");
    assert.equal(strategy("Sales Doc Ext"), "move-extension");
    assert.equal(strategy("Core Caller"), "extract-interface");
    assert.equal(strategy("Core Subscriber"), "move-subscriber");
    assert.equal(strategy("CORE ALL"), "move-permissions");
    assert.equal(result.components.find(({ name }) => name === "Core").extractable, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("proposes components and layers that follow today's dependencies", async () => {
  const { levels, proposal, result } = await assessArchitecture(workspace, { propose: true, groupBy: "namespace" });
  assert.deepEqual(proposal.architecture.components.map(({ name, layer, dependsOn }) => [name, layer, dependsOn]), [
    ["Core", 0, []],
    ["Sales", 1, ["Core"]],
    ["Integration", 2, ["Core", "Sales"]]
  ]);
  assert.equal(result.violations.length, 0);
  assert.equal(result.summary.extractable, 3);
  assert.deepEqual(proposal.moves.map(({ object, to }) => [object.label, to]), [["CON Quote Export", "Sales"]]);

  // A dependency against the grain becomes the one thing to resolve.
  const cyclic = structuredClone(levels);
  const core = cyclic.object.nodes.find(({ label }) => label === "CON Item");
  const sales = cyclic.object.nodes.find(({ label }) => label === "CON Quote Mgt.");
  cyclic.object.edges.push({ id: "back", source: core.id, target: sales.id, kinds: { calls: 1 }, weight: 1, evidence: [] });
  const backwards = proposeArchitecture(cyclic, { groupBy: "namespace" });
  assert.deepEqual(backwards.feedback, [{ source: "Core", target: "Sales", objectEdges: 1 }]);
  const checked = evaluateArchitecture(cyclic, backwards.architecture);
  assert.deepEqual(checked.violations.map(({ source, target }) => `${source.label} -> ${target.label}`), ["CON Item -> CON Quote Mgt."]);
});

test("the most specific selector assigns an object", () => {
  const levels = { app: { nodes: [] }, object: { nodes: [] } };
  const assign = componentMatcher([
    { name: "Everything", match: ["*"] },
    { name: "Sales", match: ["namespace:Contoso.Sales"] },
    { name: "Documents", match: ["namespace:Contoso.Sales.Document"] },
    { name: "Posting", match: ["object:codeunit:Sales-Post"] }
  ], levels);
  assert.equal(assign({ namespace: "Contoso.Sales.Document", type: "table", label: "Sales Header" }), "Documents");
  assert.equal(assign({ namespace: "Contoso.Sales.Setup", type: "table", label: "Sales Setup" }), "Sales");
  assert.equal(assign({ namespace: "Contoso.Sales.Document", type: "codeunit", label: "Sales-Post" }), "Posting");
  assert.equal(assign({ namespace: "Other", type: "page", label: "Other" }), "Everything");
  assert.throws(() => componentMatcher([{ name: "A", match: ["layer:1"] }], levels), /Unsupported component selector kind/u);
  assert.throws(() => componentMatcher([{ name: "A", match: ["*"], dependsOn: ["B"] }], levels), /unknown component "B"/u);
});

test("the baseline accepts today's violations and only lets them shrink", () => {
  const violation = (id) => ({ id, sourceComponent: "A", targetComponent: "B", source: { type: "codeunit", label: id }, target: { type: "table", label: "T" } });
  const baseline = createBaseline([violation("one"), violation("two")]);
  const compared = compareWithBaseline([violation("two"), violation("three")], baseline);
  assert.deepEqual(compared.new.map(({ id }) => id), ["three"]);
  assert.deepEqual(compared.known.map(({ id }) => id), ["two"]);
  assert.deepEqual(compared.fixed.map(({ id }) => id), ["one"]);
  assert.equal(compareWithBaseline([violation("x")], undefined).new.length, 1);
});

test("bca architecture and bca check enforce the architecture with a baseline", () => {
  const directory = copyWorkspace(LAYERED);
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  try {
    const failing = run("architecture", directory);
    assert.equal(failing.status, 1, failing.stderr);
    assert.match(failing.stdout, /1 of them point the wrong way/u);
    assert.match(failing.stdout, /\[S\] Declare the dependency; it points inward: codeunit 50201 CON Item Sync \(Integration -> Core\)/u);

    const check = run("check", directory);
    assert.equal(check.status, 1);
    assert.match(check.stdout, /ERROR {2}codeunit CON Item Sync \(Integration\) depends on 1 object\(s\) in Core/u);

    assert.equal(run("architecture", directory, "--update-baseline").status, 0);
    assert.ok(existsSync(path.join(directory, ".bca-architecture-baseline.json")));
    assert.equal(run("architecture", directory).status, 0);
    const accepted = run("check", directory);
    assert.equal(accepted.status, 0, accepted.stdout);
    assert.match(accepted.stdout, /1 accepted architecture violation\(s\) remain in the baseline/u);

    const json = JSON.parse(run("architecture", directory, "--format", "json").stdout);
    assert.equal(json.schema, "bc-atlas.architecture");
    assert.equal(json.baseline.known, 1);
    assert.equal(json.workItems[0].strategy, "declare-dependency");

    const markdown = run("architecture", directory, "--propose", "--format", "markdown").stdout;
    assert.match(markdown, /```mermaid/u);
    assert.match(markdown, /## Adopt this architecture/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("--write saves a proposal to .bca.json", () => {
  const directory = copyWorkspace();
  try {
    const result = spawnSync(process.execPath, [cli, "architecture", directory, "--propose", "--group-by", "app", "--write"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const saved = JSON.parse(readFileSync(path.join(directory, ".bca.json"), "utf8")).architecture;
    assert.deepEqual(saved.components.map(({ name }) => name), ["Contoso Core", "Contoso Sales", "Contoso Integration"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the explorer shows components and violations per frame", async () => {
  const directory = copyWorkspace(LAYERED);
  try {
    const document = await createGraphDocument(directory);
    assert.equal(document.architecture.mode, "configured");
    assert.equal(document.architecture.summary.violations, 1);
    assert.deepEqual(document.levels.component.edges.map(({ id, dependency }) => [id, dependency]).sort(), [
      ["component::Integration->component::Core", "violation"],
      ["component::Integration->component::Sales", "allowed"],
      ["component::Sales->component::Core", "allowed"]
    ]);
    const edge = document.levels.object.edges.find(({ violation }) => violation);
    assert.equal(edge.violation.strategy, "declare-dependency");
    assert.equal(document.timeline.frames.at(-1).violations, 1);
    assert.ok(document.levels.object.nodes.filter(({ origin }) => origin === "workspace").every(({ component }) => component));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
