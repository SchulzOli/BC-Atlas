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

function resolveLocalReferences(scenarios) {
  const byId = new Map(scenarios.map((scenario) => [scenario.value.id, scenario]));
  const procedures = new Map();
  for (const scenario of scenarios) {
    const key = scenario.value.procedure.toLocaleLowerCase("en-US");
    const candidates = procedures.get(key) ?? [];
    candidates.push(scenario);
    procedures.set(key, candidates);
  }
  for (const scenario of scenarios) {
    scenario.value.links = Object.fromEntries(
      Object.entries(scenario.value.links).map(([relation, targets]) => [
        relation,
        [...new Set(targets.map((target) => {
          if (byId.has(target)) return target;
          const candidates = procedures.get(target.toLocaleLowerCase("en-US")) ?? [];
          return candidates.length === 1 ? candidates[0].value.id : target;
        }))]
      ])
    );
  }
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

export async function loadCorpus(input) {
  const root = path.resolve(input);
  const files = await collectAlFiles(root);
  const scenarios = (await Promise.all(files.map(loadAlUiTests)))
    .flat()
    .sort((left, right) =>
      left.value.id.localeCompare(right.value.id) || left.reference.localeCompare(right.reference)
    );
  resolveLocalReferences(scenarios);
  const validation = validateCorpus(scenarios);
  return {
    root,
    files,
    scenarios,
    byId: validation.byId,
    diagnostics: validation.diagnostics
  };
}

export function scenarioSummary(scenario) {
  return {
    id: scenario.value.id,
    idSource: scenario.value.idSource,
    title: scenario.value.title,
    feature: scenario.value.features,
    file: scenario.relativePath,
    procedure: scenario.value.procedure,
    links: scenario.value.links
  };
}