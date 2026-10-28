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
  // Weighted by coupling: CON Item Sync writes Core's table, so it is bound to Core more than to Integration.
  assert.deepEqual(proposal.moves.map(({ object, to, gain }) => [object.label, to, gain]), [["CON Quote Export", "Sales", 9], ["CON Item Sync", "Core", 8]]);

  // A dependency against the grain becomes the one thing to resolve.
  const cyclic = structuredClone(levels);
  const core = cyclic.object.nodes.find(({ label }) => label === "CON Item");
  const sales = cyclic.object.nodes.find(({ label }) => label === "CON Quote Mgt.");
  cyclic.object.edges.push({ id: "back", source: core.id, target: sales.id, kinds: { calls: 1 }, weight: 1, evidence: [] });
  const backwards = proposeArchitecture(cyclic, { groupBy: "namespace" });
  assert.deepEqual(backwards.feedback, [{ source: "Core", target: "Sales", objectEdges: 1, coupling: 2 }]);
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
  assert.throws(() => componentMatcher([{ name: "A", match: ["layer:1"] }], levels), /work in architecture rules/u);
  assert.throws(() => componentMatcher([{ name: "A", match: ["*"], dependsOn: ["B"] }], levels), /unknown component "B"/u);
});

// The multi-app example with "CON Pricing Mgt." (used by Sales) marked Access = Internal.
function workspaceWithInternalPricing(architecture) {
  const directory = copyWorkspace(architecture);
  const file = path.join(directory, "core", "Pricing.al");
  writeFileSync(file, readFileSync(file, "utf8").replace('codeunit 50011 "CON Pricing Mgt."\n{', 'codeunit 50011 "CON Pricing Mgt."\n{\n    Access = Internal;\n'));
  return directory;
}

