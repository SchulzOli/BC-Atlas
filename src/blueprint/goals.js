// What a good architecture is for this team, as numbers: a closed catalog of
// criteria that each score a grouping of the project from 0 to 1, and the
// weights that say how much each one counts. The same goals score the
// structure the code has today and every target, so two architectures can be
// compared (compare.js) and several proposals can compete (bestProposal).
//
// The criteria read what evaluateArchitecture has computed already (coupling,
// violations, cycles, data ownership, stability); only the agreement with
// namespaces, folders, and apps, the size band, and the distance to a
// reference grouping are counted here.
import { UsageError } from "../cli/errors.js";
import { functionalFolder } from "./cluster.js";

// Modularity of 0.5 and more is a clear community structure; it counts as 1.
const FULL_MODULARITY = 0.5;

const round = (value, digits = 3) => Number(Number(value).toFixed(digits)) || 0;
const percent = (value) => `${Math.round(value * 100)}%`;
const plural = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** The workspace objects of the levels that have a component. */
function placed(levels, assignment) {
  return levels.object.nodes.filter((node) => node.origin === "workspace" && assignment.has(node.id));
}

/**
 * How well a grouping agrees with labels the objects carry (namespaces,
 * folders, apps): purity is the share of objects whose component is mostly
 * their label, coverage the share whose label is mostly their component; the
 * score is their harmonic mean. Hierarchical labels are tried at every depth
 * and the best depth counts, so components may follow the namespaces at the
 * first or at the third segment.
 */
function agreement(nodes, assignment, segmentsOf) {
  const labelled = nodes.map((node) => ({ component: assignment.get(node.id), segments: segmentsOf(node) })).filter(({ segments }) => segments.length);
  if (!labelled.length) return undefined;
  const depths = Math.min(8, Math.max(...labelled.map(({ segments }) => segments.length)));
  let best;
  for (let depth = 1; depth <= depths; depth++) {
    const perComponent = new Map();
    const perLabel = new Map();
    for (const { component, segments } of labelled) {
      const label = segments.slice(0, depth).join("\u0000").toLowerCase();
      if (!perComponent.has(component)) perComponent.set(component, new Map());
      if (!perLabel.has(label)) perLabel.set(label, new Map());
      perComponent.get(component).set(label, (perComponent.get(component).get(label) ?? 0) + 1);
      perLabel.get(label).set(component, (perLabel.get(label).get(component) ?? 0) + 1);
    }
    if (perLabel.size < 2) continue;
    const largest = (groups) => [...groups.values()].reduce((sum, counts) => sum + Math.max(...counts.values()), 0) / labelled.length;
    const purity = largest(perComponent);
    const coverage = largest(perLabel);
    const score = purity + coverage ? (2 * purity * coverage) / (purity + coverage) : 0;
    if (!best || score > best.score + 1e-9) best = { score, purity, coverage, depth, groups: perLabel.size };
  }
  return best && { ...best, objects: labelled.length };
}

function follow(what, segmentsOf) {
  return ({ nodes, assignment }) => {
    const found = agreement(nodes, assignment, segmentsOf);
    if (!found) return { score: 1, applicable: false, measured: {}, why: `The source has fewer than two ${what}; nothing to follow.` };
    return {
      score: found.score,
      measured: { objects: found.objects, groups: found.groups, depth: found.depth, purity: round(found.purity), coverage: round(found.coverage) },
      why: `${percent(found.purity)} of the objects sit in a component that is mostly their ${what.replace(/s$/u, "")}, and ${percent(found.coverage)} of each ${what.replace(/s$/u, "")} sits in one component (${found.groups} ${what} at depth ${found.depth}).`
    };
  };
}

const namespaceSegments = (node) => !node.namespace || node.namespace === "(global)" ? [] : node.namespace.split(".");
const folderSegments = (node) => (functionalFolder(node.file) ?? "").split("/").filter(Boolean);
const appSegments = (node) => node.app ? [node.app] : [];

