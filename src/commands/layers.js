// `bca layers`: the layered documentation (src/app/layers.js) kept in sync
// with the source. The pages of the working tree are written into a folder;
// a commit, a tag, or a release gets the same pages under history/, so the
// system can be read as it is and as it was.
//
//   docs/layers/                 the source as it is now
//     README.md, apps/, components/, namespaces/, objects/, lenses/, stories/, ...
//     history/README.md          every recorded state, and what changed between them
//     history/v0.18.0/           the same pages for that tag
//
// In sync means: a run changes only the files whose content changed and
// removes the ones it wrote before and no longer writes. --check changes
// nothing and fails when a run would change something.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildLayers, historyIndex, LAYERS_SCHEMA } from "../app/layers.js";
import { Workspace } from "../app/workspace.js";
import { findGitRoot, git } from "../automation/git.js";
import { UsageError } from "../cli/errors.js";
import { loadConfig } from "../config.js";
import { displayPath } from "../output.js";

export const LAYERS_DEFAULTS = Object.freeze({ outputDir: "docs/layers", pictures: "auto", history: "none", view: false });
/** Files that hold the BC Atlas that wrote them: written, but not what "in sync" is measured by. */
const NOT_COMPARED = new Set(["view.html"]);
export const LAYERS_PICTURES = Object.freeze(["auto", "all", "none"]);
export const LAYERS_HISTORY = Object.freeze(["none", "releases"]);

const several = (value) => [value ?? []].flat().flatMap((item) => String(item).split(",")).map((item) => item.trim()).filter(Boolean);
const digest = (content) => createHash("sha256").update(content).digest("hex");
const readJson = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
/** The folder of a state below history/: the name of the tag or commit, as far as a file name allows. */
const folderOf = (label) => String(label).replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/^[-.]+|-+$/gu, "") || "state";

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

/** What a commit, tag, or release is: its commit and the date of that commit. */
function resolveState(repository, ref) {
  const commit = git(repository, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  if (commit.status !== 0) throw new UsageError(`--at "${ref}" names no commit, tag, or release of this repository${/^[0-9a-f]{7,40}$/iu.test(ref) ? "" : "; a clone without history (fetch-depth 1) does not have its tags"}`);
  const sha = commit.stdout.trim();
  const date = git(repository, ["show", "-s", "--format=%cI", sha]).stdout.trim();
  return { ref, label: /^[0-9a-f]{7,40}$/iu.test(ref) && sha.startsWith(ref.toLowerCase()) ? sha.slice(0, 10) : ref, commit: sha, date };
}

/** The tags of the repository that the current commit descends from, the oldest first. */
function releaseTags(repository) {
  const result = git(repository, ["tag", "--merged", "HEAD", "--sort=creatordate"]);
  if (result.status !== 0) throw new Error(`git tag failed: ${result.stderr.trim()}`);
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

/** Runs `build` on a checkout of the project as it was at a commit, and removes the checkout again. */
async function atCommit(repository, root, commit, build) {
  // The checkout has the name of the repository, so a project that is named after its folder keeps its name.
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "bc-atlas-layers-"));
  const checkout = path.join(temporary, path.basename(repository));
  const added = git(repository, ["worktree", "add", "--detach", "--force", checkout, commit]);
  if (added.status !== 0) {
    await fs.rm(temporary, { recursive: true, force: true });
    throw new Error(`git worktree add failed: ${added.stderr.trim()}`);
  }
  try {
    const project = path.join(checkout, path.relative(repository, root));
    if (!(await fs.stat(project).catch(() => undefined))) return undefined;
    return await build(project);
  } finally {
    git(repository, ["worktree", "remove", "--force", checkout]);
    await fs.rm(temporary, { recursive: true, force: true });
    git(repository, ["worktree", "prune"]);
  }
}

/**
 * Writes the layered documentation of the working tree and of the asked states, or checks it.
 * @param input the project
 * @param values { output, at, releases, last, refresh, check, pictures, view, config, ... } and the analysis options
 * @returns { output, inSync, check, current?, states: [{ label, commit, folder, status, written, removed }], history? }
 */
