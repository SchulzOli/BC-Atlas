// Why an object belongs to its component: the selector that assigns it, and
// how strongly it is coupled to each component (by relation kind, weighted
// as the proposal weighs them). An object coupled more to another component
// than to its own is a candidate to move.
//
// And why it is there in the first place: the step of the proposal that
// placed it (placement.js), or the selector of .bca.json that declares it;
// for a component, how it got its name, what its objects agree on, and the
// thresholds that shaped it.
import { coupling, couplingWeights } from "../graph/coupling.js";
import { componentAssigner } from "./components.js";
import { memberAgreement, nameKey } from "./naming.js";
import { namingSentence, PLACEMENT_STEPS, placementSentence, stepCounts } from "./placement.js";
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
 * The rationale of every component, set on `result.components[].rationale`:
 * for a proposal what the proposal recorded, for a configured architecture
 * that it is declared and which selectors assign its objects; both with what
 * the objects agree on and how much of their coupling stays inside.
 */
export function addRationale({ levels, architecture, proposal, result }) {
  const members = new Map();
  for (const node of levels.object.nodes) {
    const component = result.assignment.get(node.id);
    if (!component || node.origin !== "workspace") continue;
    if (!members.has(component)) members.set(component, []);
    members.get(component).push(node);
  }
  let declared;
  if (!proposal) {
    const index = placementIndex({ levels, architecture });
    // Coupling as the proposal would weigh it: without the kinds that never shape a component.
    const inside = new Map();
    const total = new Map();
    for (const edge of levels.object.edges) {
      const source = result.assignment.get(edge.source);
      const target = result.assignment.get(edge.target);
      if (!source || !target || edge.source === edge.target) continue;
      const weight = coupling(Object.fromEntries(Object.entries(edge.kinds ?? {}).filter(([kind]) => !index.ignored.has(kind))), index.weights);
      if (!weight) continue;
      for (const component of new Set([source, target])) total.set(component, (total.get(component) ?? 0) + weight);
      if (source === target) inside.set(source, (inside.get(source) ?? 0) + weight);
    }
    declared = (name) => {
      const selectors = {};
      for (const node of members.get(name) ?? []) {
        const selector = index.assign(node)?.selector;
        if (selector) selectors[selector] = (selectors[selector] ?? 0) + 1;
      }
      const objects = (members.get(name) ?? []).length;
      return {
        naming: { by: "declared", from: ".bca.json" },
        steps: objects ? { declared: objects } : {},
        selectors,
        agreement: memberAgreement(members.get(name) ?? []),
        coupling: { inside: total.get(name) ? Number(((inside.get(name) ?? 0) / total.get(name)).toFixed(2)) : undefined },
        thresholds: {}
      };
    };
  }
  for (const component of result.components) {
    const rationale = proposal ? proposal.rationale?.[component.name] : declared(component.name);
    if (!rationale) continue;
    component.rationale = { ...rationale, coupling: { ...rationale.coupling, cohesion: component.metrics?.cohesion } };
  }
  return result;
}

/**
 * @param assessment assessArchitecture's result
 * @param id the object's node id (its key)
 * @param index placementIndex(assessment), when explaining many objects
 * @returns { object, component, selector, own, coupling: [{ component, weight, links, kinds }], suggestion,
 *   step, detail, why, naming } or undefined; `step` is one of PLACEMENT_STEPS, `why` says it in a sentence
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
  // The step that placed it: recorded by the proposal, or declared in .bca.json.
  const placement = assessment.proposal ? assessment.proposal.placements?.get(id) : component && { step: "declared", detail: { selector } };
  const naming = result.components?.find(({ name }) => name === component)?.rationale?.naming;
  return {
    object: { id, label: node.label, type: node.type, objectId: node.objectId },
    component,
    selector,
    ...(placement ? { step: placement.step, detail: placement.detail, why: placementSentence(placement) } : {}),
    ...(naming ? { naming } : {}),
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
    ...(placement.why ? [`  Why: ${placement.why}`] : []),
    ...(placement.naming ? [`  The component is ${namingSentence(placement.naming)}.`] : []),
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

const percent = (value) => `${Math.round(value * 100)}%`;

/**
 * Why a component is what it is.
 * @param name the component's name, compared without case
 * @returns { component, objects, naming, why: [sentences], steps, agreement, coupling, thresholds, boundary, within,
 *   members: [{ id, label, type, objectId, step }], more, neighbours: [{ component, weight, objectEdges }],
 *   alternatives: [sentences] } or undefined
 */
