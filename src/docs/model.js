import fs from "node:fs/promises";
import path from "node:path";
import { loadAlUiTests } from "./al-ui-source.js";
import { isDocumentId } from "./tags.js";

async function collectAlFiles(input) {
  const absolute = path.resolve(input);
  const stat = await fs.stat(absolute);
  if (stat.isFile()) return path.extname(absolute).toLowerCase() === ".al" ? [absolute] : [];
  const files = [];
  const entries = await fs.readdir(absolute, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const target = path.join(absolute, entry.name);
    if (entry.isDirectory()) files.push(...await collectAlFiles(target));
    else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".al") files.push(target);
  }
  return files;
}

function diagnostic(scenario, severity, code, message) {
  return {
    severity,
    code,
    message,
    file: scenario.relativePath,
    procedure: scenario.value.procedure,
    documentId: scenario.value.id
  };
}

function requiresCycles(scenarios, byId) {
  const state = new Map();
  const stack = [];
  const cycles = [];
  function visit(id) {
    if (state.get(id) === "done") return;
    if (state.get(id) === "visiting") {
      const start = stack.indexOf(id);
      cycles.push([...stack.slice(start), id]);
      return;
    }
    state.set(id, "visiting");
    stack.push(id);
    for (const target of byId.get(id)?.value.links.requires ?? []) {
      if (byId.has(target)) visit(target);
    }
    stack.pop();
    state.set(id, "done");
  }
  for (const scenario of scenarios) visit(scenario.value.id);
  return cycles;
}

export function validateCorpus(scenarios) {
  const diagnostics = scenarios.flatMap((scenario) =>
    scenario.value.diagnostics.map((item) => ({
      ...item,
      file: scenario.relativePath,
      procedure: scenario.value.procedure,
      documentId: scenario.value.id
    }))
  );
  const byId = new Map();
  for (const scenario of scenarios) {
    const existing = byId.get(scenario.value.id);
    if (existing) {
      diagnostics.push(diagnostic(
        scenario,
        "error",
        "duplicate-document-id",
        `Document ID "${scenario.value.id}" is also used by ${existing.relativePath}#${existing.value.procedure}`
      ));
    } else {
      byId.set(scenario.value.id, scenario);
    }
  }

  for (const scenario of scenarios) {
    for (const [relation, targets] of Object.entries(scenario.value.links)) {
      for (const target of targets) {
        if (!isDocumentId(target)) {
          diagnostics.push(diagnostic(
            scenario,
            "error",
            "invalid-link-target",
            `Invalid ${relation} target "${target}"`
          ));
        } else if (target === scenario.value.id) {
          diagnostics.push(diagnostic(
            scenario,
            "error",
            "self-document-link",
            `Document "${target}" cannot link to itself as ${relation}`
          ));
        } else if (!byId.has(target)) {
          diagnostics.push(diagnostic(
            scenario,
            "error",
            "broken-document-link",
            `${relation} target "${target}" does not exist`
          ));
        }
      }
    }
  }

  for (const cycle of requiresCycles(scenarios, byId)) {
    const scenario = byId.get(cycle[0]);
    diagnostics.push(diagnostic(
      scenario,
      "error",
      "requires-cycle",
      `Hard prerequisite cycle: ${cycle.join(" -> ")}`
    ));
  }
  return { byId, diagnostics };
}

const byProcedure = (a, b) => a.path.localeCompare(b.path) || a.procedure.localeCompare(b.procedure);

/**
 * Tests of different codeunits often share a procedure name (Microsoft's
 * EmailAccountsTest and FileAccountsTest both have AddNewAccountTest). An ID
 * derived from such a name takes its file's name in front, so both are
 * documented; an ID an author gave ([DOC-ID]) is never changed.
 */
function distinguishDerivedIds(scenarios) {
  const count = new Map();
  for (const { value } of scenarios) count.set(value.id, (count.get(value.id) ?? 0) + 1);
  const fileSlug = (file) => path.basename(file).replace(/(\.[A-Za-z]+)?\.al$/iu, "")
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1-$2").replace(/([a-z0-9])([A-Z])/gu, "$1-$2")
    .toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
  for (const scenario of scenarios) {
    if (scenario.value.idSource !== "procedure" || count.get(scenario.value.id) < 2) continue;
    scenario.value.id = `${fileSlug(scenario.path)}-${scenario.value.id}`;
  }
  scenarios.sort((left, right) => left.value.id.localeCompare(right.value.id) || left.reference.localeCompare(right.reference));
}

