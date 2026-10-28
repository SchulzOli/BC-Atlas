// Locks the public surface of components: objects no other component uses
// get Access = Internal, and the component lists its de facto API in
// `exposes` in .bca.json, so bca check reports any new use of something else.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { lineDiff } from "./diff.js";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const PROPERTY = /^\s*[A-Za-z]+\s*=/u;

/** Inserts `Access = Internal;` as the first property of the object that starts on `line` (1-based). */
export function insertAccessInternal(text, line) {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/u);
  let brace = line - 1;
  while (brace < lines.length && !lines[brace].includes("{")) brace++;
  if (brace >= lines.length) throw new Error(`no object body after line ${line}`);
  const next = lines.slice(brace + 1).find((value) => value.trim());
  const indent = next?.match(/^\s*/u)[0] || "    ";
  const insert = [`${indent}Access = Internal;`];
  // Properties come first; separate the new one from members that follow.
  if (next && !PROPERTY.test(next) && lines[brace + 1]?.trim()) insert.push("");
  lines.splice(brace + 1, 0, ...insert);
  return lines.join(newline);
}

/** Adds `"exposes": [...]` to a component in .bca.json, keeping the file's layout where it can. */
export function setExposes(text, component, exposes) {
  const config = JSON.parse(text);
  const target = config.architecture?.components?.find(({ name }) => name === component);
  if (!target) throw new Error(`component ${component} is not in the configuration`);
  const value = JSON.stringify(exposes).replaceAll("\",\"", "\", \"");
  // A component written on one line: add the property before its closing brace.
  const lines = text.split(/\r?\n/u);
  const index = lines.findIndex((line) => line.includes(`"name": ${JSON.stringify(component)}`) && /\}\s*,?\s*$/u.test(line) && line.trim().startsWith("{"));
  if (index >= 0 && !lines[index].includes('"exposes"')) {
    lines[index] = lines[index].replace(/\s*\}(\s*,?\s*)$/u, `, "exposes": ${value} }$1`);
    const updated = lines.join(text.includes("\r\n") ? "\r\n" : "\n");
    if (JSON.parse(updated).architecture.components.find(({ name }) => name === component).exposes) return updated;
  }
  target.exposes = exposes;
  return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * Plans locking the surface of one component (or every component).
 * @param assessment assessArchitecture result with `result.surface`
 * @param options { component, exposes = true, internal = true }
 */
export async function planSurface(assessment, { component, exposes = true, internal = true } = {}) {
  const { model, result, context } = assessment;
  if (assessment.proposal) throw new Error("no architecture is configured yet; adopt one first (bca architecture --propose --write)");
  const surfaces = result.surface.filter((surface) => !component || surface.component.toLowerCase() === String(component).toLowerCase());
  if (component && !surfaces.length) throw new Error(`no component "${component}"; components: ${result.surface.map((surface) => surface.component).join(", ")}`);
  const root = model.root;
  const files = new Map();
  const original = new Map();
  const read = async (file) => {
    if (!files.has(file)) {
      const text = await fs.readFile(path.join(root, file), "utf8");
      files.set(file, text);
      original.set(file, text);
    }
    return files.get(file);
  };

  const internalized = [];
  if (internal) {
    // Bottom-up per file, so earlier line numbers stay valid.
    const candidates = surfaces.flatMap((surface) => surface.candidates).sort((a, b) => a.file.localeCompare(b.file) || b.line - a.line);
    for (const candidate of candidates) {
      files.set(candidate.file, insertAccessInternal(await read(candidate.file), candidate.line));
      internalized.push(candidate.object);
    }
  }
  const exposed = [];
  const configFile = context.config.path;
  if (exposes) {
    if (!configFile) throw new Error("no .bca.json to write exposes to");
    const relative = path.relative(root, configFile).replaceAll("\\", "/");
    let text = files.get(relative) ?? await fs.readFile(configFile, "utf8");
    if (!original.has(relative)) original.set(relative, text);
    for (const surface of surfaces.filter(({ api }) => api.length)) {
      text = setExposes(text, surface.component, surface.exposes);
      exposed.push({ component: surface.component, exposes: surface.exposes });
    }
    files.set(relative, text);
  }

  const operations = [...files].filter(([file, text]) => text !== original.get(file)).map(([file, text]) => ({
    action: "edit",
    path: file,
    content: text,
    expectedHash: sha256(original.get(file))
  }));
  return {
    schema: "bc-atlas.refactor",
    refactoring: "surface",
    components: surfaces.map((surface) => surface.component),
    internalized,
    exposed,
    warnings: internalized.length ? ["Objects used from outside the analyzed source (test apps, other repositories) need internalsVisibleTo in app.json once they are internal."] : [],
    operations,
    diff: operations.map((operation) => lineDiff(operation.path, operation.path, original.get(operation.path), operation.content)).join("")
  };
}
