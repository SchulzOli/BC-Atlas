// Runs Microsoft's AL toolchain on a copy of the workspace and turns the
// results into BC Atlas data:
//
//   diagnostics  alc error logs (compiler, CodeCop, UICop, AppSourceCop,
//                PerTenantExtensionCop) - also importable from any AL build
//   call graph   `altool graph extract-whole`: every call, event, and
//                interface dispatch as the compiler resolves it
//
// The copy keeps the repository untouched: alc writes report layouts and
// translation files next to the source. Results are cached by file content.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { dependencyOrder, readAlWorkspace } from "./settings.js";
import { analyzerPaths, describeToolchain, runTool } from "./toolchain.js";

const SEVERITY = { error: "error", warning: "warning", info: "info", information: "info" };
const COPY_SKIPPED = new Set([".git", "node_modules", ".alpackages", ".alcache", ".snapshots", ".bca", "dist", "out", ".output"]);
const CACHE_VERSION = 2;

function toPosix(value) {
  return value.replaceAll("\\", "/");
}

function fileFromUri(uri) {
  const value = String(uri ?? "");
  if (!value.startsWith("file:")) return value;
  const decoded = decodeURIComponent(value.replace(/^file:\/\//u, ""));
  return /^\/[A-Za-z]:/u.test(decoded) ? decoded.slice(1) : decoded;
}

function relativeTo(root, file) {
  if (!file) return undefined;
  const relative = path.relative(root, path.resolve(root, file));
  return relative.startsWith("..") || path.isAbsolute(relative) ? toPosix(file) : toPosix(relative);
}

/**
 * Diagnostics from an AL compiler error log ({ version: "0.2", toolInfo,
 * issues }, written by alc /errorlog:, `al workspace compile
 * --errorlogdirectory`, AL-Go, or BcContainerHelper). Paths become relative
 * to `root`; `mapPath` translates paths from a copied workspace first.
 */
export function parseErrorLog(log, { root = process.cwd(), mapPath = (file) => file } = {}) {
  const diagnostics = [];
  for (const issue of log?.issues ?? []) {
    const properties = issue.properties ?? {};
    if (String(properties.isSuppressedInSource).toLowerCase() === "true") continue;
    const severity = SEVERITY[String(properties.severity ?? "").toLowerCase()];
    if (!severity) continue;
    const target = issue.locations?.[0]?.analysisTarget?.[0] ?? issue.locations?.[0]?.resultFile;
    const region = target?.region ?? {};
    const file = target?.uri ? relativeTo(root, mapPath(fileFromUri(target.uri))) : undefined;
    diagnostics.push(Object.fromEntries(Object.entries({
      severity,
      code: issue.ruleId,
      message: issue.shortMessage || issue.fullMessage || properties.title || issue.ruleId,
      file,
      line: region.startLine,
      column: region.startColumn,
      endLine: region.endLine,
      endColumn: region.endColumn,
      helpLink: properties.helpLink,
      category: properties.category,
      origin: "al"
    }).filter(([, value]) => value !== undefined && value !== "")));
  }
  return diagnostics;
}

/** Reads one error log file, or every *.json log in a folder (one per project). */
export async function readErrorLogs(target, { root = process.cwd() } = {}) {
  const resolved = path.resolve(root, target);
  const stat = await fs.stat(resolved);
  const files = stat.isDirectory()
    ? (await fs.readdir(resolved)).filter((name) => name.toLowerCase().endsWith(".json")).sort().map((name) => path.join(resolved, name))
    : [resolved];
  const diagnostics = [];
  const seen = new Set();
  for (const file of files) {
    let log;
    try {
      log = JSON.parse((await fs.readFile(file, "utf8")).replace(/^﻿/u, ""));
    } catch (error) {
      throw new Error(`cannot read AL error log ${file}: ${error.message}`);
    }
    if (!Array.isArray(log?.issues)) {
      if (stat.isDirectory()) continue;
      throw new Error(`${file} is not an AL compiler error log (no issues array)`);
    }
    for (const diagnostic of parseErrorLog(log, { root })) {
      const key = [diagnostic.code, diagnostic.file, diagnostic.line, diagnostic.column, diagnostic.message].join("|");
      if (!seen.has(key)) {
        seen.add(key);
        diagnostics.push(diagnostic);
      }
    }
  }
  return diagnostics;
}

async function listFiles(directory, root = directory, files = []) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!COPY_SKIPPED.has(entry.name)) await listFiles(path.join(directory, entry.name), root, files);
    } else if (entry.isFile()) {
      files.push(path.relative(root, path.join(directory, entry.name)));
    }
  }
  return files;
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** Content hashes of the AL projects' files, relative to the root. */
async function fingerprintFiles(workspace) {
  const files = {};
  for (const app of workspace.apps) {
    for (const relative of await listFiles(app.folder)) {
      const file = path.join(app.folder, relative);
      files[toPosix(path.relative(workspace.root, file))] = hash(await fs.readFile(file));
    }
  }
  return files;
}