/**
 * Which component of the reference grouping is the home of each component of
 * a grouping: the one most of its objects come from. A reference component is
 * the home of one component only (the one that takes most of it), so the
 * parts split off a component count as moved.
 * @param reference Map of object id to component name (the structure to stay close to)
 * @param assignment Map of object id to component name
 * @param ids the objects to count
 * @returns { overlaps: Map(component, Map(reference component, objects)), home: Map(component, reference component), moved: [ids] }
 */
export function alignComponents(reference, assignment, ids) {
  const overlaps = new Map();
  for (const id of ids) {
    const from = reference.get(id);
    const to = assignment.get(id);
    if (from === undefined || to === undefined) continue;
    if (!overlaps.has(to)) overlaps.set(to, new Map());
    overlaps.get(to).set(from, (overlaps.get(to).get(from) ?? 0) + 1);
  }
  const pairs = [...overlaps].flatMap(([to, sources]) => [...sources].map(([from, objects]) => ({ to, from, objects })))
    .sort((a, b) => b.objects - a.objects || Number(b.to === b.from) - Number(a.to === a.from) || a.to.localeCompare(b.to) || a.from.localeCompare(b.from));
  const home = new Map();
  const taken = new Set();
  for (const { to, from } of pairs) {
    if (home.has(to) || taken.has(from)) continue;
    home.set(to, from);
    taken.add(from);
  }
  const moved = ids.filter((id) => reference.has(id) && assignment.has(id) && home.get(assignment.get(id)) !== reference.get(id));
  return { overlaps, home, moved };
}

/**
 * The criteria, in the order reports list them. `measure` gets
 * { result, levels, nodes, assignment, size, reference } and returns
 * { score, measured, why, applicable? }.
 */
