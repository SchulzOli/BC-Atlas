import fs from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";

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

function objectsFor(symbols, app, packagePath) {
  const objects = [];
  for (const [collectionName, collection] of Object.entries(symbols)) {
    const type = SYMBOL_TYPES.get(collectionName.toLowerCase());
    if (!type || !Array.isArray(collection)) continue;
    for (const symbol of collection) {
      const name = valueFor(symbol, "Name");
      if (!name) continue;
      objects.push({
        id: String(valueFor(symbol, "Id") ?? "") || undefined,
        name,
        type,
        namespace: valueFor(symbol, "Namespace") ?? "(global)",
        file: `${packagePath}#SymbolReference.json`,
        relations: [],
        procedures: [],
        fields: [],
        actions: [],
        views: [],
        variables: [],
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

export async function loadSymbolPackages(root) {
  const packages = [];
  const objects = [];
  const diagnostics = [];
  for (const packageFile of await findPackages(root)) {
    const reportedPath = path.relative(root, packageFile).replaceAll("\\", "/");
    try {
      const bytes = new Uint8Array(await fs.readFile(packageFile));
      const zipStart = bytes.findIndex((value, index) =>
        value === 0x50 && bytes[index + 1] === 0x4b && bytes[index + 2] === 0x03 && bytes[index + 3] === 0x04
      );
      if (zipStart < 0) throw new Error("ZIP payload not found");
      const archive = unzipSync(bytes.subarray(zipStart));
      const symbolEntry = Object.entries(archive).find(([name]) =>
        name.toLowerCase().endsWith("symbolreference.json")
      );
      if (!symbolEntry) throw new Error("SymbolReference.json not found");
      const symbols = JSON.parse(new TextDecoder().decode(symbolEntry[1]));
      const app = appFor(symbols, reportedPath);
      packages.push(app);
      objects.push(...objectsFor(symbols, app, reportedPath));
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

export const testing = { objectsFor };
