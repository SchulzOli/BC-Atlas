import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assessArchitecture, proposeArchitecture } from "../src/blueprint/index.js";
import { clusterByRelations, subgroups } from "../src/blueprint/cluster.js";
import { componentAssigner } from "../src/blueprint/components.js";
import { explainComponent, explainPlacement, formatComponentExplanation, formatPlacement } from "../src/blueprint/explain.js";
import { applyRenames, clusterName, uniqueNames } from "../src/blueprint/naming.js";
import { PLACEMENT_STEPS, placementSentence, STEP_LABELS, THRESHOLDS } from "../src/blueprint/placement.js";
import { architectureJson, formatArchitectureMarkdown, formatArchitectureText } from "../src/blueprint/report.js";
import { proposalSettings } from "../src/blueprint/settings.js";
import { COUPLING_WEIGHTS } from "../src/graph/coupling.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const monolith = path.join(root, "examples", "monolith");
const multiApp = path.join(root, "examples", "multi-app");

function withConfig(source, architecture) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-why-"));
  cpSync(source, directory, { recursive: true });
  writeFileSync(path.join(directory, ".bca.json"), JSON.stringify({ architecture }, null, 2));
  return directory;
}

// Two apps, each with a Setup namespace two levels down, as a dependency graph.
function setupLevels({ apps = ["Contoso ERP", "Contoso ERP"] } = {}) {
  const nodes = [];
  const add = (namespace, app, names) => {
    for (const name of names) {
      const id = `${namespace}::${name}`;
      nodes.push({ id, label: name, type: "codeunit", objectId: String(50000 + nodes.length), namespace, app, origin: "workspace", file: `src/${namespace.split(".").slice(1).join("/")}/${name.replaceAll(" ", "")}.Codeunit.al` });
    }
  };
  add("Contoso.Sales.Setup", apps[0], ["Sales Setup", "Sales Setup Card", "Sales Defaults"]);
  add("Contoso.Purchase.Setup", apps[1], ["Purchase Setup", "Purchase Setup Card"]);
  add("Contoso.Sales.Posting", apps[0], ["Sales Post", "Sales Post Check"]);
  const edges = [];
  for (let index = 1; index < nodes.length; index++) {
    if (nodes[index].namespace !== nodes[index - 1].namespace) continue;
    edges.push({ id: `e${index}`, source: nodes[index].id, target: nodes[index - 1].id, kinds: { calls: 1 }, weight: 1 });
  }
  return {
    object: { nodes, edges },
    app: { nodes: [...new Set(apps)].map((label) => ({ id: label, label, origin: "workspace" })), edges: [] }
  };
}

const names = (proposal) => proposal.architecture.components.map(({ name }) => name).sort();
const byNamespace = (naming) => proposalSettings({ proposal: { groupBy: "namespace", depth: 3, ...(naming ? { naming } : {}) } });

test("components that would share a name are told apart by the level above, then the app, then a number", () => {
  const proposal = proposeArchitecture(setupLevels(), byNamespace());
  assert.deepEqual(names(proposal), ["Posting", "Purchase Setup", "Sales Setup"]);
  assert.deepEqual(proposal.rationale["Sales Setup"].naming, { by: "namespace", from: "Contoso.Sales.Setup", qualifiedBy: "parent" });
  assert.deepEqual(proposal.rationale.Posting.naming, { by: "namespace", from: "Contoso.Sales.Posting" }, "a name nobody else wants stays as it is");
  // Selectors are what they were; only the names changed.
  assert.deepEqual(proposal.architecture.components.find(({ name }) => name === "Purchase Setup").match, ["namespace:Contoso.Purchase.Setup"]);

  assert.deepEqual(names(proposeArchitecture(setupLevels(), byNamespace({ qualify: "number" }))), ["Posting", "Setup", "Setup 2"]);
  // The app tells them apart only when they lie in different apps.
  const twoApps = setupLevels({ apps: ["Contoso Sales", "Contoso Purchase"] });
  const byApp = proposeArchitecture(twoApps, byNamespace({ qualify: "app" }));
  assert.deepEqual(names(byApp), ["Posting", "Setup (Contoso Purchase)", "Setup (Contoso Sales)"]);
  assert.equal(byApp.rationale["Setup (Contoso Sales)"].naming.qualifiedBy, "app");
  assert.deepEqual(names(proposeArchitecture(setupLevels(), byNamespace({ qualify: "app" }))), ["Posting", "Purchase Setup", "Sales Setup"],
    "inside one app the app says nothing, so the level above does");
});