export const CRITERIA = Object.freeze([
  {
    id: "cohesion",
    title: "Cohesion",
    meaning: "What works together sits together.",
    measured: "The share of the weighted coupling between objects that stays inside components.",
    measure: ({ result }) => {
      const { inside, across, share } = result.summary.coupling;
      if (!(inside + across)) return { score: 1, applicable: false, measured: { inside, across }, why: "The objects have no coupling to each other." };
      return { score: share, measured: { inside, across, share }, why: `${percent(share)} of the weighted coupling stays inside components (${round(inside, 1)} of ${round(inside + across, 1)}).` };
    }
  },
  {
    id: "modularity",
    title: "Modularity",
    meaning: "The components are real groups, not one large one and not a random cut.",
    measured: `The weighted modularity Q of the grouping (0 when one component holds everything); ${FULL_MODULARITY} and more counts as 1.`,
    measure: ({ result }) => {
      const { modularity, inside, across } = result.summary.coupling;
      if (!(inside + across)) return { score: 1, applicable: false, measured: { modularity }, why: "The objects have no coupling to each other." };
      return { score: Math.min(1, Math.max(0, modularity) / FULL_MODULARITY), measured: { modularity }, why: `Modularity ${modularity} over ${plural(result.summary.components, "component")} (${FULL_MODULARITY} and more counts as full).` };
    }
  },
  {
    id: "layering",
    title: "Layering",
    meaning: "Dependencies between components go the allowed way.",
    measured: "The share of the object dependencies between components that the layers and declared dependencies allow.",
    measure: ({ result }) => {
      const total = result.edges.reduce((sum, edge) => sum + edge.objectEdges, 0);
      const allowed = result.edges.filter((edge) => edge.allowed).reduce((sum, edge) => sum + edge.objectEdges, 0);
      if (!total) return { score: 1, measured: { dependencies: 0, allowed: 0 }, why: "No dependencies between components." };
      return { score: allowed / total, measured: { dependencies: total, allowed, wrongWay: total - allowed }, why: `${allowed} of ${total} dependencies between components go the allowed way; ${total - allowed} ${total - allowed === 1 ? "does" : "do"} not.` };
    }
  },
  {
    id: "acyclic",
    title: "No cycles",
    meaning: "Components do not depend on each other in a circle.",
    measured: "1 minus the share of components that are part of a dependency cycle.",
    measure: ({ result }) => {
      const components = result.components.length;
      const inCycle = result.components.filter((component) => component.inCycle).length;
      return { score: components ? 1 - inCycle / components : 1, measured: { components, inCycle, cycles: result.cycles.length }, why: inCycle ? `${inCycle} of ${plural(components, "component")} are part of ${plural(result.cycles.length, "cycle")}.` : "No component is part of a cycle." };
    }
  },
  {
    id: "ownership",
    title: "Data ownership",
    meaning: "Every table is written by its own component only.",
    measured: "1 minus the share of tables that another component writes.",
    measure: ({ result, nodes }) => {
      const tables = nodes.filter(({ type }) => type === "table").length;
      const shared = result.dataOwnership.filter(({ status }) => status === "shared-writes").length;
      if (!tables) return { score: 1, applicable: false, measured: { tables: 0, sharedWrites: 0 }, why: "The source has no tables." };
      return { score: 1 - Math.min(1, shared / tables), measured: { tables, sharedWrites: shared }, why: shared ? `${shared} of ${plural(tables, "table")} are written by another component.` : `All ${plural(tables, "table")} are written by their own component only.` };
    }
  },
  {
    id: "extractable",
    title: "Extractable",
    meaning: "Components could become apps of their own today.",
    measured: "The share of objects in components without a forbidden outgoing dependency and outside every cycle.",
    measure: ({ result }) => {
      const objects = result.components.reduce((sum, component) => sum + component.metrics.objects, 0);
      const ready = result.components.filter((component) => component.extractable);
      const inside = ready.reduce((sum, component) => sum + component.metrics.objects, 0);
      return { score: objects ? inside / objects : 1, measured: { components: result.components.length, extractable: ready.length, objects, objectsExtractable: inside }, why: `${ready.length} of ${plural(result.components.length, "component")} (${percent(objects ? inside / objects : 1)} of the objects) could be an app of their own today.` };
    }
  },
  {
    id: "stability",
    title: "Stable dependencies",
    meaning: "Components depend on components that are more stable than themselves.",
    measured: "1 minus the share of the object dependencies between components that point at a less stable component (instability more than 0.1 higher).",
    measure: ({ result }) => {
      const total = result.edges.reduce((sum, edge) => sum + edge.objectEdges, 0);
      const unstable = result.stability.reduce((sum, edge) => sum + edge.objectEdges, 0);
      if (!total) return { score: 1, measured: { dependencies: 0, unstable: 0 }, why: "No dependencies between components." };
      return { score: 1 - unstable / total, measured: { dependencies: total, unstable }, why: unstable ? `${unstable} of ${total} dependencies between components point at a less stable component.` : "Every dependency points at a component that is at least as stable." };
    }
  },
  {
    id: "size",
    title: "Size",
    meaning: "Components are neither tiny nor huge.",
    measured: "The share of objects in components whose object count lies inside the size band (goals.size: min, max).",
    measure: ({ nodes, assignment, size }) => {
      const counts = new Map();
      for (const node of nodes) counts.set(assignment.get(node.id), (counts.get(assignment.get(node.id)) ?? 0) + 1);
      const sizes = [...counts.values()];
      const inside = sizes.filter((count) => count >= size.min && count <= size.max).reduce((sum, count) => sum + count, 0);
      const tooSmall = sizes.filter((count) => count < size.min).length;
      const tooLarge = sizes.filter((count) => count > size.max).length;
      return {
        score: nodes.length ? inside / nodes.length : 1,
        measured: { min: size.min, max: size.max, objects: nodes.length, inside, tooSmall, tooLarge },
        why: `${percent(nodes.length ? inside / nodes.length : 1)} of the objects are in components of ${size.min} to ${size.max} objects; ${plural(tooSmall, "component")} smaller, ${tooLarge} larger.`
      };
    }
  },
  {
    id: "followNamespaces",
    title: "Follows namespaces",
    meaning: "Components agree with the namespaces the code has.",
    measured: "Harmonic mean of purity (objects whose component is mostly their namespace) and coverage (objects whose namespace is mostly their component), at the namespace depth that fits best.",
    measure: follow("namespaces", namespaceSegments)
  },
  {
    id: "followFolders",
    title: "Follows folders",
    meaning: "Components agree with the folders that say what objects do.",
    measured: "The same agreement with the functional folders (folders that only sort by object type do not count).",
    measure: follow("folders", folderSegments)
  },
  {
    id: "followApps",
    title: "Follows apps",
    meaning: "Components agree with the apps the code is split into.",
    measured: "The same agreement with the apps of the workspace.",
    measure: follow("apps", appSegments)
  },
  {
    id: "fewMoves",
    title: "Few moves",
    meaning: "The architecture is close to the structure the source has today.",
    measured: "1 minus the share of objects that would have to move from where they are today (compare.js gives the structure of today).",
    measure: ({ nodes, assignment, reference }) => {
      if (!reference) return { score: 1, applicable: false, measured: {}, why: "No structure of today to compare with." };
      const ids = nodes.map(({ id }) => id).filter((id) => reference.has(id));
      const { moved } = alignComponents(reference, assignment, ids);
      return { score: ids.length ? 1 - moved.length / ids.length : 1, measured: { objects: ids.length, moved: moved.length }, why: moved.length ? `${moved.length} of ${plural(ids.length, "object")} would have to move.` : "No object has to move." };
    }
  }
]);

