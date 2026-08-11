function addUnique(target, values) {
  for (const value of values.filter(Boolean)) {
    if (!target.includes(value)) target.push(value);
  }
}

export function aggregateRelations(relations, { identity, project = (relation) => relation, occurrence } = {}) {
  const combined = new Map();
  for (const source of relations) {
    const relation = project(source);
    if (!relation) continue;
    const key = identity(relation, source);
    const current = combined.get(key) ?? {
      ...relation,
      weight: 0,
      operations: [],
      sourceProcedures: [],
      ...(occurrence || relation.occurrences ? { occurrences: [] } : {})
    };
    current.weight += relation.weight ?? 1;
    addUnique(current.operations, [relation.operation, ...(relation.operations ?? [])]);
    addUnique(current.sourceProcedures, [
      relation.sourceProcedure,
      relation.member,
      ...(relation.sourceProcedures ?? [])
    ]);
    if (current.occurrences) {
      current.occurrences.push(...(relation.occurrences ?? [occurrence?.(source)].filter(Boolean)));
    }
    combined.set(key, current);
  }
  return [...combined.values()];
}