test("names are unique without case, in the proposal, the explorer's clusters, and a component's groups", () => {
  const groups = uniqueNames([
    { key: "a", label: "Sales", objects: 5, alternatives: ["Sales Order"] },
    { key: "b", label: "sales", objects: 3, alternatives: ["sales order", "Sales Post"] },
    { key: "c", label: "SALES", objects: 1 },
    { key: "d", label: "Core", objects: 1 }
  ]);
  assert.deepEqual(groups.map(({ name }) => name), ["Sales", "sales order", "SALES 2", "Core"]);
  assert.equal(new Set(groups.map(({ name }) => name.toLowerCase())).size, 4);
  assert.deepEqual(groups.map(({ naming }) => naming.qualifiedBy), [undefined, "alternative", "number", undefined]);
  // A name you pinned is taken, whatever its case.
  const pinned = uniqueNames([{ key: "k", label: "SALES", pinned: true }, { key: "a", label: "Sales", objects: 9, outer: { key: "app", label: "Contoso" } }]);
  assert.deepEqual(pinned.map(({ name }) => name), ["SALES", "Sales (Contoso)"]);

  const levels = setupLevels();
  assert.throws(() => componentAssigner([{ name: "Sales", match: ["*"] }, { name: "sales", match: ["type:table"] }], levels),
    /architecture components "Sales" and "sales" have the same name; names are compared without case/u);
  assert.throws(() => proposalSettings({ proposal: { keep: [{ name: "Sales", match: "*" }, { name: "SALES", match: "*" }] } }), /names "Sales" and "SALES", which differ only in case/u);

  // Groups inside a component use the same rules.
  const members = levels.object.nodes.filter(({ namespace }) => namespace.endsWith(".Setup"));
  const inside = subgroups(members, levels.object.edges.map(({ source, target }) => ({ source, target, weight: 2 })), { minSize: 2 });
  assert.deepEqual([...new Set([...inside.values()].map(({ label }) => label))].sort(), ["Purchase Setup", "Sales Setup"]);
  assert.equal(inside.get(members[0].id).naming.qualifiedBy, "parent");
});

test("naming.rename gives a component the name you want and refuses two components with one name", () => {
  const renamed = proposeArchitecture(setupLevels(), byNamespace({ rename: { "sales setup": "Selling Rules", Nowhere: "X" } }));
  assert.deepEqual(names(renamed), ["Posting", "Purchase Setup", "Selling Rules"]);
  const { naming } = renamed.rationale["Selling Rules"];
  assert.equal(naming.by, "renamed");
  assert.equal(naming.was, "Sales Setup");
  assert.equal(naming.before.qualifiedBy, "parent");
  assert.deepEqual(renamed.basis.naming.unusedRenames, ["Nowhere"], "a rename that matches no component is reported, not an error");

  assert.throws(() => proposeArchitecture(setupLevels(), byNamespace({ rename: { "Sales Setup": "posting" } })),
    /naming\.rename would give two components the same name: "Sales Setup" \(renamed to "posting"\) and "Posting"/u);
  // Two components may swap names.
  const swapped = [{ name: "A" }, { name: "B" }];
  assert.deepEqual(applyRenames(swapped, { A: "B", B: "A" }), []);
  assert.deepEqual(swapped.map(({ name }) => name), ["B", "A"]);

  assert.throws(() => proposalSettings({ proposal: { naming: { rename: { A: "X", B: "x" } } } }), /gives "A" and "B" the same name "x"/u);
  assert.throws(() => proposalSettings({ proposal: { naming: { qualify: "folder" } } }), /naming\.qualify must be one of: parent, app, number/u);
  assert.throws(() => proposalSettings({ proposal: { naming: { avoid: ["object"] } } }), /naming\.avoid takes app, module, namespace/u);
  assert.throws(() => proposalSettings({ proposal: { naming: { prefix: "x" } } }), /naming has no setting "prefix"/u);
  assert.deepEqual(proposalSettings().naming, { rename: {}, qualify: "parent", avoid: [] });
});

