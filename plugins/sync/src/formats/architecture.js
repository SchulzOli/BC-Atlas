// Format "architecture": the layer above L0 of the layered documentation. Lays the recorded process
// over the BC Atlas model: which components and layers it crosses (per phase, per technical step),
// and whether each recorded call between components follows the BC Atlas layer rules
// (the same rules as the blueprint evaluation: outward-dependency, same-layer-dependency).
import { indexAtlas } from "../sources/atlas-model.js";
import { markdownCell } from "../util.js";

const OK = "ok";

function resolve(atlas, objectType, objectId, appName) {
  const candidates = atlas.byKey.get(`${String(objectType).toLowerCase()}::${objectId}`) ?? [];
  if (!candidates.length) return undefined;
  return candidates.find((candidate) => appName && candidate.app === appName) ?? candidates[0];
}

export function ruleFor(atlas, sourceName, targetName) {
  if (sourceName === targetName) return OK;
  const source = atlas.components.get(sourceName);
  const target = atlas.components.get(targetName);
  if (source?.layer === undefined || target?.layer === undefined) return "unknown-layer";
  if (target.layer > source.layer) return "outward-dependency";
  if (target.layer === source.layer && !atlas.allowSameLayer) return "same-layer-dependency";
  return OK;
}

export function analyzeArchitecture(facts, model) {
  const atlas = indexAtlas(model);
  const touched = new Map();
  const unmapped = new Map();
  const touch = (type, id, name, app, hits) => {
    const object = resolve(atlas, type, id, app);
    if (!object) {
      unmapped.set(`${type} ${id}`, name);
      return;
    }
    const component = object.component ?? "(unassigned)";
    if (!touched.has(component)) touched.set(component, { objects: new Set(), hits: 0 });
    const entry = touched.get(component);
    entry.objects.add(`${type} ${id} ${name ?? object.label}`);
    entry.hits += hits ?? 0;
  };
  for (const object of facts.objects ?? []) touch(object.objectType, object.objectId, object.objectName, object.app, object.hits);
  for (const table of facts.tables ?? []) {
    touch("table", table.tableId, table.tableName, undefined, (table.inserts ?? 0) + (table.modifies ?? 0) + (table.deletes ?? 0) + (table.renames ?? 0));
  }

  const edges = new Map();
  const steps = [];
  for (const step of facts.technicalSteps ?? []) {
    const route = [];
    for (const frame of step.callStack ?? []) {
      const component = resolve(atlas, frame.objectType, frame.objectId, frame.app)?.component;
      if (!component) continue;
      if (!route.length || route[route.length - 1].component !== component) {
        route.push({ component, via: `${frame.objectType} ${frame.objectId} ${frame.objectName}.${frame.method}` });
      }
    }
    for (let index = 1; index < route.length; index++) {
      const from = route[index - 1].component;
      const to = route[index].component;
      const key = `${from}->${to}`;
      if (!edges.has(key)) edges.set(key, { from, to, calls: 0, rule: ruleFor(atlas, from, to), examples: [] });
      const edge = edges.get(key);
      edge.calls += 1;
      const example = `T${step.step}: ${route[index - 1].via} → ${route[index].via}`;
      if (edge.examples.length < 3 && !edge.examples.includes(example)) edge.examples.push(example);
    }
    steps.push({ step: step.step, phase: step.phase ?? 0, description: step.description, path: route.map(({ component }) => component) });
  }

  const phases = (facts.phases ?? []).map((phase) => {
    const components = [];
    for (const step of steps.filter((item) => item.phase === phase.phase)) {
      for (const component of step.path) if (!components.includes(component)) components.push(component);
    }
    return { phase: phase.phase, title: phase.title, components };
  });

  const components = [...touched.entries()]
    .map(([name, entry]) => {
      const component = atlas.components.get(name);
      return {
        name,
        layer: component?.layer,
        objectsInProcess: entry.objects.size,
        objectsInAtlas: component?.metrics?.objects,
        instability: component?.metrics?.instability,
        atlasViolations: component?.violations,
        hits: entry.hits,
        objects: [...entry.objects].sort()
      };
    })
    .sort((a, b) => (b.layer ?? -1) - (a.layer ?? -1) || a.name.localeCompare(b.name));

  return {
    schema: "bc-atlas-sync.architecture/1",
    process: facts.snapshot?.processName,
    feature: facts.snapshot?.feature,
    snapshot: facts.snapshot?.no,
    fingerprint: facts.snapshot?.fingerprint,
    atlas: { title: atlas.title, objects: atlas.objectCount, components: atlas.components.size, allowSameLayer: atlas.allowSameLayer },
    components,
    phases,
    steps,
    dependencies: [...edges.values()],
    unmapped: [...unmapped.entries()].map(([key, name]) => `${key} ${name ?? ""}`.trim()).sort()
  };
}

