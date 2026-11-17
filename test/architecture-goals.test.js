import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assessArchitecture, evaluateArchitecture, proposeArchitecture } from "../src/blueprint/index.js";
import { bestProposal, compareArchitecture, compareLevels, COMPARE_SCHEMA, formatCompareMarkdown, formatCompareText } from "../src/blueprint/compare.js";
import { alignComponents, CRITERIA, DEFAULT_GOALS, goalsConfig, scoreArchitecture } from "../src/blueprint/goals.js";
import { proposalSettings } from "../src/blueprint/settings.js";
import { listTemplates, PRESETS, removeTemplate, resolveTemplate, saveTemplate, templateSettings, useTemplate, withTemplateRules } from "../src/blueprint/templates.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const example = (name) => path.join(root, "examples", name);

function copyExample(name, architecture) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-goals-"));
  cpSync(example(name), directory, { recursive: true });
  if (architecture) writeFileSync(path.join(directory, ".bca.json"), JSON.stringify({ architecture }, null, 2));
  return directory;
}

// Two components with a dependency each way, and a table of B that A writes.
function handMade() {
  const node = (id, type, namespace) => ({ id, label: id, type, namespace: `Demo.${namespace}`, app: "demo", origin: "workspace", file: `src/${namespace}/${id}.al` });
  const edge = (source, target, kind) => ({ id: `${source}->${target}`, source, target, kinds: { [kind]: 1 }, weight: 1, evidence: [{ kind, file: `${source}.al`, line: 1 }] });
  const levels = {
    object: {
      nodes: [node("a1", "codeunit", "A"), node("a2", "codeunit", "A"), node("b1", "codeunit", "B"), node("b2", "table", "B")],
      edges: [edge("a1", "a2", "calls"), edge("b1", "b2", "reads"), edge("a1", "b1", "calls"), edge("b1", "a2", "calls"), edge("a2", "b2", "writes")]
    }
  };
  const architecture = {
    components: [
      { name: "A", layer: 1, match: ["namespace:Demo.A"] },
      { name: "B", layer: 0, match: ["namespace:Demo.B"] }
    ]
  };
  return { levels, result: evaluateArchitecture(levels, architecture) };
}

const scores = (score) => Object.fromEntries(score.criteria.map((criterion) => [criterion.id, criterion]));

test("every criterion scores a hand-made architecture from its numbers", () => {
  const { levels, result } = handMade();
  const reference = new Map([["a1", "X"], ["a2", "X"], ["b1", "X"], ["b2", "Y"]]);
  const score = scoreArchitecture({ levels, result, reference }, { weights: {}, size: { min: 2, max: 3 } });
  const by = scores(score);
  assert.deepEqual(score.criteria.map(({ id }) => id), CRITERIA.map(({ id }) => id));
  // calls and reads weigh 2, writes 5: 4 inside, 9 across.
  assert.equal(by.cohesion.score, 0.308);
  assert.deepEqual(by.cohesion.measured, { inside: 4, across: 9, share: 0.308 });
  assert.equal(by.modularity.score, Math.min(1, Math.max(0, result.summary.coupling.modularity) / 0.5));
  // A may use B (inward); b1 -> a2 points outward.
  assert.equal(by.layering.score, 0.667);
  assert.deepEqual(by.layering.measured, { dependencies: 3, allowed: 2, wrongWay: 1 });
  assert.equal(by.acyclic.score, 0, "both components are in the cycle");
  assert.equal(by.ownership.score, 0, "the only table is written by the other component");
  assert.deepEqual(by.ownership.measured, { tables: 1, sharedWrites: 1 });
  assert.equal(by.extractable.score, 0);
  assert.equal(by.stability.score, 0.667, "B (instability 0.33) depends on A (0.67)");
  assert.equal(by.size.score, 1);
  assert.equal(by.followNamespaces.score, 1);
  assert.equal(by.followFolders.score, 1);
  assert.equal(by.followApps.applicable, false, "one app only: nothing to follow");
  assert.equal(by.followApps.score, 1);
  assert.equal(by.fewMoves.score, 0.75, "b1 leaves X");
  assert.deepEqual(by.fewMoves.measured, { objects: 4, moved: 1 });
  for (const criterion of score.criteria) {
    assert.ok(criterion.score >= 0 && criterion.score <= 1, criterion.id);
    assert.ok(criterion.why.length > 10, criterion.id);
  }
  // Outside the size band, and without a structure of today.
  const other = scores(scoreArchitecture({ levels, result }, { weights: {}, size: { min: 3, max: 10 } }));
  assert.equal(other.size.score, 0);
  assert.equal(other.fewMoves.applicable, false);
  assert.equal(other.fewMoves.score, 1);
});

