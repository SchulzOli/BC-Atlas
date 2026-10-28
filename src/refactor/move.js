// Moves an AL object to another component of the target architecture: the
// mechanical part of the move-extension, move-subscriber, move-object-up,
// and move-object-down work items.
//
//   - the object's file moves to the component's folder; an object that
//     shares its file with others is cut out into a file of its own
//   - its namespace becomes the component's namespace, and the files that
//     reference it get the `using` they now need
//
// The plan is a list of file operations with a diff; nothing is written
// unless it is applied. Afterwards the AL compiler and bca check verify it.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { normalizeIdentifier } from "../resolver.js";
import { lineDiff } from "./diff.js";

const TYPE_NAMES = {
  table: "Table", tableextension: "TableExt", page: "Page", pageextension: "PageExt", pagecustomization: "PageCustomization",
  codeunit: "Codeunit", report: "Report", reportextension: "ReportExt", query: "Query", xmlport: "XmlPort",
  enum: "Enum", enumextension: "EnumExt", interface: "Interface", permissionset: "PermissionSet",
  permissionsetextension: "PermissionSetExt", controladdin: "ControlAddIn", profile: "Profile", entitlement: "Entitlement"
};

const toPosix = (value) => String(value ?? "").replaceAll("\\", "/");
const hasNamespace = (value) => Boolean(value) && value !== "(global)";
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** One workspace object by type:id, type:name, name, id, or key. */
export function selectWorkspaceObject(model, selector) {
  const text = String(selector ?? "").trim();
  const [kind, identity] = /^[a-z]+:/iu.test(text) ? text.split(/:(.*)/su, 2) : [undefined, text];
  const wanted = normalizeIdentifier(String(identity).replace(/^"|"$/gu, ""));
  const matches = model.objects.filter((object) => !object.externalSymbol &&
    (!kind || object.type === kind.toLowerCase()) &&
    [object.id, object.name, object.key].filter(Boolean).some((value) => normalizeIdentifier(value) === wanted));
  if (matches.length !== 1) {
    throw new Error(matches.length ? `"${selector}" matches ${matches.length} objects; add the type, e.g. codeunit:50100` : `"${selector}" matches no object of the analyzed source`);
  }
  return matches[0];
}

/** A file name after the AL guidelines: <Name>.<Type>.al without spaces and special characters. */
export function alFileName(object) {
  const name = String(object.name).replace(/[^A-Za-z0-9]+/gu, "") || "Object";
  return `${name}.${TYPE_NAMES[object.type] ?? object.type}.al`;
}

function mostCommon(values) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0]?.[0];
}

