// Context responsibilities (check.contexts): does an object of a context do
// what its context forbids, directly or through what it calls? The contexts
// are read by context-config.js, the effects of a procedure by
// context-effects.js.
import { createCallResolver } from "./call-analysis.js";
import { validateContexts } from "./context-config.js";
import {
  callEffect,
  directEffects,
  effectEvidence,
  objectName,
  procedureIdentity,
  procedureRecords,
  selectedResponsibilities,
  sortedEffects,
  stateMutations,
  temporaryOverridesForCall,
  temporaryOverridesIdentity,
  unique
} from "./context-effects.js";
import { isCommitCall, operationKind } from "./operation-semantics.js";
import { normalizeIdentifier } from "./resolver.js";
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
      const seen = new Set([`${rootKey}|${temporaryOverridesIdentity(new Map())}`]);
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
            const temporaryOverrides = temporaryOverridesForCall(
              currentRecord,
              call,
              targetRecord,
              current.temporaryOverrides
            );
            const traversalKey = `${targetKey}|${temporaryOverridesIdentity(temporaryOverrides)}`;
            if (seen.has(traversalKey)) continue;
            seen.add(traversalKey);
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
              temporaryOverrides
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
        methodLimitations.length === 0 &&
        !methodCalls.some(({ resolution }) => resolution !== "syntactic");
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
