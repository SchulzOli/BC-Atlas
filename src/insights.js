function wildcard(pattern) {
  const escaped = String(pattern)
    .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
    .replaceAll("**", "\u0000")
    .replaceAll("*", ".*")
    .replaceAll("\u0000", ".*");
  return new RegExp(`^${escaped}$`, "iu");
}

function findCycles(objects, edges) {
  const keys = new Set(objects.map(({ key }) => key));
  const graph = new Map([...keys].map((key) => [key, []]));
  for (const edge of edges) {
    if (edge.to && keys.has(edge.from) && keys.has(edge.to)) {
      graph.get(edge.from).push(edge.to);
    }
  }

  let index = 0;
  const stack = [];
  const state = new Map();
  const cycles = [];
  function connect(key) {
    const entry = { index, low: index, onStack: true };
    index++;
    state.set(key, entry);
    stack.push(key);
    for (const target of graph.get(key)) {
      if (!state.has(target)) {
        connect(target);
        entry.low = Math.min(entry.low, state.get(target).low);
      } else if (state.get(target).onStack) {
        entry.low = Math.min(entry.low, state.get(target).index);
      }
    }
    if (entry.low !== entry.index) return;
    const component = [];
    let current;
    do {
      current = stack.pop();
      state.get(current).onStack = false;
      component.push(current);
    } while (current !== key);
    if (component.length > 1 || graph.get(key).includes(key)) cycles.push(component.sort());
  }
  for (const key of keys) if (!state.has(key)) connect(key);
  return cycles.sort((a, b) => a[0].localeCompare(b[0]));
}

export function addInsights(model, forbidden = []) {
  const degree = new Map(model.objects.map(({ key }) => [key, { incoming: 0, outgoing: 0 }]));
  for (const edge of model.edges) {
    if (degree.has(edge.from)) degree.get(edge.from).outgoing++;
    if (edge.to && degree.has(edge.to)) degree.get(edge.to).incoming++;
  }
  const hubs = [...degree]
    .map(([key, value]) => ({ key, ...value, total: value.incoming + value.outgoing }))
    .filter(({ total }) => total > 0)
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key))
    .slice(0, 10);
  const orphans = [...degree]
    .filter(([, value]) => value.incoming + value.outgoing === 0)
    .map(([key]) => key)
    .sort();
  const diagnostics = [...model.diagnostics];
  const byKey = new Map(model.objects.map((object) => [object.key, object]));

  for (const rule of forbidden) {
    if (!rule.from || !rule.to) continue;
    const fromPattern = wildcard(rule.from);
    const toPattern = wildcard(rule.to);
    for (const edge of model.edges) {
      const from = byKey.get(edge.from);
      const to = byKey.get(edge.to);
      if (!from || !to) continue;
      const fromName = `${from.namespace}:${from.type}:${from.name}`;
      const toName = `${to.namespace}:${to.type}:${to.name}`;
      if (fromPattern.test(fromName) && toPattern.test(toName)) {
        diagnostics.push({
          severity: rule.severity ?? "warning",
          code: "forbidden-dependency",
          message: rule.message ?? `Forbidden dependency from ${fromName} to ${toName}`,
          file: edge.location?.file ?? from.file,
          line: edge.location?.line
        });
      }
    }
  }

  return {
    ...model,
    diagnostics,
    insights: {
      unresolvedEdges: model.edges.filter(({ to }) => !to).length,
      orphans,
      hubs,
      cycles: findCycles(model.objects, model.edges)
    }
  };
}

export const testing = { findCycles };
