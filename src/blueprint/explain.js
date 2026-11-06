// Why an object belongs to its component: the selector that assigns it, and
// how strongly it is coupled to each component (by relation kind, weighted
// as the proposal weighs them). An object coupled more to another component
// than to its own is a candidate to move.
import { coupling, couplingWeights } from "../graph/coupling.js";
import { componentAssigner } from "./components.js";
import { normalizeIdentifier } from "../resolver.js";

const round = (value) => Number(value.toFixed(1));

/**
 * What explaining many objects shares: each object's edges and the compiled
 * selectors, built once (an app export explains every object).
 */
export function placementIndex(assessment) {
  const { levels, architecture } = assessment;
  const nodes = new Map(levels.object.nodes.map((node) => [node.id, node]));
  const edges = new Map();
  for (const edge of levels.object.edges) {
    if (edge.source === edge.target) continue;
    for (const id of [edge.source, edge.target]) {
      if (!edges.has(id)) edges.set(id, []);
      edges.get(id).push(edge);
    }
  }
  let assign = () => undefined;
  if (architecture?.components?.length) {
    try {
      assign = componentAssigner(architecture.components, levels);
    } catch {
      // A configuration error is reported by the architecture checks.
    }
  }
  return {
    nodes,
    edges,
    assign,
    weights: couplingWeights(architecture?.couplingWeights),
    ignored: new Set(assessment.proposal?.basis?.ignore ?? ["permits", "includes"])
  };
}

/**
 * @param assessment assessArchitecture's result
 * @param id the object's node id (its key)
 * @param index placementIndex(assessment), when explaining many objects
 * @returns { object, component, selector, own, coupling: [{ component, weight, links, kinds }], suggestion } or undefined
 */
export function explainPlacement(assessment, id, index = placementIndex(assessment)) {
  const { result } = assessment;
  const node = index.nodes.get(id);
  if (!node) return undefined;
  const component = result.assignment.get(id);
  const selector = index.assign(node)?.selector;
  const { weights, ignored } = index;
  const byComponent = new Map();
  for (const edge of index.edges.get(id) ?? []) {
    const other = edge.source === id ? edge.target : edge.source;
    const target = result.assignment.get(other);
    if (!target) continue;
    const kinds = Object.fromEntries(Object.entries(edge.kinds ?? {}).filter(([kind]) => !ignored.has(kind)));
    const weight = coupling(kinds, weights);
    if (!weight) continue;
    const entry = byComponent.get(target) ?? { component: target, weight: 0, links: 0, kinds: {} };
    entry.weight += weight;
    entry.links++;
    for (const [kind, count] of Object.entries(kinds)) entry.kinds[kind] = (entry.kinds[kind] ?? 0) + count;
    byComponent.set(target, entry);
  }
  const list = [...byComponent.values()]
    .map((entry) => ({ ...entry, weight: round(entry.weight) }))
    .sort((a, b) => b.weight - a.weight || a.component.localeCompare(b.component));
  const own = list.find((entry) => entry.component === component)?.weight ?? 0;
  const best = list.find((entry) => entry.component !== component);
  return {
    object: { id, label: node.label, type: node.type, objectId: node.objectId },
    component,
    selector,
    own,
    coupling: list,
    // The proposal's own rule (moves.minGain, default 2) for a move.
    ...(best && best.weight - own >= (assessment.proposal?.basis?.moves?.minGain ?? 2) ? { suggestion: { component: best.component, gain: round(best.weight - own) } } : {})
  };
}

/** The node id of an object named like `Sales Post`, `codeunit:Sales Post`, or `80`. */
export function findObject(levels, query) {
  const [type, identity] = String(query).includes(":") ? String(query).split(/:(.*)/su, 2) : [undefined, query];
  const wanted = normalizeIdentifier(identity);
  const matches = levels.object.nodes.filter((node) => node.origin === "workspace" &&
    (!type || node.type === type.toLowerCase()) &&
    [node.label, node.objectId].filter(Boolean).some((value) => normalizeIdentifier(value) === wanted));
  return matches;
}

/** Text lines for the CLI. */
export function formatPlacement(placement) {
  const kinds = (entry) => Object.entries(entry.kinds).sort((a, b) => b[1] - a[1]).map(([kind, count]) => `${kind} ${count}`).join(", ");
  const lines = [
    `${placement.object.type} ${placement.object.objectId ? `${placement.object.objectId} ` : ""}${placement.object.label}`,
    `  Component: ${placement.component ?? "(none)"}${placement.selector ? ` (assigned by ${placement.selector})` : ""}`,
    "",
    "  Coupling by component (weighted like the proposal):"
  ];
  if (!placement.coupling.length) lines.push("    none: the object relates to no other assigned object");
  for (const entry of placement.coupling) {
    lines.push(`    ${String(entry.weight).padStart(6)}  ${entry.component}${entry.component === placement.component ? " (own)" : ""}  ${entry.links} object(s): ${kinds(entry)}`);
  }
  if (placement.suggestion) lines.push("", `  It is coupled more to ${placement.suggestion.component} than to its own component (+${placement.suggestion.gain}); consider moving it.`);
  return lines;
}
