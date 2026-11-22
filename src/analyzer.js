// Reads an AL project: every .al file below a folder, parsed with tree-sitter
// into objects with their members and relations (src/analyzer/), the apps
// and modules they belong to (app.json), and the symbol packages they use.
// Parse results are cached by content (src/parse-cache.js).
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Parser } from "web-tree-sitter";
import { loadProjectSymbols } from "./symbols.js";
import { documentationComment, objectMetadata } from "./metadata.js";
import { dataOperationRelations, helperDataOperationRelations, membersFor, subscriberRelations } from "./analyzer/members.js";
import { referencesFor } from "./analyzer/references.js";
import { EXTENSION_TARGET, fieldText, getLanguage, headerOf, locationFor, nodeText, objectType, preprocessorConditions, propertiesFor, propertyValue, splitConditions, walk } from "./analyzer/syntax.js";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".alpackages",
  ".snapshots",
  "node_modules",
  "dist",
  "out"
]);

async function objectsFromSource(source, file) {
  const language = await getLanguage();
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(source);
  const namespaceNode = tree.rootNode.namedChildren.find(
    (node) => node.type === "namespace_declaration"
  );
  const namespace = namespaceNode
    ? fieldText(namespaceNode, "name", source) ?? "(global)"
    : "(global)";
  const usings = tree.rootNode.namedChildren
    .filter((node) => node.type === "using_statement")
    .map((node) => fieldText(node, "namespace", source))
    .filter(Boolean);
  const objects = [];

  walk(tree.rootNode, (node) => {
    const type = objectType(node);
    if (!type) return;

    const declaration = headerOf(node);
    const name = nodeText(declaration.field("object_name"), source);
    if (!name) return;

    const id = nodeText(declaration.field("object_id"), source);
    let base = nodeText(declaration.field("base_object"), source);
    if (type === "pagecustomization") base = nodeText(declaration.field("target_page"), source);
    if (type === "interface") base = nodeText(declaration.field("extends_interface"), source);

    const relations = referencesFor(node, source, file);
    // The branches of a split header may extend different objects: one
    // relation each, with the condition of its branch.
    const otherBases = new Map();
    if (declaration.split && base) {
      for (const baseNode of node.childrenForFieldName("base_object")) {
        const target = nodeText(baseNode, source);
        const key = target.toLowerCase();
        if (key !== base.toLowerCase() && !otherBases.has(key)) otherBases.set(key, { target, baseNode });
      }
    }
    if (base) {
      relations.push({
        target: base,
        targetType: type === "interface" ? "interface" : EXTENSION_TARGET[type],
        kind: "extends",
        relationClass: "schema",
        ...(otherBases.size
          ? { conditionalSymbols: preprocessorConditions(declaration.field("base_object"), source) }
          : {}),
        location: locationFor(node, file)
      });
    }
    for (const { target, baseNode } of otherBases.values()) {
      relations.push({
        target,
        targetType: EXTENSION_TARGET[type],
        kind: "extends",
        relationClass: "schema",
        conditionalSymbols: preprocessorConditions(baseNode, source),
        location: locationFor(baseNode, file)
      });
    }
    const members = membersFor(node, source, file);
    const properties = propertiesFor(node, source);
    const sourceTableTemporary = /^true$/iu.test(
      propertyValue(properties, "sourcetabletemporary") ?? "false"
    );
    relations.push(...subscriberRelations(members.procedures));
    const dataRelations = dataOperationRelations(members, {
      type,
      name,
      base,
      relations,
      sourceTableTemporary
    });
    relations.push(...dataRelations, ...helperDataOperationRelations(members, dataRelations));

    const assignableValue = type === "permissionset"
      ? propertyValue(properties, "assignable")
      : undefined;
    const objectAccess = ["permissionset", "permissionsetextension"].includes(type)
      ? propertyValue(properties, "access")?.toLowerCase() ?? "public"
      : undefined;
    objects.push({
      id,
      name,
      type,
      namespace,
      usings,
      file,
      properties,
      relations,
      procedures: members.procedures,
      fields: members.fields,
      parts: members.parts,
      actions: members.actions,
      views: members.views,
      elements: members.elements,
      keys: members.keys,
      primaryKeyFields: members.keys[0]?.fields ?? [],
      variables: members.variables,
      transactionBoundaries: members.transactionBoundaries,
      assignable: type === "permissionset" ? /^true$/iu.test(assignableValue ?? "false") : undefined,
      objectAccess,
      ...splitConditions(declaration, source),
      location: locationFor(node, file),
      parseError: node.hasError
    });
    objects.at(-1).metadata = objectMetadata({
      ...objects.at(-1),
      documentation: documentationComment(source, declaration.start)
    });
  });

  const result = { objects, hasError: tree.rootNode.hasError };
  tree.delete();
  parser.delete();
  return result;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Reflect.ownKeys(value)) deepFreeze(value[key]);
  }
  return value;
}

