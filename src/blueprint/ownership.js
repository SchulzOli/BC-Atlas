// Who owns which data: for every table of a component, the components that
// write, read, relate to, or extend it. A table that other components write
// is the hardest coupling to cut when a component becomes an app: its writes
// must move behind a codeunit of the owner, or the table must move.

const USES = { writes: "writers", reads: "readers", relates: "relations", extends: "extenders" };

function objectName(node) {
  return `${node.type} ${node.objectId ? `${node.objectId} ` : ""}${node.label}`;
}

/**
 * @param objectLevel the object level of the dependency lens ({ nodes, edges })
 * @param componentOf Map of object id to component name
 * @returns tables used by other components than their own, most coupled first:
 *   { id, table, component, status: "owned" | "shared-writes", writers, readers, relations, extenders }
 *   where each use lists { component, objects: [names] }
 */
export function dataOwnership(objectLevel, componentOf) {
  const nodes = new Map(objectLevel.nodes.map((node) => [node.id, node]));
  const tables = new Map();
  for (const edge of objectLevel.edges) {
    const target = nodes.get(edge.target);
    const owner = componentOf.get(edge.target);
    const user = componentOf.get(edge.source);
    if (target?.type !== "table" || target.origin !== "workspace" || !owner || !user || owner === user) continue;
    if (!tables.has(target.id)) {
      tables.set(target.id, { id: target.id, table: objectName(target), component: owner, file: target.file, line: target.line, uses: {} });
    }
    const entry = tables.get(target.id);
    for (const [kind, list] of Object.entries(USES)) {
      if (!edge.kinds?.[kind]) continue;
      entry.uses[list] ??= new Map();
      if (!entry.uses[list].has(user)) entry.uses[list].set(user, []);
      entry.uses[list].get(user).push(objectName(nodes.get(edge.source)));
    }
  }
  const list = (map) => [...(map ?? new Map())].map(([component, objects]) => ({ component, objects: objects.sort() }))
    .sort((a, b) => b.objects.length - a.objects.length || a.component.localeCompare(b.component));
  return [...tables.values()]
    .map(({ uses, ...table }) => ({
      ...table,
      status: uses.writers?.size ? "shared-writes" : "owned",
      writers: list(uses.writers),
      readers: list(uses.readers),
      relations: list(uses.relations),
      extenders: list(uses.extenders)
    }))
    .filter((table) => table.writers.length + table.readers.length + table.relations.length + table.extenders.length)
    .sort((a, b) =>
      b.writers.length - a.writers.length ||
      (b.readers.length + b.relations.length + b.extenders.length) - (a.readers.length + a.relations.length + a.extenders.length) ||
      a.table.localeCompare(b.table));
}
