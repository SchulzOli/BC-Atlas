// What a procedure does, directly and through the procedures it calls:
// persistent writes, commits, and the roles a context selects, with evidence.
import { isCommitCall } from "./operation-semantics.js";
import { normalizeIdentifier } from "./resolver.js";

export function procedureRecords(model) {
  const records = [];
  for (const owner of model.objects ?? []) {
    for (const [index, procedure] of (owner.procedures ?? []).entries()) {
      const key = `${owner.key}::procedure::${normalizeIdentifier(procedure.name)}::${procedure.location?.line ?? index}`;
      const node = {
        key,
        signature: procedure.signature,
        ownerKey: owner.key,
        ownerName: owner.name,
        procedureName: procedure.name,
        arity: procedure.arity ?? 0,
        returnTargetType: procedure.returnTargetType,
        returnTarget: procedure.returnTarget,
        type: procedure.kind,
        namespace: `${owner.namespace}.${owner.name}`,
        file: owner.file,
        location: procedure.location,
        relations: []
      };
      records.push({ owner, procedure, node });
    }
  }
  return records;
}

export function objectName(object) {
  return object?.name ?? "unknown object";
}

export function procedureIdentity(record) {
  return `${record.owner.key}::${normalizeIdentifier(record.procedure.signature)}`;
}

