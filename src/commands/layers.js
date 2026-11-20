// `bca layers`: the layered documentation (src/app/layers.js) kept in sync
// with the source.
//
//   docs/layers/
//     README.md, architecture.md, findings.md, apps/, namespaces/, objects/, lenses/, stories/, ...
//
// In sync means: a run changes only the files whose content changed and
// removes the ones it wrote before and no longer writes. --check changes
// nothing and fails when a run would change something.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { buildLayers } from "../app/layers.js";
import { loadLayersProfile } from "../app/layers-profile.js";
import { Workspace } from "../app/workspace.js";
import { UsageError } from "../cli/errors.js";
import { loadConfig } from "../config.js";
import { displayPath } from "../output.js";

export const LAYERS_DEFAULTS = Object.freeze({ outputDir: "docs/layers", pictures: "auto", view: false });
/** Files that hold the BC Atlas that wrote them: written, but not what "in sync" is measured by. */
const NOT_COMPARED = new Set(["view.html"]);
export const LAYERS_PICTURES = Object.freeze(["auto", "all", "none"]);

const digest = (content) => createHash("sha256").update(content).digest("hex");
const readJson = async (file) => JSON.parse(await fs.readFile(file, "utf8"));

/**
 * Brings a folder in line with the files it should hold.
 * @param files Map<relative path, content>
 * @param previous the files a run before wrote there (layers.json), so what is no longer written can go
 * @returns { written, removed, unchanged }: relative paths; with check nothing is touched
 */
async function syncFolder(directory, files, previous = [], { check = false } = {}) {
  const result = { written: [], removed: [], unchanged: [] };
  for (const [file, content] of files) {
    const target = path.join(directory, file);
    const existing = await fs.readFile(target).catch(() => undefined);
    if (existing && (digest(existing) === digest(content) || (check && NOT_COMPARED.has(file)))) {
      result.unchanged.push(file);
      continue;
    }
    result.written.push(file);
    if (check) continue;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  for (const file of previous) {
    // Only what this command wrote itself, and never anything outside the folder.
    if (files.has(file) || path.isAbsolute(file) || file.split(/[\\/]/u).includes("..")) continue;
    const target = path.join(directory, file);
    if (!(await fs.stat(target).catch(() => undefined))) continue;
    result.removed.push(file);
    if (!check) await fs.rm(target, { force: true });
  }
  if (!check) {
    // Folders that became empty go too.
    for (const folder of [...new Set(result.removed.map((file) => path.dirname(file)))].sort((a, b) => b.length - a.length)) {
      if (folder !== ".") await fs.rmdir(path.join(directory, folder)).catch(() => {});
    }
  }
  return result;
}

/**
 * Writes the layered documentation of a project, or checks it.
 * @param input the project
 * @param values { output, check, pictures, view, profile, config, ... } and the analysis options;
 *   profile names a documentation profile of layers.profiles in .bca.json (src/app/layers-profile.js)
 * @returns { output, check, inSync, changed, current: { written, removed, unchanged, manifest, atlas, files, fixed }, profile? }
 */
export async function syncLayers(input, values = {}) {
  const root = path.resolve(values.projectRoot ?? input ?? ".");
  const configured = (await loadConfig(root, values.config).catch(() => undefined))?.values?.layers;
  // What is written, and how. Settings that are not valid write nothing.
  const profile = await loadLayersProfile(root, configured, values.profile);
  const settings = { ...LAYERS_DEFAULTS, ...Object.fromEntries(Object.keys(LAYERS_DEFAULTS).filter((key) => profile[key] !== undefined).map((key) => [key, profile[key]])) };
  const pictures = values.pictures ?? settings.pictures;
  if (!LAYERS_PICTURES.includes(pictures)) throw new UsageError(`--pictures must be one of: ${LAYERS_PICTURES.join(", ")}`);
  const output = values.output ? path.resolve(values.output) : path.resolve(root, settings.outputDir);
  const check = Boolean(values.check);
  const { output: _output, format: _format, view: _view, profile: _profile, check: _check, pictures: _pictures, ...analysis } = values;
  // A folder holds the pages of one profile: a run removes what the run before wrote and this one does not.
  const previous = await readJson(path.join(output, "layers.json")).catch(() => undefined);
  const known = typeof previous?.schema === "string" && previous.schema.startsWith("bc-atlas.layers/");
  if (known && (previous.profile ?? "") !== (profile.name ?? "")) {
    const said = (name) => (name ? `the profile ${name}` : "the settings without a profile");
    throw new UsageError(`${displayPath(output)} holds the pages of ${said(previous.profile)}; a run with ${said(profile.name)} would replace them. Give each profile a folder of its own (outputDir), or delete ${displayPath(path.join(output, "layers.json"))} to give this folder to ${said(profile.name)}`);
  }
  const built = await buildLayers(new Workspace(root, analysis, { live: false }), { pictures, view: Boolean(values.view ?? settings.view), profile });
  const current = { ...(await syncFolder(output, built.files, known ? previous.files : [], { check })), manifest: built.manifest, atlas: built.atlas, files: built.files.size, fixed: built.fixed };
  const changed = [...current.written, ...current.removed];
  return { output, check, inSync: check ? !changed.length : true, changed, current, profile: profile.name };
}

export async function layersCommand(input, values) {
  const result = await syncLayers(input, values);
  const { output, check, current } = result;
  if (values.format === "json") {
    process.stdout.write(`${JSON.stringify({ schema: "bc-atlas.layers-sync/2", output: displayPath(output), ...(result.profile ? { profile: result.profile } : {}), check, inSync: result.inSync,
      current: { written: current.written, removed: current.removed, unchanged: current.unchanged.length, counts: current.manifest.counts } }, null, 2)}\n`);
  } else {
    const counts = current.manifest.counts;
    const lines = [`${current.manifest.title}: ${counts.objects} object(s) in ${counts.apps} app(s), ${counts.namespaces} namespace(s); ${current.files} file(s) in ${displayPath(output)}`];
    lines.push(check
      ? (current.written.length || current.removed.length ? `Not in sync: ${current.written.length} file(s) differ, ${current.removed.length} to remove` : "In sync with the source.")
      : `${current.written.length} written, ${current.removed.length} removed, ${current.unchanged.length} unchanged`);
    for (const file of [...current.written.slice(0, 12).map((name) => `  ${check ? "differs" : "wrote"} ${name}`), ...current.removed.slice(0, 6).map((name) => `  ${check ? "to remove" : "removed"} ${name}`)]) lines.push(file);
    if (current.written.length > 12) lines.push(`  and ${current.written.length - 12} more`);
    if (!check) {
      if (current.fixed.readme) lines.push("", `Start with ${displayPath(path.join(output, current.fixed.readme))}: how it works, how it is connected, and the way down to every object.`);
      lines.push("Keep it in sync: `bca layers --check` fails when the pages differ from the source (a pipeline step).");
    }
    console.error(lines.join("\n"));
  }
  if (check && !result.inSync) process.exitCode = 1;
}