async function packageFingerprint(folders) {
  const parts = [];
  for (const folder of folders) {
    try {
      for (const name of (await fs.readdir(folder)).sort()) {
        if (!name.toLowerCase().endsWith(".app")) continue;
        const stat = await fs.stat(path.join(folder, name));
        parts.push(`${folder}/${name}:${stat.size}:${stat.mtimeMs}`);
      }
    } catch {
      // A missing cache folder is part of the fingerprint as "empty".
    }
  }
  return hash(parts.join("\n"));
}

function cacheFolder(root) {
  return path.join(process.env.BCA_CACHE_DIR ?? path.join(os.tmpdir(), "bc-atlas"), "al", hash(path.resolve(root)).slice(0, 16));
}

/** Compiles one project with alc; returns its diagnostics and whether it produced an app. */
async function compileProject(app, { toolchain, copyRoot, root, output, caches, analyzers, log }) {
  const copy = path.join(copyRoot, app.relative);
  const errorLog = path.join(log, `${hash(app.folder).slice(0, 12)}.errorLog.json`);
  const settings = app.settings;
  const args = [
    `/project:${copy}`,
    `/packagecachepath:${[...settings.packageCachePaths.filter((folder) => caches.has(folder)), output].join(";")}`,
    `/outfolder:${output}`,
    `/errorlog:${errorLog}`,
    "/generatereportlayout-"
  ];
  const analyzerList = analyzers ?? (settings.enableCodeAnalysis ? settings.codeAnalyzers : []);
  if (analyzerList.length) args.push(`/analyzer:${analyzerPaths(analyzerList, toolchain, app.folder).join(";")}`);
  if (settings.ruleSetPath) args.push(`/ruleset:${settings.ruleSetPath}`);
  if (settings.assemblyProbingPaths.length) args.push(`/assemblyprobingpaths:${settings.assemblyProbingPaths.join(";")}`);
  const started = Date.now();
  const result = await runTool(toolchain.alc, args, { cwd: copy });
  let diagnostics = [];
  try {
    const logContent = JSON.parse((await fs.readFile(errorLog, "utf8")).replace(/^﻿/u, ""));
    diagnostics = parseErrorLog(logContent, {
      root,
      mapPath: (file) => path.join(root, path.relative(copyRoot, path.resolve(copy, file)))
    });
  } catch {
    if (result.code !== 0) {
      diagnostics.push({
        severity: "error",
        code: "al-compiler-failed",
        message: `The AL compiler could not compile ${app.manifest.name ?? app.relative}: ${(result.stderr || result.stdout).trim().split(/\r?\n/u).slice(-3).join(" ")}`,
        file: toPosix(path.join(app.relative, "app.json")),
        origin: "al"
      });
    }
  }
  return {
    name: app.manifest.name ?? app.relative,
    folder: app.relative,
    succeeded: result.code === 0,
    durationMs: Date.now() - started,
    diagnostics
  };
}

/** Parses an `altool graph` JSONL file into nodes and call edges with paths relative to `root`. */
export function parseCallGraph(text, { root = process.cwd(), mapPath = (file) => file } = {}) {
  const nodes = new Map();
  const edges = [];
  for (const line of String(text).split(/\r?\n/u)) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const value = row.v ?? {};
    if (row.t === "node") {
      const type = String(value.id ?? "").match(/ \/ ([A-Za-z]+) /u)?.[1];
      nodes.set(value.id, {
        id: value.id,
        kind: value.kind,
        type: type ? type.toLowerCase() : undefined,
        objectId: value.objectId,
        objectName: value.objectName,
        namespace: value.namespace,
        member: value.memberName,
        file: value.sourcePath ? relativeTo(root, mapPath(value.sourcePath)) : undefined,
        line: value.line
      });
    } else if (row.t === "edge") {
      if (value.caller === value.callee) continue;
      edges.push({
        caller: value.caller,
        callee: value.callee,
        kind: value.kind,
        confidence: value.confidence,
        file: value.sourcePath ? relativeTo(root, mapPath(value.sourcePath)) : undefined,
        line: value.line,
        detail: value.detail
      });
    }
  }
  return { nodes, edges };
}