test("naming.avoid keeps a component from sharing its name with an app it only partly covers", () => {
  // One app called Sales; its namespace Contoso.Sales holds only part of it.
  const levels = setupLevels({ apps: ["Sales", "Sales"] });
  const settings = (naming) => proposalSettings({ proposal: { groupBy: "namespace", depth: 2, ...(naming ? { naming } : {}) } });
  assert.deepEqual(names(proposeArchitecture(levels, settings())), ["Purchase", "Sales"], "by default nothing changes");
  const avoiding = proposeArchitecture(levels, settings({ avoid: ["app"] }));
  assert.deepEqual(names(avoiding), ["Contoso Sales", "Purchase"]);
  assert.deepEqual(avoiding.rationale["Contoso Sales"].naming, { by: "namespace", from: "Contoso.Sales", qualifiedBy: "parent", avoids: { kind: "app", name: "Sales" } });
  // A component that is the whole app may have the app's name.
  const whole = proposeArchitecture(levels, proposalSettings({ proposal: { groupBy: "app", naming: { avoid: ["app"] } } }));
  assert.deepEqual(names(whole), ["Sales"]);
  // A namespace of the same name with other objects counts too.
  const namespaces = proposeArchitecture(setupLevels(), byNamespace({ avoid: ["namespace"], qualify: "number" }));
  assert.ok(!names(namespaces).includes("Setup"), "two namespaces end in Setup; neither component is the plain Setup");
});

test("every object of a proposal has a placement step from the vocabulary", async () => {
  assert.deepEqual(Object.keys(STEP_LABELS), Object.keys(PLACEMENT_STEPS));
  for (const [input, values] of [[monolith, {}], [monolith, { groupBy: "namespace" }], [monolith, { groupBy: "folder" }], [monolith, { groupBy: "app" }], [multiApp, {}]]) {
    const assessment = await assessArchitecture(input, { propose: true, ...values });
    const { proposal, levels, result } = assessment;
    const objects = levels.object.nodes.filter(({ origin }) => origin === "workspace");
    assert.ok(objects.length > 0);
    for (const { id, label } of objects) {
      const placement = proposal.placements.get(id);
      assert.ok(placement && PLACEMENT_STEPS[placement.step], `${label} has a step (${placement?.step})`);
      const explained = explainPlacement(assessment, id);
      assert.equal(explained.step, placement.step);
      assert.equal(typeof explained.why, "string");
      assert.ok(!/undefined|NaN/u.test(explained.why), explained.why);
    }
    // The steps of a component add up to its objects.
    for (const component of result.components) {
      const total = Object.values(component.rationale.steps).reduce((sum, count) => sum + count, 0);
      assert.equal(total, component.metrics.objects, component.name);
    }
  }

  const { proposal } = await assessArchitecture(monolith, { propose: true });
  const steps = Object.fromEntries([...proposal.placements].map(([id, { step }]) => [id.split("::").at(-1), step]));
  assert.equal(new Set(Object.values(steps)).size, 3, "coupling, a small group that joined, and an ID neighbour");
  const shipment = [...proposal.placements].find(([id]) => /::table::50200$/u.test(id))[1];
  assert.equal(shipment.step, "small-group");
  assert.equal(shipment.detail.size, 2);
  assert.equal(shipment.detail.minimum, 3);
  const item = [...proposal.placements].find(([id]) => /::table::50000$/u.test(id))[1];
  assert.equal(item.step, "coupling");
  assert.ok(item.detail.inside > 0 && item.detail.inside <= item.detail.total);
  assert.ok(["relations", "namespace", "folder"].includes(item.detail.start));
  assert.equal(typeof item.detail.modularity, "number");
  assert.match(placementSentence(item), /of its [\d.]+ weighted links go there \(\d+%\)/u);
  // A whole app that is too small to split says so, with the threshold.
  const small = await assessArchitecture(multiApp, { propose: true });
  const whole = [...small.proposal.placements.values()].find(({ step }) => step === "boundary");
  assert.equal(whole.detail.reason, "small");
  assert.equal(whole.detail.minimum, THRESHOLDS.minClusterObjects);
  assert.deepEqual(small.proposal.basis.thresholds, THRESHOLDS);
});

test("components you keep, objects you exclude, and merged components say so", async () => {
  const directory = withConfig(monolith, {
    proposal: { keep: [{ name: "Logistics", match: ["namespace:Contoso.Warehouse"] }], exclude: ["type:permissionset"] }
  });
  try {
    const assessment = await assessArchitecture(directory);
    const { proposal, result } = assessment;
    const stepOf = (pattern) => [...proposal.placements].find(([id]) => pattern.test(id))[1];
    assert.deepEqual(stepOf(/::table::50200$/u), { step: "kept", detail: { selector: "namespace:Contoso.Warehouse" } });
    const permissions = stepOf(/::permissionset::/u);
    assert.ok(["excluded", "not-placed"].includes(permissions.step));
    assert.equal(permissions.detail.selector, "type:permissionset");
    const logistics = result.components.find(({ name }) => name === "Logistics");
    assert.deepEqual(logistics.rationale.naming, { by: "kept", from: "Logistics" });
    assert.equal(logistics.rationale.steps.kept, logistics.metrics.objects);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }

  const { proposal } = await assessArchitecture(monolith, { propose: true, groupBy: "namespace", minObjects: 3 });
  const merged = [...proposal.placements.values()].filter(({ step }) => step === "merged");
  assert.ok(merged.length > 0, "a component below minObjects joined another one");
  for (const placement of merged) {
    assert.equal(placement.detail.minObjects, 3);
    assert.ok(placement.detail.size < 3);
    assert.ok(PLACEMENT_STEPS[placement.detail.was.step], "what placed it before the merge is kept");
    assert.match(placementSentence(placement), /fewer than minObjects 3.*Before that:/u);
  }
});