/** Where objects of a component live: its folder: or namespace: selector, else what most of its objects use. */
function componentHome(component, members) {
  const selectors = [component.match ?? []].flat().map(String);
  const literal = (kind) => selectors
    .flatMap((selector) => selector.split("&").map((part) => part.trim()))
    .find((part) => part.toLowerCase().startsWith(`${kind}:`) && !/[*?]/u.test(part))
    ?.slice(kind.length + 1).trim();
  return {
    folder: literal("folder")?.replace(/^\.?\//u, "").replace(/\/$/u, "") ?? mostCommon(members.map(({ file }) => path.posix.dirname(toPosix(file)))),
    namespace: literal("namespace") ?? mostCommon(members.map(({ namespace }) => namespace).filter(hasNamespace))
  };
}

const USING = /^\s*using\s+([A-Za-z0-9_."]+)\s*;/u;
const OBJECT_START = /^\s*(table|tableextension|page|pageextension|pagecustomization|codeunit|report|reportextension|query|xmlport|enum|enumextension|interface|permissionset|permissionsetextension|controladdin|profile|entitlement|dotnet)\b/iu;
const NAMESPACE = /^\s*namespace\s+([A-Za-z0-9_."]+)\s*;/u;

/** Adds `using <namespace>;` to an AL file unless it is there: after the last using, else after the namespace. */
export function addUsing(text, namespace) {
  const lines = text.split(/\r?\n/u);
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  // The header ends where the first object starts.
  const firstObject = lines.findIndex((line) => OBJECT_START.test(line));
  const header = firstObject < 0 ? lines : lines.slice(0, firstObject);
  if (header.some((line) => USING.test(line) && normalizeIdentifier(line.match(USING)[1]) === normalizeIdentifier(namespace))) return text;
  const lastUsing = header.reduce((index, line, position) => (USING.test(line) ? position : index), -1);
  const namespaceLine = header.findIndex((line) => NAMESPACE.test(line));
  const statement = `using ${namespace};`;
  if (lastUsing >= 0) lines.splice(lastUsing + 1, 0, statement);
  else if (namespaceLine >= 0) lines.splice(namespaceLine + 1, 0, "", statement);
  else lines.splice(0, 0, statement, "");
  return lines.join(newline);
}

/** One blank line at most between the namespace and usings before the first object. */
function tidyHeader(text) {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/u);
  const first = lines.findIndex((line) => OBJECT_START.test(line) || /^\s*\/\//u.test(line));
  const end = first < 0 ? lines.length : first;
  const header = lines.slice(0, end).filter((line, index, all) => line.trim() || (index > 0 && all[index - 1].trim()));
  return [...header, ...lines.slice(end)].join(newline);
}

/** Removes `using <namespace>;`: a file needs no using of its own namespace. */
function removeUsing(text, namespace) {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  return text.split(/\r?\n/u)
    .filter((line) => !(USING.test(line) && normalizeIdentifier(line.match(USING)[1]) === normalizeIdentifier(namespace)))
    .join(newline);
}

function setNamespace(text, namespace) {
  const lines = text.split(/\r?\n/u);
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const index = lines.findIndex((line) => NAMESPACE.test(line));
  if (index >= 0) lines[index] = lines[index].replace(NAMESPACE, `namespace ${namespace};`);
  else lines.splice(0, 0, `namespace ${namespace};`, "");
  return lines.join(newline);
}

/**
 * Plans moving one object to a component.
 * @param assessment the result of assessArchitecture (model, result, architecture)
 * @param options { object, to, folder, namespace }
 */
export async function planMove(assessment, { object: selector, to, folder, namespace } = {}) {
  const { model, result, architecture } = assessment;
  const root = model.root;
  const object = selectWorkspaceObject(model, selector);
  const componentOf = result.assignment;
  const current = componentOf.get(object.key);
  const component = architecture.components.find((item) => item.name.toLowerCase() === String(to ?? "").toLowerCase());
  if (to && !component) throw new Error(`no component "${to}"; components: ${architecture.components.map(({ name }) => name).join(", ")}`);
  if (!to && !folder) throw new Error("name the target component (--to) or folder (--folder)");

  const members = component ? model.objects.filter((item) => !item.externalSymbol && componentOf.get(item.key) === component.name && item.key !== object.key) : [];
  const home = component ? componentHome(component, members) : {};
  if (folder === undefined && home.folder === undefined) throw new Error(`component ${component?.name} has no objects to take a folder from; pass --folder`);
  const targetFolder = toPosix(folder ?? home.folder).replace(/^\.\/?/u, "").replace(/\/$/u, "");
  const oldNamespace = hasNamespace(object.namespace) ? object.namespace : undefined;
  const newNamespace = namespace ?? home.namespace ?? oldNamespace;
  const namespaceChanges = Boolean(newNamespace) && normalizeIdentifier(newNamespace) !== normalizeIdentifier(oldNamespace ?? "");

  const sourceFile = toPosix(object.file);
  const sourceText = await fs.readFile(path.join(root, sourceFile), "utf8");
  const newline = sourceText.includes("\r\n") ? "\r\n" : "\n";
  const neighbours = model.objects.filter((item) => !item.externalSymbol && toPosix(item.file) === sourceFile && item.key !== object.key);
  const files = new Map([[sourceFile, sourceText]]);
  const original = new Map([[sourceFile, sourceText]]);
  const operations = [];
  const warnings = [];
  const byKey = new Map(model.objects.map((item) => [item.key, item]));

  // Namespaces the moved object needs: what it references, and what its file imported.
  const referenced = new Set(model.edges.filter((edge) => edge.from === object.key && edge.to)
    .map((edge) => byKey.get(edge.to)?.namespace).filter(hasNamespace));
  const fileUsings = (object.usings ?? []).filter(hasNamespace);
  const usings = [...new Set([...fileUsings, ...referenced, ...(namespaceChanges && oldNamespace && referenced.has(oldNamespace) ? [oldNamespace] : [])])]
    .filter((value) => normalizeIdentifier(value) !== normalizeIdentifier(newNamespace ?? ""))
    .sort();

  let targetFile;
  if (!neighbours.length) {
    // The whole file moves.
    targetFile = path.posix.join(targetFolder, path.posix.basename(sourceFile));
    let text = namespaceChanges ? removeUsing(setNamespace(sourceText, newNamespace), newNamespace) : sourceText;
    for (const value of usings) text = addUsing(text, value);
    text = tidyHeader(text);
    if (targetFile !== sourceFile) {
      files.delete(sourceFile);
      operations.push({ action: "move", from: sourceFile, path: targetFile });
    } else {
      operations.push({ action: "edit", path: targetFile });
    }
    files.set(targetFile, text);
    original.set(targetFile, targetFile === sourceFile ? sourceText : "");
  } else {
    // The object is cut out of a file it shares, with the comments right above it.
    const lines = sourceText.split(/\r?\n/u);
    let start = object.location.line - 1;
    while (start > 0 && /^\s*\/\//u.test(lines[start - 1])) start--;
    const end = object.location.endLine;
    const block = lines.slice(start, end);
    const rest = [...lines.slice(0, start), ...lines.slice(end)];
    files.set(sourceFile, `${rest.join(newline).replace(/(\r?\n){3,}/gu, `${newline}${newline}`).trimEnd()}${newline}`);
    operations.push({ action: "edit", path: sourceFile });
    targetFile = path.posix.join(targetFolder, alFileName(object));
    const header = [
      ...(newNamespace ? [`namespace ${newNamespace};`, ""] : []),
      ...usings.map((value) => `using ${value};`),
      ...(usings.length ? [""] : [])
    ];
    files.set(targetFile, `${[...header, ...block].join(newline).trimEnd()}${newline}`);
    original.set(targetFile, "");
    operations.push({ action: "create", path: targetFile });
  }
  try {
    await fs.access(path.join(root, targetFile));
    if (targetFile !== sourceFile) throw new Error(`${targetFile} exists already; pass another --folder`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  // Files that reference the object need its new namespace.
  if (namespaceChanges) {
    const referencing = new Set(model.edges
      .filter((edge) => edge.to === object.key && edge.from !== object.key)
      .map((edge) => byKey.get(edge.from))
      .filter((item) => item && !item.externalSymbol && normalizeIdentifier(item.namespace ?? "") !== normalizeIdentifier(newNamespace))
      .map((item) => toPosix(item.file)));
    for (const file of [...referencing].sort()) {
      if (!files.has(file)) {
        const text = await fs.readFile(path.join(root, file), "utf8");
        files.set(file, text);
        original.set(file, text);
        operations.push({ action: "edit", path: file });
      }
      files.set(file, addUsing(files.get(file), newNamespace));
    }
  }

  // Moving between apps: the ID must fit the target app, and tables keep their data only with MovedTo/MovedFrom.
  const appOf = (file) => [...model.apps].filter((app) => {
    const relative = toPosix(path.relative(root, app.root));
    return !relative || file === relative || file.startsWith(`${relative}/`);
  }).sort((a, b) => b.root.length - a.root.length)[0];
  const fromApp = appOf(sourceFile);
  const toApp = appOf(targetFile);
  if (fromApp && toApp && fromApp.id !== toApp.id) {
    const inApp = (item, app) => item && !item.externalSymbol && appOf(toPosix(item.file))?.id === app.id;
    const usesSource = model.edges.some((edge) => edge.from === object.key && edge.to !== object.key && inApp(byKey.get(edge.to), fromApp));
    const usedBySource = model.edges.some((edge) => edge.to === object.key && edge.from !== object.key && inApp(byKey.get(edge.from), fromApp));
    let manifest = {};
    try {
      manifest = JSON.parse(await fs.readFile(path.join(toApp.root, "app.json"), "utf8"));
    } catch {
      // No readable app.json; the compiler reports what is missing.
    }
    const declares = (manifest.dependencies ?? []).some((dependency) => [dependency.id, dependency.appId].includes(fromApp.id));
    warnings.push(`${object.type} ${object.name} moves from app ${fromApp.name} to ${toApp.name}.`);
    if (usesSource && !declares) warnings.push(`It uses objects of ${fromApp.name}, which ${toApp.name} does not declare as a dependency in app.json.`);
    if (usedBySource) warnings.push(`Objects that stay in ${fromApp.name} use it: ${fromApp.name} would have to depend on ${toApp.name}${declares ? ", a cycle" : ""}.`);
    const ranges = manifest.idRanges ?? (manifest.idRange ? [manifest.idRange] : []);
    if (object.id && ranges.length && !ranges.some(({ from, to: last }) => Number(object.id) >= from && Number(object.id) <= last)) {
      warnings.push(`ID ${object.id} is outside the idRanges of ${toApp.name}; renumber the object or extend idRanges.`);
    }
    if (["table", "tableextension"].includes(object.type)) {
      warnings.push(`Data of ${object.type} ${object.name} stays in ${fromApp.name} unless it is moved: set ObsoleteState = PendingMove and MovedTo = '${toApp.id}' in ${fromApp.name}, MovedFrom = '${fromApp.id}' in ${toApp.name} (runtime 14.0 or later).`);
    }
  }
  if (object.type === "codeunit") {
    const isSubscriber = (procedure) => (procedure.attributes ?? []).some((attribute) => /\[EventSubscriber\b/iu.test(attribute));
    const subscribers = (object.procedures ?? []).filter(isSubscriber).length;
    const others = (object.procedures ?? []).filter((procedure) => procedure.kind !== "trigger" && !isSubscriber(procedure));
    if (subscribers && others.length) warnings.push(`The codeunit has ${others.length} procedure(s) besides its ${subscribers} event subscriber(s); they move too.`);
  }

  const changes = operations
    .filter((operation) => operation.action !== "edit" || files.get(operation.path) !== original.get(operation.path))
    .map((operation) => ({
    ...operation,
    content: files.get(operation.path),
    expectedHash: original.get(operation.from ?? operation.path) ? sha256(original.get(operation.from ?? operation.path)) : undefined
  }));
  return {
    schema: "bc-atlas.refactor",
    refactoring: "move",
    object: { type: object.type, id: object.id, name: object.name },
    from: { component: current, file: sourceFile, namespace: oldNamespace },
    to: { component: component?.name, file: targetFile, namespace: newNamespace },
    operations: changes,
    diff: changes.map((change) => lineDiff(change.from ?? change.path, change.path, original.get(change.from ?? change.path) ?? "", change.content)).join(""),
    warnings
  };
}

/** Writes a planned refactoring; refuses when a file changed since it was planned. */
export async function applyRefactoring(root, plan) {
  for (const operation of plan.operations) {
    const source = path.join(root, operation.from ?? operation.path);
    if (operation.expectedHash) {
      const text = await fs.readFile(source, "utf8");
      if (sha256(text) !== operation.expectedHash) throw new Error(`${operation.from ?? operation.path} changed since the plan was made; plan again`);
    }
  }
  for (const operation of plan.operations) {
    const target = path.join(root, operation.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, operation.content);
    if (operation.action === "move") await fs.rm(path.join(root, operation.from));
  }
  return plan.operations.map(({ action, from, path: file }) => ({ action, from, path: file }));
}
