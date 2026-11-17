// Current state and target state of the architecture, side by side: how the
// source is organised today, what it should become, how both score against
// the same goals, which component of today becomes which component of the
// target, which objects have to move, and in which order to do it.
//
// A side is one of:
//   structure   the grouping the source has today: its namespaces, else its
//               functional folders, else its apps. Built directly from the
//               objects (no clustering); the proposal only lays the groups
//               out in layers, as it does for components you define (keep).
//   configured  architecture.components of .bca.json
//   proposal    the proposal under the template and settings in use
//   best        several proposals, each scored with the goals; the best wins
//
// Both sides are checked with the same rules (coupling weights, layer rules)
// and scored with the same goals, so the numbers can be compared.
import { createHash } from "node:crypto";
import { analyzeProject } from "../architecture.js";
import { UsageError } from "../cli/errors.js";
import { coupling } from "../graph/coupling.js";
import { normalizeIdentifier } from "../resolver.js";
import { functionalFolder } from "./cluster.js";
import { evaluateArchitecture } from "./evaluate.js";
import { alignComponents, CRITERIA, scoreArchitecture } from "./goals.js";
import { architectureContext, dependencyLevels } from "./index.js";
import { proposeArchitecture } from "./propose.js";
import { PROPOSAL_DEFAULTS } from "./settings.js";
import { templateSettings, withTemplateRules } from "./templates.js";

export const COMPARE_SCHEMA = "bc-atlas.architecture-compare/1";
export const SIDES = Object.freeze(["structure", "configured", "proposal", "best"]);

// The proposal options of bca architecture that a call may set.
const PROPOSAL_OPTIONS = ["groupBy", "depth", "minObjects", "startFrom", "ignore", "granularity", "sharedCore"];
// Both ways at least this share: the same component.
const SAME_SHARE = 0.9;
const DEFAULT_LIMIT = 50;

const round = (value, digits = 3) => Number(Number(value).toFixed(digits)) || 0;
const hasNamespace = (node) => Boolean(node.namespace) && node.namespace !== "(global)";
const workspace = (levels) => levels.object.nodes.filter(({ origin }) => origin === "workspace");

function commonLength(lists) {
  let common = 0;
  while (lists.length && lists.every((parts) => parts.length > common && parts[common].toLowerCase() === lists[0][common].toLowerCase())) common++;
  return common;
}

/**
 * The groups the source has today, as components with selectors: one
 * namespace segment below the common prefix, else one functional folder
 * below the common folder, else the apps. Objects without the structure the
 * others have fall back to their folder, then to their app.
 */
function structureComponents(levels, depth) {
  const nodes = workspace(levels).filter(({ outsideSelection }) => !outsideSelection);
  if (!nodes.length) throw new UsageError("the analyzed source has no objects to compare");
  const apps = new Map((levels.app?.nodes ?? []).map((node) => [node.id, node.label]));
  const namespaces = nodes.filter(hasNamespace).map((node) => node.namespace.split("."));
  const folders = nodes.map((node) => (functionalFolder(node.file) ?? "").split("/").filter(Boolean)).filter((parts) => parts.length);
  const namespaceDepth = depth ?? commonLength(namespaces) + 1;
  const folderDepth = depth ?? commonLength(folders) + 1;

  const byNamespace = (node) => {
    if (!hasNamespace(node)) return undefined;
    const parts = node.namespace.split(".").slice(0, namespaceDepth);
    return { label: parts.at(-1), selector: `namespace:${parts.join(".")}` };
  };
  const byFolder = (node) => {
    const parts = (functionalFolder(node.file) ?? "").split("/").filter(Boolean).slice(0, folderDepth);
    return parts.length ? { label: parts.at(-1), selector: `folder:${parts.join("/")}` } : undefined;
  };
  const byApp = (node) => {
    const label = apps.get(node.app) ?? "(no app)";
    return { label, selector: apps.has(node.app) ? `app:${label}` : "*" };
  };
  // Component names are compared the way identifiers are: "Sales" and "sales" are one group.
  const keyOf = (label) => normalizeIdentifier(label);
  const distinct = (groupOf) => new Set(nodes.map((node) => groupOf(node)).filter(Boolean).map(({ label }) => keyOf(label))).size;
  const covers = (groupOf) => nodes.filter((node) => groupOf(node)).length * 2 >= nodes.length && distinct(groupOf) > 1;
  const basis = covers(byNamespace) ? "namespace" : covers(byFolder) ? "folder" : "app";
  const order = { namespace: [byNamespace, byFolder, byApp], folder: [byFolder, byApp], app: [byApp] }[basis];

  const groups = new Map();
  const intended = new Map();
  for (const node of nodes) {
    let group;
    for (const groupOf of order) if ((group = groupOf(node))) break;
    const key = keyOf(group.label);
    if (!groups.has(key)) groups.set(key, { name: group.label, match: [] });
    if (!groups.get(key).match.includes(group.selector)) groups.get(key).match.push(group.selector);
    intended.set(node.id, groups.get(key).name);
  }
  return { basis, components: [...groups.values()].sort((a, b) => a.name.localeCompare(b.name)), intended, nodes };
}