test("components keep the reference component most of their objects come from; one reference component is one home", () => {
  const reference = new Map([["a", "X"], ["b", "X"], ["c", "X"], ["d", "Y"]]);
  const split = alignComponents(reference, new Map([["a", "P"], ["b", "P"], ["c", "Q"], ["d", "Q"]]), ["a", "b", "c", "d"]);
  assert.deepEqual([...split.home], [["P", "X"], ["Q", "Y"]]);
  assert.deepEqual(split.moved, ["c"]);
  const parts = alignComponents(reference, new Map([["a", "P"], ["b", "P"], ["c", "Q"], ["d", "R"]]), ["a", "b", "c", "d"]);
  assert.deepEqual(parts.moved, ["c"], "the part split off X has no home and moves");
});

test("weights are normalised, weight 0 leaves a criterion out, unknown criteria are an error", () => {
  const { levels, result } = handMade();
  const one = scoreArchitecture({ levels, result }, { weights: Object.fromEntries(CRITERIA.map(({ id }) => [id, id === "layering" ? 1 : 0])) });
  assert.equal(one.total, 66.7);
  assert.equal(scores(one).layering.share, 1);
  assert.equal(scores(one).cohesion.weight, 0);
  assert.equal(scores(one).cohesion.contribution, 0);
  const weights = { ...Object.fromEntries(CRITERIA.map(({ id }) => [id, 0])), layering: 1, acyclic: 3 };
  const two = scoreArchitecture({ levels, result }, { weights });
  const scaled = scoreArchitecture({ levels, result }, { weights: { ...weights, layering: 10, acyclic: 30 } });
  assert.equal(two.total, 16.7, "0.667 * 1/4 + 0 * 3/4");
  assert.equal(scaled.total, two.total);
  assert.equal(scores(two).acyclic.share, 0.75);
  assert.ok(Math.abs(two.criteria.reduce((sum, { share }) => sum + share, 0) - 1) < 1e-9);
  assert.ok(Math.abs(two.criteria.reduce((sum, { contribution }) => sum + contribution, 0) - two.total) < 0.11);

  assert.throws(() => scoreArchitecture({ levels, result }, { weights: { beauty: 1 } }), /no criterion "beauty"; use cohesion, modularity, layering/u);
  assert.throws(() => goalsConfig({ goals: { weights: { cohesion: -1 } } }), /cohesion must be a number of 0 or more/u);
  assert.throws(() => goalsConfig({ goals: { weights: Object.fromEntries(CRITERIA.map(({ id }) => [id, 0])) } }), /at least one criterion/u);
  assert.throws(() => goalsConfig({ goals: { size: { min: 10, max: 5 } } }), /max \(5\) is below min \(10\)/u);
  assert.throws(() => goalsConfig({ goals: { wieghts: {} } }), /has no setting "wieghts"/u);
  assert.throws(() => goalsConfig({}, { weights: "cohesion" }), /must be criterion=weight/u);
});

test("goals: defaults, then the template, then .bca.json, then options, each with its source", () => {
  const defaults = goalsConfig();
  assert.deepEqual(defaults.weights, DEFAULT_GOALS.weights);
  assert.deepEqual(defaults.size, DEFAULT_GOALS.size);
  const goals = goalsConfig(
    { goals: { weights: { cohesion: 7, size: 0 }, size: { max: 80 } } },
    { weights: ["cohesion=9", "fewMoves=5"], size: "5.." },
    { goals: { weights: { cohesion: 1, layering: 8 }, size: { min: 4 } }, source: "template mine" }
  );
  assert.equal(goals.weights.cohesion, 9);
  assert.equal(goals.weights.layering, 8);
  assert.equal(goals.weights.size, 0);
  assert.equal(goals.weights.fewMoves, 5);
  assert.equal(goals.weights.acyclic, DEFAULT_GOALS.weights.acyclic);
  assert.deepEqual(goals.size, { min: 5, max: 80 });
  assert.deepEqual(
    [goals.sources.weights.cohesion, goals.sources.weights.layering, goals.sources.weights.size, goals.sources.weights.acyclic, goals.sources.size.min, goals.sources.size.max],
    ["option", "template mine", ".bca.json", "default", "option", ".bca.json"]
  );
  assert.equal(goalsConfig({}, { weights: "cohesion=4, size=0" }).weights.cohesion, 4);
  assert.equal(goalsConfig({}, { weights: { layering: 2 } }).sources.weights.layering, "option");
});

