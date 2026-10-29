// One component up close, and the dependencies between components as they
// should be and as they are.
//
//   componentDrilldown   its objects, the groups inside it (sub-domains by
//                        coupling), the links between them, and its links to
//                        other components, allowed or against the architecture
//   dependencyMatrix     every pair of components: allowed by the rules (where
//                        dependencies should be) and the object links there today
import { coupling, couplingWeights } from "../graph/coupling.js";
import { commonAffix, shapes, subgroups } from "./cluster.js";
import { ruleFor } from "./evaluate.js";

/** Whether the rules let `source` depend on `target` (both component summaries). */
function allows(source, target, settings) {
  const rule = ruleFor(source, target, settings);
  return !rule || settings.severities?.[rule] === "off";
}

/** Components from the top layer down, as the layers card shows them. */
function ordered(components) {
  return [...components].sort((a, b) => (b.layer ?? -1) - (a.layer ?? -1) || a.name.localeCompare(b.name));
}

/**
 * @returns { order, cells } where cells[i][j] describes the dependency of
 *   order[i] on order[j]: { allowed, links, wrong } (links and wrong count object links)
 */
export function dependencyMatrix(assessment) {
  const { result } = assessment;
  const components = ordered(result.components);
  const edges = new Map(result.edges.map((edge) => [`${edge.source}->${edge.target}`, edge]));
  return {
    order: components.map(({ name }) => name),
    cells: components.map((source) => components.map((target) => {
      if (source.name === target.name) return null;
      const edge = edges.get(`${source.name}->${target.name}`);
      return { allowed: allows(source, target, result.settings), links: edge?.objectEdges ?? 0, wrong: edge?.violations ?? 0 };
    }))
  };
}

const describe = ({ id, label, type, objectId, namespace, file }) => ({
  id, label, type,
  ...(objectId === undefined ? {} : { objectId }),
  ...(namespace && namespace !== "(global)" ? { namespace } : {}),
  ...(file ? { file } : {})
});

/**
 * One component: what it is (role, layer, suggested namespace, rules), its
 * objects with their group, the links inside it, and per object and other
 * component the links out and in, split into allowed and wrong-way ones.
 * Links are index pairs into `objects`, so large components stay small.
 */
