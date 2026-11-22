#!/usr/bin/env node
// How well BC Atlas reads a real project: Microsoft's BCApps (System
// Application, Business Foundation, and the Test Framework at a pinned
// commit; the CI job `bcapps` fetches it). Usage:
//
//   node scripts/bcapps.js <BCApps src folder> [--json <file>]
//     [--min-resolved 0.75] [--min-guides 69]
//
// It measures two things and fails (exit code 1) below their floors:
//
// - Resolution: the share of references BC Atlas resolves. What it does not
//   resolve is named by kind and target; a reference to an object that IS in
//   the source and stays unresolved is a miss, and one miss fails.
// - Guides: how many UI tests (tests that drive a TestPage) become a user
//   guide, and that the guides of the whole corpus can be generated.
//
// Raise a floor when BC Atlas gets better, so it does not slip back.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadProject } from "../src/project.js";
import { loadCorpus } from "../src/docs/model.js";
import { exportDocumentation } from "../src/docs/export.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    json: { type: "string" },
    "min-resolved": { type: "string", default: "0.75" },
    "min-guides": { type: "string", default: "69" }
  }
});
const root = path.resolve(positionals[0] ?? ".");
const percent = (share) => `${(share * 100).toFixed(1)} %`;
const top = (counts, most = 10) => Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, most);

// ------------------------------------------------------------ resolution
let started = performance.now();
const { model } = await loadProject(root);
const references = model.edges.filter(({ wildcard }) => !wildcard);
const unresolved = references.filter(({ to }) => !to);
const own = new Set(model.objects.filter(({ externalSymbol }) => !externalSymbol).map(({ type, name }) => `${type}:${name}`.toLowerCase()));
const misses = unresolved.filter(({ unresolved: target }) => target && own.has(`${target.type}:${target.name}`.toLowerCase()));
const byType = {};
const byTarget = {};
for (const { unresolved: target } of unresolved) {
  byType[target?.type ?? "unknown"] = (byType[target?.type ?? "unknown"] ?? 0) + 1;
  const name = target ? `${target.type} ${target.name}` : "unknown";
  byTarget[name] = (byTarget[name] ?? 0) + 1;
}
const resolution = {
  ms: Math.round(performance.now() - started),
  objects: model.objects.filter(({ externalSymbol }) => !externalSymbol).length,
  references: references.length,
  resolved: references.length - unresolved.length,
  share: (references.length - unresolved.length) / references.length,
  unresolvedByType: Object.fromEntries(top(byType, 20)),
  unresolvedTargets: Object.fromEntries(top(byTarget, 15)),
  misses: misses.map(({ kind, unresolved: target, location }) => ({ kind, target, file: location?.file, line: location?.line }))
};

// ---------------------------------------------------------------- guides
started = performance.now();
const corpus = await loadCorpus(root);
const output = mkdtempSync(path.join(os.tmpdir(), "bca-bcapps-"));
let generated;
try {
  generated = (await exportDocumentation(corpus, { outputDirectory: output, formats: "markdown", appRoot: root })).files.length;
} catch (error) {
  generated = error.message;
} finally {
  rmSync(output, { recursive: true, force: true });
}
const uiTests = corpus.scenarios.length + corpus.undocumented.length;
const guides = {
  ms: Math.round(performance.now() - started),
  uiTests,
  guides: corpus.scenarios.length,
  share: uiTests ? corpus.scenarios.length / uiTests : 0,
  undocumented: corpus.undocumented.length,
  // A [SCENARIO] on a test that drives no page documents nothing a user does.
  withoutUiSteps: corpus.skipped.length,
  diagnostics: corpus.diagnostics.map(({ code, message }) => `${code}: ${message}`),
  generated
};

// ------------------------------------------------------------- the floors
const minResolved = Number(values["min-resolved"]);
const minGuides = Number(values["min-guides"]);
const failures = [
  ...(resolution.share < minResolved ? [`resolved ${percent(resolution.share)} of the references, below the floor of ${percent(minResolved)}`] : []),
  ...(resolution.misses.length ? [`${resolution.misses.length} reference(s) to objects in the source are not resolved`] : []),
  ...(guides.guides < minGuides ? [`${guides.guides} UI tests became a guide, below the floor of ${minGuides}`] : []),
  ...(guides.diagnostics.length ? [`the documentation corpus has ${guides.diagnostics.length} diagnostic(s)`] : []),
  ...(typeof generated === "string" ? [`the guides could not be generated: ${generated}`] : [])
];

const lines = [
  "## BC Atlas on BCApps",
  "",
  "| Measure | Value | Floor |",
  "|---|---:|---:|",
  `| Objects | ${resolution.objects} | |`,
  `| References resolved | ${resolution.resolved} of ${resolution.references} (${percent(resolution.share)}) | ${percent(minResolved)} |`,
  `| References to objects in the source not resolved | ${resolution.misses.length} | 0 |`,
  `| UI tests that become a guide | ${guides.guides} of ${guides.uiTests} (${percent(guides.share)}) | ${minGuides} |`,
  `| UI tests without [SCENARIO] | ${guides.undocumented} | |`,
  `| Corpus diagnostics | ${guides.diagnostics.length} | 0 |`,
  `| Guides generated | ${typeof generated === "string" ? "failed" : `${generated} files`} | |`,
  "",
  "What is not resolved points outside the source (the platform's System app, whose symbols are not in the repository):",
  "",
  ...top(byTarget, 10).map(([target, count]) => `- ${target}: ${count}`),
  "",
  failures.length ? `**Failed:** ${failures.join("; ")}.` : "Every floor holds."
];
console.log(lines.join("\n"));
if (values.json) writeFileSync(values.json, `${JSON.stringify({ commit: process.env.BCAPPS_COMMIT, resolution, guides, failures }, null, 2)}\n`);
if (failures.length) process.exit(1);