const TITLES = {
  namespace: "The namespaces of the source",
  folder: "The folders of the source",
  app: "The apps of the source"
};

function structureSide(levels, settings) {
  const { basis, components, intended, nodes } = structureComponents(levels, settings.settings.depth);
  const build = () => {
    // Every object is in a component given here, so nothing is clustered;
    // the proposal orders the components into layers and allowed dependencies.
    // Settings that would rename or regroup them (keep, exclude, minObjects, naming) do not apply to the structure as it is.
    const proposal = proposeArchitecture(levels, { ...settings.settings, keep: components, exclude: [], minObjects: 1, naming: undefined });
    const architecture = withTemplateRules(proposal.architecture, settings, { all: true });
    return { architecture, result: evaluateArchitecture(levels, architecture, { architectureOrigin: "proposed" }) };
  };
  let side = build();
  // A selector of another group that is more specific (a folder inside a
  // namespace) would take an object away; name such objects explicitly.
  const strays = nodes.filter((node) => side.result.assignment.get(node.id) !== intended.get(node.id));
  if (strays.length) {
    for (const node of strays) components.find(({ name }) => name === intended.get(node.id))?.match.push(`object:${node.type}:${node.label}`);
    side = build();
  }
  return { kind: "structure", basis, title: TITLES[basis], ...side };
}

function configuredSide(levels, settings, configured) {
  if (!configured?.components?.length) {
    throw new UsageError("no architecture is configured (.bca.json has no architecture.components); compare with the proposal (to: proposal or best), or adopt one first: bca architecture --propose --write");
  }
  const architecture = withTemplateRules(configured, settings, { all: true });
  return { kind: "configured", title: "The architecture configured in .bca.json", architecture, result: evaluateArchitecture(levels, architecture, { architectureOrigin: "configured" }) };
}

const candidateSettings = ({ groupBy, depth, granularity, sharedCore, startFrom, minObjects, ignore }) => ({
  groupBy: groupBy ?? "auto", ...(depth === undefined ? {} : { depth }), granularity, sharedCore, startFrom: [...startFrom], minObjects, ignore: [...ignore]
});

function proposalSide(levels, settings) {
  const proposal = proposeArchitecture(levels, settings.settings);
  const architecture = withTemplateRules(proposal.architecture, settings, { all: true });
  return {
    kind: "proposal",
    title: `The proposal (template ${settings.template.name})`,
    settings: candidateSettings(settings.settings),
    proposal,
    architecture,
    result: evaluateArchitecture(levels, architecture, { architectureOrigin: "proposed" })
  };
}

/** A short fingerprint of a grouping, to see that two candidates are the same. */
function groupingKey(assignment) {
  const members = new Map();
  for (const [id, component] of assignment) {
    if (!members.has(component)) members.set(component, []);
    members.get(component).push(id);
  }
  const text = [...members.values()].map((ids) => ids.sort().join("\n")).sort().join("\n\n");
  return createHash("sha1").update(text).digest("hex");
}

/**
 * Proposes several architectures and picks the one that scores best with the
 * goals. The candidates vary what the settings leave open: how to group
 * (the relations, namespaces, folders, relations only), the granularity
 * (half, double), and the shared core (on, off). A setting given as an
 * option of the call is not varied.
 * @param levels the dependency levels
 * @param settings the result of proposalSettings (or templateSettings(...).settings)
 * @param goals the result of goalsConfig
 * @param options { reference: Map of object id to today's component, for fewMoves;
 *   rules: architecture settings every candidate is checked with (couplingWeights, strictLayers, ...);
 *   limit: at most this many candidates (default and maximum 8) }
 * @returns { best: { id, label, settings, proposal, architecture, result, score },
 *   candidates: [{ id, label, settings, components, total, criteria: { criterion: score }, chosen, sameAs?, error? }] }
 */
