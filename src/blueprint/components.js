import { normalizeIdentifier } from "../resolver.js";

// A component is a named part of the target architecture (a future app, or a
// layer inside one). Objects are assigned by selectors; the most specific
// matching selector wins (object, then the longest namespace or folder, then
// module and app, then type, then *):
//   namespace:Contoso.Sales      the namespace and everything below it
//   folder:src/Sales             files below a folder (globs allowed)
//   app:Contoso Sales            an app by name or ID
//   module:Job Queue             a module (nested app.json) by name or ID
//   type:table                   an object type
//   object:codeunit:Sales-Post   one object by type and name or ID
//   *                            everything not matched before

function globToRegExp(pattern) {
  const escaped = String(pattern)
    .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
    .replaceAll("**", "\u0000")
    .replaceAll("*", "[^/.]*")
    .replaceAll("\u0000", ".*")
    .replaceAll("?", ".");
  return new RegExp(`^${escaped}$`, "iu");
}

const isGlob = (value) => /[*?]/u.test(value);

function compileSelector(selector, { apps, modules }) {
  const text = String(selector).trim();
  if (text === "*" || text === "**") return () => 1;
  const separator = text.indexOf(":");
  if (separator < 1) {
    throw new Error(`Invalid component selector "${text}"; use namespace:, folder:, app:, module:, type:, object:, or *`);
  }
  const kind = text.slice(0, separator).toLowerCase();
  const value = text.slice(separator + 1).trim();
  if (!value) throw new Error(`Component selector "${text}" has no value`);
  const wanted = normalizeIdentifier(value);

  if (kind === "namespace") {
    const specificity = 100 + value.replaceAll("*", "").length;
    if (isGlob(value)) {
      const expression = globToRegExp(value);
      return (node) => expression.test(node.namespace ?? "") && specificity;
    }
    return (node) => {
      const namespace = normalizeIdentifier(node.namespace);
      return (namespace === wanted || namespace.startsWith(`${wanted}.`)) && specificity;
    };
  }
  if (kind === "folder") {
    const folder = value.replaceAll("\\", "/").replace(/^\.?\//u, "").replace(/\/$/u, "");
    const specificity = 100 + folder.replaceAll("*", "").length;
    if (isGlob(folder)) {
      const expression = globToRegExp(folder);
      const nested = globToRegExp(`${folder}/**`);
      return (node) => Boolean(node.file) && (expression.test(node.file) || nested.test(node.file)) && specificity;
    }
    return (node) => Boolean(node.file) && (node.file === folder || node.file.startsWith(`${folder}/`)) && specificity;
  }
  if (kind === "app") {
    return (node) => {
      const app = apps.get(node.app);
      return [node.app, app?.label, app?.appId].filter(Boolean).some((candidate) => normalizeIdentifier(candidate) === wanted) && 50;
    };
  }
  if (kind === "module") {
    return (node) => {
      const module = modules.get(node.module);
      return [module?.label, module?.appId].filter(Boolean).some((candidate) => normalizeIdentifier(candidate) === wanted) && 60;
    };
  }
  if (kind === "type") {
    const types = new Set(wanted.split(",").map((type) => type.trim()));
    return (node) => types.has(node.type) && 10;
  }
  if (kind === "object") {
    const [type, identity] = value.includes(":") ? value.split(/:(.*)/su, 2) : [undefined, value];
    const name = normalizeIdentifier(identity);
    return (node) => (!type || node.type === type.toLowerCase()) &&
      [node.label, node.objectId].filter(Boolean).some((candidate) => normalizeIdentifier(candidate) === name) && 1000;
  }
  throw new Error(`Unsupported component selector kind "${kind}"; use namespace, folder, app, module, type, or object`);
}

/**
 * Validates the `architecture.components` configuration and returns a
 * function that names the component of an object node (or undefined).
 */
export function componentMatcher(components, levels) {
  if (!Array.isArray(components) || !components.length) {
    throw new Error("architecture.components must list at least one component");
  }
  const names = new Set();
  const apps = new Map((levels.app?.nodes ?? []).map((node) => [node.id, node]));
  const modules = new Map((levels.module?.nodes ?? []).map((node) => [node.id, node]));
  const compiled = components.map((component) => {
    if (!component?.name) throw new Error("every architecture component needs a name");
    if (names.has(component.name)) throw new Error(`duplicate architecture component "${component.name}"`);
    names.add(component.name);
    const selectors = [component.match ?? []].flat();
    if (!selectors.length) throw new Error(`architecture component "${component.name}" has no match selectors`);
    return { name: component.name, matchers: selectors.map((selector) => compileSelector(selector, { apps, modules })) };
  });
  for (const component of components) {
    for (const target of component.dependsOn ?? []) {
      if (!names.has(target)) {
        throw new Error(`architecture component "${component.name}" depends on unknown component "${target}"`);
      }
    }
  }
  return (node) => {
    let best;
    let bestScore = 0;
    for (const { name, matchers } of compiled) {
      for (const matcher of matchers) {
        const score = matcher(node) || 0;
        if (score > bestScore) {
          best = name;
          bestScore = score;
        }
      }
    }
    return best;
  };
}