const IDS = CRITERIA.map(({ id }) => id);

export const DEFAULT_GOALS = Object.freeze({
  // Modularity counts most: unlike the share of coupling inside components,
  // the absence of cycles, or owned data, it does not get better by simply
  // merging everything into one component.
  weights: Object.freeze({
    cohesion: 2,
    modularity: 4,
    layering: 3,
    acyclic: 2,
    ownership: 2,
    extractable: 1,
    stability: 1,
    size: 1,
    followNamespaces: 1,
    followFolders: 1,
    followApps: 1,
    fewMoves: 2
  }),
  size: Object.freeze({ min: 3, max: 200 })
});

function fail(message) {
  throw new UsageError(`architecture.goals${message}`);
}

/** Weights as an object: { cohesion: 3 }, "cohesion=3,size=0", or ["cohesion=3", "size=0"]. */
function readWeights(value, where) {
  if (value === undefined || value === null) return {};
  let entries;
  if (typeof value === "string" || Array.isArray(value)) {
    entries = [value].flat().flatMap((item) => String(item).split(",")).map((item) => item.trim()).filter(Boolean).map((item) => {
      const [id, number] = item.split("=").map((part) => part.trim());
      if (number === undefined || number === "") fail(`${where}: "${item}" must be criterion=weight, e.g. cohesion=3`);
      return [id, Number(number)];
    });
  } else if (typeof value === "object") {
    entries = Object.entries(value).filter(([key]) => key !== "$comment");
  } else {
    fail(`${where} must map criteria to weights`);
  }
  for (const [id, weight] of entries) {
    if (!IDS.includes(id)) fail(`${where} has no criterion "${id}"; use ${IDS.join(", ")}`);
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0) fail(`${where}.${id} must be a number of 0 or more`);
  }
  return Object.fromEntries(entries);
}

/** A size band as { min, max } or "3..200"; either end may be left out. */
function readSize(value, where) {
  if (value === undefined || value === null) return {};
  let size = value;
  if (typeof value === "string") {
    const match = /^\s*(\d*)\s*\.\.\s*(\d*)\s*$/u.exec(value);
    if (!match) fail(`${where} must be min..max, e.g. 3..200`);
    size = { ...(match[1] ? { min: Number(match[1]) } : {}), ...(match[2] ? { max: Number(match[2]) } : {}) };
  }
  if (typeof size !== "object" || Array.isArray(size)) fail(`${where} must be { "min": number, "max": number }`);
  for (const key of Object.keys(size)) if (!["min", "max"].includes(key)) fail(`${where} has no setting "${key}"; use min or max`);
  for (const key of ["min", "max"]) {
    if (size[key] !== undefined && !(Number.isInteger(size[key]) && size[key] >= 1)) fail(`${where}.${key} must be an integer of 1 or more`);
  }
  return size;
}

