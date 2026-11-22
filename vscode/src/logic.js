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
 */
function findingsToProblems(health, projectRoot) {
  const problems = [];
  for (const finding of health?.findings ?? []) {
    if (!finding.file) continue;
    const line = Math.max(0, (Number(finding.line) || 1) - 1);
    problems.push(Object.fromEntries(Object.entries({
      file: path.join(projectRoot, ...posix(finding.file).split("/")),
      line,
      column: finding.column ? finding.column - 1 : undefined,
      endLine: finding.endLine ? finding.endLine - 1 : undefined,
      endColumn: finding.endColumn ? finding.endColumn - 1 : undefined,
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
      `uses ${object.uses.toLocaleString("en-US")}`
    ].join(" · ")
  }));
}

/** The status bar text and tone for an overview. */
function statusFor(overview) {
  if (!overview) return { text: "$(sync~spin) BC Atlas", tone: "busy", tooltip: "Analyzing the AL source…" };
  const { health, summary } = overview;
  const errors = health.counts.error;
  const warnings = health.counts.warning;
  const text = errors
    ? `$(error) BC Atlas: ${count(errors, "error", "errors")}`
    : warnings
      ? `$(warning) BC Atlas: ${count(warnings, "warning", "warnings")}`
      : "$(pass) BC Atlas";
  const tooltip = [
    `${overview.title}: ${count(summary.objects, "object", "objects")} in ${count(summary.apps.length, "app", "apps")}`,
    `Health: ${health.passed ? "passed" : "failed"} (${count(errors, "error", "errors")}, ${count(warnings, "warning", "warnings")})`
  ].join("\n");
  return { text, tone: errors ? "error" : warnings ? "warning" : "ok", tooltip };
}

// What `bca export` writes, for the Export command.
const EXPORT = { label: "BC Atlas (one offline HTML file)", file: "bc-atlas.html", filters: { HTML: ["html"] } };

/** `bca export` arguments: the view of the project as one HTML file. */
function exportArgs(project, output) {
  return ["export", project, "-o", output];
}

/**
 * The address of a view of the BC Atlas panel: what the graph shows (lens),
 * in which form, and what is selected, as the panel keeps it itself.
 * @param state { lens, form, sel, inside, focus, story, check, ... }
 */
function viewHash(state = {}) {
  const query = new URLSearchParams(Object.entries(state).filter(([, value]) => value !== undefined && value !== ""));
  return `#${query}`;
}

/**
 * Resolves `${workspaceFolder}` in an `al.*` setting the way VS Code would:
 * the workspace folder that holds the project. VS Code's configuration API
 * returns the raw text; the engine expands the remaining variables.
 */
function expandWorkspaceFolder(value, workspaceFolder) {
  if (Array.isArray(value)) return value.map((item) => expandWorkspaceFolder(item, workspaceFolder));
  if (typeof value !== "string" || !workspaceFolder) return value;
  return value.replace(/\$\{(?:workspaceFolder|workspaceRoot)\}/gu, workspaceFolder);
}

const AL_SETTINGS = Object.freeze(["packageCachePath"]);

/**
 * The `al.*` settings someone actually set, by layer, for the engine:
 * { user, workspace, workspaceFolder }. `inspect` is VS Code's
 * `WorkspaceConfiguration.inspect`. Defaults are left out: `get()` would also
 * return the AL extension's defaults (`./.alpackages`, `./.netpackages`), which
 * then hid every project's own `.vscode/settings.json`.
 * @param options { workspaceFolder, multiRoot } where `${workspaceFolder}`
 *   points; in a multi-root workspace the workspace (file) layer is left to
 *   the engine, which resolves it per project.
 */
function editorAlSettings(inspect, { workspaceFolder, multiRoot = false } = {}) {
  const layers = { user: {}, workspace: {}, workspaceFolder: {} };
  const set = (layer, key, value) => {
    if (value !== undefined && value !== null && value !== "") layers[layer][key] = value;
  };
  for (const key of AL_SETTINGS) {
    const info = inspect(key) ?? {};
    set("user", key, info.globalValue);
    set("workspace", key, multiRoot ? info.workspaceValue : expandWorkspaceFolder(info.workspaceValue, workspaceFolder));
    set("workspaceFolder", key, expandWorkspaceFolder(info.workspaceFolderValue, workspaceFolder));
  }
  return Object.fromEntries(Object.entries(layers).filter(([, layer]) => Object.keys(layer).length));
}

module.exports = {
  AL_SETTINGS,
  editorAlSettings,
  EXPORT,
  expandWorkspaceFolder,
  exportArgs,
  findingsToProblems,
  lensesForFile,
  objectAt,
  objectsInFile,
  projectPath,
  statusFor,
  viewHash
};
