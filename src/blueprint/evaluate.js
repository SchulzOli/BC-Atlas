import { SEVERITIES } from "../capabilities.js";
import { DEPENDENCY_KINDS } from "../graph/lenses/dependency.js";
import { findCycles } from "../insights.js";
import { compileSelector, componentAssigner, selectorContext } from "./components.js";
import { suggestResolution } from "./resolutions.js";

const MAX_EVIDENCE = 5;

/** Rules a dependency between two objects can break; their violations can be baselined. */
export const VIOLATION_RULES = Object.freeze([
  "undeclared-component-dependency",
  "outward-dependency",
  "same-layer-dependency",
  "layer-skip-dependency",
  "internal-access",
  "dependency-rule"
]);

/** Checks of the architecture as a whole, with their default severity in bca check. */
export const CHECK_RULES = Object.freeze({
  "component-cycle": "warning",
  "unassigned-objects": "info",
  "empty-component": "warning",
  "unused-selector": "info",
  "unused-component-dependency": "info",
  "inconsistent-component-dependency": "warning",
  "declared-component-cycle": "warning",
  "component-too-large": "warning",
  "unstable-dependency": "info"
});

const LEVELS = [...SEVERITIES, "off"];

export function fingerprint(violation) {
  const objects = `${violation.source.id}->${violation.target.id}`;
  if (violation.rule === "dependency-rule") return `rule:${violation.policy}|${objects}`;
  if (violation.rule === "internal-access") return `internal:${violation.sourceComponent}->${violation.targetComponent}|${objects}`;
  return `${violation.sourceComponent}->${violation.targetComponent}|${objects}`;
}

function level(value, name) {
  if (value !== undefined && !LEVELS.includes(value)) throw new Error(`${name} must be one of: ${LEVELS.join(", ")}`);
  return value;
}

/** Settings of the `architecture` section that change what is checked. */
function readSettings(architecture) {
  const severities = architecture.severities ?? {};
  if (!severities || typeof severities !== "object" || Array.isArray(severities)) {
    throw new Error("architecture.severities must map rule names to error, warning, info, or off");
  }
  for (const [rule, value] of Object.entries(severities)) {
    if (!VIOLATION_RULES.includes(rule) && !(rule in CHECK_RULES)) {
      throw new Error(`architecture.severities: unknown rule "${rule}"; use one of: ${[...VIOLATION_RULES, ...Object.keys(CHECK_RULES)].join(", ")}`);
    }
    level(value, `architecture.severities.${rule}`);
  }
  const maxObjects = architecture.maxObjects;
  if (maxObjects !== undefined && !(Number.isInteger(maxObjects) && maxObjects > 0)) {
    throw new Error("architecture.maxObjects must be a positive integer");
  }
  return {
    allowSameLayer: Boolean(architecture.allowSameLayer),
    strictLayers: Boolean(architecture.strictLayers),
    ...(maxObjects ? { maxObjects } : {}),
    severities: {
      ...(architecture.unassigned ? { "unassigned-objects": level(architecture.unassigned, "architecture.unassigned") } : {}),
      ...severities
    }
  };
}

/**
 * A dependency rule of `architecture.rules`: objects matching `from` must not
 * depend on objects matching `to`, unless they match `except`.
 */
function compilePolicy(rule, index, context) {
  const where = `architecture.rules[${index}]`;
  if (!rule || typeof rule !== "object" || !rule.from || !rule.to) throw new Error(`${where} needs "from" and "to" selectors`);
  const kinds = rule.kinds === undefined ? undefined : [rule.kinds].flat().map((kind) => String(kind).toLowerCase());
  const unknown = kinds?.filter((kind) => !DEPENDENCY_KINDS.includes(kind)) ?? [];
  if (unknown.length) throw new Error(`${where}: unknown relation kind(s) ${unknown.join(", ")}; use ${DEPENDENCY_KINDS.join(", ")}`);
  const list = (value) => [value ?? []].flat().map(String);
  const matchers = (value) => list(value).map((selector) => compileSelector(selector, context));
  return {
    name: String(rule.name ?? `${list(rule.from).join(", ")} -> ${list(rule.to).join(", ")}`),
    from: list(rule.from),
    to: list(rule.to),
    except: list(rule.except),
    kinds,
    across: Boolean(rule.across),
    severity: level(rule.severity, `${where}.severity`),
    message: rule.message,
    resolution: rule.resolution,
    matchFrom: matchers(rule.from),
    matchTo: matchers(rule.to),
    matchExcept: matchers(rule.except)
  };
}

