import { findCycles } from "../insights.js";
import { componentMatcher } from "./components.js";
import { suggestResolution } from "./resolutions.js";

const MAX_EVIDENCE = 5;

export function fingerprint(violation) {
  return `${violation.sourceComponent}->${violation.targetComponent}|${violation.source.id}->${violation.target.id}`;
}

function objectSummary(node) {
  return {
    id: node.id,
    label: node.label,
    type: node.type,
    ...(node.objectId ? { objectId: node.objectId } : {}),
    ...(node.file ? { file: node.file, line: node.line } : {})
  };
}

/** Why a dependency from one component to another is not allowed, or undefined. */
function ruleFor(source, target, settings) {
  if (source.dependsOn) {
    return source.dependsOn.includes(target.name) ? undefined : "undeclared-component-dependency";
  }
  if (source.layer === undefined || target.layer === undefined) return undefined;
  if (target.layer > source.layer) return "outward-dependency";
  if (target.layer === source.layer && !settings.allowSameLayer) return "same-layer-dependency";
  return undefined;
}

const EFFORT_RANK = { S: 0, M: 1, L: 2 };

/**
 * One work item per source object, target component, and strategy: "move the
 * grants of D365 READ for 892 Sales objects" instead of 892 single findings.
 */
function groupWorkItems(violations, inputs) {
  const items = new Map();
  for (const violation of violations) {
    const { strategy } = violation.resolution;
    const key = `${violation.source.id}|${violation.targetComponent}|${strategy}`;
    if (!items.has(key)) {
      items.set(key, {
        id: key,
        sourceComponent: violation.sourceComponent,
        targetComponent: violation.targetComponent,
        source: violation.source,
        strategy,
        title: violation.resolution.title,
        effort: violation.resolution.effort,
        steps: violation.resolution.steps,
        alternatives: violation.resolution.alternatives.map(({ strategy: alternative, title, effort }) => ({ strategy: alternative, title, effort })),
        targets: [],
        violations: 0,
        evidence: [],
        first: violation
      });
    }
    const item = items.get(key);
    item.violations++;
    if (item.targets.length < 20) item.targets.push({ label: violation.target.label, type: violation.target.type });
    for (const evidence of violation.evidence) if (item.evidence.length < 5) item.evidence.push(evidence);
  }
  // Steps that name every target, not only the first one.
  for (const item of items.values()) {
    if (item.violations < 2) continue;
    const input = inputs.get(item.first);
    const types = new Set(item.targets.map(({ type }) => type));
    const steps = suggestResolution({ ...input, target: { ...input.target, many: item.violations, type: types.size === 1 ? [...types][0] : "object" } }, input.context).steps;
    item.steps = steps;
  }
  for (const item of items.values()) delete item.first;
  return [...items.values()].sort((a, b) =>
    b.violations - a.violations || EFFORT_RANK[a.effort] - EFFORT_RANK[b.effort] || a.id.localeCompare(b.id));
}

/**
 * Clean-architecture metrics after Robert C. Martin, per component:
 * afferent (Ca) and efferent (Ce) coupling counted in objects, instability
 * I = Ce / (Ca + Ce), abstractness A = interfaces / objects, and the distance
 * from the main sequence D = |A + I - 1|.
 */
function componentMetrics(name, members, outgoing, incoming) {
  const objects = members.length;
  const interfaces = members.filter(({ type }) => type === "interface").length;
  const ce = outgoing.size;
  const ca = incoming.size;
  const instability = ca + ce ? ce / (ca + ce) : 0;
  const abstractness = objects ? interfaces / objects : 0;
  const round = (value) => Number(value.toFixed(3));
  return {
    objects,
    interfaces,
    afferentCoupling: ca,
    efferentCoupling: ce,
    instability: round(instability),
    abstractness: round(abstractness),
    distance: round(Math.abs(abstractness + instability - 1))
  };
}

/**
 * Checks an object-level dependency graph against a target architecture
 * (components, layers, allowed dependencies) and explains how to resolve
 * every dependency the architecture does not allow.
 */