export function bestProposal(levels, settings, goals, { reference, rules = {}, limit = 8 } = {}) {
  const nodes = workspace(levels);
  const fixed = (key) => settings.sources?.[key] === "option";
  const variants = [
    { id: "settings", label: "The settings as they are", change: {} },
    ...(nodes.some(hasNamespace) ? [{ id: "namespaces", label: "Namespaces decide", change: { groupBy: "namespace" } }] : []),
    ...(nodes.some((node) => functionalFolder(node.file)) ? [{ id: "folders", label: "Folders decide", change: { groupBy: "folder" } }] : []),
    { id: "relations", label: "Relations only", change: { groupBy: "coupling", startFrom: [] } },
    { id: "coarser", label: "Coarser (half the granularity)", change: { granularity: round(settings.granularity / 2) } },
    { id: "finer", label: "Finer (double the granularity)", change: { granularity: round(settings.granularity * 2) } },
    { id: "core", label: settings.sharedCore ? "Without a shared core" : "With a shared core", change: { sharedCore: !settings.sharedCore } },
    { id: "coarser-core", label: `Coarser, ${settings.sharedCore ? "without" : "with"} a shared core`, change: { granularity: round(settings.granularity / 2), sharedCore: !settings.sharedCore } }
  ];
  const seen = new Set();
  const chosen = [];
  for (const variant of variants) {
    if (Object.keys(variant.change).some(fixed)) continue;
    const next = { ...settings, ...variant.change, sources: { ...settings.sources, ...Object.fromEntries(Object.keys(variant.change).map((key) => [key, "candidate"])) } };
    const key = JSON.stringify(candidateSettings(next));
    if (seen.has(key)) continue;
    seen.add(key);
    chosen.push({ ...variant, settings: next });
    if (chosen.length >= Math.min(8, Math.max(1, limit))) break;
  }

  const groupings = new Map();
  const candidates = chosen.map((candidate) => {
    const summary = { id: candidate.id, label: candidate.label, settings: candidateSettings(candidate.settings) };
    try {
      const proposal = proposeArchitecture(levels, candidate.settings);
      const architecture = { ...proposal.architecture, ...rules };
      const result = evaluateArchitecture(levels, architecture, { architectureOrigin: "proposed" });
      const score = scoreArchitecture({ levels, result, reference }, goals);
      const grouping = groupingKey(result.assignment);
      const sameAs = groupings.get(grouping);
      if (!sameAs) groupings.set(grouping, candidate.id);
      return {
        ...summary,
        components: result.components.length,
        total: score.total,
        criteria: Object.fromEntries(score.criteria.map(({ id, score: value }) => [id, value])),
        ...(sameAs ? { sameAs } : {}),
        full: { id: candidate.id, label: candidate.label, settings: candidate.settings, proposal, architecture, result, score }
      };
    } catch (error) {
      return { ...summary, error: error.message };
    }
  });
  // The best total wins; among equals the one listed first (the settings as they are).
  const winner = candidates.filter(({ full }) => full).reduce((best, candidate) => !best || candidate.total > best.total ? candidate : best, undefined);
  if (!winner) throw new UsageError(`no proposal could be made: ${candidates.map(({ label, error }) => `${label}: ${error}`).join("; ")}`);
  return {
    best: winner.full,
    candidates: candidates.map(({ full: _full, ...candidate }) => ({ ...candidate, chosen: candidate.id === winner.id }))
  };
}

function bestSide(levels, settings, reference) {
  const { best, candidates } = bestProposal(levels, settings.settings, settings.goals, {
    reference,
    rules: withTemplateRules({}, settings, { all: true })
  });
  return {
    kind: "best",
    title: `The best of ${candidates.length} proposals: ${best.label.toLowerCase()}`,
    settings: candidateSettings(best.settings),
    candidate: best.id,
    proposal: best.proposal,
    architecture: best.architecture,
    result: best.result,
    candidates
  };
}

/** An object selector for the command line: codeunit:50100, or interface:"Name" for objects without an ID. */
const objectSelector = (node) => `${node.type}:${node.objectId ?? `"${node.label}"`}`;
const moveCommand = (node, to) => `bca refactor move --object ${objectSelector(node)} --to "${to}"`;

/** The dependencies between two objects that an evaluated architecture does not allow (rules of .bca.json aside). */
function forbidden(result) {
  return new Set(result.violations.filter(({ rule }) => rule !== "dependency-rule").map(({ source, target }) => `${source.id}\u0000${target.id}`));
}

