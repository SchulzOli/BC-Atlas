import { compileSelector } from "./blueprint/components.js";
import { normalizeIdentifier } from "./resolver.js";

function flattenEvidence(statements) {
  return statements.flatMap((statement) => [
    statement,
    ...(statement.kind === "conditional"
      ? [
        ...(statement.then ? flattenEvidence(statement.then) : []),
        ...(statement.else ? flattenEvidence(statement.else) : []),
        ...(statement.branches ?? []).flatMap(flattenEvidence)
      ]
      : [])
  ]);
}

function unknown(evidence, limitations) {
  return { kind: "unknown", evidence, limitations };
}

export function classifyFallbackBody(procedure) {
  const facts = procedure?.fallbackFacts;
  const evidence = facts?.statements ? flattenEvidence(facts.statements) : [];
  if (procedure?.hasBody !== true || !facts) {
    return unknown(evidence, ["Procedure body information is unavailable."]);
  }
  if (!facts.complete) {
    return unknown(evidence, facts.limitations ?? ["Procedure body facts are incomplete."]);
  }
  if (facts.statements.some(({ kind }) => kind === "conditional")) {
    return { kind: "conditional", evidence, limitations: [] };
  }
  if (!facts.statements.length) {
    return { kind: "empty", evidence, limitations: [] };
  }
  if (facts.statements.length !== 1) {
    return unknown(evidence, ["The procedure has mixed statements outside the supported classifier."]);
  }

  const [statement] = facts.statements;
  if (statement.kind === "return" && statement.constant) {
    return { kind: "constant-return", evidence, limitations: [] };
  }
  if (statement.kind === "call" && statement.directError && !statement.conditional) {
    return { kind: "direct-error", evidence, limitations: [] };
  }
  if (statement.kind === "call" && !statement.directError) {
    if (statement.resolved) {
      return {
        kind: "delegation",
        evidence,
        limitations: ["Delegated behavior was not analyzed."]
      };
    }
    return unknown(evidence, [`Delegated call target "${statement.target}" could not be resolved.`]);
  }
  return unknown(evidence, ["The procedure body is outside the supported structural classifier."]);
}