/**
 * What a caller gets of a cached parse result: the objects copied one level
 * deep. analyze() sets `app` and `module` on each object and the resolver its
 * `key`; nothing below that level is written (the tests freeze the cached
 * results, BCA_FREEZE_PARSE, so a write there throws). A deep copy of every
 * file took a third of the time of a warm analysis.
 */
function copyResult(result) {
  if (process.env.BCA_FREEZE_PARSE) deepFreeze(result);
  return { ...result, objects: result.objects.map((object) => ({ ...object })) };
}

async function cachedObjectsFromSource(source, file, cache) {
  if (!cache) return objectsFromSource(source, file);
  const key = `${file}\u0000${createHash("sha1").update(source).digest("hex")}`;
  if (!cache.has(key)) cache.set(key, await objectsFromSource(source, file));
  return copyResult(cache.get(key));
}

async function collectAlFiles(input) {
  const absolute = path.resolve(input);
  const stat = await fs.stat(absolute);
  if (stat.isFile()) {
    if (path.extname(absolute).toLowerCase() !== ".al") {
      throw new Error(`Input file is not an AL source file: ${absolute}`);
    }
    return [absolute];
  }

  const files = [];
  async function visit(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(entryPath);
      else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".al") {
        files.push(entryPath);
      }
    }
  }
  await visit(absolute);
  return files.sort();
}

async function manifestAt(candidate, boundary, cache) {
  if (cache.has(candidate)) return cache.get(candidate);
  let app;
  try {
    const data = JSON.parse(await fs.readFile(candidate, "utf8"));
    app = {
      id: data.id,
      name: data.name,
      publisher: data.publisher,
      version: data.version,
      path: path.relative(boundary, candidate).replaceAll("\\", "/") || "app.json",
      root: path.dirname(candidate),
      dependencies: data.dependencies ?? []
    };
  } catch {
    app = undefined;
  }
  cache.set(candidate, app);
  return app;
}

const outside = (boundary, directory) => {
  const relative = path.relative(boundary, directory);
  return relative.startsWith("..") || path.isAbsolute(relative);
};

/**
 * Finds the app that compiles a file and, when app.json files are nested, the
 * module it belongs to. The AL compiler builds every file below an app
 * folder, so a nested app.json (as in BCApps' System Application or Base
 * Application) marks a module of the outer app, not an app of its own. Above
 * the analyzed root only the nearest manifest counts.
 */
async function readAppManifest(file, root, cache) {
  const boundary = (await fs.stat(root)).isDirectory() ? root : path.dirname(root);
  const found = [];
  let directory = path.dirname(file);
  while (true) {
    const app = await manifestAt(path.join(directory, "app.json"), boundary, cache);
    if (app) found.push(app);
    const parent = path.dirname(directory);
    if (parent === directory || (found.length && outside(boundary, parent))) break;
    directory = parent;
  }
  if (!found.length) return {};
  return { app: found.at(-1), module: found.length > 1 ? found[0] : undefined };
}