async function supportsGraph(toolchain) {
  if (!toolchain.altool) return false;
  try {
    return (await runTool(toolchain.altool, ["graph", "--help"], { timeout: 60000 })).code === 0;
  } catch {
    return false;
  }
}

async function copyWorkspace(workspace, copyRoot) {
  await fs.rm(copyRoot, { recursive: true, force: true });
  for (const app of workspace.apps) {
    const target = path.join(copyRoot, app.relative);
    await fs.cp(app.folder, target, {
      recursive: true,
      filter: (source) => !COPY_SKIPPED.has(path.basename(source)) || source === app.folder
    });
  }
}

/**
 * Compiles every AL project below `root` in dependency order and extracts the
 * compiler's call graph. Returns { toolchain, projects, diagnostics, graph,
 * files } and caches it until a file, setting, or symbol package changes.
 * @param options { toolchain, al, analyzers, graph, cache, onProgress }
 */
export async function runAlTools(root, { toolchain, al, analyzers, graph = true, cache = true, onProgress = () => {} } = {}) {
  const absoluteRoot = path.resolve(root);
  const workspace = await readAlWorkspace(absoluteRoot, al);
  if (!workspace.apps.length) return undefined;
  const files = await fingerprintFiles(workspace);
  const caches = new Set();
  for (const app of workspace.apps) {
    for (const folder of app.settings.packageCachePaths) {
      if (await fs.stat(folder).then((stat) => stat.isDirectory(), () => false)) caches.add(folder);
    }
  }
  const key = hash(JSON.stringify({
    version: CACHE_VERSION,
    files,
    settings: workspace.apps.map(({ relative, settings, manifest }) => ({ relative, settings, manifest })),
    packages: await packageFingerprint([...caches]),
    tool: [toolchain.source, toolchain.location, toolchain.version],
    analyzers,
    graph
  }));
  const folder = cacheFolder(absoluteRoot);
  const resultFile = path.join(folder, "result.json");
  if (cache) {
    const cached = await readCachedAlTools(absoluteRoot);
    if (cached?.key === key) return cached;
  }

  const work = path.join(folder, "work");
  const copyRoot = path.join(work, "src");
  const output = path.join(work, "packages");
  const log = path.join(work, "logs");
  onProgress(`Compiling ${workspace.apps.length} AL project(s) with the ${describeToolchain(toolchain)}`);
  await copyWorkspace(workspace, copyRoot);
  await fs.rm(output, { recursive: true, force: true });
  await fs.rm(log, { recursive: true, force: true });
  await fs.mkdir(output, { recursive: true });
  await fs.mkdir(log, { recursive: true });

  const projects = [];
  for (const app of dependencyOrder(workspace.apps)) {
    projects.push(await compileProject(app, { toolchain, copyRoot, root: absoluteRoot, output, caches, analyzers, log }));
  }

  let callGraph;
  if (graph && await supportsGraph(toolchain)) {
    onProgress("Reading the call graph from the AL compiler");
    const graphFile = path.join(work, "graph.jsonl");
    await fs.rm(graphFile, { force: true });
    const result = await runTool(toolchain.altool, ["graph", "extract-whole", "--corpus", copyRoot, "--out", path.join(work, "shards"), "--graph", graphFile]);
    if (result.code === 0) {
      callGraph = parseCallGraph(await fs.readFile(graphFile, "utf8"), {
        root: absoluteRoot,
        mapPath: (file) => path.join(absoluteRoot, path.relative(copyRoot, file))
      });
    }
  }

  const result = {
    key,
    toolchain: { source: toolchain.source, version: toolchain.version, location: toolchain.location },
    projects: projects.map(({ diagnostics, ...project }) => project),
    diagnostics: projects.flatMap(({ diagnostics }) => diagnostics),
    graph: callGraph ? { nodes: [...callGraph.nodes.values()], edges: callGraph.edges } : undefined,
    files
  };
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(resultFile, JSON.stringify(result));
  await fs.rm(work, { recursive: true, force: true });
  return revive(result);
}

/**
 * The last result for a root, even if files changed since: the model only
 * uses it for files whose content still matches (see applyAlResults).
 */
export async function readCachedAlTools(root) {
  try {
    return revive(JSON.parse(await fs.readFile(path.join(cacheFolder(path.resolve(root)), "result.json"), "utf8")));
  } catch {
    return undefined;
  }
}

function revive(result) {
  if (!result.graph || result.graph.nodes instanceof Map) return result;
  return { ...result, graph: { nodes: new Map(result.graph.nodes.map((node) => [node.id, node])), edges: result.graph.edges } };
}
