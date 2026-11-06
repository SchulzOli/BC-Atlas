import fs from "node:fs/promises";
import path from "node:path";
import { packageCacheFolders, readAlWorkspace } from "./al/settings.js";
import { unzipSync } from "fflate";
import { includedPermissionSets } from "./permission-semantics.js";
import { objectMetadata } from "./metadata.js";

const SYMBOL_TYPES = new Map([
  ["tables", "table"],
  ["tableextensions", "tableextension"],
  ["pages", "page"],
  ["pageextensions", "pageextension"],
  ["pagecustomizations", "pagecustomization"],
  ["codeunits", "codeunit"],
  ["reports", "report"],
  ["reportextensions", "reportextension"],
  ["queries", "query"],
  ["xmlports", "xmlport"],
  ["enums", "enum"],
  ["enumextensions", "enumextension"],
  ["interfaces", "interface"],
  ["permissionsets", "permissionset"],
  ["permissionsetextensions", "permissionsetextension"]
]);

function valueFor(object, ...names) {
  if (!object || typeof object !== "object") return undefined;
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  const entry = Object.entries(object).find(([name]) => wanted.has(name.toLowerCase()));
  return entry?.[1];
}

function appFor(symbols, packagePath) {
  return {
    id: valueFor(symbols, "AppId", "Id"),
    name: valueFor(symbols, "Name") ?? path.basename(packagePath, path.extname(packagePath)),
    publisher: valueFor(symbols, "Publisher"),
    version: valueFor(symbols, "Version"),
    path: packagePath,
    dependencies: valueFor(symbols, "Dependencies") ?? [],
    external: true
  };
}

const list = (value) => Array.isArray(value) ? value : [];

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * What characterizes a symbol (metadata.js), from the properties, fields,
 * keys, and methods SymbolReference.json lists. Only the summary is kept: the
 * Base Application has tens of thousands of fields and methods.
 */
function symbolMetadata(symbol, type) {
  const properties = list(valueFor(symbol, "Properties")).map((property) => ({
    name: valueFor(property, "Name"),
    value: valueFor(property, "Value") === undefined ? undefined : String(valueFor(property, "Value"))
  })).filter(({ name }) => name);
  // Symbols list no local methods; internal ones are flagged.
  const procedures = list(valueFor(symbol, "Methods")).map((method) => {
    const attributes = list(valueFor(method, "Attributes")).map((attribute) => String(valueFor(attribute, "Name") ?? ""));
    return {
      name: valueFor(method, "Name"),
      kind: attributes.some((name) => /^(Integration|Business|Internal)Event$/iu.test(name)) ? "event" : "procedure",
      visibility: valueFor(method, "IsInternal") ? "internal" : valueFor(method, "IsProtected") ? "protected" : "public",
      hasBody: false
    };
  });
  const fields = list(valueFor(symbol, "Fields")).map(() => ({ kind: "field" }));
  const controls = [];
  const walk = (items) => {
    for (const control of list(items)) {
      if (String(valueFor(control, "Kind") ?? "").toLowerCase() === "field" || valueFor(control, "SourceExpression")) controls.push({ kind: "page-field" });
      walk(valueFor(control, "Controls"));
    }
  };
  walk(valueFor(symbol, "Controls"));
  return deepFreeze(objectMetadata({
    type,
    properties,
    procedures,
    fields: type === "page" || type === "pageextension" ? controls : fields,
    keys: list(valueFor(symbol, "Keys")),
    actions: list(valueFor(symbol, "Actions")),
    elements: list(valueFor(symbol, "Values"))
  }));
}

// Newer symbol files nest objects in namespaces:
// { Namespaces: [{ Name: "Microsoft", Namespaces: [{ Name: "Sales", Tables: [...] }] }] }
function* collections(symbols, namespace) {
  for (const [collectionName, collection] of Object.entries(symbols)) {
    const type = SYMBOL_TYPES.get(collectionName.toLowerCase());
    if (type && Array.isArray(collection)) yield { type, collection, namespace };
  }
  for (const child of list(valueFor(symbols, "Namespaces"))) {
    const name = valueFor(child, "Name");
    yield* collections(child, name ? (namespace ? `${namespace}.${name}` : String(name)) : namespace);
  }
}

function objectsFor(symbols, app, packagePath) {
  const objects = [];
  for (const { type, collection, namespace } of collections(symbols)) {
    for (const symbol of collection) {
      const name = valueFor(symbol, "Name");
      if (!name) continue;
      const assignable = type === "permissionset"
        ? String(valueFor(symbol, "Assignable") ?? "false").toLowerCase() === "true"
        : undefined;
      objects.push({
        id: String(valueFor(symbol, "Id") ?? "") || undefined,
        name,
        type,
        namespace: valueFor(symbol, "Namespace") ?? namespace ?? "(global)",
        file: `${packagePath}#SymbolReference.json`,
        relations: ["permissionset", "permissionsetextension"].includes(type)
          ? includedPermissionSets(valueFor(symbol, "IncludedPermissionSets"))
          : [],
        procedures: [],
        fields: [],
        actions: [],
        views: [],
        variables: [],
        assignable,
        objectAccess: ["permissionset", "permissionsetextension"].includes(type)
          ? String(valueFor(symbol, "Access") ?? "public").toLowerCase()
          : undefined,
        metadata: symbolMetadata(symbol, type),
        app,
        externalSymbol: true
      });
    }
  }
  return objects;
}

