import { classifyPermissionSet } from "./permission-semantics.js";

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

function appIdentity(app) {
  return normalizeIdentifier(app?.id ?? app?.name);
}

function dependencyIds(app) {
  return new Set((app?.dependencies ?? []).flatMap((dependency) =>
    [dependency.id, dependency.appId, dependency.name]
      .filter(Boolean)
      .map(normalizeIdentifier)
  ));
}

function targetOrigin(source, target) {
  if (!target) return "unknown";
  if (target.externalSymbol && /microsoft/iu.test(target.app?.publisher ?? "")) {
    return "microsoft-base-app";
  }
  if (dependencyIds(source.app).has(appIdentity(target.app))) return "declared-dependency";
  if (appIdentity(source.app) && appIdentity(source.app) === appIdentity(target.app)) {
    return "same-app";
  }
  return target.externalSymbol ? "unknown" : "workspace-app";
}

function inferredCardinality(target, relation) {
  if (
    relation.property !== "tablerelation" ||
    !relation.sourceField ||
    !relation.relatedField ||
    target?.primaryKeyFields?.length !== 1 ||
    (relation.relatedField &&
      normalizeIdentifier(relation.relatedField) !== normalizeIdentifier(target.primaryKeyFields[0]))
  ) return {};
  return {
    cardinality: "0..* -> 0..1",
    cardinalityEvidence: `TableRelation ${relation.sourceField} -> primary key ${target.primaryKeyFields[0]}`
  };
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
    if (relation.targetAppId) {
      const targetAppId = normalizeIdentifier(relation.targetAppId);
      candidates = candidates.filter((candidate) => appIdentity(candidate.app) === targetAppId);
    }
    if (candidates.length > 1 && source.app) {
      const sameApp = candidates.filter(
        (candidate) => appIdentity(candidate.app) === appIdentity(source.app)
      );
      if (sameApp.length) candidates = sameApp;
    }
    if (candidates.length > 1) {
      const sameNamespace = candidates.filter(
        (candidate) => candidate.namespace === source.namespace
      );
      if (sameNamespace.length) candidates = sameNamespace;
    }
    if (candidates.length > 1 && source.app?.dependencies?.length) {
      const declaredIds = dependencyIds(source.app);
      const dependencyCandidates = candidates.filter(
        (candidate) => declaredIds.has(appIdentity(candidate.app))
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
      const cardinality = inferredCardinality(target, relation);
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
        permissionKind: relation.permissionKind,
        tableDataRights: relation.tableDataRights,
        execute: relation.execute,
        permissionSetRelation: relation.permissionSetRelation,
        targetAppId: relation.targetAppId,
        operation: relation.operation,
        operations: relation.operations,
        sourceProcedure: relation.sourceProcedure ?? relation.member,
        sourceProcedures: relation.sourceProcedures,
        relationClass: relation.relationClass,
        ...cardinality,
        sourceField: relation.sourceField,
        transactionSegment: relation.transactionSegment,
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
        targetOrigin: targetOrigin(object, target),
        targetApp: target?.app ? {
          id: target.app.id,
          name: target.app.name,
          publisher: target.app.publisher
        } : undefined,
        location: relation.location
      });
    }
  }

  const includedBy = new Map();
  for (const edge of edges.filter(({ kind, to }) => kind === "includes" && to)) {
    const sources = includedBy.get(edge.to) ?? [];
    sources.push(edge.from);
    includedBy.set(edge.to, sources);
  }
  const objects = model.objects.map((object) => {
    if (!["permissionset", "permissionsetextension"].includes(object.type)) return object;
    return classifyPermissionSet(object, includedBy.get(object.key) ?? []);
  });

  return { ...model, objects, edges, diagnostics };
}