export function temporaryOverridesIdentity(overrides) {
  return JSON.stringify([...overrides.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function temporaryValue(record, name, overrides = new Map(), fallback) {
  const identifier = normalizeIdentifier(name);
  if (overrides.has(identifier)) return overrides.get(identifier);
  if (["rec", "xrec"].includes(identifier)) {
    const sourceTableTemporary = (record.owner.properties ?? []).find(({ name: property }) =>
      normalizeIdentifier(property) === "sourcetabletemporary"
    )?.value;
    return sourceTableTemporary === undefined
      ? fallback ?? false
      : /^true$/iu.test(sourceTableTemporary);
  }
  const variable = (record.owner.variables ?? [])
    .filter(({ scope }) => scope === undefined || scope === record.procedure.scope)
    .find(({ name: candidate }) => normalizeIdentifier(candidate) === identifier);
  if (!variable) return fallback;
  if (variable.parameter && variable.temporary !== true) return undefined;
  return variable.temporary;
}

export function temporaryOverridesForCall(record, call, targetRecord, current = new Map()) {
  const overrides = new Map();
  for (const [index, parameter] of (targetRecord.procedure.parameters ?? []).entries()) {
    if (!parameter.byReference) continue;
    const argument = call.arguments?.[index]?.trim();
    if (!argument || !/^[\p{L}_][\p{L}\p{N}_]*$/u.test(argument)) continue;
    overrides.set(
      normalizeIdentifier(parameter.name),
      temporaryValue(record, argument, current)
    );
  }
  return overrides;
}

export function directEffects(record, temporaryOverrides = new Map()) {
  const signature = normalizeIdentifier(record.procedure.signature);
  const effects = [];
  for (const relation of record.owner.relations ?? []) {
    if (relation.relationClass !== "runtime" ||
      normalizeIdentifier(relation.member ?? relation.sourceProcedure) !== signature ||
      relation.via?.length) continue;
    if (relation.kind === "reads") {
      effects.push({
        category: "reads",
        operation: relation.operation,
        temporary: false,
        member: record.procedure.signature,
        location: relation.location
      });
    } else if (relation.kind === "writes") {
      const temporary = relation.recordVariable
        ? temporaryValue(record, relation.recordVariable, temporaryOverrides, relation.temporary)
        : relation.temporary;
      effects.push({
        category: temporary === true
          ? "temporary-writes"
          : temporary === false
            ? "persistent-writes"
            : "unknown-state-writes",
        operation: relation.operation,
        temporary,
        member: record.procedure.signature,
        location: relation.location,
        ...(temporary === undefined
          ? { limitations: ["The record's temporary state could not be determined."] }
          : {})
      });
    }
  }
  for (const call of record.procedure.calls ?? []) {
    if (isCommitCall(call)) {
      effects.push({
        category: "commits",
        operation: "Commit",
        temporary: false,
        member: record.procedure.signature,
        location: call.location
      });
    }
  }
  return effects;
}

function assignments(statements) {
  return (statements ?? []).flatMap((statement) => [
    ...(statement.kind === "assignment" ? [statement] : []),
    ...(statement.kind === "conditional"
      ? [
        ...assignments(statement.then),
        ...assignments(statement.else),
        ...(statement.branches ?? []).flatMap(assignments)
      ]
      : [])
  ]);
}

export function stateMutations(record) {
  const variables = record.owner.variables ?? [];
  const globalVariables = new Set(
    variables.filter(({ scope }) => scope === undefined)
      .map(({ name }) => normalizeIdentifier(name))
  );
  const localVariables = new Set(
    variables.filter(({ scope }) => scope === record.procedure.scope)
      .map(({ name }) => normalizeIdentifier(name))
  );
  return assignments(record.procedure.fallbackFacts?.statements)
    .filter(({ target }) => {
      const name = normalizeIdentifier(target);
      return globalVariables.has(name) && !localVariables.has(name);
    })
    .map(({ target, location }) => ({
      category: "state-mutations",
      target,
      member: record.procedure.signature,
      procedure: record.procedure.signature,
      location
    }));
}

export function callEffect(record, call, resolved, targetRecord, depth, path, callPath) {
  const targetOwner = targetRecord?.owner ?? resolved.targetOwner;
  const targetProcedure = targetRecord?.procedure;
  const isResolved = Boolean(targetRecord);
  const resolution = isResolved
    ? resolved.resolvedBy ?? "syntactic"
    : resolved.confidence === "ambiguous"
      ? "ambiguous"
      : "unresolved";
  return {
    member: record.procedure.signature,
    target: targetOwner?.name,
    targetProcedure: targetProcedure?.signature,
    resolution,
    directness: depth === 0 ? "direct" : "indirect",
    depth,
    location: call.location,
    path: path.map(({ owner, procedure }) => `${owner.name}.${procedure.signature}`),
    callPath
  };
}

export function effectEvidence(effect) {
  return {
    kind: effect.category,
    operation: effect.operation,
    member: effect.member,
    file: effect.location?.file,
    line: effect.location?.line,
    column: effect.location?.column,
    ...(effect.path ? { path: effect.path } : {}),
    ...(effect.callPath ? { callPath: effect.callPath } : {})
  };
}

export function unique(items, key) {
  const seen = new Set();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

export function sortedEffects(items) {
  return items.sort((left, right) =>
    (left.location?.file ?? "").localeCompare(right.location?.file ?? "") ||
    (left.location?.line ?? 0) - (right.location?.line ?? 0) ||
    left.category.localeCompare(right.category) ||
    String(left.operation ?? "").localeCompare(String(right.operation ?? "")) ||
    left.member.localeCompare(right.member) ||
    JSON.stringify(left.callPath ?? []).localeCompare(JSON.stringify(right.callPath ?? []))
  );
}

export function selectedResponsibilities(record, targetRecord, call, depth, path, roles) {
  if (!targetRecord) return [];
  const responsibilities = [];
  for (const [role, targets] of Object.entries(roles)) {
    if (!targets.some(({ key }) => key === targetRecord.owner.key)) continue;
    responsibilities.push({
      role,
      target: objectName(targetRecord.owner),
      procedure: targetRecord.procedure.signature,
      caller: record.procedure.signature,
      directness: depth === 0 ? "direct" : "indirect",
      depth,
      location: call.location,
      path: path.map(({ owner, procedure }) => `${owner.name}.${procedure.signature}`)
    });
  }
  return responsibilities;
}