async function findPackages(root) {
  const packages = [];
  async function visit(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".alpackages") {
          const packageEntries = await fs.readdir(entryPath, { withFileTypes: true });
          packages.push(...packageEntries
            .filter((item) => item.isFile() && path.extname(item.name).toLowerCase() === ".app")
            .map((item) => path.join(entryPath, item.name)));
        } else if (!new Set([".git", "node_modules", ".alcache"]).has(entry.name)) {
          await visit(entryPath);
        }
      }
    }
  }
  await visit(root);
  return packages.sort();
}

async function packagesIn(folder) {
  try {
    const entries = await fs.readdir(folder, { withFileTypes: true });
    return entries
      .filter((item) => item.isFile() && path.extname(item.name).toLowerCase() === ".app")
      .map((item) => path.join(folder, item.name));
  } catch {
    return [];
  }
}

/**
 * Reads SymbolReference.json from every .app in the `.alpackages` folders
 * below `root` and in `folders` (the package cache paths from
 * `al.packageCachePath`). The same app version in several caches loads once.
 */
// Parsed packages by file, path relative to the root, size, and modification
// time: a Base Application takes seconds to unzip and parse, and every page
// of the app (health, architecture, explorer) loads the same packages.
const packageCache = new Map();

async function readPackage(packageFile, reportedPath) {
  const stat = await fs.stat(packageFile);
  const key = `${packageFile}\u0000${reportedPath}`;
  const stamp = `${stat.size}:${stat.mtimeMs}`;
  const cached = packageCache.get(key);
  if (cached?.stamp === stamp) return cached.value;
  const bytes = new Uint8Array(await fs.readFile(packageFile));
  let zipStart = -1;
  for (let index = 0; index + 3 < bytes.length; index++) {
    if (bytes[index] === 0x50 && bytes[index + 1] === 0x4b && bytes[index + 2] === 0x03 && bytes[index + 3] === 0x04) {
      zipStart = index;
      break;
    }
  }
  if (zipStart < 0) throw new Error("ZIP payload not found");
  const archive = unzipSync(bytes.subarray(zipStart), {
    filter: ({ name }) => name.toLowerCase().endsWith("symbolreference.json")
  });
  const symbolEntry = Object.entries(archive).find(([name]) =>
    name.toLowerCase().endsWith("symbolreference.json")
  );
  if (!symbolEntry) throw new Error("SymbolReference.json not found");
  const symbols = JSON.parse(new TextDecoder().decode(symbolEntry[1]));
  const app = appFor(symbols, reportedPath);
  const value = { app, objects: objectsFor(symbols, app, reportedPath) };
  packageCache.set(key, { stamp, value });
  return value;
}

/** Fresh copies, so callers may change what they get without touching the cache. */
function copyPackage({ app, objects }) {
  const copy = { ...app, dependencies: [...app.dependencies] };
  return {
    app: copy,
    objects: objects.map((object) => ({
      ...object,
      relations: object.relations.map((relation) => ({ ...relation })),
      procedures: [],
      fields: [],
      actions: [],
      views: [],
      variables: [],
      app: copy
    }))
  };
}

export async function loadSymbolPackages(root, { folders = [] } = {}) {
  const packages = [];
  const objects = [];
  const diagnostics = [];
  const files = new Set(await findPackages(root));
  for (const folder of folders) for (const file of await packagesIn(folder)) files.add(file);
  const loaded = new Set();
  for (const packageFile of [...files].sort()) {
    const reportedPath = path.relative(root, packageFile).replaceAll("\\", "/");
    try {
      const parsed = await readPackage(packageFile, reportedPath);
      const identity = `${parsed.app.id ?? parsed.app.name}@${parsed.app.version ?? ""}`.toLowerCase();
      if (loaded.has(identity)) continue;
      loaded.add(identity);
      const { app, objects: packageObjects } = copyPackage(parsed);
      packages.push(app);
      for (const object of packageObjects) objects.push(object);
    } catch (error) {
      diagnostics.push({
        severity: "warning",
        code: "symbol-package-error",
        message: `Could not read symbol package ${reportedPath}: ${error.message}`,
        file: reportedPath
      });
    }
  }
  return { packages, objects, diagnostics };
}

/** Symbols for a project: `.alpackages` below it plus the configured package caches. */
export async function loadProjectSymbols(root, al) {
  return loadSymbolPackages(root, { folders: await packageCacheFolders(await readAlWorkspace(root, al)) });
}

export const testing = { objectsFor };