test("rules for layers, public objects, and dependencies", async () => {
  const directory = workspaceWithInternalPricing({
    components: [
      { name: "Core", layer: 0, match: ["app:Contoso Core"] },
      { name: "Sales", layer: 1, match: ["app:Contoso Sales"] },
      { name: "Integration", layer: 2, match: ["app:Contoso Integration"] }
    ],
    strictLayers: true,
    rules: [
      { name: "no-table-access", from: "component:Integration", to: "type:table", kinds: ["reads", "writes"], across: true, resolution: "Call a codeunit of the owning component." },
      { name: "core-uses-nothing-outside", from: "layer:0", to: "*", except: ["layer:0"] }
    ]
  });
  try {
    const { result } = await assessArchitecture(directory);
    const rules = (rule) => result.violations.filter((violation) => violation.rule === rule);

    // Access = Internal: Sales may use Core, but not its internal codeunit.
    const [internal] = rules("internal-access");
    assert.equal(`${internal.source.label} -> ${internal.target.label}`, "CON Quote Mgt. -> CON Pricing Mgt.");
    assert.equal(internal.resolution.strategy, "use-public-api");
    assert.match(internal.resolution.steps[1], /set Access = Public/u);
    assert.match(internal.id, /^internal:Sales->Core\|/u);

    // Strict layers: Integration (2) may use Sales (1) but not Core (0).
    const [skip] = rules("layer-skip-dependency");
    assert.equal(`${skip.sourceComponent} -> ${skip.targetComponent}`, "Integration -> Core");
    assert.equal(skip.resolution.strategy, "go-through-layer");
    assert.match(skip.resolution.steps[0], /through Sales/u);

    // A rule of .bca.json with kinds and across; Core uses nothing outside its layer.
    const policy = rules("dependency-rule");
    assert.deepEqual([...new Set(policy.map((violation) => violation.policy))], ["no-table-access"]);
    assert.deepEqual(policy.map(({ target }) => target.label).sort(), ["CON Item", "CON Sales Quote"]);
    assert.equal(policy[0].resolution.strategy, "follow-rule");
    assert.equal(policy[0].resolution.steps[0], "Call a codeunit of the owning component.");
    assert.match(policy[0].id, /^rule:no-table-access\|/u);
    assert.deepEqual(result.summary.byRule, { "dependency-rule": 2, "internal-access": 1, "layer-skip-dependency": 1 });

    // Rules of .bca.json do not decide whether a component can become an app.
    const components = new Map(result.components.map((component) => [component.name, component]));
    assert.equal(components.get("Sales").extractable, false, "uses an internal object of Core");
    assert.equal(components.get("Core").extractable, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("exposes limits what other components may use; severities turn rules off", async () => {
  const levels = (await assessArchitecture(workspace)).levels;
  const evaluate = (extra, core = {}) => evaluateArchitecture(levels, {
    components: [
      { name: "Core", layer: 0, match: ["app:Contoso Core"], ...core },
      { name: "Sales", layer: 1, match: ["app:Contoso Sales"] },
      { name: "Integration", layer: 2, match: ["app:Contoso Integration"] }
    ],
    ...extra
  });
  const exposed = evaluate({}, { exposes: ["type:interface", "object:codeunit:CON Pricing Mgt."] });
  const internal = exposed.violations.filter(({ rule }) => rule === "internal-access").map(({ source, target }) => `${source.label} -> ${target.label}`).sort();
  assert.deepEqual(internal, ["CON Item Sync -> CON Item", "CON Sales Quote -> CON Item"], "Core does not expose its table CON Item");
  assert.match(exposed.violations.find(({ rule }) => rule === "internal-access").resolution.steps[1], /add it to exposes of Core/u);

  const off = evaluate({ severities: { "internal-access": "off" } }, { exposes: ["type:interface"] });
  assert.equal(off.violations.length, 0);
  assert.throws(() => evaluate({ severities: { "no-such-rule": "error" } }), /unknown rule "no-such-rule"/u);
  assert.throws(() => evaluate({ severities: { "empty-component": "loud" } }), /must be one of: error, warning, info, off/u);
  assert.throws(() => evaluate({ rules: [{ from: "*" }] }), /needs "from" and "to"/u);
  assert.throws(() => evaluate({ rules: [{ from: "*", to: "*", kinds: ["eats"] }] }), /unknown relation kind\(s\) eats/u);
});

test("checks the architecture configuration itself", async () => {
  const levels = (await assessArchitecture(workspace)).levels;
  const result = evaluateArchitecture(levels, {
    components: [
      { name: "Core", layer: 0, match: ["app:Contoso Core", "namespace:Contoso.Legacy"], dependsOn: ["Integration"] },
      { name: "Sales", layer: 1, match: ["app:Contoso Sales"], dependsOn: ["Core"], maxObjects: 2 },
      { name: "Integration", layer: 2, match: ["app:Contoso Integration"], dependsOn: ["Sales", "Core", "Reporting"] },
      { name: "Reporting", layer: 2, match: ["namespace:Contoso.Reporting"] }
    ],
    severities: { "unstable-dependency": "off" }
  });
  const checks = Object.fromEntries(Object.entries(Object.groupBy(result.checks, ({ rule }) => rule)).map(([rule, list]) => [rule, list.map(({ message }) => message)]));
  assert.deepEqual(checks["empty-component"], ["Component Reporting has no objects; no object matches namespace:Contoso.Reporting"]);
  assert.match(checks["unused-selector"][0], /Selector "namespace:Contoso.Legacy" of component Core assigns no object/u);
  assert.match(checks["unused-component-dependency"][0], /Core declares a dependency on Integration but uses none of its objects/u);
  assert.match(checks["inconsistent-component-dependency"][0], /Core \(layer 0\) declares a dependency on Integration \(layer 2\)/u);
  assert.match(checks["declared-component-cycle"][0], /The declared dependencies form a cycle: Core -> Integration -> Sales -> Core/u);
  assert.deepEqual(checks["component-too-large"], ["Component Sales has 4 objects (limit 2); split it into smaller components"]);
  assert.equal(checks["unstable-dependency"], undefined, "turned off");
  assert.equal(result.checks.find(({ rule }) => rule === "empty-component").severity, "warning");
  assert.equal(result.summary.checks, result.checks.length);
});

test("bca check reports architecture rules with their own rule IDs and points configuration checks at .bca.json", () => {
  const directory = workspaceWithInternalPricing({
    components: [
      { name: "Core", layer: 0, match: ["app:Contoso Core"] },
      { name: "Sales", layer: 1, match: ["app:Contoso Sales"], dependsOn: ["Core"] },
      { name: "Integration", layer: 2, match: ["app:Contoso Integration"], dependsOn: ["Sales", "Core"] },
      { name: "Reporting", layer: 2, match: ["namespace:Contoso.Reporting"] }
    ],
    rules: [{ name: "no-table-writes", from: "component:Integration", to: "type:table", kinds: ["writes"], severity: "warning", message: "Only the owning component writes its tables" }]
  });
  try {
    const run = spawnSync(process.execPath, [cli, "check", directory, "--format", "json"], { encoding: "utf8" });
    assert.equal(run.status, 1, run.stderr);
    const findings = JSON.parse(run.stdout).findings;
    const internal = findings.find(({ rule }) => rule === "internal-access");
    assert.equal(internal.severity, "error");
    assert.match(internal.message, /codeunit CON Quote Mgt\. \(Sales\) uses 1 internal object\(s\) of Core \(codeunit CON Pricing Mgt\.\)/u);
    assert.equal(internal.file, "sales/Quotes.al");
    const policy = findings.find(({ rule }) => rule === "dependency-rule");
    assert.equal(policy.severity, "warning");
    assert.equal(policy.policy, "no-table-writes");
    assert.match(policy.message, /breaks rule "no-table-writes": Only the owning component writes its tables/u);
    const empty = findings.find(({ rule }) => rule === "empty-component");
    assert.equal(empty.file, ".bca.json");
    const config = readFileSync(path.join(directory, ".bca.json"), "utf8").split("\n");
    assert.match(config[empty.line - 1], /"name": "Reporting"/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
    assert.match(failing.stdout, /1 of them points the wrong way/u);
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

test("coupling weights what it takes to cut a dependency", async () => {
  const { coupling, couplingWeights, COUPLING_WEIGHTS } = await import("../src/graph/coupling.js");
  assert.equal(coupling({ writes: 1 }), 5);
  assert.equal(coupling({ subscribes: 1 }), 1);
  assert.ok(coupling({ calls: 10 }) < 10 * coupling({ calls: 1 }), "repeated uses count logarithmically");
  assert.ok(coupling({ permits: 50 }) < coupling({ uses: 1 }), "permission grants barely bind");
  assert.equal(couplingWeights({ writes: 8 }).writes, 8);
  assert.equal(couplingWeights({ writes: 8 }).calls, COUPLING_WEIGHTS.calls);
  assert.throws(() => couplingWeights({ eats: 1 }), /unknown relation kind "eats"/u);
  assert.throws(() => couplingWeights({ writes: -1 }), /must be a number of 0 or more/u);
});

test("grouping by coupling forms components from namespaces that belong together, and every architecture gets a quality score", async () => {
  const monolith = path.join(root, "examples", "monolith");
  const { proposal, result } = await assessArchitecture(monolith, { propose: true, groupBy: "coupling" });
  assert.deepEqual(proposal.architecture.components.map(({ name, match }) => [name, match]).sort(), [
    ["Core", ["namespace:Contoso.Core"]],
    ["Permissions", ["namespace:Contoso.Permissions"]],
    ["Sales", ["namespace:Contoso.Sales"]],
    ["Warehouse", ["namespace:Contoso.Warehouse"]]
  ]);
  assert.ok(result.summary.coupling.share > 0 && result.summary.coupling.share < 1);
  assert.equal(typeof result.summary.coupling.modularity, "number");
  const core = result.components.find(({ name }) => name === "Core");
  assert.ok(core.metrics.cohesion > 0.5, "most of Core's coupling stays inside Core");

  // One component holding everything keeps all coupling inside, but scores no modularity.
  const levels = (await assessArchitecture(monolith)).levels;
  const single = evaluateArchitecture(levels, { components: [{ name: "All", match: ["*"] }] });
  assert.equal(single.summary.coupling.share, 1);
  assert.equal(single.summary.coupling.modularity, 0);

  // Weights from .bca.json shape the score.
  const heavy = evaluateArchitecture(levels, { components: LAYERED_MONOLITH, couplingWeights: { writes: 50 } });
  const light = evaluateArchitecture(levels, { components: LAYERED_MONOLITH });
  assert.notEqual(heavy.summary.coupling.share, light.summary.coupling.share);
});

const LAYERED_MONOLITH = [
  { name: "Core", layer: 0, match: ["folder:src/Core"] },
  { name: "Sales", layer: 1, match: ["folder:src/Sales"] },
  { name: "Warehouse", layer: 2, match: ["folder:src/Warehouse"] },
  { name: "Permissions", layer: 3, match: ["folder:src/Permissions"] }
];
