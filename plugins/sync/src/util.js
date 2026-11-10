// Small shared helpers: hashing, stable JSON, ids, file writes that only touch changed files.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** JSON with sorted keys, so equal data always hashes and writes the same. */
export function stableStringify(value, indent = 0) {
  const sort = (item) => {
    if (Array.isArray(item)) return item.map(sort);
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.keys(item).sort().map((key) => [key, sort(item[key])]));
    }
    return item;
  };
  return JSON.stringify(sort(value), null, indent);
}

/** Lowercase hyphenated id, the same rule the AL side uses for BC Atlas [DOC-ID]s. */
export function kebabId(value) {
  // Runs of other characters become one hyphen; trimming is done without a regex, so input made
  // of many hyphens cannot make the match slow (one hyphen at most remains at each end).
  let id = String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/gu, "-");
  if (id.startsWith("-")) id = id.slice(1);
  if (id.endsWith("-")) id = id.slice(0, -1);
  id = id.slice(0, 80);
  if (id.endsWith("-")) id = id.slice(0, -1);
  return id || "process";
}

/** Text for a Markdown table cell: backslashes and pipes escaped, line breaks as spaces. */
export function markdownCell(text) {
  return String(text ?? "")
    .replace(/\\/gu, "\\\\")
    .replace(/\|/gu, "\\|")
    .replace(/\r?\n/gu, " ");
}

/** "*", "Order*", "post-*" style globs against several candidate strings (case-insensitive). */
export function matchesAny(patterns, candidates) {
  if (!patterns?.length) return true;
  return patterns.some((pattern) => {
    const regex = new RegExp(`^${String(pattern).toLowerCase().replace(/[.+?^${}()|[\]\\]/gu, "\\$&").replace(/\*/gu, ".*")}$`, "u");
    return candidates.some((candidate) => candidate !== undefined && regex.test(String(candidate).toLowerCase()));
  });
}

export function toPosix(relative) {
  return relative.split(path.sep).join("/");
}

/** Writes only when the content differs; returns true when the file changed. */
export async function writeIfChanged(file, content) {
  const data = Buffer.isBuffer(content) ? content : Buffer.from(String(content), "utf8");
  try {
    const current = await fs.readFile(file);
    if (current.equals(data)) return false;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
  return true;
}

export async function removeFile(file) {
  try {
    await fs.unlink(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
