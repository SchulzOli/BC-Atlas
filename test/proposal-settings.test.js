import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assessArchitecture, proposeArchitecture } from "../src/blueprint/index.js";
import { formatArchitectureMarkdown, formatArchitectureText } from "../src/blueprint/report.js";
import { GROUPINGS, PROPOSAL_DEFAULTS, RELATION_KINDS, proposalSettings } from "../src/blueprint/settings.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const monolith = path.join(root, "examples", "monolith");

function withProposal(proposal) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-proposal-"));
  cpSync(monolith, directory, { recursive: true });
  writeFileSync(path.join(directory, ".bca.json"), JSON.stringify({ architecture: { proposal } }, null, 2));
  return directory;
}

test("proposal settings: defaults, then .bca.json, then options, each with its source", () => {
  const defaults = proposalSettings();
  for (const [key, value] of Object.entries(PROPOSAL_DEFAULTS)) assert.deepEqual(defaults[key], value, key);
  assert.equal(defaults.sources.granularity, "default");

  const layered = proposalSettings({ proposal: { granularity: 2, startFrom: ["namespace"], sharedCore: false } }, { granularity: "1.5", startFrom: "none" });
  assert.equal(layered.granularity, 1.5);
  assert.equal(layered.sources.granularity, "option");
  assert.deepEqual(layered.startFrom, [], "none means relations only");
  assert.equal(layered.sharedCore, false);
  assert.equal(layered.sources.sharedCore, ".bca.json");
  assert.deepEqual(proposalSettings({}, { ignore: "permits,includes,uses" }).ignore, ["permits", "includes", "uses"]);
  assert.equal(proposalSettings({}, { sharedCore: "false" }).sharedCore, false);

  assert.throws(() => proposalSettings({ proposal: { granularty: 2 } }), /has no setting "granularty"/u);
  assert.throws(() => proposalSettings({ proposal: { ignore: ["eats"] } }), /takes relation kinds/u);
  assert.throws(() => proposalSettings({ proposal: { startFrom: ["type"] } }), /takes namespace, folder, or none/u);
  assert.throws(() => proposalSettings({}, { granularity: "0" }), /must be a number above 0/u);
  assert.throws(() => proposalSettings({ proposal: { keep: [{ name: "A" }] } }), /needs match selectors/u);
  assert.throws(() => proposalSettings({ proposal: { keep: [{ name: "A", match: "*" }, { name: "A", match: "*" }] } }), /names "A" twice/u);
  assert.throws(() => proposalSettings({ proposal: { moves: { gain: 1 } } }), /has no setting "gain"/u);
});

test("default settings propose exactly what the proposal proposed before they existed", async () => {
  const { levels } = await assessArchitecture(monolith, { propose: true });
  const { basis: _plain, ...plain } = proposeArchitecture(levels);
  const { basis, ...configured } = proposeArchitecture(levels, proposalSettings());
  assert.deepEqual(configured, plain);
  assert.equal(basis.objects.shaping, basis.objects.considered);
  assert.deepEqual(basis.startFrom, ["namespace", "folder"]);
  assert.ok(!basis.shapingKinds.includes("permits"));
});

test("components you define keep their objects and name; the proposal arranges the rest around them", async () => {
  const directory = withProposal({
    keep: [{ name: "Logistics", match: ["namespace:Contoso.Warehouse"], description: "Owned by the logistics team" }],
    exclude: ["type:permissionset"]
  });
  try {
    const assessment = await assessArchitecture(directory);
    const { proposal, result, model } = assessment;
    const logistics = proposal.architecture.components.find(({ name }) => name === "Logistics");
    assert.ok(logistics, "the kept component is part of the proposal");
    assert.equal(logistics.description, "Owned by the logistics team");
    assert.ok(logistics.match.includes("namespace:Contoso.Warehouse"));
    const warehouse = model.objects.filter(({ namespace }) => namespace === "Contoso.Warehouse");
    assert.ok(warehouse.length > 0);
    const assigned = [...result.assignment].filter(([, component]) => component === "Logistics").length;
    assert.equal(assigned, warehouse.length, "every warehouse object lands in Logistics");
    assert.ok(proposal.moves.every(({ from }) => from !== "Logistics"), "objects of your components are not proposed for moves");
    assert.equal(result.summary.unassigned, 0, "excluded objects are placed afterwards");
    assert.deepEqual(proposal.basis.kept, [{ name: "Logistics", objects: warehouse.length }]);
    assert.equal(proposal.basis.objects.excluded, 1);
    assert.equal(proposal.basis.sources.keep, ".bca.json");
    assert.match(formatArchitectureText(assessment), /Your components\s+Logistics \(\d+\)/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("options override architecture.proposal, and the report says how the proposal was made", async () => {
  const directory = withProposal({ granularity: 3, sharedCore: false });
  try {
    const assessment = await assessArchitecture(directory, { granularity: "2", startFrom: "namespace" });
    const { basis } = assessment.proposal;
    assert.equal(basis.granularity, 2);
    assert.equal(basis.sources.granularity, "option");
    assert.equal(basis.sharedCore, false);
    assert.equal(basis.sources.sharedCore, ".bca.json");
    assert.deepEqual(basis.startFrom, ["namespace"]);
    const markdown = formatArchitectureMarkdown(assessment);
    assert.match(markdown, /## How this proposal was made/u);
    assert.match(markdown, /\| Shared core \| no \(\.bca\.json\) \|/u);
    assert.match(markdown, /\| Granularity \| 2, app candidates 0\.3 \(option\) \|/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the .bca.json schema lists exactly the settings the proposal accepts", () => {
  const schema = JSON.parse(readFileSync(path.join(root, "schemas", "bca.schema.json"), "utf8"));
  const proposal = schema.$defs.proposal.properties;
  assert.deepEqual(Object.keys(proposal).filter((key) => key !== "$comment").sort(), Object.keys(PROPOSAL_DEFAULTS).sort());
  assert.deepEqual(proposal.groupBy.enum, [...GROUPINGS]);
  assert.deepEqual([...schema.$defs.relationKind.enum].sort(), [...RELATION_KINDS].sort());
  for (const key of ["granularity", "appGranularity", "sharedCore", "minObjects"]) assert.deepEqual(proposal[key].default, PROPOSAL_DEFAULTS[key], key);
  // The example configuration uses the schema and passes validation.
  const example = JSON.parse(readFileSync(path.join(root, ".bca.example.json"), "utf8"));
  assert.ok(example.$schema.endsWith("schemas/bca.schema.json"));
  assert.doesNotThrow(() => proposalSettings(example.architecture));
});