export async function syncLayers(input, values = {}) {
  const root = path.resolve(values.projectRoot ?? input ?? ".");
  const settings = { ...LAYERS_DEFAULTS, ...((await loadConfig(root, values.config).catch(() => undefined))?.values?.layers ?? {}) };
  const pictures = values.pictures ?? settings.pictures;
  if (!LAYERS_PICTURES.includes(pictures)) throw new UsageError(`--pictures must be one of: ${LAYERS_PICTURES.join(", ")}`);
  if (!LAYERS_HISTORY.includes(settings.history)) throw new UsageError(`layers.history in .bca.json must be one of: ${LAYERS_HISTORY.join(", ")}`);
  const output = values.output ? path.resolve(values.output) : path.resolve(root, settings.outputDir);
  const check = Boolean(values.check);
  const { output: _output, format: _format, at: _at, view: _view, ...analysis } = values;
  const historyFolder = path.join(output, "history");

  // Which states of the source are asked for besides the working tree.
  const asked = several(values.at);
  const releases = Boolean(values.releases) || (settings.history === "releases" && !asked.length);
  const repository = asked.length || releases ? await findGitRoot(root) : undefined;
  if ((asked.length || values.releases) && !repository) throw new UsageError("--at and --releases need a Git repository");
  let refs = asked;
  if (releases && repository) {
    let tags = releaseTags(repository);
    if (values.last !== undefined) {
      if (!/^[1-9]\d*$/u.test(String(values.last))) throw new UsageError("--last must be a number of releases, 1 or more");
      tags = tags.slice(-Number(values.last));
    }
    refs = [...new Set([...asked, ...tags])];
  }

  const states = [];
  for (const ref of refs) {
    const state = resolveState(repository, ref);
    const folder = folderOf(state.label);
    const directory = path.join(historyFolder, folder);
    const recorded = await readJson(path.join(directory, "layers.json")).catch(() => undefined);
    const entry = { label: state.label, commit: state.commit, folder: `history/${folder}`, written: [], removed: [] };
    states.push(entry);
    // A recorded state does not change: its commit is what it is.
    if (recorded?.schema === LAYERS_SCHEMA && recorded.state?.commit === state.commit && !values.refresh) {
      entry.status = "recorded";
      continue;
    }
    if (check) {
      entry.status = "missing";
      continue;
    }
    const built = await atCommit(repository, root, state.commit, (project) => buildLayers(new Workspace(project, { ...analysis, projectRoot: undefined }, { live: false }), { pictures, state, view: true }));
    if (!built) {
      entry.status = "no project";
      continue;
    }
    Object.assign(entry, await syncFolder(directory, built.files, recorded?.files), { status: recorded ? "refreshed" : "added" });
  }

  // The working tree, unless only states were asked for.
  let current;
  const existing = (await fs.readdir(historyFolder, { withFileTypes: true }).catch(() => [])).filter((item) => item.isDirectory()).map((item) => item.name);
  if (!asked.length || values.releases) {
    const previous = await readJson(path.join(output, "layers.json")).catch(() => undefined);
    const built = await buildLayers(new Workspace(root, analysis, { live: false }), { pictures, view: Boolean(values.view ?? settings.view) });
    if (existing.length) {
      // The way from the system to its history.
      const readme = built.files.get("README.md");
      built.files.set("README.md", readme.replace("\nThe graph itself is in [atlas.json]", "\n## History\n\n[The system as it was](history/README.md) at earlier commits, tags, and releases, and what changed between them.\n\nThe graph itself is in [atlas.json]"));
    }
    current = { ...(await syncFolder(output, built.files, previous?.schema === LAYERS_SCHEMA ? previous.files : [], { check })), manifest: built.manifest, atlas: built.atlas, files: built.files.size };
  }

  // The page of the history: every recorded state, and what changed from each to the next.
  let history;
  if (existing.length) {
    const recorded = [];
    for (const folder of existing) {
      const manifest = await readJson(path.join(historyFolder, folder, "layers.json")).catch(() => undefined);
      const atlas = manifest?.schema === LAYERS_SCHEMA ? await readJson(path.join(historyFolder, folder, "atlas.json")).catch(() => undefined) : undefined;
      if (atlas && manifest.state?.commit) recorded.push({ folder, manifest, atlas });
    }
    recorded.sort((a, b) => String(a.manifest.state.date).localeCompare(String(b.manifest.state.date)) || a.folder.localeCompare(b.folder));
    let now = current;
    if (!now) {
      const manifest = await readJson(path.join(output, "layers.json")).catch(() => undefined);
      const atlas = manifest?.schema === LAYERS_SCHEMA ? await readJson(path.join(output, "atlas.json")).catch(() => undefined) : undefined;
      now = atlas ? { manifest, atlas } : undefined;
    }
    if (recorded.length) history = { ...(await syncFolder(historyFolder, new Map([["README.md", historyIndex(recorded, now)]]), [], { check })), states: recorded.length };
  }

  const changed = [...(current ? [...current.written, ...current.removed] : []), ...(history ? history.written.map((file) => `history/${file}`) : [])];
  const inSync = !changed.length && states.every(({ status }) => status === "recorded" || (!check && status !== "no project"));
  return { output, check, inSync: check ? inSync : true, changed, current, states, history };
}

