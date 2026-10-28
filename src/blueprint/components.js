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
// Selectors joined with & must all match (module:Base Application &
// namespace:Microsoft.Sales); their specificities add up. Architecture rules
// also select by the result of the assignment:
//   component:Sales              the objects of a component
//   layer:0,1                    the objects of components in these layers

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

export function compileSelector(selector, context) {
  const parts = String(selector).split("&").map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1) {
    const matchers = parts.map((part) => compileSingle(part, context));
    return (node) => {
      let total = 0;
      for (const matcher of matchers) {
        const score = matcher(node);
        if (!score) return 0;
        total += score;
      }
      return total;
    };
  }
  return compileSingle(selector, context);
}

function compileSingle(selector, { apps, modules, componentOf, layerOf }) {
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
  if (kind === "component" || kind === "layer") {
    if (!componentOf) throw new Error(`"${text}": ${kind}: selectors work in architecture rules, not in component selectors`);
    if (kind === "component") return (node) => normalizeIdentifier(componentOf(node)) === wanted && 200;
    const layers = new Set(value.split(",").map((layer) => Number(layer.trim())));
    if ([...layers].some((layer) => !Number.isInteger(layer))) throw new Error(`"${text}": layer: takes layer numbers, e.g. layer:0,1`);
    return (node) => layers.has(layerOf(node)) && 200;
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
  throw new Error(`Unsupported selector kind "${kind}"; use namespace, folder, app, module, type, or object${componentOf ? ", component, or layer" : ""}`);
}

/** Apps and modules by id, for selectors that name them. */
export function selectorContext(levels) {
  return {
    apps: new Map((levels.app?.nodes ?? []).map((node) => [node.id, node])),
    modules: new Map((levels.module?.nodes ?? []).map((node) => [node.id, node]))
  };
}

/**
 * Validates the `architecture.components` configuration and returns a
 * function that names the component of an object node (or undefined).
 */
export function componentMatcher(components, levels) {
  const assign = componentAssigner(components, levels);
  return (node) => assign(node)?.component;
}

/**
 * Like componentMatcher, but also tells which selector decided:
 * `(node) => ({ component, selector })` (or undefined).
 */
export function componentAssigner(components, levels) {
  if (!Array.isArray(components) || !components.length) {
    throw new Error("architecture.components must list at least one component");
  }
  const names = new Set();
  const context = selectorContext(levels);
  const compiled = components.map((component) => {
    if (!component?.name) throw new Error("every architecture component needs a name");
    if (names.has(component.name)) throw new Error(`duplicate architecture component "${component.name}"`);
    names.add(component.name);
    const selectors = [component.match ?? []].flat();
    if (!selectors.length) throw new Error(`architecture component "${component.name}" has no match selectors`);
    if (component.maxObjects !== undefined && !(Number.isInteger(component.maxObjects) && component.maxObjects > 0)) {
      throw new Error(`architecture component "${component.name}": maxObjects must be a positive integer`);
    }
    if (component.exposes !== undefined && ![component.exposes].flat().length) {
      throw new Error(`architecture component "${component.name}": exposes needs at least one selector`);
    }
    return { name: component.name, selectors, matchers: selectors.map((selector) => compileSelector(selector, context)) };
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
    for (const { name, selectors, matchers } of compiled) {
      matchers.forEach((matcher, index) => {
        const score = matcher(node) || 0;
        if (score > bestScore) {
          best = { component: name, selector: selectors[index] };
          bestScore = score;
        }
      });
    }
    return best;
  };
}