export function evaluateArchitecture(levels, architecture = {}) {
  const assign = componentMatcher(architecture.components, levels);
  const settings = { allowSameLayer: Boolean(architecture.allowSameLayer) };
  const components = new Map(architecture.components.map((component) => [component.name, {
    name: component.name,
    description: component.description,
    layer: component.layer === undefined ? undefined : Number(component.layer),
    dependsOn: component.dependsOn,
    match: [component.match].flat()
  }]));

  const nodes = new Map(levels.object.nodes.map((node) => [node.id, node]));
  const componentOf = new Map();
  const members = new Map([...components.keys()].map((name) => [name, []]));
  const unassigned = [];
  for (const node of levels.object.nodes) {
    const component = assign(node);
    if (component) {
      componentOf.set(node.id, component);
      members.get(component).push(node);
    } else if (node.origin === "workspace") {
      unassigned.push(node);
    }
  }

  const usage = new Map();
  const outgoing = new Map([...components.keys()].map((name) => [name, new Set()]));
  const incoming = new Map([...components.keys()].map((name) => [name, new Set()]));
  const componentEdges = new Map();
  const violations = [];
  for (const edge of levels.object.edges) {
    const sourceComponent = componentOf.get(edge.source);
    const targetComponent = componentOf.get(edge.target);
    if (!sourceComponent || !targetComponent || sourceComponent === targetComponent) continue;
    if (!usage.has(edge.target)) usage.set(edge.target, new Set());
    usage.get(edge.target).add(sourceComponent);
    outgoing.get(sourceComponent).add(edge.source);
    incoming.get(targetComponent).add(edge.source);

    const rule = ruleFor(components.get(sourceComponent), components.get(targetComponent), settings);
    const id = `${sourceComponent}->${targetComponent}`;
    const aggregate = componentEdges.get(id) ?? {
      id, source: sourceComponent, target: targetComponent, objectEdges: 0, weight: 0, kinds: {}, violations: 0, allowed: !rule
    };
    aggregate.objectEdges++;
    aggregate.weight += edge.weight;
    for (const [kind, weight] of Object.entries(edge.kinds ?? {})) aggregate.kinds[kind] = (aggregate.kinds[kind] ?? 0) + weight;
    if (rule) aggregate.violations++;
    componentEdges.set(id, aggregate);

    if (rule) {
      violations.push({
        rule,
        sourceComponent,
        targetComponent,
        source: objectSummary(nodes.get(edge.source)),
        target: objectSummary(nodes.get(edge.target)),
        kinds: edge.kinds,
        weight: edge.weight,
        evidence: (edge.evidence ?? []).slice(0, MAX_EVIDENCE),
        edge: edge.id
      });
    }
  }
  const inputs = new Map();
  for (const violation of violations) {
    violation.id = fingerprint(violation);
    const source = components.get(violation.sourceComponent);
    const target = components.get(violation.targetComponent);
    const input = {
      source: nodes.get(violation.source.id),
      target: nodes.get(violation.target.id),
      kinds: violation.kinds,
      sourceComponent: violation.sourceComponent,
      targetComponent: violation.targetComponent,
      rule: violation.rule,
      inward: source.layer !== undefined && target.layer !== undefined && target.layer < source.layer,
      // A declared dependency that itself may use the target can act as facade.
      via: (source.dependsOn ?? []).find((name) => components.get(name)?.dependsOn?.includes(violation.targetComponent)),
      context: { usage }
    };
    inputs.set(violation, input);
    violation.resolution = suggestResolution(input, input.context);
  }
  violations.sort((left, right) =>
    left.sourceComponent.localeCompare(right.sourceComponent) ||
    left.targetComponent.localeCompare(right.targetComponent) ||
    right.weight - left.weight ||
    left.id.localeCompare(right.id));

  const workItems = groupWorkItems(violations, inputs);

  const cycles = findCycles(
    [...components.keys()].map((key) => ({ key })),
    [...componentEdges.values()].map(({ source, target }) => ({ from: source, to: target }))
  );
  const inCycle = new Set(cycles.flat());
  const metrics = new Map([...components.keys()].map((name) =>
    [name, componentMetrics(name, members.get(name), outgoing.get(name), incoming.get(name))]));

  // Stable Dependencies Principle: depend in the direction of stability.
  const stability = [...componentEdges.values()]
    .filter(({ source, target }) => metrics.get(target).instability > metrics.get(source).instability + 0.1)
    .map(({ source, target, objectEdges }) => ({
      source, target, objectEdges,
      sourceInstability: metrics.get(source).instability,
      targetInstability: metrics.get(target).instability
    }));

  const summaries = [...components.values()].map((component) => {
    const outgoingViolations = violations.filter(({ sourceComponent }) => sourceComponent === component.name);
    return {
      ...component,
      metrics: metrics.get(component.name),
      dependsOnActual: [...componentEdges.values()].filter(({ source }) => source === component.name).map(({ target }) => target).sort(),
      violations: outgoingViolations.length,
      inCycle: inCycle.has(component.name),
      // A component can become an app of its own when everything it uses is
      // allowed and none of its dependencies point back at it.
      extractable: !outgoingViolations.length && !inCycle.has(component.name)
    };
  });

  return {
    schema: "bc-atlas.architecture",
    schemaVersion: 1,
    settings,
    summary: {
      components: components.size,
      objects: levels.object.nodes.filter(({ origin }) => origin === "workspace").length,
      assigned: [...members.values()].reduce((total, list) => total + list.filter(({ origin }) => origin === "workspace").length, 0),
      unassigned: unassigned.length,
      dependencies: [...componentEdges.values()].reduce((total, edge) => total + edge.objectEdges, 0),
      violations: violations.length,
      workItems: workItems.length,
      byStrategy: Object.fromEntries(Object.entries(violations.reduce((counts, { resolution }) => {
        counts[resolution.strategy] = (counts[resolution.strategy] ?? 0) + 1;
        return counts;
      }, {})).sort((a, b) => b[1] - a[1])),
      cycles: cycles.length,
      extractable: summaries.filter(({ extractable }) => extractable).length
    },
    components: summaries,
    edges: [...componentEdges.values()].sort((a, b) => a.id.localeCompare(b.id)),
    cycles,
    stability,
    workItems,
    violations,
    unassigned: unassigned.map(objectSummary),
    assignment: componentOf
  };
}
