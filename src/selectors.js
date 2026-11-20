// Selectors name objects of a project in .bca.json (check.contexts,
// check.contractExpectations):
//   namespace:Contoso.Sales      the namespace and everything below it
//   folder:src/Sales             files below a folder (globs allowed)
//   file:src/Sales/Order.al      one file (globs allowed)
//   app:Contoso Sales            an app by name or ID
//   module:Job Queue             a module (nested app.json) by name or ID
//   type:table                   an object type
//   object:codeunit:Sales-Post   one object by type and name or ID
//   id:50100..50199              objects whose ID lies in a range (or id:50100)
//   *                            everything
// Selectors joined with & must all match. A matcher returns 0, or how specific
// the match is.
import { normalizeIdentifier } from "./resolver.js";

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

function compileSingle(selector, { apps, modules }) {
  const text = String(selector).trim();
  if (text === "*" || text === "**") return () => 1;
  const separator = text.indexOf(":");
  if (separator < 1) {
    throw new Error(`Invalid selector "${text}"; use namespace:, folder:, file:, app:, module:, type:, object:, id:, or *`);
  }
  const kind = text.slice(0, separator).toLowerCase();
  const value = text.slice(separator + 1).trim();
  if (!value) throw new Error(`Selector "${text}" has no value`);
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
  if (kind === "file") {
    const file = value.replaceAll("\\", "/").replace(/^\.?\//u, "");
    const specificity = 200 + file.replaceAll("*", "").replaceAll("?", "").length;
    const expression = isGlob(file) ? globToRegExp(file) : undefined;
    return (node) => {
      const candidate = String(node.file ?? "").replaceAll("\\", "/");
      return (expression ? expression.test(candidate) : candidate === file) && specificity;
    };
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
  if (kind === "id") {
    const range = value.match(/^(\d+)(?:\s*\.\.\s*(\d+))?$/u);
    if (!range) throw new Error(`"${text}": id: takes an object ID or a range, e.g. id:50100..50199`);
    const from = Number(range[1]);
    const to = Number(range[2] ?? range[1]);
    // Narrower ranges are more specific; any range is less specific than a namespace or folder.
    const specificity = 90 + Math.max(0, 9 - Math.floor(Math.log10(to - from + 1) * 2));
    return (node) => /^\d+$/u.test(String(node.objectId ?? "")) && Number(node.objectId) >= from && Number(node.objectId) <= to && specificity;
  }
  if (kind === "type") {
    const types = new Set(wanted.split(",").map((type) => type.trim()));
    return (node) => types.has(node.type) && 10;
  }
  if (kind === "object") {
    const [type, identity] = value.includes(":") ? value.split(/:(.*)/su, 2) : [undefined, value];
    const name = normalizeIdentifier(identity);
    const objectType = type?.toLowerCase();
    const matcher = (node) => (!objectType || node.type === objectType) &&
      [node.label, node.objectId].filter(Boolean).some((candidate) => normalizeIdentifier(candidate) === name) && 1000;
    return matcher;
  }
  throw new Error(`Unsupported selector kind "${kind}"; use namespace, folder, file, app, module, type, object, or id`);
}
