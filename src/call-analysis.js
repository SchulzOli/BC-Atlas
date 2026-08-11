import { normalizeIdentifier } from "./resolver.js";

export function createCallResolver(model, procedureRecords) {
  const objects = new Map();
  const procedures = new Map();

  for (const object of model.objects) {
    for (const identity of [object.name, `${object.namespace}.${object.name}`, object.id].filter(Boolean)) {
      objects.set(`${object.type}:${normalizeIdentifier(identity)}`, object);
    }
  }
  for (const record of procedureRecords) {
    const key = `${record.owner.key}:${normalizeIdentifier(record.procedure.name)}`;
    const candidates = procedures.get(key) ?? [];
    candidates.push(record);
    procedures.set(key, candidates);
  }

  const object = (type, identity) =>
    objects.get(`${type}:${normalizeIdentifier(identity)}`);
  const candidatesFor = (owner, name) =>
    owner ? procedures.get(`${owner.key}:${normalizeIdentifier(name)}`) ?? [] : [];
  const variableFor = (owner, call, targetType) => (owner.variables ?? [])
    .filter(({ name, scope, targetType: type }) =>
      normalizeIdentifier(name) === normalizeIdentifier(call.receiver) &&
      (scope === undefined || scope === call.scope) && (!targetType || type === targetType)
    )
    .at(-1);

  function targetOwnerFor(owner, call) {
    if (!call.receiver) return owner;
    if (call.receiverCall) {
      const receiverOwner = targetOwnerFor(owner, call.receiverCall);
      const matches = candidatesFor(receiverOwner, call.receiverCall.name)
        .filter(({ procedure }) => (procedure.arity ?? 0) === call.receiverCall.arity);
      const returned = matches.length === 1 ? matches[0].procedure : undefined;
      return returned?.returnTarget
        ? object(returned.returnTargetType, returned.returnTarget)
        : undefined;
    }
    if (/^(rec|xrec|currpage|report)$/iu.test(call.receiver)) return owner;
    const variable = variableFor(owner, call);
    return variable?.target
      ? object(variable.targetType, variable.target)
      : object("codeunit", call.receiver) ?? object("interface", call.receiver);
  }

  function resolveCall(owner, call) {
    const targetOwner = targetOwnerFor(owner, call);
    const candidates = candidatesFor(targetOwner, call.name);
    const matches = candidates.filter(
      ({ procedure }) => (procedure.arity ?? 0) === call.arity
    );
    return {
      targetOwner,
      candidates: matches,
      target: matches.length === 1 ? matches[0].node : undefined,
      confidence: matches.length === 1 ? "resolved" : matches.length > 1 ? "ambiguous" : "syntactic"
    };
  }

  return {
    object,
    candidates: (owner, name) => candidatesFor(owner, name).map(({ node }) => node),
    nodeFor: (owner, procedure) => candidatesFor(owner, procedure.name)
      .find(({ procedure: candidate }) => candidate.location?.line === procedure.location?.line)?.node,
    resolveCall,
    variableFor
  };
}
