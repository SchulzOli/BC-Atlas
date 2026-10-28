// Reads an AL workspace the way the AL Language extension and ALTool do:
// app.json per project, `.vscode/settings.json` per project folder, and the
// `settings` and `folders` of a `.code-workspace` file. Folder settings win
// over workspace settings, as in VS Code.
import fs from "node:fs/promises";
import path from "node:path";
import { parseJsonc } from "../automation/vscode.js";

const SKIPPED = new Set([".git", "node_modules", ".alpackages", ".alcache", ".snapshots", "dist", "out", ".output", ".bca"]);

async function readJson(file, { jsonc = false } = {}) {
  try {
    const text = await fs.readFile(file, "utf8");
    return jsonc ? parseJsonc(text) : JSON.parse(text.replace(/^﻿/u, ""));
  } catch {
    return undefined;
  }
}

async function isDirectory(directory) {
  try {
    return (await fs.stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

/** Folders with an app.json below `root`; a nested app.json is a module of the outer app. */
export async function findAppFolders(root) {
  const folders = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((entry) => entry.isFile() && entry.name.toLowerCase() === "app.json")) {
      folders.push(directory);
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !SKIPPED.has(entry.name) && !entry.name.startsWith(".")) {
        await visit(path.join(directory, entry.name));
      }
    }
  }
  await visit(root);
  return folders.sort();
}

/** The `.code-workspace` file of a root: the configured one, else the only or first one. */
export async function findWorkspaceFile(root, configured) {
  if (configured) return path.resolve(root, configured);
  try {
    const files = (await fs.readdir(root)).filter((name) => name.toLowerCase().endsWith(".code-workspace")).sort();
    return files.length ? path.join(root, files[0]) : undefined;
  } catch {
    return undefined;
  }
}

function list(value) {
  if (value === undefined || value === null || value === "") return [];
  return (Array.isArray(value) ? value : [value]).map(String).filter(Boolean);
}

function alSettings(values = {}) {
  const pick = (key) => values[`al.${key}`];
  return Object.fromEntries(Object.entries({
    packageCachePath: pick("packageCachePath"),
    codeAnalyzers: pick("codeAnalyzers"),
    enableCodeAnalysis: pick("enableCodeAnalysis"),
    ruleSetPath: pick("ruleSetPath"),
    assemblyProbingPaths: pick("assemblyProbingPaths"),
    enableExternalRulesets: pick("enableExternalRulesets")
  }).filter(([, value]) => value !== undefined));
}

/**
 * Settings that apply to one AL project. Relative paths resolve against the
 * project folder, as the AL Language extension resolves them.
 */
export function projectSettings(folder, ...layers) {
  const merged = Object.assign({}, ...layers.filter(Boolean));
  const resolve = (value) => path.resolve(folder, value);
  const packageCachePaths = list(merged.packageCachePath ?? ".alpackages").map(resolve);
  return {
    packageCachePaths,
    codeAnalyzers: list(merged.codeAnalyzers),
    enableCodeAnalysis: merged.enableCodeAnalysis === true,
    ruleSetPath: merged.ruleSetPath ? resolve(merged.ruleSetPath) : undefined,
    assemblyProbingPaths: list(merged.assemblyProbingPaths).map(resolve),
    enableExternalRulesets: merged.enableExternalRulesets === true
  };
}

/**
 * The AL projects below `root` with their manifests and settings.
 * @param options { workspaceFile, settings } settings override every layer
 *   (VS Code passes the effective `al.*` configuration here).
 */
export async function readAlWorkspace(root, { workspaceFile, settings } = {}) {
  const absoluteRoot = path.resolve(root);
  const workspacePath = await findWorkspaceFile(absoluteRoot, workspaceFile);
  const workspace = workspacePath ? await readJson(workspacePath, { jsonc: true }) : undefined;
  const workspaceSettings = alSettings(workspace?.settings);

  let folders = await findAppFolders(absoluteRoot);
  const declared = (workspace?.folders ?? [])
    .map((folder) => path.resolve(path.dirname(workspacePath), folder.path ?? ""))
    .filter((folder) => !path.relative(absoluteRoot, folder).startsWith(".."));
  if (declared.length) {
    const appFolders = [];
    for (const folder of declared) appFolders.push(...await findAppFolders(folder));
    if (appFolders.length) folders = [...new Set(appFolders)].sort();
  }

  const apps = [];
  for (const folder of folders) {
    const manifest = await readJson(path.join(folder, "app.json"));
    if (!manifest) continue;
    const folderSettings = alSettings(await readJson(path.join(folder, ".vscode", "settings.json"), { jsonc: true }));
    const rootSettings = folder === absoluteRoot
      ? {}
      : alSettings(await readJson(path.join(absoluteRoot, ".vscode", "settings.json"), { jsonc: true }));
    apps.push({
      folder,
      relative: path.relative(absoluteRoot, folder).replaceAll("\\", "/") || ".",
      manifest,
      settings: projectSettings(folder, rootSettings, workspaceSettings, folderSettings, settings)
    });
  }
  return { root: absoluteRoot, workspaceFile: workspacePath, apps };
}

/** Every existing package cache folder of a workspace, for symbol loading. */
export async function packageCacheFolders(alWorkspace) {
  const folders = [];
  for (const app of alWorkspace.apps) {
    for (const folder of app.settings.packageCachePaths) {
      if (!folders.includes(folder) && await isDirectory(folder)) folders.push(folder);
    }
  }
  return folders;
}

/** Orders projects so that dependencies compile first; unknown dependencies are external. */
export function dependencyOrder(apps) {
  const byId = new Map(apps.map((app) => [String(app.manifest.id ?? "").toLowerCase(), app]));
  const ordered = [];
  const state = new Map();
  const visit = (app) => {
    if (state.get(app) === "done") return;
    if (state.get(app) === "visiting") return;
    state.set(app, "visiting");
    for (const dependency of app.manifest.dependencies ?? []) {
      const target = byId.get(String(dependency.id ?? dependency.appId ?? "").toLowerCase());
      if (target) visit(target);
    }
    state.set(app, "done");
    ordered.push(app);
  };
  for (const app of apps) visit(app);
  return ordered;
}
