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

export async function loadCorpus(input) {
  const root = path.resolve(input);
  const files = await collectAlFiles(root);
  const skipped = [];
  const undocumented = [];
  const scenarios = (await Promise.all(files.map((file) => loadAlUiTests(file, skipped, undocumented))))
    .flat()
    .sort((left, right) =>
      left.value.id.localeCompare(right.value.id) || left.reference.localeCompare(right.reference)
    );
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
export async function findUiTests(root, gitRoot) {
  const candidates = new Set(["."]);
  for (const directory of await directories(root)) if (/test/iu.test(path.basename(directory))) candidates.add(directory);
  if (gitRoot && gitRoot !== root) {
    for (const directory of await directories(gitRoot)) {
      if (/test/iu.test(path.basename(directory))) candidates.add(path.relative(root, path.join(gitRoot, directory)).replaceAll("\\", "/") || ".");
    }
  }
  let best = { path: undefined, scenarios: 0 };
  for (const candidate of candidates) {
    const corpus = await loadCorpus(path.join(root, candidate)).catch(() => undefined);
    const count = corpus?.scenarios.length ?? 0;
    // Prefer the most specific folder when counts tie.
    if (count > best.scenarios || (count && count === best.scenarios && candidate.length > (best.path ?? "").length)) {
      best = { path: candidate, scenarios: count };
    }
  }
  return best;
}
