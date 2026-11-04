import { createCallResolver } from "./call-analysis.js";
import { compileSelector } from "./blueprint/components.js";
import { isCommitCall, operationKind } from "./operation-semantics.js";
import { normalizeIdentifier } from "./resolver.js";

const FORBIDDEN = new Set([
  "persistent-writes",
  "commits",
  "planning",
  "partner-resolution",
  "lazy-reads"
]);

function projectObjects(model) {
  const apps = new Map((model.apps ?? []).map((app) => [
    app.id ?? app.name,
    { label: app.name, appId: app.id }
  ]));
  const modules = new Map((model.modules ?? []).map((module) => [
    module.id ?? module.name,
    { label: module.name, appId: module.id }
  ]));
  const objects = (model.objects ?? []).map((object) => ({
    ...object,
    label: object.name,
    objectId: object.id,
    app: typeof object.app === "object" ? object.app.id ?? object.app.name : object.app,
    module: typeof object.module === "object" ? object.module.id ?? object.module.name : object.module,
    sourceObject: object
  }));
  return { objects, context: { apps, modules } };
}

function selectObjects(selector, objects, selectorContext, where, required = true) {
  if (typeof selector !== "string" || !selector.trim()) {
    throw new Error(`${where} must be a non-empty object selector`);
  }
  let matches;
  try {
    const matcher = compileSelector(selector, selectorContext);
    matches = objects.filter((object) => matcher(object) > 0);
  } catch (error) {
    throw new Error(`${where}: ${error.message}`);
  }
  if (required && !matches.length) {
    throw new Error(`${where} selector "${selector}" did not match any object`);
  }
  return matches.map(({ sourceObject }) => sourceObject);
}

function validateContexts(model, contexts) {
  if (contexts === undefined) return [];
  if (!Array.isArray(contexts)) throw new Error("check.contexts must be an array");

  const { objects, context: selectorContext } = projectObjects(model);
  return contexts.map((item, index) => {
    const where = `check.contexts[${index}]`;
    if (!item || Array.isArray(item) || typeof item !== "object") {
      throw new Error(`${where} must be an object with an object selector`);
    }

    const selected = selectObjects(item.object, objects, selectorContext, `${where}.object`);
    const maxCallDepth = item.maxCallDepth === undefined ? 3 : item.maxCallDepth;
    if (!Number.isInteger(maxCallDepth) || maxCallDepth < 1) {
      throw new Error(`${where}.maxCallDepth must be a positive integer`);
    }

    const roles = item.roles === undefined ? {} : item.roles;
    if (!roles || Array.isArray(roles) || typeof roles !== "object") {
      throw new Error(`${where}.roles must be an object`);
    }
    const unknownRoles = Object.keys(roles).filter(
      (role) => !["planning", "partnerResolution"].includes(role)
    );
    if (unknownRoles.length) {
      throw new Error(`${where}.roles has unsupported role(s): ${unknownRoles.join(", ")}`);
    }
    const selectedRoles = {};
    for (const role of ["planning", "partnerResolution"]) {
      if (roles[role] === undefined) {
        selectedRoles[role] = [];
        continue;
      }
      if (!Array.isArray(roles[role])) {
        throw new Error(`${where}.roles.${role} must be an array of object selectors`);
      }
      selectedRoles[role] = roles[role].flatMap((selector, roleIndex) =>
        selectObjects(
          selector,
          objects,
          selectorContext,
          `${where}.roles.${role}[${roleIndex}]`
        )
      );
    }

    const lazyReadMethods = item.lazyReadMethods === undefined ? [] : item.lazyReadMethods;
    if (!Array.isArray(lazyReadMethods) ||
      lazyReadMethods.some((method) => typeof method !== "string" || !method.trim())) {
      throw new Error(`${where}.lazyReadMethods must be an array of method signatures`);
    }
    const availableSignatures = new Set(selected.flatMap((object) =>
      (object.procedures ?? []).map(({ signature }) => normalizeIdentifier(signature))
    ));
    for (const [methodIndex, method] of lazyReadMethods.entries()) {
      if (!/^.+\([^()]*\)$/u.test(method.trim())) {
        throw new Error(`${where}.lazyReadMethods[${methodIndex}] must be a method signature such as LoadPartner()`);
      }
      if (!availableSignatures.has(normalizeIdentifier(method))) {
        throw new Error(`${where}.lazyReadMethods includes unknown method signature "${method}" on the selected object(s)`);
      }
    }

    const forbid = item.forbid === undefined ? [] : item.forbid;
    if (!Array.isArray(forbid) ||
      forbid.some((category) => typeof category !== "string" || !FORBIDDEN.has(category))) {
      throw new Error(
        `${where}.forbid must contain only: ${[...FORBIDDEN].join(", ")}`
      );
    }
    return {
      selected,
      selectedRoles,
      lazyReadMethods: new Set(lazyReadMethods.map(normalizeIdentifier)),
      forbid: new Set(forbid),
      maxCallDepth
    };
  });
}