test("the cluster cache returns the reasons with the result", async () => {
  const { levels } = await assessArchitecture(monolith, { propose: true });
  const nodes = levels.object.nodes.filter(({ origin }) => origin === "workspace");
  const options = { granularity: 1.25 };
  const fresh = clusterByRelations(nodes, levels, COUPLING_WEIGHTS, options);
  const cached = clusterByRelations(nodes, levels, COUPLING_WEIGHTS, { ...options, prefix: "app|" });
  assert.equal(cached.size, nodes.length);
  for (const [id, cluster] of fresh) {
    assert.ok(PLACEMENT_STEPS[cluster.placement.step]);
    assert.equal(cached.get(id).key, `app|${cluster.key}`);
    assert.equal(cached.get(id).placement, cluster.placement, "the same reason object, from the cache");
    assert.deepEqual(cached.get(id).naming, cluster.naming);
    assert.equal(cached.get(id).thresholds, cluster.thresholds);
  }
  const { thresholds } = fresh.values().next().value;
  assert.deepEqual(Object.keys(thresholds), ["smallGroup", "hub", "idDistance", "appCandidate"]);
  assert.equal(thresholds.smallGroup, 3);
  assert.equal(thresholds.hub.communities, THRESHOLDS.hubCommunities);
});

test("explainComponent says how a component got its name, its objects, and its thresholds", async () => {
  const assessment = await assessArchitecture(monolith, { propose: true });
  const explanation = explainComponent(assessment, "core");
  assert.equal(explanation.component, "Core", "the name is found without case");
  assert.equal(explanation.objects, 5);
  assert.deepEqual(explanation.naming, { by: "namespace", from: "Contoso.Core", share: 0.8 });
  assert.deepEqual(explanation.steps, { coupling: 4, "id-neighbour": 1 });
  assert.deepEqual(explanation.agreement.namespace, { value: "Contoso.Core", share: 0.8 });
  assert.equal(explanation.agreement.folder.value, "src/Core");
  assert.deepEqual(explanation.agreement.prefix, { value: "CON", share: 1 });
  assert.ok(explanation.coupling.inside > 0.5 && explanation.coupling.cohesion > 0.5);
  assert.equal(explanation.boundary, "app");
  assert.equal(explanation.within, "Contoso Monolith");
  assert.equal(explanation.thresholds.minClusterObjects, 6);
  assert.equal(explanation.thresholds.selectorOwnership, 0.8);
  assert.equal(explanation.thresholds.idDistance, 50);
  assert.deepEqual(explanation.members.map(({ step }) => step), ["coupling", "coupling", "coupling", "coupling", "id-neighbour"]);
  assert.equal(explanation.more, 0);
  assert.deepEqual(explanation.neighbours.map(({ component }) => component), ["Sales"]);
  assert.ok(explanation.why[0].startsWith("Core is named after namespace Contoso.Core (4 of 5 objects)"));
  assert.ok(explanation.alternatives.some((text) => text.includes("granularity")));
  const text = formatComponentExplanation(explanation).join("\n");
  assert.match(text, /Component Core \(5 object\(s\)\)/u);
  assert.match(text, /permissionset 50000 CON ALL\s+id-neighbour/u);
  assert.ok(!/undefined/u.test(text), text);

  const capped = explainComponent(assessment, "Core", { limit: 2 });
  assert.equal(capped.members.length, 2);
  assert.equal(capped.more, 3);
  assert.equal(explainComponent(assessment, "Nowhere"), undefined);

  // The object explanation is what it was, plus the step.
  const [id] = [...assessment.proposal.placements].find(([key]) => /::permissionset::/u.test(key));
  const lines = formatPlacement(explainPlacement(assessment, id));
  assert.equal(lines[1], "  Component: Core (assigned by id:50000)");
  assert.match(lines[2], /^ {2}Why: Nothing relates it to the rest of the app, so it follows the object with the nearest ID: CON Item \(50000\)/u);
  assert.ok(lines.includes("  Coupling by component (weighted like the proposal):"));
});

