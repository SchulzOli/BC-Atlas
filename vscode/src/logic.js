// What the extension computes from BC Atlas results, without the VS Code API,
// so it can be tested with plain Node.
"use strict";

const path = require("node:path");

const posix = (file) => String(file ?? "").replaceAll("\\", "/");

/** The file path BC Atlas uses for a document: relative to the project root, with "/". */
function projectPath(projectRoot, file) {
  const relative = posix(path.relative(projectRoot, file));
  return relative.startsWith("../") || path.isAbsolute(relative) ? undefined : relative;
}

/**
 * Health findings with a location, ready to become Problems-panel entries.
 * With `skipCompiler`, AL compiler and analyzer findings are left to the AL
 * Language extension, which already reports them.
 */
function findingsToProblems(health, projectRoot, { skipCompiler = false } = {}) {
  const problems = [];
  for (const finding of health?.findings ?? []) {
    if (!finding.file) continue;
    if (skipCompiler && finding.origin === "al") continue;
    const line = Math.max(0, (Number(finding.line) || 1) - 1);
    problems.push(Object.fromEntries(Object.entries({
      file: path.join(projectRoot, ...posix(finding.file).split("/")),
      line,
      column: finding.column ? finding.column - 1 : undefined,
      endLine: finding.endLine ? finding.endLine - 1 : undefined,
      endColumn: finding.endColumn ? finding.endColumn - 1 : undefined,
      helpLink: finding.helpLink,
      severity: finding.severity,
      message: finding.message,
      code: finding.rule,
      object: finding.object
    }).filter(([, value]) => value !== undefined)));
  }
  return problems;
}

/** Objects declared in one file, in source order. */
function objectsInFile(objects, relative) {
  return (objects ?? [])
    .filter((object) => posix(object.file) === relative)
    .sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
}

/** The object whose declaration is the last one at or above a line (0-based). */
function objectAt(objects, relative, line) {
  const candidates = objectsInFile(objects, relative);
  let found;
  for (const object of candidates) {
    if ((object.line ?? 1) - 1 <= line) found = object;
  }
  return found ?? candidates[0];
}

const count = (value, one, many) => `${value.toLocaleString("en-US")} ${value === 1 ? one : many}`;

/** One CodeLens above each object declaration. */
function lensesForFile(objects, relative) {
  return objectsInFile(objects, relative).map((object) => ({
    line: Math.max(0, (object.line ?? 1) - 1),
    id: object.id,
    title: [
      `used by ${object.usedBy.toLocaleString("en-US")}`,
      `uses ${object.uses.toLocaleString("en-US")}`,
      object.component ? `component ${object.component}` : undefined,
      object.violations ? `${count(object.violations, "dependency", "dependencies")} against the architecture` : undefined
    ].filter(Boolean).join(" · "),
    warning: object.violations > 0
  }));
}

/** The status bar text and tone for an overview. */
function statusFor(overview) {
  if (!overview) return { text: "$(sync~spin) BC Atlas", tone: "busy", tooltip: "Analyzing the AL source…" };
  const { health, architecture, summary } = overview;
  const errors = health.counts.error;
  const warnings = health.counts.warning;
  const text = errors
    ? `$(error) BC Atlas: ${count(errors, "error", "errors")}`
    : warnings
      ? `$(warning) BC Atlas: ${count(warnings, "warning", "warnings")}`
      : "$(pass) BC Atlas";
  const tooltip = [
    `${overview.title}: ${count(summary.objects, "object", "objects")} in ${count(summary.apps.length, "app", "apps")}`,
    `Health: ${health.passed ? "passed" : "failed"} (${count(errors, "error", "errors")}, ${count(warnings, "warning", "warnings")})`,
    `Architecture (${architecture.mode}): ${count(architecture.violations, "wrong-way dependency", "wrong-way dependencies")}, ${architecture.extractable} of ${architecture.components} components can become apps`
  ].join("\n");
  return { text, tone: errors ? "error" : warnings ? "warning" : "ok", tooltip };
}

/** The pages of the BC Atlas panel, with a short summary for the side bar. */
function pages(overview) {
  const list = [
    { id: "overview", label: "Overview", icon: "dashboard", description: overview ? `${overview.summary.objects.toLocaleString("en-US")} objects` : undefined },
    { id: "health", label: "Health", icon: "pulse", description: overview ? (overview.health.passed ? "passed" : `${overview.health.counts.error} errors, ${overview.health.counts.warning} warnings`) : undefined },
    { id: "architecture", label: "Architecture", icon: "layers", description: overview ? `${overview.architecture.mode}, ${overview.architecture.violations.toLocaleString("en-US")} wrong-way` : undefined },
    { id: "dependencies", label: "Dependencies (3D)", icon: "type-hierarchy", description: overview ? `${overview.summary.apps.length} apps` : undefined },
    { id: "diagrams", label: "Diagrams", icon: "graph" },
    { id: "objects", label: "Objects", icon: "symbol-class", description: overview ? overview.summary.objects.toLocaleString("en-US") : undefined }
  ];
  if (overview?.docs?.scenarios) list.push({ id: "docs", label: "Docs", icon: "book", description: `${overview.docs.scenarios} scenarios` });
  return list;
}

// What `bca export` can write, for the Export command.
const EXPORTS = [
  { view: "app", label: "BC Atlas pages (one offline HTML file)", detail: "Share or publish everything you see in the panel", file: "bc-atlas.html", filters: { HTML: ["html"] } },
  { view: "report", label: "Markdown report", detail: "README.md with health, diagrams, and an optional object catalog", folder: "docs/atlas" },
  { view: "explorer", label: "3D dependency explorer (HTML)", detail: "One offline file, replayable over Git history", file: "bc-atlas-explorer.html", filters: { HTML: ["html"] } },
  { view: "catalog", label: "Object catalog (Markdown)", detail: "One linked page per AL object", folder: "docs/codegraph" },
  { view: "knowledge-graph", label: "Knowledge graph (RDF, OWL)", detail: "For triple stores, graph databases, and Protégé: Turtle, RDF/XML, N-Triples, or JSON-LD", file: "bc-atlas.ttl", filters: { Turtle: ["ttl"], OWL: ["owl"], "RDF/XML": ["rdf"], "N-Triples": ["nt"], "JSON-LD": ["jsonld"] } },
  ...["project", "module", "data", "contracts", "events", "ui"].map((view) => ({
    view, label: `Diagram: ${view} view`, detail: "SVG, PNG, PDF, or the D2 source", file: `${view}.svg`, filters: { SVG: ["svg"], PNG: ["png"], PDF: ["pdf"], D2: ["d2"] }
  }))
];

/** `bca export` arguments for one export target. */
function exportArgs(target, project, output) {
  return ["export", project, "--view", target.view, "-o", output];
}

/** The page hash for a page id and its parameters. */
function pageHash(page, params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== ""));
  return `#/${page}${query.size ? `?${query}` : ""}`;
}

module.exports = {
  EXPORTS,
  exportArgs,
  findingsToProblems,
  lensesForFile,
  objectAt,
  objectsInFile,
  pageHash,
  pages,
  projectPath,
  statusFor
};