export function componentDrilldown(assessment, name) {
  const { levels, result, proposal, architecture } = assessment;
  const component = result.components.find((candidate) => candidate.name === name);
  if (!component) return undefined;
  const componentOf = result.assignment;
  const byName = new Map(result.components.map((summary) => [summary.name, summary]));
  const nodes = levels.object.nodes.filter(({ id }) => componentOf.get(id) === name);
  const index = new Map(nodes.map(({ id }, position) => [id, position]));
  const weights = couplingWeights(architecture.couplingWeights);

  // Links inside the component, weighted like the proposal weighs them.
  const inside = new Map();
  for (const edge of levels.object.edges) {
    if (!index.has(edge.source) || !index.has(edge.target) || edge.source === edge.target) continue;
    const weight = shapes(edge) ? coupling(edge.kinds, weights) : 0;
    const key = `${edge.source}\u0000${edge.target}`;
    inside.set(key, { source: edge.source, target: edge.target, weight: (inside.get(key)?.weight ?? 0) + weight, kinds: Object.keys(edge.kinds ?? {}) });
  }
  const groups = subgroups(nodes, [...inside.values()].filter(({ weight }) => weight > 0), { affix: commonAffix(levels.object.nodes.filter(({ origin }) => origin === "workspace")) });

  // Links to and from other components, per object; wrong-way ones from the violations.
  const wrong = new Map();
  for (const violation of result.violations) {
    if (violation.sourceComponent === name) {
      const key = `out\u0000${violation.source.id}\u0000${violation.targetComponent}`;
      wrong.set(key, (wrong.get(key) ?? 0) + 1);
    }
    if (violation.targetComponent === name) {
      const key = `in\u0000${violation.target.id}\u0000${violation.sourceComponent}`;
      wrong.set(key, (wrong.get(key) ?? 0) + 1);
    }
  }
  const external = new Map();
  for (const edge of levels.object.edges) {
    const from = componentOf.get(edge.source);
    const to = componentOf.get(edge.target);
    if (!from || !to || from === to || (from !== name && to !== name)) continue;
    const [direction, own, other] = from === name ? ["out", edge.source, to] : ["in", edge.target, from];
    const key = `${direction}\u0000${own}\u0000${other}`;
    const entry = external.get(key) ?? { direction, own, other, links: 0 };
    entry.links++;
    external.set(key, entry);
  }

  const moves = new Map((proposal?.moves ?? []).map((move) => [move.object.id, move.to]));
  const objects = nodes.map((node) => ({
    ...describe(node),
    group: groups.get(node.id)?.key,
    inside: 0,
    out: { links: 0, wrong: 0 },
    in: { links: 0, wrong: 0 },
    ...(moves.has(node.id) ? { belongsTo: moves.get(node.id) } : {})
  }));
  for (const { source, target } of inside.values()) {
    objects[index.get(source)].inside++;
    objects[index.get(target)].inside++;
  }
  const links = [...inside.values()].map(({ source, target, weight, kinds }) => [index.get(source), index.get(target), weight, kinds]);

  const others = new Map();
  const otherEntry = (other) => {
    if (!others.has(other)) {
      const summary = byName.get(other);
      others.set(other, {
        name: other,
        layer: summary?.layer,
        // Where dependencies should be: the rules in both directions.
        mayUse: summary ? allows(component, summary, result.settings) : undefined,
        mayBeUsedBy: summary ? allows(summary, component, result.settings) : undefined,
        out: { links: 0, wrong: 0, objects: 0 },
        in: { links: 0, wrong: 0, objects: 0 }
      });
    }
    return others.get(other);
  };
  const externalLinks = [];
  for (const { direction, own, other, links: count } of external.values()) {
    const wrongCount = wrong.get(`${direction}\u0000${own}\u0000${other}`) ?? 0;
    const object = objects[index.get(own)];
    object[direction].links += count;
    object[direction].wrong += wrongCount;
    const entry = otherEntry(other)[direction];
    entry.links += count;
    entry.wrong += wrongCount;
    entry.objects++;
    externalLinks.push([index.get(own), other, direction, count, wrongCount]);
  }
  // Components it may use but does not: dependencies could go there.
  for (const summary of result.components) {
    if (summary.name !== name && allows(component, summary, result.settings)) otherEntry(summary.name);
  }

  const groupList = new Map();
  for (const [id, group] of groups) {
    const entry = groupList.get(group.key) ?? { key: group.key, label: group.label, fullName: group.fullName, ...(group.basis ? { basis: group.basis } : {}), objects: 0, types: {} };
    entry.objects++;
    const { type } = nodes[index.get(id)];
    entry.types[type] = (entry.types[type] ?? 0) + 1;
    groupList.set(group.key, entry);
  }
  // Links between groups show how they hang together.
  const between = new Map();
  for (const [source, target, weight] of links) {
    const a = objects[source].group;
    const b = objects[target].group;
    if (a === b) {
      groupList.get(a).inside = (groupList.get(a).inside ?? 0) + 1;
      continue;
    }
    const key = `${a}->${b}`;
    between.set(key, { source: a, target: b, links: (between.get(key)?.links ?? 0) + 1, weight: (between.get(key)?.weight ?? 0) + weight });
  }

  const recommendation = proposal?.recommendations?.find((candidate) => candidate.component === name);
  return {
    name,
    description: component.description,
    layer: component.layer,
    role: recommendation?.role,
    app: recommendation?.app,
    namespace: recommendation?.namespace,
    match: component.match,
    dependsOn: component.dependsOn,
    metrics: component.metrics,
    violations: component.violations,
    extractable: component.extractable,
    inCycle: component.inCycle,
    mode: proposal ? "proposal" : "configured",
    objects,
    links,
    groups: [...groupList.values()],
    groupLinks: [...between.values()],
    external: externalLinks,
    components: ordered([...others.values()])
  };
}

/** Every component's drilldown, for the exported app. */
export function componentDrilldowns(assessment) {
  return Object.fromEntries(assessment.result.components.map(({ name }) => [name, componentDrilldown(assessment, name)]));
}