/**
 * Parses every AL file below `input`. Pass a shared `parseCache` Map to reuse
 * parse results for unchanged file content across calls (the editor, --watch),
 * preloaded `symbols` to skip reading .alpackages again, and a
 * `fileFilter` for root-relative paths to analyze part of a large repository.
 */
/** The contents of the files, in their order, a few at a time. */
async function readAll(files, parallel = 32) {
  const contents = new Array(files.length);
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const at = next++;
      contents[at] = await fs.readFile(files[at], "utf8");
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, files.length) }, worker));
  return contents;
}

export async function analyze(input, { parseCache, symbols: preloadedSymbols, fileFilter, al } = {}) {
  const root = path.resolve(input);
  const rootStat = await fs.stat(root);
  const base = rootStat.isDirectory() ? root : path.dirname(root);
  const files = (await collectAlFiles(root))
    .filter((file) => !fileFilter || fileFilter(path.relative(base, file).replaceAll("\\", "/")));
  const objects = [];
  const parseErrors = [];
  const diagnostics = [];
  const manifestCache = new Map();
  const apps = new Map();
  const modules = new Map();
  // Read in parallel, in order: one file after the other was a third of a warm analysis.
  const sources = await readAll(files);

  for (const [at, file] of files.entries()) {
    const source = sources[at];
    // Forward slashes on every system: the same source gives the same output on Windows and Linux.
    const relativeFile = path.relative(base, file).replaceAll("\\", "/");
    const result = await cachedObjectsFromSource(source, relativeFile || path.basename(file), parseCache);
    objects.push(...result.objects);
    const { app, module } = await readAppManifest(file, root, manifestCache);
    if (app) {
      apps.set(app.id ?? app.name, app);
      for (const object of result.objects) object.app = app;
    }
    if (module) {
      modules.set(module.id ?? module.name, { ...module, app: app.id ?? app.name });
      const reference = { id: module.id, name: module.name, path: module.path };
      for (const object of result.objects) object.module = reference;
    }
    if (result.hasError) {
      const reportedFile = relativeFile || path.basename(file);
      parseErrors.push(reportedFile);
      diagnostics.push({
        severity: "error",
        code: "parse-error",
        message: "tree-sitter reported one or more syntax errors",
        file: reportedFile
      });
    }
  }

  const symbols = preloadedSymbols ?? await loadProjectSymbols(base, al);
  // An app of the workspace may also lie compiled in a package cache (App A's
  // .app in the .alpackages of App B that depends on it). The source is what
  // is analyzed; its symbols would only duplicate every object of the app.
  const appKey = (app) => String(app?.id ?? app?.name ?? "").toLowerCase();
  const sourceApps = new Set([...apps.values()].map(appKey).filter(Boolean));
  const shadowed = new Set();
  for (const app of symbols.packages) {
    if (sourceApps.has(appKey(app))) {
      shadowed.add(appKey(app));
      diagnostics.push({
        severity: "info",
        code: "symbol-package-shadowed",
        message: `Symbol package ${app.path} (${[app.name, app.version].filter(Boolean).join(" ")}) is ignored: the workspace contains the source of this app`,
        file: app.path
      });
    } else {
      apps.set(app.id ?? app.name, app);
    }
  }
  for (const object of symbols.objects) if (!shadowed.has(appKey(object.app))) objects.push(object);
  diagnostics.push(...symbols.diagnostics);

  return {
    schemaVersion: 1,
    root,
    files: files.length,
    apps: [...apps.values()],
    ...(modules.size ? { modules: [...modules.values()] } : {}),
    symbolPackages: symbols.packages.filter((app) => !shadowed.has(appKey(app))),
    objects,
    parseErrors,
    diagnostics
  };
}

export const testing = { objectsFromSource };
