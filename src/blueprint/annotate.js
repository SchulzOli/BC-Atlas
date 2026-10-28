import { evaluateArchitecture } from "./evaluate.js";

/**
 * Adds the target architecture to one frame of the dependency lens: every
 * object gets its component, every forbidden edge its violation and
 * resolution, and a component level joins the object, module, and app levels.
 */
export function annotateLevels(levels, architecture) {
  const result = evaluateArchitecture(levels, architecture);
  for (const node of levels.object.nodes) {
    const component = result.assignment.get(node.id);
    if (component) node.component = component;
  }
  const byEdge = new Map(result.violations.map((violation) => [violation.edge, violation]));
  for (const edge of levels.object.edges) {
    const violation = byEdge.get(edge.id);
    if (!violation) continue;
    const { strategy, title, effort, steps } = violation.resolution;
    edge.violation = { rule: violation.rule, strategy, title, effort, steps };
  }
  const order = new Map(architecture.components.map(({ name }, index) => [name, index]));
  levels.component = {
    nodes: result.components.map((component) => ({
      id: `component::${component.name}`,
      label: component.name,
      type: "component",
      component: component.name,
      componentIndex: order.get(component.name),
      layer: component.layer,
      objectCount: component.metrics.objects,
      componentMetrics: component.metrics,
      violations: component.violations,
      extractable: component.extractable,
      dependsOn: component.dependsOn,
      origin: "component"
    })),
    edges: result.edges.map((edge) => ({
      id: `component::${edge.source}->component::${edge.target}`,
      source: `component::${edge.source}`,
      target: `component::${edge.target}`,
      dependency: edge.allowed ? "allowed" : "violation",
      scope: "inter-app",
      kinds: edge.kinds,
      weight: edge.weight,
      objectEdges: edge.objectEdges,
      violations: edge.violations
    }))
  };
  return result;
}
