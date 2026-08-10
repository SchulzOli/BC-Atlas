export function normalizeIdentifier(value) {
  return String(value ?? "")
    .trim()
    .replace(/"((?:""|[^"])*)"/gu, (_match, content) => content.replaceAll('""', '"'))
    .toLocaleLowerCase("en-US");
}

function symbolKey(object) {
  const app = object.app?.id ?? object.app?.name ?? "workspace";
  const identity = object.id || normalizeIdentifier(object.name);
  return [app, object.namespace, object.type, identity].join("::");
}

function lookupKeys(object) {
  const values = [
    normalizeIdentifier(object.name),
    normalizeIdentifier(`${object.namespace}.${object.name}`)
  ];
  if (object.id) values.push(String(object.id));
  return values.flatMap((value) => [
    `${object.type}:${value}`,
    `*:${value}`
  ]);
}

export function resolveModel(model) {
  const diagnostics = [...(model.diagnostics ?? [])];
  const index = new Map();

  for (const object of model.objects) {
    object.key = symbolKey(object);
    for (const key of lookupKeys(object)) {
      const candidates = index.get(key) ?? [];
      candidates.push(object);
      index.set(key, candidates);
    }
  }

  function resolve(source, relation) {
    const target = normalizeIdentifier(relation.target);
    let candidates =
      index.get(`${relation.targetType ?? "*"}:${target}`) ??
      index.get(`*:${target}`) ??
      [];
    if (candidates.length > 1) {
      const sameNamespace = candidates.filter(
        (candidate) => candidate.namespace === source.namespace
      );
      if (sameNamespace.length) candidates = sameNamespace;
    }
    if (candidates.length > 1 && source.app) {
      const sameApp = candidates.filter(
        (candidate) => candidate.app?.id === source.app.id
      );
      if (sameApp.length) candidates = sameApp;
    }
    if (candidates.length > 1 && source.app?.dependencies?.length) {
      const dependencyIds = new Set(
        source.app.dependencies.flatMap((dependency) => [dependency.id, dependency.appId])
      );
      const dependencyCandidates = candidates.filter(
        (candidate) => candidate.app?.id && dependencyIds.has(candidate.app.id)
      );
      if (dependencyCandidates.length) candidates = dependencyCandidates;
    }
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) {
      diagnostics.push({
        severity: "warning",
        code: "ambiguous-reference",
        message: `${source.type} "${source.name}" references ambiguous ${relation.targetType ?? "object"} "${relation.target}"`,
        file: relation.location?.file ?? source.file,
        line: relation.location?.line ?? source.location?.line,
        candidates: candidates.map(({ key }) => key)
      });
    }
    return undefined;
  }

  const edges = [];
  for (const object of model.objects) {
    for (const relation of object.relations) {
      const target = resolve(object, relation);
      if (!target) {
        diagnostics.push({
          severity: "info",
          code: "unresolved-reference",
          message: `${object.type} "${object.name}" references external or unresolved ${relation.targetType ?? "object"} "${relation.target}"`,
          file: relation.location?.file ?? object.file,
          line: relation.location?.line ?? object.location?.line
        });
      }
      edges.push({
        id: `e${edges.length}`,
        from: object.key,
        to: target?.key,
        unresolved: target ? undefined : {
          name: relation.target,
          type: relation.targetType ?? "object"
        },
        kind: relation.kind,
        access: relation.access,
        operation: relation.operation,
        property: relation.property,
        member: relation.member,
        contract: relation.contract,
        relatedField: relation.relatedField,
        condition: relation.condition,
        filters: relation.filters,
        temporary: relation.temporary,
        conditionalSymbols: relation.conditionalSymbols,
        via: relation.via,
        confidence: target ? "resolved" : "syntactic",
        location: relation.location
      });
    }
  }

  return { ...model, edges, diagnostics };
}
