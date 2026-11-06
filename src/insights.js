function wildcard(pattern) {
  const escaped = String(pattern)
    .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
    .replaceAll("**", "\u0000")
    .replaceAll("*", ".*")
    .replaceAll("\u0000", ".*");
  return new RegExp(`^${escaped}$`, "iu");
}

export function findCycles(objects, edges) {
  const keys = new Set(objects.map(({ key }) => key));
  const graph = new Map([...keys].map((key) => [key, []]));
  for (const edge of edges) {
    const from = edge.from ?? edge.source;
    const to = edge.to ?? edge.target;
    if (to && keys.has(from) && keys.has(to)) {
      graph.get(from).push(to);
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
    // An object that refers to itself (a variable of its own type, a recursive
    // call) depends on nothing else; a cycle needs at least two objects.
    if (component.length > 1) cycles.push(component.sort());
  }
  for (const key of keys) if (!state.has(key)) connect(key);
  return cycles.sort((a, b) => a[0].localeCompare(b[0]));
}

function relationKinds(edge) {
  const kinds = [
    edge.kind,
    ...Object.entries(edge.kinds ?? {}).filter(([, weight]) => weight).map(([kind]) => kind),
    ...(edge.evidence ?? []).map(({ kind }) => kind)
  ].filter(Boolean);
  return [...new Set(kinds)].sort((left, right) =>
    left === right ? 0 : left === "calls" ? -1 : right === "calls" ? 1 : left.localeCompare(right));
}

function evidenceFor(edges, kind) {
  return edges.flatMap((edge) => {
    const evidence = edge.evidence?.length
      ? edge.evidence
      : [{
        kind: edge.kind,
        member: edge.member,
        file: edge.location?.file ?? edge.file,
        line: edge.location?.line ?? edge.line
      }];
    return evidence
      .filter((item) => !item.kind || item.kind === kind)
      .map((item) => ({ ...item, kind: item.kind ?? kind }));
  }).sort((left, right) =>
    String(left.file ?? "").localeCompare(String(right.file ?? "")) ||
    (left.line ?? 0) - (right.line ?? 0) ||
    String(left.member ?? left.sourceProcedure ?? "").localeCompare(String(right.member ?? right.sourceProcedure ?? "")));
}

function edgeDetails(edges, from, to) {
  const kinds = [...new Set(edges.flatMap(relationKinds))].sort((left, right) =>
    left === right ? 0 : left === "calls" ? -1 : right === "calls" ? 1 : left.localeCompare(right));
  const kind = kinds[0] ?? "dependency";
  return { from, to, kind, evidence: evidenceFor(edges, kind) };
}

function representativePath(start, members, outgoing, edgesByPair) {
  const allowed = new Set(members);
  const visited = new Set([start]);
  const path = [];
  function search(current) {
    for (const target of [...new Set(outgoing.get(current) ?? [])].sort()) {
      if (!allowed.has(target)) continue;
      if (target === start) {
        const edges = edgesByPair.get(`${current}\u0000${target}`) ?? [];
        return [...path, edgeDetails(edges, current, target)];
      }
      if (visited.has(target)) continue;
      visited.add(target);
      const edges = edgesByPair.get(`${current}\u0000${target}`) ?? [];
      path.push(edgeDetails(edges, current, target));
      const found = search(target);
      if (found) return found;
      path.pop();
      visited.delete(target);
    }
    return undefined;
  }
  return search(start) ?? [];
}

/** Provides one deterministic, evidence-backed representative path per structural cycle. */
export function findCyclePaths(objects, edges) {
  const cycles = findCycles(objects, edges);
  const outgoing = new Map(objects.map(({ key }) => [key, []]));
  const edgesByPair = new Map();
  for (const edge of edges) {
    const from = edge.from ?? edge.source;
    const to = edge.to ?? edge.target;
    if (!outgoing.has(from) || !outgoing.has(to)) continue;
    outgoing.get(from).push(to);
    const key = `${from}\u0000${to}`;
    if (!edgesByPair.has(key)) edgesByPair.set(key, []);
    edgesByPair.get(key).push(edge);
  }
  return cycles.map((members) => {
    const path = representativePath(members[0], members, outgoing, edgesByPair);
    const hasCalls = path.some(({ kind }) => kind === "calls");
    const calls = path.flatMap(({ kind, evidence }) => kind === "calls" ? evidence : []);
    const syntacticCalls = calls.some(({ callResolution, resolution }) => (callResolution ?? resolution) !== "compiler");
    const incompleteCalls = path.some(({ kind, evidence }) =>
      kind === "calls" && evidence.some(({ callResolution, resolution }) =>
        !["compiler", "syntactic"].includes(callResolution ?? resolution)));
    const missingEvidence = path.some(({ evidence }) => !evidence.length);
    const missingLocations = path.some(({ evidence }) => !evidence.some(({ file, line }) => file && line !== undefined));
    return {
      members,
      path,
      classification: "structural",
      limitations: [
        "A structural dependency cycle is not evidence of runtime recursion.",
        ...(hasCalls && syntacticCalls ? ["Call resolution is incomplete without compiler evidence; ambiguous or unresolved call evidence may be omitted."] : []),
        ...(incompleteCalls ? ["Ambiguous or unresolved call evidence does not support a tailored call-cycle remedy."] : []),
        ...(missingEvidence ? ["One or more cycle hops lack supporting dependency evidence."] : []),
        ...(missingLocations ? ["One or more cycle hops lack a supporting source location."] : [])
      ]
    };
  });
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
      cycles: findCycles(model.objects, model.edges),
      cyclePaths: findCyclePaths(model.objects, model.edges)
    }
  };
}

export const testing = { findCycles, findCyclePaths };