export async function layersCommand(input, values) {
  const result = await syncLayers(input, values);
  const { output, check, current, states, history } = result;
  if (values.format === "json") {
    const brief = (part) => part && { written: part.written, removed: part.removed, unchanged: part.unchanged.length };
    process.stdout.write(`${JSON.stringify({ schema: "bc-atlas.layers-sync/1", output: displayPath(output), check, inSync: result.inSync, current: current && { ...brief(current), counts: current.manifest.counts },
      states: states.map(({ label, commit, folder, status, written, removed }) => ({ label, commit, folder, status, written: written.length, removed: removed.length })), history: brief(history) }, null, 2)}\n`);
  } else {
    const lines = [];
    if (current) {
      const counts = current.manifest.counts;
      lines.push(`${current.manifest.title}: ${counts.objects} object(s) in ${counts.apps} app(s), ${counts.components} component(s), ${counts.namespaces} namespace(s); ${current.files} file(s) in ${displayPath(output)}`);
      lines.push(check
        ? (current.written.length || current.removed.length ? `Not in sync: ${current.written.length} file(s) differ, ${current.removed.length} to remove` : "In sync with the source.")
        : `${current.written.length} written, ${current.removed.length} removed, ${current.unchanged.length} unchanged`);
      for (const file of [...current.written.slice(0, 12).map((name) => `  ${check ? "differs" : "wrote"} ${name}`), ...current.removed.slice(0, 6).map((name) => `  ${check ? "to remove" : "removed"} ${name}`)]) lines.push(file);
      if (current.written.length > 12) lines.push(`  and ${current.written.length - 12} more`);
      // Where to start, and what there is to change.
      const changes = current.atlas?.changes ?? [];
      if (!check) {
        lines.push("", `Start with ${displayPath(path.join(output, "README.md"))}: how it works, how it is connected, and what to change.`);
        if (changes.length) {
          lines.push(`${changes.length} change(s) to the architecture, the most important first (${displayPath(path.join(output, "changes.md"))}):`);
          for (const [position, change] of changes.slice(0, 5).entries()) lines.push(`  ${position + 1}. ${change.title}`);
          if (changes.length > 5) lines.push(`  and ${changes.length - 5} more`);
        }
        lines.push("Keep it in sync: `bca layers --check` fails when the pages differ from the source (a pipeline step), or let `bca setup` add it to a Git hook.");
      }
    }
    const said = { recorded: "already recorded", added: "recorded", refreshed: "recorded again", missing: "not recorded yet", "no project": "the project did not exist then" };
    for (const state of states) lines.push(`${state.label} (${state.commit.slice(0, 10)}): ${said[state.status]}${state.written.length ? `, ${state.written.length} file(s) in ${displayPath(path.join(output, state.folder))}` : ""}`);
    if (history) lines.push(`History: ${history.states} state(s) in ${displayPath(path.join(output, "history", "README.md"))}${history.written.length ? (check ? " (differs)" : " (updated)") : ""}`);
    console.error(lines.join("\n"));
  }
  if (check && !result.inSync) process.exitCode = 1;
}
