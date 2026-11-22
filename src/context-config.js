// The contexts of .bca.json (check.contexts): which objects each one selects,
// which roles they play, and what they must not do, validated against the model.
import { compileSelector } from "./selectors.js";
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

export function validateContexts(model, contexts) {
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