/** For each target component: where its objects are today, and what that makes of it. */
function mapComponents(current, target, ids) {
  const currentOf = current.result.assignment;
  const targetOf = target.result.assignment;
  const alignment = alignComponents(currentOf, targetOf, ids);
  const size = (assignment) => {
    const counts = new Map();
    for (const id of ids) counts.set(assignment.get(id), (counts.get(assignment.get(id)) ?? 0) + 1);
    return counts;
  };
  const currentSize = size(currentOf);
  const targetSize = size(targetOf);
  const mapping = target.result.components.map(({ name }) => {
    const objects = targetSize.get(name) ?? 0;
    const from = [...(alignment.overlaps.get(name) ?? [])]
      .map(([component, count]) => ({ component, objects: count, share: round(count / objects), ofCurrent: round(count / currentSize.get(component)) }))
      .sort((a, b) => b.objects - a.objects || a.component.localeCompare(b.component));
    const [main] = from;
    let status = "new";
    if (main && main.share >= SAME_SHARE && main.ofCurrent >= SAME_SHARE) status = main.component === name ? "same" : "renamed";
    else if (from.filter(({ ofCurrent }) => ofCurrent > 0.5).length > 1) status = "merged";
    else if (main && main.share > 0.5 && main.ofCurrent <= 0.5) status = "split";
    else if (main && main.share > 0.5) status = "reshaped";
    return { target: name, objects, status, from };
  }).filter(({ objects }) => objects);
  const mains = new Set(mapping.map(({ from }) => from[0]?.component));
  const gone = current.result.components.map(({ name }) => name).filter((name) => currentSize.get(name) && !mains.has(name))
    .map((component) => ({
      component,
      objects: currentSize.get(component),
      to: mapping.filter(({ from }) => from.some((source) => source.component === component))
        .map(({ target: name, from }) => ({ component: name, objects: from.find((source) => source.component === component).objects }))
        .sort((a, b) => b.objects - a.objects || a.component.localeCompare(b.component))
    }));
  return { mapping, gone, alignment };
}

/** The objects that are not where the target wants them, most valuable first. */
function planMoves(levels, current, target, alignment, weights) {
  const nodes = new Map(levels.object.nodes.map((node) => [node.id, node]));
  const currentOf = current.result.assignment;
  const targetOf = target.result.assignment;
  const moved = new Set(alignment.moved);
  const toTarget = new Map();
  const toHome = new Map();
  for (const edge of levels.object.edges) {
    if (edge.source === edge.target) continue;
    for (const [object, other] of [[edge.source, edge.target], [edge.target, edge.source]]) {
      if (!moved.has(object)) continue;
      const weight = coupling(edge.kinds, weights);
      if (targetOf.get(other) === targetOf.get(object)) toTarget.set(object, (toTarget.get(object) ?? 0) + weight);
      else if (currentOf.get(other) === currentOf.get(object)) toHome.set(object, (toHome.get(object) ?? 0) + weight);
    }
  }
  const before = forbidden(current.result);
  const after = forbidden(target.result);
  const resolves = new Map();
  for (const key of before) {
    if (after.has(key)) continue;
    for (const id of key.split("\u0000")) if (moved.has(id)) resolves.set(id, (resolves.get(id) ?? 0) + 1);
  }
  return alignment.moved.map((id) => {
    const node = nodes.get(id);
    const to = targetOf.get(id);
    return {
      object: { id, type: node.type, name: node.label, ...(node.objectId ? { objectId: node.objectId } : {}), ...(node.file ? { file: node.file } : {}) },
      from: currentOf.get(id),
      to,
      gain: round((toTarget.get(id) ?? 0) - (toHome.get(id) ?? 0), 1),
      resolves: resolves.get(id) ?? 0,
      command: moveCommand(node, to)
    };
  }).sort((a, b) => b.resolves - a.resolves || b.gain - a.gain || a.object.name.localeCompare(b.object.name) || a.object.id.localeCompare(b.object.id));
}

const OPTION_NAMES = { groupBy: "--group-by", depth: "--depth", minObjects: "--min-objects", startFrom: "--start-from", ignore: "--ignore", granularity: "--granularity", sharedCore: "--shared-core" };

/** The command that writes a proposed target to .bca.json: every setting that is not the default, as an option. */
function adoptCommand(target, settings) {
  const options = [];
  if (settings.template.source === "option") options.push(`--template "${settings.template.name}"`);
  for (const [key, option] of Object.entries(OPTION_NAMES)) {
    const value = target.settings[key];
    if (value === undefined || JSON.stringify(value) === JSON.stringify(PROPOSAL_DEFAULTS[key])) continue;
    options.push(`${option} ${Array.isArray(value) ? value.join(",") || "none" : value}`);
  }
  return ["bca architecture --propose", ...options, "--write"].join(" ");
}

const count = (number, noun) => `${number} ${number === 1 ? noun : noun.endsWith("y") ? `${noun.slice(0, -1)}ies` : `${noun}s`}`;

/**
 * The steps in the order to take them: adopt the target, then the moves per
 * target component (first the components whose moves remove most
 * dependencies that are forbidden today, then by the coupling the moves
 * bring inside), then what the target still does not allow, then the check.
 */