test("the report says why the components are what they are, and JSON carries the rationale", async () => {
  const assessment = await assessArchitecture(monolith, { propose: true });
  const text = formatArchitectureText(assessment);
  assert.match(text, /Why these components/u);
  assert.match(text, / {2}Core: named after namespace Contoso\.Core \(4 of 5 objects\); 4 by coupling, 1 by nearest object ID/u);
  const markdown = formatArchitectureMarkdown(assessment);
  assert.match(markdown, /## Why these components/u);
  assert.match(markdown, /\| Sales \| named after namespace Contoso\.Sales \(4 of 6 objects\) \| 4 by coupling, 2 from a small group that joined \| 67% in namespace Contoso\.Sales \|/u);
  const json = JSON.parse(JSON.stringify(architectureJson(assessment)));
  assert.deepEqual(json.components.find(({ name }) => name === "Core").rationale.naming, { by: "namespace", from: "Contoso.Core", share: 0.8 });
  assert.deepEqual(json.proposal.steps, { coupling: 8, "small-group": 2, "id-neighbour": 1 });
  assert.deepEqual(json.proposal.basis.naming, { qualify: "parent", avoid: [], rename: {} });
  assert.equal(json.proposal.placements, undefined, "the per-object reasons stay out of the report; explainPlacement gives them");
});

test("a configured architecture says which selector declares each object", async () => {
  const directory = withConfig(multiApp, {
    components: [
      { name: "Core", layer: 0, match: ["app:Contoso Core"] },
      { name: "Sales", layer: 1, match: ["app:Contoso Sales", "object:codeunit:CON Item Sync"], dependsOn: ["Core"] },
      { name: "Integration", layer: 2, match: ["app:Contoso Integration"], dependsOn: ["Sales"] }
    ]
  });
  try {
    const assessment = await assessArchitecture(directory);
    assert.equal(assessment.proposal, undefined);
    const sales = assessment.result.components.find(({ name }) => name === "Sales");
    assert.deepEqual(sales.rationale.naming, { by: "declared", from: ".bca.json" });
    assert.deepEqual(sales.rationale.steps, { declared: sales.metrics.objects });
    assert.equal(sales.rationale.selectors["object:codeunit:CON Item Sync"], 1);
    assert.equal(sales.rationale.selectors["app:Contoso Sales"], sales.metrics.objects - 1);
    assert.equal(sales.rationale.coupling.cohesion, sales.metrics.cohesion);
    assert.ok(sales.rationale.agreement.namespace);
    assert.deepEqual(sales.rationale.thresholds, {});

    const sync = assessment.levels.object.nodes.find(({ label }) => label === "CON Item Sync");
    const placement = explainPlacement(assessment, sync.id);
    assert.equal(placement.step, "declared");
    assert.equal(placement.why, "Declared in .bca.json: object:codeunit:CON Item Sync assigns it.");
    const explanation = explainComponent(assessment, "SALES");
    assert.equal(explanation.component, "Sales");
    assert.ok(explanation.members.every(({ step }) => step === "declared"));
    assert.ok(explanation.why.some((sentence) => sentence.startsWith("Selectors: app:Contoso Sales")));
    assert.ok(!/Why these components/u.test(formatArchitectureText(assessment)), "the section belongs to proposals");
    assert.ok(JSON.parse(JSON.stringify(architectureJson(assessment))).components.every(({ rationale }) => rationale.naming.by === "declared"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("groups named after the same word are told apart by the namespace most of each is in, not by a number", () => {
  const member = (label, namespace) => ({ label, namespace, file: `src/${namespace.split(".").at(-1)}/${label}.al` });
  // No namespace holds most of the group, so its word names it; the largest namespace is the alternative.
  const mixed = (largest, others) => [...Array.from({ length: 2 }, (_, index) => member(`Posting ${largest} ${index}`, `Contoso.${largest}`)), ...others.map((other, index) => member(`Posting ${other} ${index}`, `Contoso.${other}`))];
  const sales = clusterName(mixed("Sales", ["Stock", "Bank", "Tax", "Jobs", "Assets"]), undefined, { namespaceDepth: 2 });
  const purchase = clusterName(mixed("Purchase", ["Stock", "Bank", "Tax", "Jobs", "Assets"]), undefined, { namespaceDepth: 2 });
  assert.equal(sales.label, "Posting");
  assert.ok(sales.alternatives.includes("Posting (Sales)"), sales.alternatives.join());
  assert.ok(purchase.alternatives.includes("Posting (Purchase)"), purchase.alternatives.join());
});
