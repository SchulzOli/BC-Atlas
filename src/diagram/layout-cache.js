// ELK layouts on disk, keyed by the exact graph ELK receives. ELK is
// deterministic, so the same graph always gets the same layout; for a
// diagram of a few hundred objects that layout takes seconds, while reading
// it back takes milliseconds. A Git hook, `bca run`, or an export of an
// unchanged view therefore lays out only what changed. Entries live in the
// BC Atlas cache folder (BCA_CACHE_DIR, default <temp>/bc-atlas) under
// layout/; BCA_LAYOUT_CACHE=off turns the cache off.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// Entries kept; older ones (by last use) are removed when a run writes one.
const MAX_ENTRIES = 2000;
// Bumped when the stored shape changes.
const FORMAT = 1;

let fingerprint;
/** The layout depends on ELK only; its version, or BC Atlas's where ELK is bundled. */
function engineFingerprint() {
  if (fingerprint) return fingerprint;
  let version;
  try {
    version = `elkjs@${createRequire(import.meta.url)("elkjs/package.json").version}`;
  } catch {
    try {
      version = `bc-atlas@${JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version}`;
    } catch {
      version = "unknown";
    }
  }
  return (fingerprint = `${FORMAT}:${version}`);
}

function cacheDirectory() {
  return path.join(process.env.BCA_CACHE_DIR ?? path.join(os.tmpdir(), "bc-atlas"), "layout");
}

const enabled = () => process.env.BCA_LAYOUT_CACHE !== "off";

/** What the renderer reads from an ELK result; the rest is not stored. */
function compact(result) {
  const box = ({ id, x, y, width, height }) => ({ id, x, y, width, height });
  return {
    width: result.width,
    height: result.height,
    children: (result.children ?? []).map((child) => ({
      ...box(child),
      ...(child.children ? { children: child.children.map(box) } : {})
    })),
    edges: (result.edges ?? []).map((edge) => ({
      ...(edge.sections ? {
        sections: edge.sections.map(({ startPoint, bendPoints, endPoint }) => ({ startPoint, ...(bendPoints ? { bendPoints } : {}), endPoint }))
      } : {}),
      ...(edge.labels?.length ? { labels: edge.labels.map(({ x, y, width, height }) => ({ x, y, width, height })) } : {})
    }))
  };
}

let pruned = false;
async function prune(directory) {
  if (pruned) return;
  pruned = true;
  const names = (await fs.readdir(directory)).filter((name) => name.endsWith(".json.gz"));
  if (names.length <= MAX_ENTRIES) return;
  const entries = await Promise.all(names.map(async (name) => {
    const file = path.join(directory, name);
    return { file, used: (await fs.stat(file).catch(() => null))?.mtimeMs ?? 0 };
  }));
  entries.sort((a, b) => a.used - b.used);
  await Promise.all(entries.slice(0, entries.length - MAX_ENTRIES).map(({ file }) => fs.rm(file, { force: true })));
}

/**
 * The layout of `graph`: from the cache, or from `layout(graph)`, stored for
 * the next run. A cache that cannot be read or written only costs the
 * layout; it never fails the diagram.
 */
export async function cachedLayout(graph, layout) {
  if (!enabled()) return compact(await layout(graph));
  const key = createHash("sha256").update(engineFingerprint()).update("\0").update(JSON.stringify(graph)).digest("hex");
  const directory = cacheDirectory();
  const file = path.join(directory, `${key.slice(0, 40)}.json.gz`);
  try {
    const stored = JSON.parse(await gunzip(await fs.readFile(file)));
    if (stored?.key === key) {
      const now = new Date();
      fs.utimes(file, now, now).catch(() => {});
      return stored.layout;
    }
  } catch {
    // Not cached yet, or damaged: lay out again.
  }
  const result = compact(await layout(graph));
  try {
    await fs.mkdir(directory, { recursive: true });
    // A reader never sees half a file.
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, await gzip(JSON.stringify({ key, layout: result }), { level: 1 }));
    await fs.rename(temporary, file).catch(async () => fs.rm(temporary, { force: true }));
    await prune(directory);
  } catch {
    // Read-only or full cache folder: the next run lays out again.
  }
  return result;
}
