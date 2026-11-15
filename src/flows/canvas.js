// The canvas of the flow builder: where its nodes are, and what is on it without being part of a
// flow yet. The flows themselves are in .bca.json; this is how they are laid out to build on, kept
// next to it in .bca/flow-canvas.json so the picture is the same for everyone who opens it.
//
//   {
//     "positions": { "flow:docs": [260, 40], "step:docs/system": [510, 40], "trigger:ci": [40, 40] },
//     "loose": [{ "key": "loose:1", "step": { "what": "handbook", "language": "de" } }],
//     "triggers": ["schedule"]
//   }
//
// positions: a node by its key (flow:<id>, trigger:<name>, step:<the place it saves to>,
// gate:<flow>:<artifact>:<n> for a step that saves nothing, loose:<n>) and its x and y.
// loose: steps on the canvas that no flow makes yet; those that left a flow together share a group and keep their wires. triggers: triggers on the canvas that start no flow yet.
import fs from "node:fs/promises";
import path from "node:path";
import { TRIGGERS } from "../automation/config.js";

export const CANVAS_FILE = ".bca/flow-canvas.json";
const MOST = 500;
const EMPTY = Object.freeze({ positions: {}, loose: [], triggers: [] });

/** What of a canvas is kept: plain data in its shape, nothing else. */
export function normalizeCanvas(canvas = {}) {
  const positions = {};
  for (const [key, value] of Object.entries(canvas.positions ?? {}).slice(0, MOST)) {
    if (typeof key !== "string" || key.length > 300 || !Array.isArray(value)) continue;
    const [x, y] = value.map(Number);
    if (Number.isFinite(x) && Number.isFinite(y)) positions[key] = [Math.round(x), Math.round(y)];
  }
  const loose = [];
  const seen = new Set();
  for (const entry of (Array.isArray(canvas.loose) ? canvas.loose : []).slice(0, MOST)) {
    const step = entry?.step;
    if (typeof entry?.key !== "string" || seen.has(entry.key) || !step || typeof step !== "object" || Array.isArray(step) || typeof step.what !== "string") continue;
    seen.add(entry.key);
    // The wires of a step that left a flow with others come along, to wire them back together.
    const after = (Array.isArray(step.after) ? step.after : []).flatMap((wire) => (typeof wire === "string" ? [wire] : typeof wire?.step === "string" ? [{ step: wire.step, ...(typeof wire.if === "string" ? { if: wire.if } : {}) }] : []));
    loose.push({
      key: entry.key,
      step: { ...Object.fromEntries(Object.entries(step).filter(([, value]) => ["string", "number", "boolean"].includes(typeof value) && value !== "")), ...(after.length ? { after } : {}) },
      ...(typeof entry.group === "string" ? { group: entry.group } : {})
    });
  }
  const triggers = [...new Set((Array.isArray(canvas.triggers) ? canvas.triggers : []).filter((name) => Object.hasOwn(TRIGGERS, name)))];
  return { positions: Object.fromEntries(Object.entries(positions).sort(([a], [b]) => a.localeCompare(b))), loose, triggers };
}

/** The canvas of a project, or an empty one. */
export async function readFlowCanvas(root) {
  try {
    return normalizeCanvas(JSON.parse(await fs.readFile(path.join(root, CANVAS_FILE), "utf8")));
  } catch {
    // Without a file, or with one that cannot be read, the builder lays the flows out itself.
    return structuredClone(EMPTY);
  }
}

/**
 * Keeps the canvas of a project. An empty canvas needs no file.
 * @returns { file, written, canvas }
 */
export async function writeFlowCanvas(root, canvas) {
  const file = path.join(root, CANVAS_FILE);
  const next = normalizeCanvas(canvas);
  const content = `${JSON.stringify(next, null, 2)}\n`;
  if (!Object.keys(next.positions).length && !next.loose.length && !next.triggers.length) {
    const existed = await fs.rm(file).then(() => true, () => false);
    return { file, written: existed, canvas: next };
  }
  if (await fs.readFile(file, "utf8").catch(() => undefined) === content) return { file, written: false, canvas: next };
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
  return { file, written: true, canvas: next };
}