export function explainComponent(assessment, name, { limit = 30 } = {}) {
  const { result, proposal, levels } = assessment;
  const component = result.components.find((candidate) => nameKey(candidate.name) === nameKey(name));
  if (!component) return undefined;
  const rationale = component.rationale ?? {};
  const nodes = levels.object.nodes.filter((node) => node.origin === "workspace" && result.assignment.get(node.id) === component.name);
  const stepOf = (id) => proposal ? proposal.placements?.get(id)?.step : "declared";
  const order = Object.keys(PLACEMENT_STEPS);
  const members = nodes.map((node) => ({ id: node.id, label: node.label, type: node.type, objectId: node.objectId, step: stepOf(node.id) }))
    .sort((a, b) => order.indexOf(a.step) - order.indexOf(b.step) || String(a.label).localeCompare(String(b.label)));
  const neighbours = new Map();
  for (const edge of result.edges ?? []) {
    if (edge.source !== component.name && edge.target !== component.name) continue;
    const other = edge.source === component.name ? edge.target : edge.source;
    const entry = neighbours.get(other) ?? { component: other, weight: 0, objectEdges: 0 };
    entry.weight += edge.weight;
    entry.objectEdges += edge.objectEdges;
    neighbours.set(other, entry);
  }

  const { naming, steps = {}, agreement = {}, coupling: inside = {}, thresholds = {} } = rationale;
  const why = [];
  if (naming) why.push(`${component.name} is ${namingSentence(naming, { objects: nodes.length })}.`);
  if (Object.keys(steps).length) why.push(`Of its ${nodes.length} object(s): ${stepCounts(steps)}.`);
  for (const step of order.filter((key) => steps[key])) why.push(`${step}: ${PLACEMENT_STEPS[step]}`);
  if (rationale.selectors && Object.keys(rationale.selectors).length) {
    why.push(`Selectors: ${Object.entries(rationale.selectors).sort((a, b) => b[1] - a[1]).map(([selector, count]) => `${selector} (${count})`).join(", ")}.`);
  }
  const agreed = [
    agreement.namespace && `${percent(agreement.namespace.share)} are in namespace ${agreement.namespace.value}`,
    agreement.folder && `${percent(agreement.folder.share)} in folder ${agreement.folder.value}`,
    agreement.prefix && `${percent(agreement.prefix.share)} start with ${agreement.prefix.value}`
  ].filter(Boolean);
  if (agreed.length) why.push(`What its objects agree on: ${agreed.join(", ")}.`);
  if (inside.inside !== undefined) {
    why.push(`${percent(inside.inside)} of its coupling stays inside, counting the relations that shape components` +
      (inside.cohesion === undefined ? "." : ` (${percent(inside.cohesion)} counting all relations).`));
  }
  if (rationale.within) why.push(`It lies in the ${rationale.boundary} ${rationale.within}; a proposed component never crosses an app or module.`);

  const alternatives = [];
  if (proposal) {
    const basis = proposal.basis ?? {};
    if (steps["shared-core"]) alternatives.push(`"sharedCore": false leaves its ${steps["shared-core"]} object(s) in the components that use them.`);
    if (steps.coupling) alternatives.push(`"granularity" above ${basis.granularity ?? 1} gives more, smaller components; below it fewer, larger ones.`);
    if (steps.coupling && basis.startFrom?.length) alternatives.push(`"startFrom": "none" lets the relations alone decide, without today's ${basis.startFrom.join(" and ")} as a starting point.`);
    if (steps.boundary && thresholds.minClusterObjects) alternatives.push(`An app or module with fewer than ${thresholds.minClusterObjects} objects is not split; "keep" defines components inside it.`);
    if (steps.merged) alternatives.push(`"minObjects" below ${thresholds.minObjects ?? basis.minObjects} keeps the component(s) that joined it apart.`);
    if (steps.excluded) alternatives.push("Without \"exclude\", its excluded object(s) shape components themselves.");
    if (naming?.qualifiedBy) alternatives.push("\"naming.rename\" gives it the name you want; \"naming.qualify\" changes what tells components of the same name apart first.");
    alternatives.push("\"keep\" pins objects to a component you define; the proposal arranges the rest around it.");
  } else {
    alternatives.push("Its objects follow the match selectors of the component in .bca.json; the most specific selector wins.");
  }
  return {
    component: component.name,
    objects: nodes.length,
    naming,
    why,
    steps,
    agreement,
    coupling: inside,
    thresholds,
    ...(rationale.boundary ? { boundary: rationale.boundary } : {}),
    ...(rationale.within ? { within: rationale.within } : {}),
    members: members.slice(0, limit),
    more: Math.max(0, members.length - limit),
    neighbours: [...neighbours.values()].map((entry) => ({ ...entry, weight: round(entry.weight) })).sort((a, b) => b.weight - a.weight || a.component.localeCompare(b.component)),
    alternatives
  };
}

/** Text lines for the CLI. */
export function formatComponentExplanation(explanation) {
  const lines = [`Component ${explanation.component} (${explanation.objects} object(s))`, "", "  Why"];
  for (const sentence of explanation.why) lines.push(`    ${sentence}`);
  const thresholds = Object.entries(explanation.thresholds ?? {});
  if (thresholds.length) {
    lines.push("", "  Thresholds that applied");
    for (const [key, value] of thresholds) lines.push(`    ${key.padEnd(20)} ${typeof value === "object" ? Object.entries(value).map(([part, number]) => `${part} ${number}`).join(", ") : value}`);
  }
  lines.push("", "  Objects (and the step that placed each)");
  for (const member of explanation.members) lines.push(`    ${`${member.type} ${member.objectId ? `${member.objectId} ` : ""}${member.label}`.padEnd(48)} ${member.step ?? ""}`);
  if (explanation.more) lines.push(`    ... ${explanation.more} more; use --format json for all of them`);
  if (explanation.neighbours.length) {
    lines.push("", "  Neighbours (coupling across the boundary)");
    for (const neighbour of explanation.neighbours) lines.push(`    ${String(neighbour.weight).padStart(6)}  ${neighbour.component}  ${neighbour.objectEdges} object dependency(ies)`);
  }
  if (explanation.alternatives.length) {
    lines.push("", "  What would change it");
    for (const alternative of explanation.alternatives) lines.push(`    ${alternative}`);
  }
  return lines;
}