function procedureRecords(model) {
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

function objectName(object) {
  return object?.name ?? "unknown object";
}

function procedureIdentity(record) {
  return `${record.owner.key}::${normalizeIdentifier(record.procedure.signature)}`;
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

function temporaryOverridesForCall(record, call, targetRecord, current = new Map()) {
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

function directEffects(record, temporaryOverrides = new Map()) {
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

function stateMutations(record) {
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

function callEffect(record, call, resolved, targetRecord, depth, path, callPath) {
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

function effectEvidence(effect) {
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

function unique(items, key) {
  const seen = new Set();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function sortedEffects(items) {
  return items.sort((left, right) =>
    (left.location?.file ?? "").localeCompare(right.location?.file ?? "") ||
    (left.location?.line ?? 0) - (right.location?.line ?? 0) ||
    left.category.localeCompare(right.category) ||
    String(left.operation ?? "").localeCompare(String(right.operation ?? "")) ||
    left.member.localeCompare(right.member) ||
    JSON.stringify(left.callPath ?? []).localeCompare(JSON.stringify(right.callPath ?? []))
  );
}

function selectedResponsibilities(record, targetRecord, call, depth, path, roles) {
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

function findingFor(object, category, directness, evidence, limitations, forbidden) {
  const policyViolation = forbidden && directness === "direct";
  const label = `${object.type} ${object.name}`;
  const operation = evidence.operation ? ` (${evidence.operation})` : "";
  const severity = policyViolation ? "warning" : "info";
  const basis = policyViolation ? "configured-policy" : "observed-code-fact";
  return {
    severity,
    rule: "context-responsibility",
    basis,
    object: label,
    category,
    directness,
    primaryEvidence: evidence,
    ...(evidence.file ? {
      file: evidence.file,
      line: evidence.line,
      column: evidence.column
    } : {}),
    evidence: [evidence],
    ...(limitations.length ? { limitations } : {}),
    message: `${label} has ${directness} ${category.replaceAll("-", " ")}${operation}`
  };
}

function analyzeSelectedObject(config, callResolver, recordByNode, recordsByOwner) {
  const { selected, selectedRoles, lazyReadMethods, forbid, maxCallDepth } = config;
  const summaries = [];
  const findings = [];

  for (const object of selected) {
    const roots = (recordsByOwner.get(object.key) ?? []);
    const direct = roots.flatMap((record) => directEffects(record));
    const indirect = [];
    const calls = [];
    const limitations = [];
    const limitationRecords = [];
    const responsibilities = {
      planning: [],
      partnerResolution: [],
      lazyReads: []
    };

    const addLimitation = (message, procedure, rootProcedure) => {
      limitations.push(message);
      limitationRecords.push({
        message,
        procedure: normalizeIdentifier(procedure ?? ""),
        rootProcedure: normalizeIdentifier(rootProcedure ?? procedure ?? "")
      });
    };

    for (const root of roots) {
      if (root.procedure.hasBody !== true ||
        root.procedure.fallbackFacts?.complete === false) {
        addLimitation(
          `Selected procedure body information is unavailable or incomplete for ${object.name}.${root.procedure.signature}; its effects are unknown.`,
          root.procedure.signature,
          root.procedure.signature
        );
      }
      const rootKey = procedureIdentity(root);
      const seen = new Set([rootKey]);
      const queue = [{
        record: root,
        depth: 0,
        path: [root],
        callPath: [],
        temporaryOverrides: new Map()
      }];
      while (queue.length) {
        const current = queue.shift();
        const currentPath = current.path;
        const currentRecord = current.record;
        for (const call of currentRecord.procedure.calls ?? []) {
          if (operationKind(call.name) || isCommitCall(call)) continue;
          const resolved = callResolver.resolveCall(currentRecord.owner, call);
          const targetRecord = resolved.target
            ? recordByNode.get(resolved.target.key)
            : undefined;
          if (!targetRecord && !resolved.targetOwner &&
            !call.receiver && !resolved.confidence?.startsWith("ambiguous")) {
            addLimitation(
              `Unresolved call "${call.name}" in ${currentRecord.procedure.signature}.`,
              currentRecord.procedure.signature,
              currentPath[0].procedure.signature
            );
          } else if (!targetRecord && !resolved.target) {
            const receiver = call.receiver ? `${call.receiver}.` : "";
            addLimitation(
              `${resolved.confidence === "ambiguous" ? "Ambiguous" : "Unresolved"} call "${receiver}${call.name}" in ${currentRecord.procedure.signature}.`,
              currentRecord.procedure.signature,
              currentPath[0].procedure.signature
            );
          }

          const callItem = callEffect(
            currentRecord,
            call,
            resolved,
            targetRecord,
            current.depth,
            currentPath,
            current.callPath
          );
          calls.push(callItem);
          if (targetRecord) {
            if (targetRecord.procedure.hasBody !== true ||
              targetRecord.procedure.fallbackFacts?.complete === false) {
              addLimitation(
                `Procedure body information is unavailable or incomplete for ${targetRecord.owner.name}.${targetRecord.procedure.signature}; indirect effects are unknown.`,
                currentRecord.procedure.signature,
                currentPath[0].procedure.signature
              );
            }
            responsibilities.planning.push(
              ...selectedResponsibilities(currentRecord, targetRecord, call, current.depth, currentPath, {
                planning: selectedRoles.planning
              })
            );
            responsibilities.partnerResolution.push(
              ...selectedResponsibilities(currentRecord, targetRecord, call, current.depth, currentPath, {
                partnerResolution: selectedRoles.partnerResolution
              })
            );

            if (current.depth >= maxCallDepth) {
              addLimitation(
                `Call traversal stopped at maxCallDepth ${maxCallDepth} after ${currentRecord.procedure.signature}.`,
                currentRecord.procedure.signature,
                currentPath[0].procedure.signature
              );
              continue;
            }
            const targetKey = procedureIdentity(targetRecord);
            if (currentPath.some((item) => procedureIdentity(item) === targetKey)) {
              addLimitation(
                `Call cycle reached ${targetRecord.procedure.signature}; the visited-procedure guard stopped traversal.`,
                currentRecord.procedure.signature,
                currentPath[0].procedure.signature
              );
              continue;
            }
            if (seen.has(targetKey)) continue;
            seen.add(targetKey);
            queue.push({
              record: targetRecord,
              depth: current.depth + 1,
              path: [...currentPath, targetRecord],
              callPath: [...current.callPath, {
                from: objectName(currentRecord.owner),
                sourceProcedure: currentRecord.procedure.signature,
                to: objectName(targetRecord.owner),
                targetProcedure: targetRecord.procedure.signature,
                resolution: callItem.resolution,
                location: call.location
              }],
              temporaryOverrides: temporaryOverridesForCall(
                currentRecord,
                call,
                targetRecord,
                current.temporaryOverrides
              )
            });
          }
        }

        if (current.depth > 0) {
          indirect.push(...directEffects(currentRecord, current.temporaryOverrides).map((effect) => ({
            ...effect,
            directness: "indirect",
            depth: current.depth,
            path: currentPath.map(({ owner, procedure }) => `${owner.name}.${procedure.signature}`),
            callPath: current.callPath
          })));
        }
      }
    }

    const selectedMethods = roots.filter(({ procedure }) =>
      lazyReadMethods.has(normalizeIdentifier(procedure.signature))
    );
    for (const { procedure } of selectedMethods) {
      const methodKey = normalizeIdentifier(procedure.signature);
      const rootPath = `${object.name}.${procedure.signature}`;
      const methodEffects = [
        ...direct.filter(({ member }) => normalizeIdentifier(member) === methodKey),
        ...indirect.filter(({ path }) => path[0] === rootPath)
      ];
      const methodCalls = calls.filter(({ path }) => path[0] === rootPath);
      const methodLimitations = limitationRecords
        .filter(({ rootProcedure: signature }) => signature === methodKey)
        .map(({ message }) => message);
      const readOnly = methodEffects.length > 0 &&
        methodEffects.every(({ category }) => category === "reads") &&
        !methodCalls.some(({ resolution }) => resolution !== "syntactic" && resolution !== "compiler");
      if (readOnly) {
        responsibilities.lazyReads.push({
          procedure: procedure.signature,
          directness: "direct",
          effects: methodEffects,
          limitations: []
        });
      } else {
        responsibilities.lazyReads.push({
          procedure: procedure.signature,
          directness: "direct",
          effects: methodEffects,
          limitations: methodLimitations.length
            ? methodLimitations
            : ["The selected method is not established as read-only by the available operation facts."]
        });
      }
    }

    const selectedResponsibilitiesList = [
      ...responsibilities.planning,
      ...responsibilities.partnerResolution
    ];
    const uniqueDirect = unique(direct, (effect) =>
      `${effect.category}|${effect.operation}|${effect.member}|${effect.location?.file}|${effect.location?.line}`
    );
    const uniqueIndirect = unique(indirect, (effect) =>
      `${effect.category}|${effect.operation}|${effect.member}|${effect.location?.file}|${effect.location?.line}|${effect.path.join(">")}|${JSON.stringify(effect.callPath)}`
    );
    const uniqueCalls = unique(calls, (call) =>
      `${call.member}|${call.target}|${call.targetProcedure}|${call.location?.file}|${call.location?.line}|${call.path.join(">")}`
    );
    const uniqueStateMutations = unique(roots.flatMap((record) => stateMutations(record)), (mutation) =>
      `${mutation.target}|${mutation.member}|${mutation.location?.file}|${mutation.location?.line}`
    );
    const summary = {
      object: objectName(object),
      objectType: object.type,
      objectId: object.id,
      maxCallDepth,
      directEffects: sortedEffects(uniqueDirect),
      indirectEffects: sortedEffects(uniqueIndirect),
      stateMutations: uniqueStateMutations,
      calls: uniqueCalls,
      responsibilities: {
        planning: unique(responsibilities.planning, ({ target, procedure, location, path }) =>
          `${target}|${procedure}|${location?.file}|${location?.line}|${path.join(">")}`
        ),
        partnerResolution: unique(responsibilities.partnerResolution, ({ target, procedure, location, path }) =>
          `${target}|${procedure}|${location?.file}|${location?.line}|${path.join(">")}`
        ),
        lazyReads: responsibilities.lazyReads
      },
      limitations: [...new Set(limitations)].sort()
    };
    summaries.push(summary);

    for (const effect of [...uniqueDirect.map((item) => ({ ...item, directness: "direct" })), ...uniqueIndirect]) {
      const forbiddenCategory = effect.category === "persistent-writes"
        ? forbid.has("persistent-writes")
        : effect.category === "commits"
          ? forbid.has("commits")
          : false;
      findings.push(findingFor(
        object,
        effect.category,
        effect.directness,
        effectEvidence(effect),
        effect.limitations ?? [],
        forbiddenCategory
      ));
    }
    for (const responsibility of selectedResponsibilitiesList) {
      const category = responsibility.role === "planning" ? "planning" : "partner-resolution";
      findings.push(findingFor(
        object,
        category,
        responsibility.directness,
        {
          kind: category,
          member: responsibility.caller,
          file: responsibility.location?.file,
          line: responsibility.location?.line
        },
        [],
        forbid.has(category)
      ));
    }
    for (const mutation of uniqueStateMutations) {
      findings.push(findingFor(
        object,
        "state-mutations",
        "direct",
        {
          kind: "state-mutations",
          operation: `assign ${mutation.target}`,
          member: mutation.member,
          file: mutation.location?.file,
          line: mutation.location?.line
        },
        [],
        false
      ));
    }
    for (const lazyRead of responsibilities.lazyReads) {
      const readOnly = !lazyRead.limitations.length;
      if (!readOnly) continue;
      findings.push(findingFor(
        object,
        "lazy-reads",
        "direct",
        {
          kind: "lazy-reads",
          member: lazyRead.procedure,
          file: lazyRead.effects[0]?.location?.file,
          line: lazyRead.effects[0]?.location?.line
        },
        [],
        forbid.has("lazy-reads")
      ));
    }
    if (summary.limitations.length) {
      findings.push({
        severity: "info",
        rule: "context-responsibility",
        basis: "observed-code-fact",
        object: `${object.type} ${object.name}`,
        category: "analysis-limitations",
        directness: "analysis",
        limitations: summary.limitations,
        evidence: [],
        message: `${object.type} ${object.name} has incomplete context-responsibility evidence`
      });
    }
  }

  return { summaries, findings };
}

export function analyzeContextResponsibilities(model, contexts) {
  const configurations = validateContexts(model, contexts);
  if (!configurations.length) return { summaries: [], findings: [] };
  const records = procedureRecords(model);
  const recordByNode = new Map(records.map((record) => [record.node.key, record]));
  const recordsByOwner = new Map();
  for (const record of records) {
    const owners = recordsByOwner.get(record.owner.key) ?? [];
    owners.push(record);
    recordsByOwner.set(record.owner.key, owners);
  }
  const callResolver = createCallResolver(model, records);
  return configurations.reduce((result, config) => {
    const analyzed = analyzeSelectedObject(config, callResolver, recordByNode, recordsByOwner);
    result.summaries.push(...analyzed.summaries);
    result.findings.push(...analyzed.findings);
    return result;
  }, { summaries: [], findings: [] });
}