function planSteps(current, target, moves, listed, settings) {
  const steps = [];
  if (target.kind === "proposal" || target.kind === "best") {
    steps.push({
      title: "Adopt the target architecture",
      why: "Writes the target components to .bca.json. From then on bca architecture and bca check measure the source against the target, and bca refactor move knows the components.",
      objects: 0,
      commands: [adoptCommand(target, settings)]
    });
  } else if (target.kind === "structure") {
    steps.push({
      title: "Adopt the target architecture",
      why: "Write the target components (the structure of the source) to architecture.components in .bca.json, so that bca architecture and bca check measure the source against them.",
      objects: 0,
      commands: []
    });
  }
  const groups = new Map();
  for (const move of moves) {
    if (!groups.has(move.to)) groups.set(move.to, []);
    groups.get(move.to).push(move);
  }
  const visible = new Set(listed);
  const ordered = [...groups].map(([to, list]) => ({
    to,
    list,
    resolves: list.reduce((sum, move) => sum + move.resolves, 0),
    gain: round(list.reduce((sum, move) => sum + move.gain, 0), 1)
  })).sort((a, b) => b.resolves - a.resolves || b.gain - a.gain || b.list.length - a.list.length || a.to.localeCompare(b.to));
  for (const { to, list, resolves, gain } of ordered) {
    const sources = new Map();
    for (const move of list) sources.set(move.from, (sources.get(move.from) ?? 0) + 1);
    const from = [...sources].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, number]) => `${number} from ${name}`).join(", ");
    const commands = list.filter((move) => visible.has(move)).map(({ command }) => command);
    steps.push({
      title: `Move ${count(list.length, "object")} to ${to}`,
      why: `${from}. ${resolves ? `Removes ${count(resolves, "dependency")} that today's structure does not allow. ` : ""}${gain > 0 ? `Brings ${gain} of coupling inside the component.` : gain < 0 ? `Costs ${-gain} of coupling inside components; the target wants the objects here for another reason.` : "Coupling inside components stays the same."}`,
      component: to,
      objects: list.length,
      resolves,
      gain,
      commands,
      ...(commands.length < list.length ? { omitted: list.length - commands.length } : {})
    });
  }
  const remaining = target.result.violations.filter(({ rule }) => rule !== "dependency-rule").length;
  if (remaining) {
    const strategies = Object.entries(target.result.summary.byStrategy).slice(0, 4).map(([strategy, number]) => `${strategy} (${number})`).join(", ");
    steps.push({
      title: `Resolve ${count(remaining, "dependency")} the target does not allow`,
      why: `Moving objects does not remove them; they need a change in the code: ${strategies}. bca architecture lists every work item with its steps.`,
      objects: 0,
      commands: target.result.workItems.filter(({ command }) => command).slice(0, 10).map(({ command }) => command)
    });
  }
  steps.push({
    title: "Check the result",
    why: "Compile, then let BC Atlas measure the source against the target again.",
    objects: 0,
    commands: ["bca architecture", "bca check"]
  });
  return steps;
}

function describeSide(side, score, ids) {
  const counts = new Map();
  for (const id of ids) counts.set(side.result.assignment.get(id), (counts.get(side.result.assignment.get(id)) ?? 0) + 1);
  return {
    kind: side.kind,
    title: side.title,
    ...(side.basis ? { basis: side.basis } : {}),
    ...(side.candidate ? { candidate: side.candidate } : {}),
    ...(side.settings ? { settings: side.settings } : {}),
    components: side.result.components.filter(({ name }) => counts.get(name))
      .map(({ name, layer }) => ({ name, objects: counts.get(name), ...(layer === undefined ? {} : { layer }) })),
    violations: side.result.violations.filter(({ rule }) => rule !== "dependency-rule").length,
    cycles: side.result.cycles.length,
    score: score.total
  };
}

/**
 * Compares two groupings of the same dependency levels.
 * @param levels the dependency levels
 * @param options { root: the project root, architecture: `architecture` from .bca.json,
 *   values: { from, to, limit, template, weights, size, and the proposal options } }
 * @returns the comparison (see compareArchitecture)
 */