/**
 * The effective goals: the defaults, overridden by the template, by
 * `architecture.goals` in .bca.json, and by the options of this call.
 * @param config `architecture` from .bca.json (goals)
 * @param values { weights, size } from the CLI, MCP, or the app (undefined = not set);
 *   weights as an object, "criterion=n,criterion=n", or a list of "criterion=n"
 * @param base { goals, source } of the template in use (templates.js)
 * @returns { weights: { criterion: number }, size: { min, max }, sources: { weights: { criterion: source }, size: { min, max } } }
 *   with source "default" | "template <name>" | ".bca.json" | "option"
 */
export function goalsConfig(config = {}, values = {}, base = {}) {
  const configured = config?.goals ?? {};
  if (typeof configured !== "object" || Array.isArray(configured)) fail(" must be an object");
  for (const key of Object.keys(configured)) if (!["weights", "size", "$comment"].includes(key)) fail(` has no setting "${key}"; use weights or size`);
  const layers = [
    [base.source ?? "template", readWeights(base.goals?.weights, ".weights of the template"), readSize(base.goals?.size, ".size of the template")],
    [".bca.json", readWeights(configured.weights, ".weights"), readSize(configured.size, ".size")],
    ["option", readWeights(values.weights ?? values.weight, ".weights"), readSize(values.size, ".size")]
  ];
  const weights = { ...DEFAULT_GOALS.weights };
  const size = { ...DEFAULT_GOALS.size };
  const sources = { weights: Object.fromEntries(IDS.map((id) => [id, "default"])), size: { min: "default", max: "default" } };
  for (const [source, layerWeights, layerSize] of layers) {
    for (const [id, weight] of Object.entries(layerWeights)) {
      weights[id] = weight;
      sources.weights[id] = source;
    }
    for (const [key, value] of Object.entries(layerSize)) {
      size[key] = value;
      sources.size[key] = source;
    }
  }
  if (size.max < size.min) fail(`.size: max (${size.max}) is below min (${size.min})`);
  if (!Object.values(weights).some((weight) => weight > 0)) fail(".weights: at least one criterion needs a weight above 0");
  return { weights, size, sources };
}

/**
 * Scores an evaluated architecture with the goals.
 * @param assessment { levels, result, reference? }: the dependency levels, the
 *   result of evaluateArchitecture for them, and for fewMoves a Map of object
 *   id to the component it is in today
 * @param goals { weights, size }; criteria left out keep their default weight,
 *   weight 0 leaves a criterion out of the total
 * @returns { total (0 to 100), criteria: [{ id, title, score, weight, share, contribution, applicable, measured, why }] }
 *   share is the normalised weight, contribution the points of the total
 */
export function scoreArchitecture(assessment, goals = DEFAULT_GOALS) {
  const { levels, result, reference } = assessment;
  const { weights, size } = goals.sources ? goals : goalsConfig({ goals: { weights: goals.weights, size: goals.size } });
  const nodes = placed(levels, result.assignment);
  const input = { result, levels, nodes, assignment: result.assignment, size, reference };
  const sum = Object.values(weights).reduce((total, weight) => total + weight, 0);
  const criteria = CRITERIA.map((criterion) => {
    const { score, measured, why, applicable = true } = criterion.measure(input);
    const weight = weights[criterion.id];
    return {
      id: criterion.id,
      title: criterion.title,
      score: round(score),
      weight,
      share: round(weight / sum),
      contribution: round((weight / sum) * score * 100, 1),
      applicable,
      measured,
      why
    };
  });
  return {
    total: round(criteria.reduce((total, { score, weight }) => total + (weight / sum) * score * 100, 0), 1),
    criteria
  };
}
