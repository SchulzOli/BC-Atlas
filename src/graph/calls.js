// Procedure calls between AL objects, resolved from the source (src/call-analysis.js).
import { normalizeIdentifier } from "../resolver.js";
import { aggregateRelations } from "../relation-aggregation.js";
import { createCallResolver } from "../call-analysis.js";

/** The publisher an `[EventSubscriber(...)]` attribute names: { type, target, event }. */
export function subscriberAttribute(attribute) {
  const match = attribute.match(
    /EventSubscriber\s*\(\s*ObjectType::([\w.]+)\s*,\s*([^,]+?)\s*,\s*'((?:''|[^'])*)'/iu
  );
  if (!match) return undefined;
  const reference = match[2].trim();
  const separator = reference.indexOf("::");
  return {
    type: match[1].split(".").at(-1).toLowerCase(),
    target: cleanSubscriberReference(separator >= 0 ? reference.slice(separator + 2) : reference),
    event: match[3].replaceAll("''", "'")
  };
}

function cleanSubscriberReference(value) {
  const text = value.trim();
  return text.startsWith('"') && text.endsWith('"')
    ? text.slice(1, -1).replaceAll('""', '"')
    : text;
}

/**
 * Every call that resolves to exactly one procedure, as one edge per calling
 * and called object, with the calls as evidence.
 */
export function resolvedCallEdges(model) {
  const records = [];
  for (const owner of model.objects) {
    for (const [index, procedure] of (owner.procedures ?? []).entries()) {
      records.push({
        owner,
        procedure,
        node: {
          key: `${owner.key}::procedure::${normalizeIdentifier(procedure.name)}::${procedure.location?.line ?? index}`,
          name: procedure.name,
          signature: procedure.signature,
          ownerKey: owner.key,
          ownerName: owner.name,
          procedureName: procedure.name,
          arity: procedure.arity ?? 0,
          returnTargetType: procedure.returnTargetType,
          returnTarget: procedure.returnTarget
        }
      });
    }
  }
  const resolver = createCallResolver(model, records);
  const ownerOf = new Map(records.map(({ node }) => [node.key, node.ownerKey]));
  const edges = [];
  for (const owner of model.objects) {
    for (const procedure of owner.procedures ?? []) {
      const from = resolver.nodeFor(owner, procedure);
      if (!from) continue;
      for (const call of procedure.calls ?? []) {
        const resolved = resolver.resolveCall(owner, call);
        // Built-in methods (Rec.FindFirst, Message) are platform calls, not dependencies.
        if (resolved.builtin || !resolved.target || resolved.confidence !== "resolved") continue;
        edges.push({
          from: from.key,
          to: resolved.target.key,
          sourceProcedure: procedure.signature,
          targetProcedure: resolved.target.signature,
          callResolution: "syntactic",
          kind: "calls",
          confidence: "resolved",
          location: call.location
        });
      }
    }
  }
  return aggregateRelations(edges, {
    project: (edge) => ({ ...edge, from: ownerOf.get(edge.from), to: ownerOf.get(edge.to) }),
    identity: (edge) => `${edge.from}|${edge.to}|${edge.kind}`,
    occurrence: (edge) => ({
      sourceProcedure: edge.sourceProcedure,
      targetProcedure: edge.targetProcedure,
      callResolution: edge.callResolution,
      location: edge.location
    })
  });
}