export function compareLevels(levels, { root = ".", architecture = {}, values = {} } = {}) {
  const settings = templateSettings(root, architecture, {
    template: values.template,
    weights: values.weights ?? values.weight,
    size: values.size,
    ...Object.fromEntries(PROPOSAL_OPTIONS.map((key) => [key, values[key]]))
  });
  const from = values.from ?? "structure";
  const to = values.to ?? (architecture?.components?.length ? "configured" : "best");
  for (const [name, side] of [["from", from], ["to", to]]) {
    if (!SIDES.includes(side)) throw new UsageError(`${name} must be one of: ${SIDES.join(", ")} (received "${side}")`);
  }
  if (from === to) throw new UsageError(`from and to are both "${from}"; compare two different states`);
  const limit = values.limit === undefined ? DEFAULT_LIMIT : Number(values.limit);
  if (!Number.isInteger(limit) || limit < 0) throw new UsageError("limit must be an integer of 0 or more (0: every move)");

  // fewMoves always measures the distance to the structure of today.
  let structure;
  const today = () => (structure ??= structureSide(levels, settings));
  const reference = () => today().result.assignment;
  const build = (kind) => {
    if (kind === "structure") return today();
    if (kind === "configured") return configuredSide(levels, settings, architecture);
    if (kind === "proposal") return proposalSide(levels, settings);
    return bestSide(levels, settings, reference());
  };
  const current = build(from);
  const target = build(to);
  const goals = settings.goals;
  const scores = {
    current: scoreArchitecture({ levels, result: current.result, reference: reference() }, goals),
    target: scoreArchitecture({ levels, result: target.result, reference: reference() }, goals)
  };

  const ids = workspace(levels).map(({ id }) => id).filter((id) => current.result.assignment.has(id) && target.result.assignment.has(id));
  const { mapping, gone, alignment } = mapComponents(current, target, ids);
  const moves = planMoves(levels, current, target, alignment, settings.settings.weights);
  const listed = limit ? moves.slice(0, limit) : moves;
  const criteria = CRITERIA.map(({ id, title }, index) => {
    const before = scores.current.criteria[index];
    const after = scores.target.criteria[index];
    return {
      id,
      title,
      weight: before.weight,
      share: before.share,
      current: before.score,
      target: after.score,
      delta: round(after.score - before.score),
      why: `Today: ${before.why} Target: ${after.why}`
    };
  });
  const counted = criteria.filter(({ weight }) => weight > 0);

  const result = {
    schema: COMPARE_SCHEMA,
    from,
    to,
    template: settings.template,
    goals: { weights: goals.weights, size: goals.size, sources: goals.sources },
    rules: withTemplateRules({}, settings, { all: true }),
    current: describeSide(current, scores.current, ids),
    target: describeSide(target, scores.target, ids),
    criteria,
    mapping,
    gone,
    moves: listed,
    movesTotal: moves.length,
    steps: planSteps(current, target, moves, listed, settings),
    ...(target.candidates ?? current.candidates ? { candidates: target.candidates ?? current.candidates } : {}),
    summary: {
      objects: ids.length,
      moves: moves.length,
      distance: ids.length ? round(moves.length / ids.length) : 0,
      current: scores.current.total,
      target: scores.target.total,
      delta: round(scores.target.total - scores.current.total, 1),
      improves: counted.filter(({ delta }) => delta > 0).map(({ id }) => id),
      worsens: counted.filter(({ delta }) => delta < 0).map(({ id }) => id)
    }
  };
  // The evaluated sides, for callers that write the target or render more; not part of the JSON.
  Object.defineProperty(result, "sides", { value: { current, target, scores, settings }, enumerable: false });
  return result;
}

/**
 * Current state and target state of a project's architecture.
 * @param input the project (or a path inside it to focus on)
 * @param values options: from, to (structure | configured | proposal | best;
 *   default from structure, to configured when .bca.json has components, else best),
 *   limit (moves listed, default 50, 0 for all), template, weights, size, the
 *   proposal options (groupBy, depth, minObjects, startFrom, ignore, granularity,
 *   sharedCore), and the project options of bca architecture
 * @param context { model }: an analyzed project to reuse
 * @returns {
 *   schema: "bc-atlas.architecture-compare/1", from, to,
 *   template: { name, title, summary, origin, chain, source },
 *   goals: { weights, size, sources }, rules,
 *   current, target: { kind, title, basis?, settings?, candidate?, components: [{ name, objects, layer? }], violations, cycles, score },
 *   criteria: [{ id, title, weight, share, current, target, delta, why }],
 *   mapping: [{ target, objects, status: "same" | "renamed" | "split" | "merged" | "reshaped" | "new", from: [{ component, objects, share, ofCurrent }] }],
 *   gone: [{ component, objects, to: [{ component, objects }] }],
 *   moves: [{ object: { id, type, name, objectId?, file? }, from, to, gain, resolves, command }], movesTotal,
 *   steps: [{ title, why, component?, objects, resolves?, gain?, commands, omitted? }],
 *   candidates?: [...] (with best),
 *   summary: { objects, moves, distance, current, target, delta, improves, worsens }
 * }
 *   and, not enumerable, sides: { current, target, scores, settings } with the evaluated architectures
 */
