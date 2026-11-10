// Source "fact-snapshots": what Business Central produced. A folder with JSON fact sheets
// (schema bc-atlas-sync.fact-snapshot/1) and/or "Download All" ZIPs of the BC Atlas Sync
// extension (all documents of one snapshot). One item per process snapshot.
import fs from "node:fs/promises";
import path from "node:path";
import { readZip } from "../zip.js";
import { kebabId, sha256 } from "../util.js";

export const FACT_SCHEMAS = Object.freeze(["bc-atlas-sync.fact-snapshot/1", "techsync-fact-snapshot/1"]);

// File name suffix (FileSafe of the BC documentation type caption) -> document type id and file name.
const DOCUMENT_TYPES = [
  ["json-fact-sheet", "facts", "facts.json"],
  ["layered-documentation", "layered", "layered.md"],
  ["technical-documentation", "technical", "technical.md"],
  ["user-guide", "user-guide", "user-guide.md"],
  ["sequence-diagram", "sequence", "sequence.mmd"],
  ["object-inventory", "inventory", "inventory.csv"],
  ["page-script", "page-script", "page-script.yml"],
  ["bc-atlas-ui-test", "ui-test", "ui-test.al"],
  ["al-test-codeunit", "ui-test", "ui-test.al"]
];

/** Document type of a file in a BC "Download All" ZIP: <Process>-S<no>-<Doc-Type>.<ext>. */
export function documentType(fileName) {
  const base = path.posix.basename(fileName);
  const match = base.match(/-S\d+-(.+)\.([A-Za-z0-9]+)$/u);
  if (!match) return undefined;
  const suffix = match[1].toLowerCase();
  const known = DOCUMENT_TYPES.find(([prefix]) => suffix.startsWith(prefix));
  if (known) return { type: known[1], file: known[2] };
  const type = kebabId(suffix);
  return { type, file: `${type}.${match[2].toLowerCase()}` };
}

function isFactSheet(value) {
  return value && typeof value === "object" && FACT_SCHEMAS.includes(value.schema) && value.snapshot;
}

function itemFrom(facts, documents, origin) {
  const snapshot = facts.snapshot;
  const process = snapshot.processName ?? `snapshot ${snapshot.no}`;
  const fingerprint = snapshot.fingerprint || sha256(JSON.stringify(facts));
  // The content hash covers facts and documents: "changed" reacts to any difference.
  const contentHash = sha256([
    JSON.stringify(facts),
    ...documents.map(({ type, data }) => `${type}:${sha256(data)}`).sort()
  ].join("\n"));
  return {
    key: kebabId(process),
    process,
    feature: snapshot.feature || process,
    snapshotNo: Number(snapshot.no ?? 0),
    fingerprint,
    driftDetected: Boolean(facts.drift?.detected),
    contentHash,
    facts,
    documents,
    origin
  };
}

async function walk(dir) {
  const result = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return result;
    throw error;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await walk(full));
    else result.push(full);
  }
  return result;
}

/** Loads every snapshot in the folder; warnings for files that are not TechSync/BC Atlas Sync output. */
export async function loadFactSnapshots(root, source) {
  const dir = path.resolve(root, source.path);
  const items = [];
  const warnings = [];
  for (const file of await walk(dir)) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    try {
      if (/\.zip$/iu.test(file)) {
        const entries = readZip(await fs.readFile(file));
        let facts;
        const documents = [];
        for (const entry of entries) {
          if (entry.name.startsWith("raw/")) continue;
          const kind = documentType(entry.name);
          if (/\.json$/iu.test(entry.name)) {
            try {
              const parsed = JSON.parse(entry.data.toString("utf8"));
              if (isFactSheet(parsed)) facts = parsed;
            } catch {
              // not JSON after all: kept as a document below
            }
          }
          if (kind) documents.push({ ...kind, name: entry.name, data: entry.data });
        }
        if (!facts) {
          warnings.push(`${relative}: no JSON fact sheet in the archive`);
          continue;
        }
        items.push(itemFrom(facts, documents, relative));
      } else if (/\.json$/iu.test(file)) {
        const parsed = JSON.parse(await fs.readFile(file, "utf8"));
        if (!isFactSheet(parsed)) {
          warnings.push(`${relative}: not a fact sheet (schema ${parsed?.schema ?? "missing"})`);
          continue;
        }
        const data = Buffer.from(JSON.stringify(parsed));
        items.push(itemFrom(parsed, [{ type: "facts", file: "facts.json", name: path.basename(file), data }], relative));
      }
    } catch (error) {
      warnings.push(`${relative}: ${error.message}`);
    }
  }
  return { items, warnings };
}

/** Keeps the newest snapshot per process ("latest") or all of them. */
export function selectVersions(items, versions) {
  if (versions === "all") {
    return items
      .map((item) => ({ ...item, key: `${item.key}/s${item.snapshotNo}` }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }
  const latest = new Map();
  for (const item of items) {
    const current = latest.get(item.key);
    if (!current || item.snapshotNo > current.snapshotNo) latest.set(item.key, item);
  }
  return [...latest.values()].sort((a, b) => a.key.localeCompare(b.key));
}
