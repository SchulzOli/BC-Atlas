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
  // The names SymbolReference.json uses.
  ["enumtypes", "enum"],
  ["enumextensiontypes", "enumextension"],
  ["profiles", "profile"],
  ["profileextensions", "profileextension"],
  ["controladdins", "controladdin"],
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
// Page control kinds in SymbolReference.json: 8 is a field.
const FIELD_CONTROL = 8;

function symbolMetadata(symbol, type) {
  const properties = list(valueFor(symbol, "Properties")).map((property) => {
    const name = valueFor(property, "Name");
    let value = valueFor(property, "Value") === undefined ? undefined : String(valueFor(property, "Value"));
    // Symbols write application areas as #Basic, #Suite.
    if (value && /^applicationarea$/iu.test(name ?? "")) value = value.replace(/#/gu, "");
    return { name, value };
  }).filter(({ name }) => name);
  const procedures = list(valueFor(symbol, "Methods")).map((method) => {
    const attributes = list(valueFor(method, "Attributes")).map((attribute) => String(valueFor(attribute, "Name") ?? ""));
    return {
      name: valueFor(method, "Name"),
      kind: attributes.some((name) => /^(Integration|Business|Internal)Event$/iu.test(name)) ? "event" : "procedure",
      visibility: valueFor(method, "IsLocal") ? "local" : valueFor(method, "IsInternal") ? "internal" : valueFor(method, "IsProtected") ? "protected" : "public",
      hasBody: false
    };
  });
  const fields = list(valueFor(symbol, "Fields")).map(() => ({ kind: "field" }));
  const controls = [];
  const walkControls = (items) => {
    for (const control of list(items)) {
      const kind = valueFor(control, "Kind");
      const sourced = list(valueFor(control, "Properties")).some((property) => /^sourceexpression$/iu.test(valueFor(property, "Name") ?? ""));
      if (kind === FIELD_CONTROL || String(kind).toLowerCase() === "field" || sourced) controls.push({ kind: "page-field" });
      walkControls(valueFor(control, "Controls"));
    }
  };
  walkControls(valueFor(symbol, "Controls"));
  // Actions sit in groups; only the ones without children are actions.
  const actions = [];
  const walkActions = (items) => {
    for (const action of list(items)) {
      const children = list(valueFor(action, "Actions"));
      if (children.length) walkActions(children);
      else actions.push({ kind: "action" });
    }
  };
  walkActions(valueFor(symbol, "Actions"));
  return objectMetadata({
    type,
    properties,
    procedures,
    fields: type === "page" || type === "pageextension" ? controls : fields,
    keys: list(valueFor(symbol, "Keys")),
    actions,
    elements: list(valueFor(symbol, "Values"))
  });
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
  const tableNames = new Map();
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
      if (type === "table") tableNames.set(String(valueFor(symbol, "Id") ?? ""), name);
    }
  }
  // Symbols name a page's source table by its ID.
  for (const object of objects) {
    const source = object.metadata.sourceTable;
    if (source && /^\d+$/u.test(source) && tableNames.has(source)) object.metadata.sourceTable = tableNames.get(source);
    deepFreeze(object.metadata);
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

/** 26.0.12345.0 > 26.0.9999.0 > 25.5: numeric parts, left to right. */
export function compareVersions(a, b) {
  const parts = (value) => String(value ?? "").split(/[.\-+]/u).map((part) => /^\d+$/u.test(part) ? Number(part) : part);
  const left = parts(a);
  const right = parts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const x = left[index] ?? 0;
    const y = right[index] ?? 0;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    return String(x).localeCompare(String(y));
  }
  return 0;
}

/**
 * Every .app once per app: when a cache holds several versions of the same
 * app (Base Application 26.0 and 27.0), only the newest loads, as the AL
 * compiler picks it. Otherwise every reference to Customer or Item would
 * match two tables and be reported as ambiguous.
 */
export async function loadSymbolPackages(root, { folders = [] } = {}) {
  const diagnostics = [];
  const files = new Set(await findPackages(root));
  for (const folder of folders) for (const file of await packagesIn(folder)) files.add(file);
  const newest = new Map();
  for (const packageFile of [...files].sort()) {
    const reportedPath = path.relative(root, packageFile).replaceAll("\\", "/");
    try {
      const parsed = await readPackage(packageFile, reportedPath);
      const identity = String(parsed.app.id ?? parsed.app.name).toLowerCase();
      const current = newest.get(identity);
      if (current && compareVersions(current.app.version, parsed.app.version) >= 0) {
        if (current.app.version !== parsed.app.version) diagnostics.push(superseded(parsed.app, current.app));
        continue;
      }
      if (current) diagnostics.push(superseded(current.app, parsed.app));
      newest.set(identity, parsed);
    } catch (error) {
      diagnostics.push({
        severity: "warning",
        code: "symbol-package-error",
        message: `Could not read symbol package ${reportedPath}: ${error.message}`,
        file: reportedPath
      });
    }
  }
  const packages = [];
  const objects = [];
  for (const parsed of newest.values()) {
    const { app, objects: packageObjects } = copyPackage(parsed);
    packages.push(app);
    for (const object of packageObjects) objects.push(object);
  }
  return { packages, objects, diagnostics };
}

function superseded(older, newer) {
  return {
    severity: "info",
    code: "symbol-package-superseded",
    message: `Symbol package ${older.path} (${older.name} ${older.version}) is ignored: ${newer.path} has the newer version ${newer.version}`,
    file: older.path
  };
}

/** Symbols for a project: `.alpackages` below it plus the configured package caches. */
export async function loadProjectSymbols(root, al) {
  return loadSymbolPackages(root, { folders: await packageCacheFolders(await readAlWorkspace(root, al)) });
}

export const testing = { objectsFor };