export async function compareArchitecture(input, values = {}, { model } = {}) {
  const context = await architectureContext(input, values);
  const analyzed = model ?? await analyzeProject(context.projectRoot, context.options, { fileFilter: context.fileFilter });
  const levels = await dependencyLevels(context, { model: analyzed });
  return compareLevels(levels, { root: context.projectRoot, architecture: context.options.architecture, values });
}

const signed = (value, digits = 2) => `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
const STATUS_TEXT = {
  same: "stays",
  renamed: "renamed from",
  split: "split off",
  merged: "merges",
  reshaped: "reshaped from",
  new: "new, from"
};
const sourcesText = (from) => from.map(({ component, objects }) => `${component} (${objects})`).join(", ") || "nothing";
// Long lists name the largest and count the rest.
const LISTED = 8;
function componentsText(components) {
  if (components.length <= LISTED) return components.map(({ name, objects }) => `${name} (${objects})`).join(", ");
  const largest = [...components].sort((a, b) => b.objects - a.objects || a.name.localeCompare(b.name)).slice(0, LISTED);
  return `${components.length} components; the largest: ${largest.map(({ name, objects }) => `${name} (${objects})`).join(", ")}`;
}
const MAPPED = 40;
/** The mapping without the components that simply stay, which are counted. */
function changedComponents(result) {
  const changed = result.mapping.filter(({ status }) => status !== "same");
  return { changed: changed.slice(0, MAPPED), more: Math.max(0, changed.length - MAPPED), same: result.mapping.length - changed.length };
}

/** The comparison as plain text for the terminal. */
export function formatCompareText(result) {
  const lines = [];
  const pad = (text, width) => String(text).padEnd(width);
  lines.push("Current and target architecture");
  lines.push("");
  lines.push(`Template  ${result.template.name}${result.template.title && result.template.title !== result.template.name ? ` (${result.template.title})` : ""}`);
  lines.push(`Current   ${result.current.title}: ${componentsText(result.current.components)}`);
  lines.push(`Target    ${result.target.title}: ${componentsText(result.target.components)}`);
  lines.push(`Distance  ${result.summary.moves} of ${count(result.summary.objects, "object")} would move (${Math.round(result.summary.distance * 100)}%)`);
  lines.push("");
  const width = Math.max(...result.criteria.map(({ title }) => title.length), "Criterion".length) + 2;
  lines.push(`${pad("Criterion", width)}${pad("Weight", 8)}${pad("Current", 9)}${pad("Target", 8)}Change`);
  for (const criterion of result.criteria) {
    lines.push(`${pad(criterion.title, width)}${pad(criterion.weight || "-", 8)}${pad(criterion.current.toFixed(2), 9)}${pad(criterion.target.toFixed(2), 8)}${criterion.delta ? signed(criterion.delta) : "="}`);
  }
  lines.push(`${pad("Total (0 to 100)", width)}${pad("", 8)}${pad(result.summary.current.toFixed(1), 9)}${pad(result.summary.target.toFixed(1), 8)}${result.summary.delta ? signed(result.summary.delta, 1) : "="}`);
  lines.push("");
  lines.push("Components of the target");
  const { changed, more, same } = changedComponents(result);
  if (same) lines.push(`  ${count(same, "component")} ${same === 1 ? "stays as it is" : "stay as they are"}${same <= LISTED ? `: ${result.mapping.filter(({ status }) => status === "same").map(({ target }) => target).join(", ")}` : ""}`);
  for (const entry of changed) lines.push(`  ${entry.target} (${entry.objects}): ${STATUS_TEXT[entry.status]} ${sourcesText(entry.from)}`);
  if (more) lines.push(`  ... and ${more} more`);
  for (const entry of result.gone.slice(0, MAPPED)) lines.push(`  ${entry.component} (${entry.objects}) goes into ${sourcesText(entry.to)}`);
  if (result.gone.length > MAPPED) lines.push(`  ... and ${result.gone.length - MAPPED} more that go into others`);
  if (result.candidates) {
    lines.push("");
    lines.push("Proposals that competed");
    for (const candidate of result.candidates) {
      lines.push(`  ${candidate.chosen ? "*" : " "} ${pad(candidate.label, 38)}${candidate.error ? `failed: ${candidate.error}` : `${candidate.total.toFixed(1).padStart(5)}  ${count(candidate.components, "component")}${candidate.sameAs ? ` (same as ${candidate.sameAs})` : ""}`}`);
    }
  }
  lines.push("");
  lines.push("Steps");
  result.steps.forEach((step, index) => {
    lines.push(`  ${index + 1}. ${step.title}`);
    lines.push(`     ${step.why}`);
    for (const command of step.commands) lines.push(`       ${command}`);
    if (step.omitted) lines.push(`       ... and ${step.omitted} more (raise the limit to list them)`);
  });
  return `${lines.join("\n")}\n`;
}

const cell = (text) => String(text).replaceAll("|", "\\|");

/** The comparison as Markdown: the criteria side by side, the component mapping, and the steps. */
export function formatCompareMarkdown(result) {
  const lines = [];
  lines.push("# Current and target architecture");
  lines.push("");
  lines.push(`Template: **${result.template.name}**${result.template.summary ? `. ${result.template.summary}` : ""}`);
  lines.push("");
  lines.push("| | Current | Target |");
  lines.push("| --- | --- | --- |");
  lines.push(`| State | ${cell(result.current.title)} | ${cell(result.target.title)} |`);
  lines.push(`| Components | ${cell(componentsText(result.current.components))} | ${cell(componentsText(result.target.components))} |`);
  lines.push(`| Forbidden dependencies | ${result.current.violations} | ${result.target.violations} |`);
  lines.push(`| Cycles | ${result.current.cycles} | ${result.target.cycles} |`);
  lines.push(`| **Score (0 to 100)** | **${result.summary.current.toFixed(1)}** | **${result.summary.target.toFixed(1)}** |`);
  lines.push("");
  lines.push(`${result.summary.moves} of ${count(result.summary.objects, "object")} would move (${Math.round(result.summary.distance * 100)}%).`);
  lines.push("");
  lines.push("## Criteria");
  lines.push("");
  lines.push("| Criterion | Weight | Current | Target | Change | Why |");
  lines.push("| --- | ---: | ---: | ---: | ---: | --- |");
  for (const criterion of result.criteria) {
    lines.push(`| ${criterion.title} | ${criterion.weight || "-"} | ${criterion.current.toFixed(2)} | ${criterion.target.toFixed(2)} | ${criterion.delta ? signed(criterion.delta) : "="} | ${cell(criterion.why)} |`);
  }
  lines.push("");
  lines.push("## Components");
  lines.push("");
  lines.push("| Target | Objects | What happens | From |");
  lines.push("| --- | ---: | --- | --- |");
  const { changed, more, same } = changedComponents(result);
  for (const entry of changed) lines.push(`| ${cell(entry.target)} | ${entry.objects} | ${entry.status} | ${cell(sourcesText(entry.from))} |`);
  for (const entry of result.gone.slice(0, MAPPED)) lines.push(`| - | ${entry.objects} | gone: ${cell(entry.component)} | goes into ${cell(sourcesText(entry.to))} |`);
  if (!changed.length && !result.gone.length) lines.push("| - | | nothing changes | |");
  lines.push("");
  lines.push(`${same ? `${count(same, "component")} ${same === 1 ? "stays as it is" : "stay as they are"}${same <= LISTED ? ` (${result.mapping.filter(({ status }) => status === "same").map(({ target }) => target).join(", ")})` : ""}.` : "No component stays as it is."}${more + Math.max(0, result.gone.length - MAPPED) ? ` ${more + Math.max(0, result.gone.length - MAPPED)} more changes are in the JSON output.` : ""}`);
  if (result.candidates) {
    lines.push("");
    lines.push("## Proposals that competed");
    lines.push("");
    lines.push("| Proposal | Score | Components | Group by | Granularity | Shared core |");
    lines.push("| --- | ---: | ---: | --- | ---: | --- |");
    for (const candidate of result.candidates) {
      const name = `${candidate.chosen ? "**" : ""}${cell(candidate.label)}${candidate.chosen ? "** (chosen)" : ""}${candidate.sameAs ? ` (same as ${candidate.sameAs})` : ""}`;
      lines.push(candidate.error
        ? `| ${name} | failed | | ${candidate.settings.groupBy} | ${candidate.settings.granularity} | ${candidate.settings.sharedCore ? "yes" : "no"} |`
        : `| ${name} | ${candidate.total.toFixed(1)} | ${candidate.components} | ${candidate.settings.groupBy} | ${candidate.settings.granularity} | ${candidate.settings.sharedCore ? "yes" : "no"} |`);
    }
  }
  lines.push("");
  lines.push("## Steps");
  lines.push("");
  result.steps.forEach((step, index) => {
    lines.push(`${index + 1}. **${step.title}.** ${step.why}`);
    if (step.commands.length) {
      lines.push("");
      lines.push("   ```sh");
      for (const command of step.commands) lines.push(`   ${command}`);
      lines.push("   ```");
      if (step.omitted) lines.push(`   ... and ${step.omitted} more.`);
      lines.push("");
    }
  });
  return `${lines.join("\n").replace(/\n+$/u, "")}\n`;
}