const nodeId = (name) => `C_${String(name).replace(/[^A-Za-z0-9]/gu, "_")}`;
const label = (text) => String(text ?? "").replace(/["[\]{}|<>#;`]/gu, "");
const cell = markdownCell;

export function architectureMarkdown(result) {
  const out = [];
  const violations = result.dependencies.filter(({ rule }) => rule !== OK && rule !== "unknown-layer");
  out.push(`# ${result.process} - Architecture layer (BC Atlas)`, "");
  out.push(`> Fact snapshot ${result.snapshot} (fingerprint \`${String(result.fingerprint ?? "").slice(0, 12)}\`) laid over BC Atlas "${result.atlas.title}" (${result.atlas.objects} objects, ${result.atlas.components} components).`);
  out.push("> The layer above L0 of the layered documentation: where in the architecture the process runs.", "");
  out.push("## A0 · Architecture footprint", "");
  out.push(`- **Use case:** ${result.feature ?? result.process}`);
  out.push(`- **Components crossed:** ${result.components.length} of ${result.atlas.components}`);
  const layers = [...new Set(result.components.map(({ layer }) => layer))].filter((layer) => layer !== undefined).sort((a, b) => b - a);
  out.push(`- **Layers:** ${layers.join(", ") || "-"}`);
  out.push(`- **Recorded calls against the layer rules:** ${violations.length || "none"}`);
  if (result.unmapped.length) out.push(`- **Not in this Atlas (other apps):** ${result.unmapped.join("; ")}`);
  out.push("", "```mermaid", "flowchart TB");
  const byLayer = new Map();
  for (const component of result.components) {
    const layer = component.layer ?? "?";
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer).push(component);
  }
  for (const [layer, components] of byLayer) {
    out.push(`    subgraph L${String(layer).replace("?", "x")}["Layer ${layer}"]`);
    for (const component of components) out.push(`        ${nodeId(component.name)}["${label(component.name)} · ${component.objectsInProcess} obj"]`);
    out.push("    end");
  }
  for (const dependency of result.dependencies) {
    const ok = dependency.rule === OK;
    out.push(`    ${nodeId(dependency.from)} ${ok ? "-->" : "-.->"}|${label(ok ? `${dependency.calls}` : `${dependency.calls} ${dependency.rule}`)}| ${nodeId(dependency.to)}`);
  }
  out.push("```", "", "## Components", "");
  out.push("| Layer | Component | Objects in process | Objects in Atlas | Instability | Atlas violations | Hits |");
  out.push("|---:|---|---:|---:|---:|---:|---:|");
  for (const component of result.components) {
    out.push(`| ${component.layer ?? "-"} | ${cell(component.name)} | ${component.objectsInProcess} | ${component.objectsInAtlas ?? "-"} | ${component.instability ?? "-"} | ${component.atlasViolations ?? "-"} | ${component.hits} |`);
  }
  out.push("");
  if (result.phases.length) {
    out.push("## Phases through the architecture", "", "| Phase | Components in call order |", "|---|---|");
    for (const phase of result.phases) out.push(`| ${phase.phase} · ${cell(phase.title)} | ${phase.components.map(cell).join(" → ") || "-"} |`);
    out.push("");
  }
  out.push("## Technical steps through the architecture", "");
  for (const step of result.steps.filter(({ path }) => path.length)) out.push(`- **T${step.step}** ${step.description}: ${step.path.join(" → ")}`);
  out.push("", "## Recorded calls between components", "");
  if (!result.dependencies.length) {
    out.push("_The recorded call stacks stay inside one component._");
  } else {
    out.push(`Checked with the BC Atlas layer rules (allowSameLayer: ${result.atlas.allowSameLayer}).`, "");
    out.push("| From | To | Calls | Rule | Example |", "|---|---|---:|---|---|");
    for (const dependency of result.dependencies) {
      out.push(`| ${cell(dependency.from)} | ${cell(dependency.to)} | ${dependency.calls} | ${dependency.rule === OK ? "ok" : `**${dependency.rule}**`} | ${cell(dependency.examples[0] ?? "")} |`);
    }
  }
  out.push("");
  return out.join("\n");
}

export const architectureFormat = {
  id: "architecture",
  scope: "process",
  async render({ item, atlasModel }) {
    if (!atlasModel) return { files: [], warnings: [`${item.key}: no BC Atlas model, architecture skipped`] };
    const result = analyzeArchitecture(item.facts, atlasModel);
    return {
      files: [
        { path: `${item.key}/architecture.md`, content: architectureMarkdown(result) },
        { path: `${item.key}/architecture.json`, content: `${JSON.stringify(result, null, 2)}\n` }
      ],
      warnings: []
    };
  }
};
