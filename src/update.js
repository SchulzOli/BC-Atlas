// Update awareness for BC Atlas: a once-a-day background check against the
// npm registry, a short notice in interactive terminals, and the data
// `bca update` needs (latest version and the changelog in between).
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_NAME = "bc-atlas";
const DAY = 24 * 60 * 60 * 1000;
const CHANGELOG_URL = "https://raw.githubusercontent.com/SchulzOli/BC-Atlas/main/CHANGELOG.md";

function registryUrl() {
  return (process.env.BCA_REGISTRY_URL ?? process.env.npm_config_registry ?? "https://registry.npmjs.org").replace(/\/$/u, "");
}

export function cacheFile() {
  const base = process.env.BCA_CACHE_DIR ??
    (process.platform === "win32"
      ? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "bc-atlas")
      : path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"), "bc-atlas"));
  return path.join(base, "update-check.json");
}

function parse(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?/u.exec(String(version ?? "").trim());
  return match ? { parts: match.slice(1, 4).map(Number), pre: match[4] } : undefined;
}

/** Semantic-version comparison; a prerelease sorts before its release. */
export function compareVersions(left, right) {
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index++) {
    if (a.parts[index] !== b.parts[index]) return a.parts[index] - b.parts[index];
  }
  if (a.pre && !b.pre) return -1;
  if (!a.pre && b.pre) return 1;
  return String(a.pre ?? "").localeCompare(String(b.pre ?? ""));
}

export function isMajorUpdate(current, latest) {
  const a = parse(current);
  const b = parse(latest);
  if (!a || !b) return false;
  // Before 1.0.0, a minor bump may contain breaking changes.
  return b.parts[0] > a.parts[0] || (a.parts[0] === 0 && b.parts[1] > a.parts[1]);
}

export async function fetchLatestVersion({ timeout = 5000 } = {}) {
  const response = await fetch(`${registryUrl()}/${PACKAGE_NAME}/latest`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(timeout)
  });
  if (!response.ok) throw new Error(`npm registry answered ${response.status}`);
  const { version } = await response.json();
  if (!parse(version)) throw new Error("npm registry returned no version");
  return version;
}

export async function readCache() {
  try {
    return JSON.parse(await readFile(cacheFile(), "utf8"));
  } catch {
    return undefined;
  }
}

export async function refreshCache() {
  const latest = await fetchLatestVersion();
  const file = cacheFile();
  await mkdir(path.dirname(file), { recursive: true });
  const entry = { checkedAt: new Date().toISOString(), latest };
  await writeFile(file, `${JSON.stringify(entry)}\n`);
  return entry;
}

/** Commands, environments, and output modes in which no notice is shown. */
export function updateCheckEnabled({ command, values = {}, env = process.env, stderrIsTTY = process.stderr.isTTY } = {}) {
  if (!stderrIsTTY) return false;
  if (env.CI || env.BCA_NO_UPDATE_CHECK || env.NO_UPDATE_NOTIFIER || env.GIT_DIR || env.HUSKY_GIT_PARAMS) return false;
  if (["run", "mcp", "capabilities", "update", "watch"].includes(command)) return false;
  return values.format !== "json";
}

export function noticeFor(cache, current) {
  if (!cache?.latest || compareVersions(cache.latest, current) <= 0) return undefined;
  const major = isMajorUpdate(current, cache.latest) ? " It may contain breaking changes." : "";
  return `BC Atlas ${cache.latest} is available (you have ${current}).${major} Run "bca update" to see what's new.`;
}

/**
 * Prints a notice from the cached check and refreshes a stale cache in a
 * detached process, so no command ever waits for the network.
 */
export async function maybeNotifyUpdate(current, context) {
  if (!updateCheckEnabled(context)) return;
  const cache = await readCache();
  const notice = noticeFor(cache, current);
  if (notice) process.stderr.write(`\n${notice}\n`);
  if (!cache?.checkedAt || Date.now() - Date.parse(cache.checkedAt) > DAY) {
    try {
      const worker = fileURLToPath(new URL("./update-worker.js", import.meta.url));
      spawn(process.execPath, [worker], { detached: true, stdio: "ignore", env: process.env }).unref();
    } catch {
      // An update check must never break a command.
    }
  }
}

/** Changelog sections newer than `current` and up to `latest`. */
export function changelogBetween(markdown, current, latest) {
  const sections = [];
  const pattern = /^## \[?v?(\d+\.\d+\.\d+[\w.-]*)\]?.*$/gmu;
  const headings = [...markdown.matchAll(pattern)];
  for (const [index, heading] of headings.entries()) {
    const version = heading[1];
    if (compareVersions(version, current) <= 0 || compareVersions(version, latest) > 0) continue;
    const end = headings[index + 1]?.index ?? markdown.length;
    sections.push({ version, text: markdown.slice(heading.index, end).trim() });
  }
  return sections;
}

export async function fetchChangelog({ timeout = 5000 } = {}) {
  const response = await fetch(process.env.BCA_CHANGELOG_URL ?? CHANGELOG_URL, { signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`changelog request answered ${response.status}`);
  return response.text();
}