test("every preset resolves, says when to use it, and gives valid proposal settings and goals", () => {
  assert.deepEqual(Object.keys(PRESETS), ["balanced", "follow-structure", "by-coupling", "layered", "modular-monolith", "small-steps"]);
  for (const [name, preset] of Object.entries(PRESETS)) {
    assert.ok(preset.title && preset.summary.includes("Use it"), name);
    assert.deepEqual(Object.keys(preset.goals.weights).sort(), CRITERIA.map(({ id }) => id).sort(), `${name} weighs every criterion`);
    assert.doesNotThrow(() => proposalSettings({ proposal: preset.proposal }), name);
    const resolved = resolveTemplate(root, {}, name);
    assert.equal(resolved.origin, "preset");
    assert.deepEqual(resolved.chain, [name]);
    const settings = templateSettings(root, { template: name });
    assert.equal(settings.template.name, name);
    assert.equal(settings.template.source, ".bca.json");
    assert.deepEqual(settings.goals.weights, preset.goals.weights);
    for (const key of Object.keys(preset.proposal)) assert.equal(settings.settings.sources[key], `template ${name}`, `${name}.${key}`);
  }
  assert.throws(() => PRESETS.balanced.goals.weights.cohesion = 9, TypeError, "presets are frozen");
  const listed = listTemplates(root, {});
  assert.deepEqual(listed.map(({ name }) => name), Object.keys(PRESETS));
  assert.deepEqual(listed.filter(({ active }) => active).map(({ name }) => name), ["balanced"]);

  // The layered and the modular-monolith presets also set how the layers are checked.
  const layered = templateSettings(root, {}, { template: "layered" });
  assert.equal(layered.template.source, "option");
  assert.deepEqual(layered.rules, { allowSameLayer: false, strictLayers: true });
  assert.equal(templateSettings(root, { strictLayers: false }, { template: "layered" }).rules.strictLayers, false, ".bca.json wins over the template");
  assert.equal(templateSettings(root, {}, { template: "modular-monolith" }).rules.internalAccess, "component");
  assert.deepEqual(withTemplateRules({ components: [] }, layered), { components: [], allowSameLayer: false, strictLayers: true });
  assert.throws(() => templateSettings(root, {}, { template: "nope" }), /no template "nope"; templates: balanced, follow-structure/u);
});

test("the balanced preset proposes exactly what the proposal proposes today", async () => {
  for (const name of ["multi-app", "monolith"]) {
    const { levels, proposal, context } = await assessArchitecture(example(name), { propose: true });
    const { settings, goals, template, rules, couplingWeights } = templateSettings(context.projectRoot, context.options.architecture);
    assert.equal(template.name, "balanced");
    assert.deepEqual(proposeArchitecture(levels, settings), proposal, name);
    assert.deepEqual(settings, proposalSettings(context.options.architecture), name);
    assert.deepEqual(goals.weights, DEFAULT_GOALS.weights);
    assert.equal(couplingWeights, undefined);
    assert.deepEqual(rules, name === "monolith" ? { internalAccess: "component" } : {});
  }
});

test("a template of your own extends another one; options and .bca.json win over it", () => {
  const architecture = {
    template: "ours",
    templates: {
      base: { extends: "layered", title: "Base", goals: { weights: { fewMoves: 4 }, size: { max: 120 } }, proposal: { granularity: 1.5, moves: { minGain: 3 } }, couplingWeights: { calls: 3 } },
      ours: { extends: "base", summary: "How we do it.", goals: { weights: { layering: 9 } }, proposal: { sharedCore: false, moves: { limit: 5 } }, strictLayers: false }
    },
    proposal: { minObjects: 2 },
    goals: { weights: { size: 0 } }
  };
  const resolved = resolveTemplate(root, architecture, "ours");
  assert.deepEqual(resolved.chain, ["layered", "base", "ours"]);
  assert.equal(resolved.extends, "base");
  assert.equal(resolved.origin, ".bca.json");
  assert.equal(resolved.title, "ours");
  assert.equal(resolved.goals.weights.layering, 9);
  assert.equal(resolved.goals.weights.fewMoves, 4);
  assert.equal(resolved.goals.weights.acyclic, PRESETS.layered.goals.weights.acyclic);
  assert.deepEqual(resolved.goals.size, { max: 120 });
  assert.deepEqual(resolved.proposal, { granularity: 1.5, moves: { minGain: 3, limit: 5 }, sharedCore: false });
  assert.deepEqual(resolved.couplingWeights, { calls: 3 });
  assert.equal(resolved.strictLayers, false);
  assert.equal(resolved.allowSameLayer, false);

  const settings = templateSettings(root, architecture, { granularity: "2", weights: "layering=1" });
  assert.equal(settings.settings.granularity, 2);
  assert.equal(settings.settings.sharedCore, false);
  assert.equal(settings.settings.minObjects, 2);
  assert.deepEqual(settings.settings.moves, { minGain: 3, limit: 5 });
  assert.equal(settings.settings.weights.calls, 3);
  assert.deepEqual(
    [settings.settings.sources.granularity, settings.settings.sources.sharedCore, settings.settings.sources.minObjects, settings.settings.sources.groupBy, settings.settings.sources.weights],
    ["option", "template ours", ".bca.json", "default", "template ours"]
  );
  assert.equal(settings.goals.weights.layering, 1);
  assert.equal(settings.goals.weights.size, 0);
  assert.deepEqual(settings.goals.size, { min: DEFAULT_GOALS.size.min, max: 120 });
  assert.deepEqual(settings.sources.rules, { allowSameLayer: "template ours", strictLayers: "template ours" });
  assert.deepEqual(listTemplates(root, architecture).filter(({ origin }) => origin !== "preset").map(({ name, active }) => [name, active]), [["base", false], ["ours", true]]);

  assert.throws(() => resolveTemplate(root, { templates: { a: { extends: "b" }, b: { extends: "a" } } }, "a"), /template "a" extends itself: a -> b -> a/u);
  assert.throws(() => resolveTemplate(root, { templates: { a: { extends: "gone" } } }, "a"), /no template "gone"/u);
  assert.throws(() => resolveTemplate(root, { templates: { balanced: {} } }, "balanced"), /"balanced" is a preset/u);
  assert.throws(() => resolveTemplate(root, { templates: { a: { proposal: { granularty: 2 } } } }, "a"), /architecture\.templates\.a: architecture\.proposal has no setting "granularty"/u);
  assert.throws(() => resolveTemplate(root, { templates: { a: { goal: {} } } }, "a"), /has no setting "goal"/u);
  // A template that cannot be read does not hide the others.
  const broken = listTemplates(root, { templates: { a: { extends: "gone" } } }).find(({ name }) => name === "a");
  assert.match(broken.error, /no template "gone"/u);
});

