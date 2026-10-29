// Parse results on disk, so an editor that opens a project again skips
// tree-sitter for every file whose content has not changed. One file per
// project in the BC Atlas cache folder (BCA_CACHE_DIR, default
// <temp>/bc-atlas), next to the AL compiler's results.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import v8 from "node:v8";
import zlib from "node:zlib";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// Parse results depend on the parser and the grammar; a change to either
// starts over. In the bundled extension the modules are inlined (and the
// version changes with them), so only the files that exist count.
const ENGINE_FILES = ["../package.json", "./analyzer.js", "./operation-semantics.js", "./permission-semantics.js", "../vendor/tree-sitter-al.wasm"];
let engine;
function engineFingerprint() {
  if (engine) return engine;
  const hash = createHash("sha1");
  for (const file of ENGINE_FILES) {
    try {
      hash.update(readFileSync(new URL(file, import.meta.url)));
    } catch {
      hash.update(`missing:${file}`);
    }
  }
  return (engine = hash.digest("hex"));
}

export function parseCacheFile(root) {
  const key = createHash("sha1").update(path.resolve(root)).digest("hex").slice(0, 16);
  return path.join(process.env.BCA_CACHE_DIR ?? path.join(os.tmpdir(), "bc-atlas"), "parse", `${key}.bin`);
}

/**
 * The `parseCache` for analyze(): a Map of parse results by file and content
 * hash that remembers which entries a run used, so save() keeps only those
 * (files deleted or changed since drop out).
 */
export class ParseCache extends Map {
  constructor(file, entries = []) {
    super();
    for (const [key, value] of entries) super.set(key, value);
    this.file = file;
    this.used = new Set();
    this.changed = false;
  }

  get(key) {
    this.used.add(key);
    return super.get(key);
  }

  set(key, value) {
    this.used.add(key);
    this.changed = true;
    return super.set(key, value);
  }

  /** Writes the entries used since the last save, when anything changed. */
  async save() {
    for (const key of this.keys()) {
      if (this.used.has(key)) continue;
      this.delete(key);
      this.changed = true;
    }
    this.used = new Set();
    if (!this.changed || !this.file) return false;
    this.changed = false;
    const data = await gzip(v8.serialize({ engine: engineFingerprint(), entries: [...this.entries()] }), { level: 1 });
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    // A reader never sees half a file.
    const temporary = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, data);
    await fs.rename(temporary, this.file).catch(async (error) => {
      await fs.rm(temporary, { force: true });
      throw error;
    });
    return true;
  }
}

/** Opens the parse cache of the project at `root`; an unreadable or outdated file starts empty. */
export async function openParseCache(root) {
  const file = parseCacheFile(root);
  try {
    const data = v8.deserialize(await gunzip(await fs.readFile(file)));
    if (data?.engine === engineFingerprint() && Array.isArray(data.entries)) return new ParseCache(file, data.entries);
  } catch {
    // Missing, from another version, or damaged: parse again.
  }
  return new ParseCache(file);
}