function selectorObjects(model) {
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

function validateExpectations(model, expectations) {
  if (expectations === undefined) return [];
  if (!Array.isArray(expectations)) {
    throw new Error("check.contractExpectations must be an array");
  }
  const { objects, context } = selectorObjects(model);
  return expectations.map((expectation, index) => {
    const where = `check.contractExpectations[${index}]`;
    if (!expectation || Array.isArray(expectation) || typeof expectation !== "object") {
      throw new Error(`${where} must be an object with interface and methods`);
    }
    if (typeof expectation.interface !== "string" || !expectation.interface.trim()) {
      throw new Error(`${where}.interface must be a non-empty object selector`);
    }
    if (!Array.isArray(expectation.methods) ||
      expectation.methods.some((method) => typeof method !== "string" || !method.trim())) {
      throw new Error(`${where}.methods must be an array of non-empty method names`);
    }
    let matches;
    try {
      const matcher = compileSelector(expectation.interface, context);
      matches = objects.filter((object) => matcher(object) > 0);
    } catch (error) {
      throw new Error(`${where}.interface: ${error.message}`);
    }
    if (matches.length !== 1 || matches[0].type !== "interface") {
      throw new Error(
        `${where}.interface selector "${expectation.interface}" must resolve to exactly one interface object; found ${matches.length}`
      );
    }
    const contract = matches[0].sourceObject;
    const methods = new Set();
    for (const method of expectation.methods) {
      const matching = (contract.procedures ?? []).filter(
        (procedure) => normalizeIdentifier(procedure.name) === normalizeIdentifier(method)
      );
      if (!matching.length) {
        const available = [...new Set((contract.procedures ?? []).map(({ name }) => name))].sort().join(", ");
        throw new Error(
          `${where}.methods includes unknown method "${method}" on interface ${contract.name}; available methods: ${available || "(none)"}`
        );
      }
      methods.add(normalizeIdentifier(method));
    }
    return { contract, methods };
  });
}

function contractLabel(contract) {
  const namespace = normalizeIdentifier(contract.namespace);
  const name = normalizeIdentifier(contract.name);
  return namespace && !name.startsWith(`${namespace}.`)
    ? `${contract.namespace}.${contract.name}`
    : contract.name;
}

function bindingMatchesContract(interfacesByName, enumObject, contract, binding) {
  const reference = normalizeIdentifier(binding.contract);
  const name = normalizeIdentifier(contract.name);
  const fullName = normalizeIdentifier(contractLabel(contract));
  if (reference === fullName || reference === normalizeIdentifier(contract.id)) return true;
  if (reference !== name) return false;

  const candidates = interfacesByName.get(name) ?? [];
  if (candidates.length === 1) return candidates[0] === contract;
  const sameNamespace = candidates.filter(
    (object) => normalizeIdentifier(object.namespace) === normalizeIdentifier(enumObject.namespace)
  );
  return sameNamespace.length === 1 && sameNamespace[0] === contract;
}

function methodSignature(procedure) {
  const signature = normalizeIdentifier(procedure.signature ?? `${procedure.name}()`);
  return `${signature}->${normalizeIdentifier(procedure.returnType)}`;
}

function targetForBinding(model, enumObject, binding, objectsByKey, codeunitsByName) {
  const edge = model.edges?.find((candidate) =>
    candidate.from === enumObject.key &&
    candidate.kind === "selects" &&
    candidate.bindingKind === binding.bindingKind &&
    candidate.contract === binding.contract &&
    candidate.member === binding.member &&
    candidate.location?.file === binding.location?.file &&
    candidate.location?.line === binding.location?.line
  );
  if (edge?.to && objectsByKey.has(edge.to)) return objectsByKey.get(edge.to);

  const target = normalizeIdentifier(binding.target);
  let candidates = codeunitsByName.get(target) ?? [];
  if (candidates.length > 1) {
    const sameNamespace = candidates.filter(
      ({ namespace }) => normalizeIdentifier(namespace) === normalizeIdentifier(enumObject.namespace)
    );
    if (sameNamespace.length) candidates = sameNamespace;
  }
  if (candidates.length > 1 && enumObject.app) {
    const app = typeof enumObject.app === "object" ? enumObject.app.id ?? enumObject.app.name : enumObject.app;
    const sameApp = candidates.filter((candidate) => {
      const targetApp = typeof candidate.app === "object" ? candidate.app.id ?? candidate.app.name : candidate.app;
      return normalizeIdentifier(targetApp) === normalizeIdentifier(app);
    });
    if (sameApp.length) candidates = sameApp;
  }
  return candidates.length === 1 ? candidates[0] : undefined;
}

function effectiveBindings(interfacesByName, contract, enumObject) {
  const bindings = (enumObject.relations ?? []).filter((relation) =>
    relation.kind === "selects" &&
    ["explicit", "default"].includes(relation.bindingKind) &&
    bindingMatchesContract(interfacesByName, enumObject, contract, relation)
  );
  const explicit = bindings.filter(({ bindingKind }) => bindingKind === "explicit");
  const defaults = bindings.filter(({ bindingKind }) => bindingKind === "default");
  const cases = explicit.map((binding) => ({
    binding,
    enumValue: binding.member
  }));
  if (defaults.length !== 1) return cases;

  const explicitMembers = new Set(explicit.map(({ member }) => normalizeIdentifier(member)));
  for (const element of (enumObject.elements ?? []).filter(({ kind }) => kind === "enum-value")) {
    if (!explicitMembers.has(normalizeIdentifier(element.name))) {
      cases.push({ binding: defaults[0], enumValue: element.name });
    }
  }
  return cases;
}

function hasSuccessfulConditionalPath(statement) {
  const successfulBranch = (branch) => {
    if (branch === null || branch.length === 0) return true;
    if (branch.length !== 1) return false;
    const [item] = branch;
    if (item.kind === "return") return item.constant && normalizeIdentifier(item.value) === "true";
    if (item.kind === "conditional") return hasSuccessfulConditionalPath(item);
    return false;
  };
  if (statement.hasImplicitEmptyPath) return true;
  if (statement.branches) return statement.branches.some(successfulBranch);
  return successfulBranch(statement.then) || successfulBranch(statement.else);
}

function isSilentSuccess(classification, procedure) {
  if (classification.kind === "empty") return true;
  if (classification.kind === "constant-return") {
    return classification.evidence.some(({ kind, value }) =>
      kind === "return" && normalizeIdentifier(value) === "true"
    );
  }
  return classification.kind === "conditional" &&
    procedure.fallbackFacts.statements.length === 1 &&
    hasSuccessfulConditionalPath(procedure.fallbackFacts.statements[0]);
}

function evidenceLocations(binding, classification) {
  const locations = [binding.location, ...classification.evidence.map(({ location }) => location)]
    .filter(Boolean);
  const unique = new Map(locations.map((location) => [
    `${location.file}:${location.line}:${location.column ?? ""}:${location.endLine ?? ""}:${location.endColumn ?? ""}`,
    location
  ]));
  return [...unique.values()];
}

function findingFor({ contract, enumObject, enumValue, binding, procedure, interfaceProcedure, classification, configured }) {
  const location = procedure.location ?? interfaceProcedure.location ?? binding.location;
  const label = contractLabel(contract);
  const implementation = procedure === interfaceProcedure
    ? `interface default ${label}`
    : procedure.objectName ?? procedure.owner ?? binding.target;
  const fallback = classification.kind === "conditional"
    ? "conditional path that can complete without an error"
    : classification.kind === "empty"
      ? "empty body"
      : "constant true return";
  return {
    severity: configured ? "warning" : "info",
    rule: "contract-fallback",
    message: `${configured ? "Required method" : "Method"} ${label}.${interfaceProcedure.name} has a structurally silent ${fallback} in ${implementation} for ${enumObject.name}.${enumValue}`,
    basis: configured ? "configured-policy" : "observed-code-fact",
    resolution: "syntactic",
    file: location?.file,
    line: location?.line,
    column: location?.column,
    endLine: location?.endLine,
    endColumn: location?.endColumn,
    interface: label,
    method: interfaceProcedure.name,
    methodSignature: interfaceProcedure.signature,
    enum: enumObject.name,
    enumValue,
    implementation: binding.target,
    bindingKind: binding.bindingKind,
    fallbackKind: classification.kind,
    evidence: evidenceLocations(binding, classification),
    limitations: [
      ...classification.limitations,
      "Body classification is structural and is not proof of runtime behavior."
    ]
  };
}

export function analyzeContractFallbacks(model, expectations) {
  const required = validateExpectations(model, expectations);
  const objects = model.objects ?? [];
  const expectedMethods = new Map();
  for (const { contract, methods } of required) {
    const selected = expectedMethods.get(contract) ?? new Set();
    for (const method of methods) selected.add(method);
    expectedMethods.set(contract, selected);
  }

  const findings = [];
  const interfaces = objects.filter(({ type }) => type === "interface");
  const enums = objects.filter(({ type }) =>
    ["enum", "enumextension"].includes(type)
  );
  const interfacesByName = new Map();
  for (const contract of interfaces) {
    const name = normalizeIdentifier(contract.name);
    const candidates = interfacesByName.get(name) ?? [];
    candidates.push(contract);
    interfacesByName.set(name, candidates);
  }
  const objectsByKey = new Map(objects.map((object) => [object.key, object]));
  const codeunitsByName = new Map();
  for (const codeunit of objects.filter(({ type }) => type === "codeunit")) {
    for (const name of [
      codeunit.name,
      codeunit.namespace ? `${codeunit.namespace}.${codeunit.name}` : undefined,
      codeunit.id
    ].filter(Boolean)) {
      const key = normalizeIdentifier(name);
      const candidates = codeunitsByName.get(key) ?? [];
      if (!candidates.includes(codeunit)) candidates.push(codeunit);
      codeunitsByName.set(key, candidates);
    }
  }
  for (const contract of interfaces) {
    const methodExpectations = expectedMethods.get(contract) ?? new Set();
    const cases = enums.flatMap((enumObject) =>
      effectiveBindings(interfacesByName, contract, enumObject).flatMap(({ binding, enumValue }) => {
        const implementation = targetForBinding(
          model,
          enumObject,
          binding,
          objectsByKey,
          codeunitsByName
        );
        return implementation ? [{ enumObject, binding, enumValue, implementation }] : [];
      })
    );
    for (const interfaceProcedure of contract.procedures ?? []) {
      const configured = methodExpectations.has(normalizeIdentifier(interfaceProcedure.name));
      const signature = methodSignature(interfaceProcedure);
      for (const { enumObject, binding, enumValue, implementation } of cases) {
        const candidates = (implementation.procedures ?? []).filter((procedure) =>
          methodSignature(procedure) === signature
        );
        const procedure = candidates.length === 1
          ? candidates[0]
          : candidates.length > 1
            ? undefined
            : interfaceProcedure;
        if (!procedure) continue;
        const classification = classifyFallbackBody(procedure);
        if (!isSilentSuccess(classification, procedure)) continue;
        findings.push(findingFor({
          contract,
          enumObject,
          enumValue,
          binding,
          procedure,
          interfaceProcedure,
          classification,
          configured
        }));
      }
    }
  }
  return findings.sort((left, right) =>
    left.severity.localeCompare(right.severity) ||
    left.interface.localeCompare(right.interface) ||
    left.method.localeCompare(right.method) ||
    left.enum.localeCompare(right.enum) ||
    String(left.enumValue).localeCompare(String(right.enumValue))
  );
}