test("a template can live in a JSON file that several repositories share", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-template-"));
  try {
    mkdirSync(path.join(directory, "shared"));
    writeFileSync(path.join(directory, "shared", "company.json"), JSON.stringify({ extends: "by-coupling", title: "Company", goals: { weights: { size: 3 } }, proposal: { granularity: 0.8 } }));
    const architecture = { template: "company", templates: { company: "shared/company.json", missing: "shared/none.json" } };
    const resolved = resolveTemplate(directory, architecture, "company");
    assert.equal(resolved.origin, "shared/company.json");
    assert.equal(resolved.title, "Company");
    assert.deepEqual(resolved.chain, ["by-coupling", "company"]);
    assert.deepEqual(resolved.proposal, { groupBy: "coupling", startFrom: [], granularity: 0.8 });
    assert.equal(templateSettings(directory, architecture).goals.weights.size, 3);
    assert.throws(() => resolveTemplate(directory, architecture, "missing"), /cannot read shared\/none\.json: no such file/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("saving the current settings as a template: write, list, use, resolve, remove", async () => {
  const directory = copyExample("monolith");
  const file = path.join(directory, ".bca.json");
  const original = JSON.parse(readFileSync(file, "utf8"));
  try {
    const values = { template: "layered", granularity: "1.5", sharedCore: "false", weights: "fewMoves=4,size=0", size: "4..90" };
    const before = templateSettings(directory, original.architecture, values);

    const dry = await saveTemplate(directory, { name: "team", title: "Team", summary: "Ours.", values, dryRun: true });
    assert.deepEqual([dry.changed, dry.written], [true, false]);
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), original, "a dry run writes nothing");

    const saved = await saveTemplate(directory, { name: "team", title: "Team", summary: "Ours.", values });
    assert.deepEqual([saved.changed, saved.written, saved.use], [true, true, false]);
    assert.equal(saved.file, file);
    assert.deepEqual(saved.template.proposal, { granularity: 1.5, sharedCore: false });
    assert.equal(saved.template.strictLayers, true);
    assert.equal(saved.template.extends, undefined, "the saved template stands on its own");
    const written = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(written.architecture.templates, { team: saved.template });
    // The rest of the file is as it was.
    const { templates: _templates, ...rest } = written.architecture;
    assert.deepEqual(rest, original.architecture);
    assert.deepEqual({ ...written, architecture: undefined }, { ...original, architecture: undefined });
    assert.equal((await saveTemplate(directory, { name: "team", title: "Team", summary: "Ours.", values })).changed, false, "saving the same again changes nothing");

    const listed = listTemplates(directory, written.architecture).find(({ name }) => name === "team");
    assert.deepEqual([listed.title, listed.summary, listed.origin, listed.active], ["Team", "Ours.", ".bca.json", false]);

    const used = await useTemplate(directory, { name: "team" });
    assert.equal(used.written, true);
    const inUse = JSON.parse(readFileSync(file, "utf8")).architecture;
    assert.equal(inUse.template, "team");
    const after = templateSettings(directory, inUse);
    assert.equal(after.template.name, "team");
    assert.deepEqual(after.goals.weights, before.goals.weights);
    assert.deepEqual(after.goals.size, before.goals.size);
    const { sources: _before, ...settingsBefore } = before.settings;
    const { sources: _after, ...settingsAfter } = after.settings;
    assert.deepEqual(settingsAfter, settingsBefore, "the template gives the settings it was saved from");
    assert.deepEqual(after.rules, before.rules);
    assert.equal(after.settings.sources.granularity, "template team");

    // Presets cannot be overwritten or removed; names must exist.
    await assert.rejects(saveTemplate(directory, { name: "balanced" }), /"balanced" is a preset and cannot be overwritten/u);
    await assert.rejects(saveTemplate(directory, { name: "bad/name" }), /is not a template name/u);
    await assert.rejects(saveTemplate(directory, { name: "x", template: { extends: "nope" } }), /no template "nope"/u);
    await assert.rejects(saveTemplate(directory, { name: "x", template: { goals: { weights: { beauty: 1 } } } }), /no criterion "beauty"/u);
    await assert.rejects(useTemplate(directory, { name: "nope" }), /no template "nope"/u);
    await assert.rejects(removeTemplate(directory, { name: "layered" }), /is a preset and cannot be removed/u);
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).architecture, inUse, "what is not valid never reaches the file");

    // A template that extends another one, saved as it is, in a file of its own.
    const child = await saveTemplate(directory, { name: "team-strict", template: { extends: "team", strictLayers: true, goals: { weights: { layering: 9 } } }, file: "architecture/team-strict.json", use: true });
    assert.equal(child.templateFile, "architecture/team-strict.json");
    assert.ok(existsSync(path.join(directory, "architecture", "team-strict.json")));
    const withChild = JSON.parse(readFileSync(file, "utf8")).architecture;
    assert.equal(withChild.templates["team-strict"], "architecture/team-strict.json");
    assert.equal(withChild.template, "team-strict");
    assert.deepEqual(resolveTemplate(directory, withChild, "team-strict").chain, ["team", "team-strict"]);
    assert.equal(templateSettings(directory, withChild).goals.weights.layering, 9);
    await assert.rejects(removeTemplate(directory, { name: "team" }), /template "team" is extended by team-strict/u);

    // A copy of a preset under your own name.
    const copy = await saveTemplate(directory, { name: "my-coupling", from: "by-coupling" });
    assert.deepEqual(copy.template.proposal, { groupBy: "coupling", startFrom: [] });
    assert.equal(copy.template.title, PRESETS["by-coupling"].title);

    const removed = await removeTemplate(directory, { name: "team-strict" });
    assert.deepEqual([removed.wasInUse, removed.written, removed.templateFile], [true, true, "architecture/team-strict.json"]);
    await removeTemplate(directory, { name: "my-coupling" });
    await removeTemplate(directory, { name: "team" });
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), original, "removing everything gives the file back");
    assert.equal((await useTemplate(directory, {})).changed, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function checkShape(result, model) {
  assert.equal(result.schema, COMPARE_SCHEMA);
  assert.deepEqual(result.criteria.map(({ id }) => id), CRITERIA.map(({ id }) => id));
  // Both sides are scored with the same weights.
  const sum = Object.values(result.goals.weights).reduce((total, weight) => total + weight, 0);
  for (const criterion of result.criteria) {
    assert.equal(criterion.weight, result.goals.weights[criterion.id]);
    assert.ok(Math.abs(criterion.share - criterion.weight / sum) < 0.001);
    assert.ok(Math.abs(criterion.delta - (criterion.target - criterion.current)) < 0.0011, criterion.id);
    assert.match(criterion.why, /^Today: .+ Target: .+/u);
  }
  for (const side of ["current", "target"]) {
    const total = result.criteria.reduce((points, criterion) => points + criterion.share * criterion[side] * 100, 0);
    assert.ok(Math.abs(total - result[side].score) < 0.2, `${side}: ${total} vs ${result[side].score}`);
    assert.equal(result[side].components.reduce((objects, component) => objects + component.objects, 0), result.summary.objects);
    assert.equal(result.summary[side], result[side].score);
    assert.deepEqual(result.sides.scores[side].total, result[side].score);
  }
  assert.equal(Object.keys(result).includes("sides"), false, "the evaluated sides are not part of the JSON");
  // The mapping covers every target component and every object once.
  assert.deepEqual(result.mapping.map(({ target }) => target), result.target.components.map(({ name }) => name));
  for (const entry of result.mapping) {
    assert.ok(["same", "renamed", "split", "merged", "reshaped", "new"].includes(entry.status), entry.status);
    assert.equal(entry.from.reduce((objects, source) => objects + source.objects, 0), entry.objects);
    if (entry.status === "same") assert.equal(entry.from[0].component, entry.target);
    if (["same", "renamed"].includes(entry.status)) assert.ok(entry.from[0].share >= 0.9 && entry.from[0].ofCurrent >= 0.9);
  }
  const mains = new Set(result.mapping.map(({ from }) => from[0].component));
  assert.deepEqual(result.gone.map(({ component }) => component).sort(), result.current.components.map(({ name }) => name).filter((name) => !mains.has(name)).sort());
  // Every move names a real object, where it is, where it goes, and the command that moves it.
  const objects = new Map(model.objects.map((object) => [object.key, object]));
  assert.equal(result.summary.moves, result.movesTotal);
  assert.ok(result.moves.length <= result.movesTotal);
  assert.ok(Math.abs(result.summary.distance - result.movesTotal / result.summary.objects) < 0.001);
  for (const move of result.moves) {
    const object = objects.get(move.object.id);
    assert.ok(object, move.object.id);
    assert.equal(object.name, move.object.name);
    // A move names the file with forward slashes on every system.
    assert.equal(object.file.replaceAll("\\", "/"), move.object.file);
    assert.equal(result.sides.current.result.assignment.get(move.object.id), move.from);
    assert.equal(result.sides.target.result.assignment.get(move.object.id), move.to);
    assert.notEqual(move.from, move.to);
    assert.equal(move.command, `bca refactor move --object ${object.type}:${object.id ?? `"${object.name}"`} --to "${move.to}"`);
    assert.ok(result.target.components.some(({ name }) => name === move.to));
  }
  // Steps: moves grouped by target component, in the order to take them, ending with the check.
  const moveSteps = result.steps.filter(({ component }) => component);
  assert.equal(moveSteps.reduce((total, step) => total + step.objects, 0), result.movesTotal);
  assert.deepEqual(moveSteps.flatMap(({ commands }) => commands).sort(), result.moves.map(({ command }) => command).sort());
  for (let index = 1; index < moveSteps.length; index++) {
    const [previous, step] = [moveSteps[index - 1], moveSteps[index]];
    assert.ok(previous.resolves > step.resolves || (previous.resolves === step.resolves && previous.gain >= step.gain), "most valuable step first");
  }
  for (const step of result.steps) assert.ok(step.title && step.why && Array.isArray(step.commands));
  assert.equal(result.steps.at(-1).title, "Check the result");
  for (const format of [formatCompareText, formatCompareMarkdown]) {
    const text = format(result);
    assert.ok(text.includes(result.template.name) && text.includes("Current") && text.includes("Target"));
    for (const criterion of result.criteria) assert.ok(text.includes(criterion.title), criterion.title);
  }
}

test("compares the structure of today with the configured architecture (monolith)", async () => {
  const { model } = await assessArchitecture(example("monolith"));
  const result = await compareArchitecture(example("monolith"), {}, { model });
  checkShape(result, model);
  assert.deepEqual([result.from, result.to], ["structure", "configured"]);
  assert.equal(result.current.basis, "namespace");
  assert.deepEqual(result.current.components.map(({ name, objects }) => `${name} ${objects}`).sort(), ["Core 4", "Permissions 1", "Sales 4", "Warehouse 2"]);
  // The configured components are the namespaces: nothing moves, and what differs is what may depend on what.
  assert.deepEqual(result.mapping.map(({ status }) => status), ["same", "same", "same", "same"]);
  assert.deepEqual(result.gone, []);
  assert.equal(result.movesTotal, 0);
  assert.equal(result.summary.distance, 0);
  assert.ok(result.summary.improves.includes("layering"));
  assert.ok(result.summary.target > result.summary.current);
  assert.equal(result.candidates, undefined);
  assert.deepEqual(result.rules, { internalAccess: "component" });
  assert.match(formatCompareMarkdown(result), /\| Criterion \| Weight \| Current \| Target \| Change \| Why \|/u);
  assert.match(formatCompareMarkdown(result), /\| \*\*Score \(0 to 100\)\*\* \| \*\*\d+\.\d\*\* \| \*\*\d+\.\d\*\* \|/u);
  assert.match(formatCompareText(result), /Total \(0 to 100\)\s+\d+\.\d\s+\d+\.\d/u);

  // The same question twice gives the same answer.
  assert.deepEqual(await compareArchitecture(example("monolith"), {}, { model }), result);

  // Another template weighs the same two states differently.
  const layered = await compareArchitecture(example("monolith"), { template: "layered" }, { model });
  assert.equal(layered.template.name, "layered");
  assert.equal(layered.goals.weights.layering, PRESETS.layered.goals.weights.layering);
  assert.notEqual(layered.summary.target, result.summary.target);
  const weighted = await compareArchitecture(example("monolith"), { weights: "layering=50" }, { model });
  assert.equal(weighted.goals.sources.weights.layering, "option");
  assert.ok(weighted.summary.delta > result.summary.delta, "more weight on what the target improves widens the gap");

  await assert.rejects(compareArchitecture(example("monolith"), { to: "structure" }, { model }), /from and to are both "structure"/u);
  await assert.rejects(compareArchitecture(example("monolith"), { to: "ideal" }, { model }), /to must be one of: structure, configured, proposal, best/u);
  await assert.rejects(compareArchitecture(example("monolith"), { weights: "beauty=1" }, { model }), /no criterion "beauty"/u);
});

test("moves objects from where they are today to where the target wants them (monolith, proposal)", async () => {
  const { model, levels, proposal } = await assessArchitecture(example("monolith"), { propose: true });
  const result = await compareArchitecture(example("monolith"), { to: "proposal" }, { model });
  checkShape(result, model);
  assert.equal(result.target.kind, "proposal");
  assert.deepEqual(result.target.components.map(({ name }) => name), proposal.architecture.components.map(({ name }) => name), "the target is the proposal of bca architecture --propose");
  assert.ok(result.movesTotal > 0);
  assert.ok(result.mapping.some(({ status }) => status !== "same"));
  assert.ok(result.gone.length > 0, "four namespaces become fewer components");
  for (const entry of result.gone) assert.equal(entry.to.reduce((objects, target) => objects + target.objects, 0), entry.objects);
  assert.equal(result.steps[0].title, "Adopt the target architecture");
  assert.deepEqual(result.steps[0].commands, ["bca architecture --propose --write"]);
  assert.ok(result.summary.worsens.includes("fewMoves"));
  const fewMoves = result.criteria.find(({ id }) => id === "fewMoves");
  assert.equal(fewMoves.current, 1);
  assert.ok(Math.abs(fewMoves.target - (1 - result.summary.distance)) < 0.001);

  // A limit lists the most valuable moves and says how many there are.
  const limited = await compareArchitecture(example("monolith"), { to: "proposal", limit: 1 }, { model });
  assert.equal(limited.moves.length, 1);
  assert.equal(limited.movesTotal, result.movesTotal);
  assert.deepEqual(limited.moves[0], result.moves[0]);
  assert.equal(limited.steps.filter(({ component }) => component).reduce((total, step) => total + (step.omitted ?? 0), 0), result.movesTotal - 1);
  for (let index = 1; index < result.moves.length; index++) {
    const [previous, move] = [result.moves[index - 1], result.moves[index]];
    assert.ok(previous.resolves > move.resolves || (previous.resolves === move.resolves && previous.gain >= move.gain));
  }

  // From the configured architecture instead of the structure.
  const fromConfigured = await compareArchitecture(example("monolith"), { from: "configured", to: "proposal" }, { model });
  checkShape(fromConfigured, model);
  assert.equal(fromConfigured.current.kind, "configured");
  assert.ok(levels.object.nodes.length >= fromConfigured.summary.objects);
});

test("without configured components the best of several proposals is the target (purchasing-app)", async () => {
  const { model, levels, context } = await assessArchitecture(example("purchasing-app"));
  const result = await compareArchitecture(example("purchasing-app"), {}, { model });
  checkShape(result, model);
  assert.deepEqual([result.from, result.to], ["structure", "best"]);
  assert.ok(result.candidates.length >= 2 && result.candidates.length <= 8);
  assert.equal(result.candidates[0].id, "settings");
  assert.equal(new Set(result.candidates.map(({ id }) => id)).size, result.candidates.length);
  const chosen = result.candidates.filter((candidate) => candidate.chosen);
  assert.equal(chosen.length, 1);
  assert.equal(chosen[0].total, Math.max(...result.candidates.map(({ total }) => total)), "the best total wins");
  assert.equal(result.candidates.find(({ total }) => total === chosen[0].total).id, chosen[0].id, "among equals the first");
  assert.equal(result.target.score, chosen[0].total);
  assert.equal(result.target.candidate, chosen[0].id);
  assert.deepEqual(result.target.settings, chosen[0].settings);
  for (const candidate of result.candidates) {
    assert.deepEqual(Object.keys(candidate.criteria), CRITERIA.map(({ id }) => id));
    assert.ok(candidate.label && candidate.settings.groupBy && candidate.components > 0);
    if (candidate.sameAs) assert.equal(result.candidates.find(({ id }) => id === candidate.sameAs).total, candidate.total);
  }
  assert.match(result.steps[0].commands[0], /^bca architecture --propose .*--write$/u);
  assert.match(formatCompareText(result), /Proposals that competed/u);
  assert.match(formatCompareMarkdown(result), /\(chosen\)/u);
  assert.deepEqual(await compareArchitecture(example("purchasing-app"), {}, { model }), result, "deterministic");

  await assert.rejects(compareArchitecture(example("purchasing-app"), { to: "configured" }, { model }), /no architecture is configured/u);

  // bestProposal on its own; an option of the call is not varied.
  const settings = templateSettings(context.projectRoot, context.options.architecture, { granularity: "1" });
  const { best, candidates } = bestProposal(levels, settings.settings, settings.goals);
  assert.ok(candidates.every(({ settings: used }) => used.granularity === 1), "granularity was given, so no candidate changes it");
  assert.ok(candidates.some(({ id }) => id === "namespaces"));
  assert.equal(best.score.total, Math.max(...candidates.map(({ total }) => total)));
  assert.equal(best.result.components.length, candidates.find(({ chosen: isChosen }) => isChosen).components);
  assert.equal(bestProposal(levels, settings.settings, settings.goals, { limit: 2 }).candidates.length, 2);
});

test("a structure without namespaces falls back to folders, then to apps", () => {
  const node = (id, file, namespace) => ({ id, label: id, type: "codeunit", app: "demo", origin: "workspace", file, ...(namespace ? { namespace } : {}) });
  const edge = (source, target) => ({ id: `${source}->${target}`, source, target, kinds: { calls: 1 }, weight: 1, evidence: [] });
  const app = { nodes: [{ id: "demo", label: "Demo", type: "app", origin: "workspace" }], edges: [] };
  const folders = {
    object: { nodes: [node("s1", "src/Sales/Codeunits/s1.al"), node("s2", "src/Sales/s2.al"), node("p1", "src/Purchase/p1.al"), node("p2", "src/Purchase/p2.al")], edges: [edge("s1", "s2"), edge("p1", "p2"), edge("s1", "p1")] },
    app
  };
  const byFolder = compareLevels(folders, { values: { to: "proposal" } });
  assert.equal(byFolder.current.basis, "folder");
  assert.deepEqual(byFolder.current.components.map(({ name, objects }) => `${name} ${objects}`).sort(), ["Purchase 2", "Sales 2"]);

  const flat = { object: { nodes: [node("x1", "src/x1.al"), node("x2", "src/x2.al")], edges: [edge("x1", "x2")] }, app };
  const byApp = compareLevels(flat, { values: { to: "proposal" } });
  assert.equal(byApp.current.basis, "app");
  assert.deepEqual(byApp.current.components, [{ name: "Demo", objects: 2, layer: 0 }]);

  // An object without a namespace joins the others by its folder.
  const mixed = {
    object: { nodes: [node("s1", "src/Sales/s1.al", "Demo.Sales"), node("s2", "src/Sales/s2.al", "Demo.Sales"), node("p1", "src/Purchase/p1.al", "Demo.Purchase"), node("s3", "src/Sales/s3.al")], edges: [edge("s1", "s2"), edge("s3", "s1"), edge("s1", "p1")] },
    app
  };
  const both = compareLevels(mixed, { values: { to: "proposal" } });
  assert.equal(both.current.basis, "namespace");
  assert.deepEqual(both.current.components.map(({ name, objects }) => `${name} ${objects}`).sort(), ["Purchase 1", "Sales 3"]);
});

test("the .bca.json schema knows goals, the template in use, and your own templates", () => {
  const schema = JSON.parse(readFileSync(path.join(root, "schemas", "bca.schema.json"), "utf8"));
  const architecture = schema.$defs.architecture.properties;
  assert.equal(architecture.goals.$ref, "#/$defs/architectureGoals");
  const goals = schema.$defs.architectureGoals.properties;
  assert.deepEqual(Object.keys(goals.weights.properties).filter((key) => key !== "$comment").sort(), CRITERIA.map(({ id }) => id).sort());
  for (const [id, weight] of Object.entries(DEFAULT_GOALS.weights)) assert.equal(goals.weights.properties[id].default, weight, id);
  assert.equal(goals.size.properties.min.default, DEFAULT_GOALS.size.min);
  assert.equal(goals.size.properties.max.default, DEFAULT_GOALS.size.max);
  assert.deepEqual(architecture.template.examples, Object.keys(PRESETS));
  const template = schema.$defs.architectureTemplate.properties;
  assert.deepEqual(Object.keys(template).filter((key) => key !== "$comment").sort(), ["allowSameLayer", "couplingWeights", "extends", "goals", "internalAccess", "proposal", "strictLayers", "summary", "title"]);
  assert.equal(template.proposal.$ref, "#/$defs/proposal");
  assert.equal(template.goals.$ref, "#/$defs/architectureGoals");
});