const matchesAny = (matchers, node) => matchers.some((matcher) => matcher(node));

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
  if (settings.strictLayers && target.layer < source.layer - 1) return "layer-skip-dependency";
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
    const key = `${violation.source.id}|${violation.targetComponent}|${strategy}${violation.policy ? `|${violation.policy}` : ""}`;
    if (!items.has(key)) {
      items.set(key, {
        id: key,
        rule: violation.rule,
        ...(violation.policy ? { policy: violation.policy } : {}),
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
  const assigner = componentAssigner(architecture.components, levels);
  const settings = readSettings(architecture);
  const enabled = (rule) => (rule && settings.severities[rule] !== "off" ? rule : undefined);
  const components = new Map(architecture.components.map((component) => [component.name, {
    name: component.name,
    description: component.description,
    layer: component.layer === undefined ? undefined : Number(component.layer),
    dependsOn: component.dependsOn,
    match: [component.match].flat(),
    ...(component.exposes ? { exposes: [component.exposes].flat() } : {}),
    ...(component.maxObjects ? { maxObjects: component.maxObjects } : {})
  }]));

  const nodes = new Map(levels.object.nodes.map((node) => [node.id, node]));
  const componentOf = new Map();
  const members = new Map([...components.keys()].map((name) => [name, []]));
  const selectorUse = new Map();
  const unassigned = [];
  for (const node of levels.object.nodes) {
    const assigned = assigner(node);
    if (assigned) {
      componentOf.set(node.id, assigned.component);
      members.get(assigned.component).push(node);
      const key = `${assigned.component}\u0000${assigned.selector}`;
      selectorUse.set(key, (selectorUse.get(key) ?? 0) + 1);
    } else if (node.origin === "workspace") {
      unassigned.push(node);
    }
  }

  // Rules and exposes may select by component and layer.
  const context = {
    ...selectorContext(levels),
    componentOf: (node) => componentOf.get(node.id),
    layerOf: (node) => components.get(componentOf.get(node.id))?.layer
  };
  const exposes = new Map([...components.values()].filter(({ exposes: list }) => list)
    .map(({ name, exposes: list }) => [name, list.map((selector) => compileSelector(selector, context))]));
  // Part of a component's public surface: not Access = Internal, and listed in exposes if it has one.
  const isPublic = (node, component) => node.access !== "internal" && (!exposes.has(component) || matchesAny(exposes.get(component), node));
  const policies = (architecture.rules ?? []).map((rule, index) => compilePolicy(rule, index, context))
    .filter(({ severity }) => severity !== "off" && settings.severities["dependency-rule"] !== "off");
  if (new Set(policies.map(({ name }) => name)).size !== policies.length) throw new Error("architecture.rules: rule names must be unique");

  const usage = new Map();
  const outgoing = new Map([...components.keys()].map((name) => [name, new Set()]));
  const incoming = new Map([...components.keys()].map((name) => [name, new Set()]));
  const componentEdges = new Map();
  const violations = [];
  const violation = (rule, edge, sourceComponent, targetComponent, extra = {}) => violations.push({
    rule,
    ...extra,
    sourceComponent,
    targetComponent,
    source: objectSummary(nodes.get(edge.source)),
    target: objectSummary(nodes.get(edge.target)),
    kinds: edge.kinds,
    weight: edge.weight,
    evidence: (edge.evidence ?? []).slice(0, MAX_EVIDENCE),
    edge: edge.id
  });
  for (const edge of levels.object.edges) {
    const sourceComponent = componentOf.get(edge.source);
    const targetComponent = componentOf.get(edge.target);

    // Rules of .bca.json apply to every dependency on an object of the analyzed apps or their symbols.
    const target = nodes.get(edge.target);
    if (policies.length && ["workspace", "symbol"].includes(target?.origin)) {
      const source = nodes.get(edge.source);
      for (const policy of policies) {
        if (policy.across && (!sourceComponent || !targetComponent || sourceComponent === targetComponent)) continue;
        if (policy.kinds && !policy.kinds.some((kind) => edge.kinds?.[kind])) continue;
        if (!matchesAny(policy.matchFrom, source) || !matchesAny(policy.matchTo, target) || matchesAny(policy.matchExcept, target)) continue;
        violation("dependency-rule", edge, sourceComponent ?? "(none)", targetComponent ?? "(none)", {
          policy: policy.name,
          ...(policy.severity ? { severity: policy.severity } : {}),
          ...(policy.message ? { message: policy.message } : {})
        });
      }
    }

    if (!sourceComponent || !targetComponent || sourceComponent === targetComponent) continue;
    if (!usage.has(edge.target)) usage.set(edge.target, new Set());
    usage.get(edge.target).add(sourceComponent);
    outgoing.get(sourceComponent).add(edge.source);
    incoming.get(targetComponent).add(edge.source);

    const direction = enabled(ruleFor(components.get(sourceComponent), components.get(targetComponent), settings));
    const rule = direction ?? enabled(isPublic(target, targetComponent) ? undefined : "internal-access");
    const id = `${sourceComponent}->${targetComponent}`;
    const aggregate = componentEdges.get(id) ?? {
      id, source: sourceComponent, target: targetComponent, objectEdges: 0, weight: 0, kinds: {}, violations: 0, allowed: !direction
    };
    aggregate.objectEdges++;
    aggregate.weight += edge.weight;
    for (const [kind, weight] of Object.entries(edge.kinds ?? {})) aggregate.kinds[kind] = (aggregate.kinds[kind] ?? 0) + weight;
    if (rule) aggregate.violations++;
    componentEdges.set(id, aggregate);

    if (rule) violation(rule, edge, sourceComponent, targetComponent, settings.severities[rule] ? { severity: settings.severities[rule] } : {});
  }
  const inputs = new Map();
  for (const violation of violations) {
    violation.id = fingerprint(violation);
    const source = components.get(violation.sourceComponent) ?? {};
    const target = components.get(violation.targetComponent) ?? {};
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
      policy: violation.policy ? policies.find(({ name }) => name === violation.policy) : undefined,
      // Components between two layers that already use the target component.
      between: violation.rule === "layer-skip-dependency"
        ? [...components.values()].filter(({ name, layer }) => layer > target.layer && layer < source.layer && componentEdges.has(`${name}->${target.name}`)).map(({ name }) => name)
        : undefined,
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
    // Rules of .bca.json do not decide whether a component can become an app.
    const outgoingViolations = violations.filter(({ sourceComponent, rule }) => sourceComponent === component.name && rule !== "dependency-rule");
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

  const checks = architectureChecks({ architecture, settings, components, members, selectorUse, componentEdges, cycles, stability, unassigned });

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
      byRule: Object.fromEntries(Object.entries(violations.reduce((counts, { rule }) => {
        counts[rule] = (counts[rule] ?? 0) + 1;
        return counts;
      }, {})).sort((a, b) => b[1] - a[1])),
      byStrategy: Object.fromEntries(Object.entries(violations.reduce((counts, { resolution }) => {
        counts[resolution.strategy] = (counts[resolution.strategy] ?? 0) + 1;
        return counts;
      }, {})).sort((a, b) => b[1] - a[1])),
      cycles: cycles.length,
      checks: checks.length,
      extractable: summaries.filter(({ extractable }) => extractable).length
    },
    components: summaries,
    edges: [...componentEdges.values()].sort((a, b) => a.id.localeCompare(b.id)),
    cycles,
    stability,
    checks,
    workItems,
    violations,
    unassigned: unassigned.map(objectSummary),
    assignment: componentOf
  };
}

const named = (list) => `${list.slice(0, 5).map(({ type, label }) => `${type} ${label}`).join(", ")}${list.length > 5 ? ", ..." : ""}`;

/**
 * Findings about the architecture as a whole: its configuration (selectors,
 * declared dependencies, layers) and its components (cycles, size, stability).
 */
function architectureChecks({ settings, components, members, selectorUse, componentEdges, cycles, stability, unassigned }) {
  const checks = [];
  const check = (rule, message, details = {}) => {
    const severity = settings.severities[rule] ?? CHECK_RULES[rule];
    if (severity !== "off") checks.push({ rule, severity, message, ...details });
  };
  for (const cycle of cycles) {
    check("component-cycle", `Components depend on each other in a cycle: ${cycle.join(" -> ")} -> ${cycle[0]}`, { components: cycle });
  }
  if (unassigned.length) check("unassigned-objects", `${unassigned.length} object(s) belong to no architecture component: ${named(unassigned)}`);

  for (const component of components.values()) {
    const own = members.get(component.name);
    if (!own.length) {
      check("empty-component", `Component ${component.name} has no objects; no object matches ${component.match.join(", ")}`, { component: component.name });
    } else {
      for (const selector of component.match) {
        if (!selectorUse.has(`${component.name}\u0000${selector}`)) {
          check("unused-selector", `Selector "${selector}" of component ${component.name} assigns no object; another selector matches more specifically, or nothing matches`, { component: component.name, selector });
        }
      }
    }
    const limit = component.maxObjects ?? settings.maxObjects;
    const objects = own.filter(({ origin }) => origin === "workspace").length;
    if (limit && objects > limit) {
      check("component-too-large", `Component ${component.name} has ${objects} objects (limit ${limit}); split it into smaller components`, { component: component.name });
    }
    for (const name of component.dependsOn ?? []) {
      const target = components.get(name);
      if (component.layer !== undefined && target.layer !== undefined &&
        (target.layer > component.layer || (target.layer === component.layer && !settings.allowSameLayer))) {
        check("inconsistent-component-dependency", `Component ${component.name} (layer ${component.layer}) declares a dependency on ${name} (layer ${target.layer}), against the layers`, { component: component.name });
      }
      if (own.length && members.get(name).length && !componentEdges.has(`${component.name}->${name}`)) {
        check("unused-component-dependency", `Component ${component.name} declares a dependency on ${name} but uses none of its objects; remove it from dependsOn`, { component: component.name });
      }
    }
  }
  const declared = findCycles(
    [...components.keys()].map((key) => ({ key })),
    [...components.values()].flatMap(({ name, dependsOn }) => (dependsOn ?? []).map((target) => ({ from: name, to: target })))
  );
  for (const cycle of declared) {
    check("declared-component-cycle", `The declared dependencies form a cycle: ${cycle.join(" -> ")} -> ${cycle[0]}; these components cannot become separate apps`, { components: cycle });
  }
  for (const item of stability) {
    check("unstable-dependency", `Component ${item.source} (instability ${item.sourceInstability.toFixed(2)}) depends on ${item.target}, which is less stable (instability ${item.targetInstability.toFixed(2)})`, { component: item.source });
  }
  return checks;
}