/** One file of the corpus; with a cache, read again only when its size or time changed. */
async function loadFile(file, cache) {
  const stamp = cache && await fs.stat(file).then(({ size, mtimeMs }) => `${size}:${mtimeMs}`, () => undefined);
  const hit = stamp && cache.get(file);
  if (hit && hit.stamp === stamp) return hit;
  const entry = { stamp, skipped: [], undocumented: [] };
  entry.scenarios = await loadAlUiTests(file, entry.skipped, entry.undocumented);
  if (stamp) cache.set(file, entry);
  return entry;
}

/**
 * The documented UI tests of a folder.
 * @param options { cache }: a Map kept between calls (an editor session), so
 *   only the files that changed are read again
 */
export async function loadCorpus(input, { cache } = {}) {
  const root = path.resolve(input);
  const files = await collectAlFiles(root);
  const read = await Promise.all(files.map((file) => loadFile(file, cache)));
  const skipped = read.flatMap((entry) => entry.skipped);
  const undocumented = read.flatMap((entry) => entry.undocumented);
  const scenarios = read.flatMap((entry) => entry.scenarios)
    .sort((left, right) =>
      left.value.id.localeCompare(right.value.id) || left.reference.localeCompare(right.reference)
    );
  distinguishDerivedIds(scenarios);
  const validation = validateCorpus(scenarios);
  return {
    root,
    files,
    scenarios,
    // [SCENARIO] tests without UI steps, which are not documented.
    skipped: skipped.sort(byProcedure),
    // UI tests without a [SCENARIO]: what is not documented yet.
    undocumented: undocumented.sort(byProcedure),
    byId: validation.byId,
    diagnostics: validation.diagnostics
  };
}

export function scenarioSummary(scenario) {
  return {
    id: scenario.value.id,
    idSource: scenario.value.idSource,
    title: scenario.value.title,
    features: scenario.value.features,
    file: scenario.relativePath,
    procedure: scenario.value.procedure,
    links: scenario.value.links
  };
}
const IGNORED_FOLDERS = new Set([".git", ".alpackages", ".vscode", "node_modules", ".snapshots", "docs", ".husky", ".github"]);

async function directories(root, depth = 0, relative = "") {
  if (depth > 3) return [];
  const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true }).catch(() => []);
  const found = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || IGNORED_FOLDERS.has(entry.name)) continue;
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    found.push(child, ...await directories(root, depth + 1, child));
  }
  return found;
}

/** Finds the folder with the most documented UI-test scenarios. */
export async function findUiTests(root, gitRoot, { cache } = {}) {
  const candidates = new Set(["."]);
  for (const directory of await directories(root)) if (/test/iu.test(path.basename(directory))) candidates.add(directory);
  if (gitRoot && gitRoot !== root) {
    for (const directory of await directories(gitRoot)) {
      if (/test/iu.test(path.basename(directory))) candidates.add(path.relative(root, path.join(gitRoot, directory)).replaceAll("\\", "/") || ".");
    }
  }
  // The tests under the project are read once, and a candidate there counts the ones under it;
  // a candidate outside it (elsewhere in the repository) is read on its own.
  const all = [];
  for (const folder of [".", ...[...candidates].filter((candidate) => candidate.startsWith(".."))]) {
    all.push(...((await loadCorpus(path.resolve(root, folder), { cache }).catch(() => undefined))?.scenarios ?? []));
  }
  let best = { path: undefined, scenarios: 0 };
  for (const candidate of candidates) {
    const folder = path.resolve(root, candidate);
    const count = all.filter((scenario) => scenario.path === folder || scenario.path.startsWith(`${folder}${path.sep}`)).length;
    // Prefer the most specific folder when counts tie.
    if (count > best.scenarios || (count && count === best.scenarios && candidate.length > (best.path ?? "").length)) {
      best = { path: candidate, scenarios: count };
    }
  }
  return best;
}
