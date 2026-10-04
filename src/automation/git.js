import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export async function findGitRoot(start) {
  let directory = path.resolve(start);
  for (;;) {
    const marker = await fs.stat(path.join(directory, ".git")).catch(() => undefined);
    if (marker) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

export function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.error?.code === "ENOENT") throw new Error("git is not installed or not on PATH");
  return result;
}

export async function remoteUrl(root) {
  const config = await fs.readFile(path.join(root, ".git", "config"), "utf8").catch(() => "");
  return /\[remote "origin"\][^[]*?url\s*=\s*(\S+)/u.exec(config)?.[1];
}

export function hostOf(url) {
  if (!url) return undefined;
  if (/github\.com[/:]/u.test(url)) return "github";
  if (/dev\.azure\.com|visualstudio\.com/u.test(url)) return "azure-devops";
  if (/gitlab\./u.test(url)) return "gitlab";
  return "other";
}

/** Paths (relative to root) with uncommitted changes, including untracked files. */
export function changedPaths(root, paths) {
  if (!paths.length) return [];
  const result = git(root, ["status", "--porcelain", "--untracked-files=all", "--", ...paths]);
  if (result.status !== 0) throw new Error(`git status failed: ${result.stderr.trim()}`);
  return result.stdout.split("\n").filter(Boolean).map((line) => line.slice(3).trim());
}

export function stagePaths(root, paths) {
  if (!paths.length) return;
  const result = git(root, ["add", "--all", "--", ...paths]);
  if (result.status !== 0) throw new Error(`git add failed: ${result.stderr.trim()}`);
}
