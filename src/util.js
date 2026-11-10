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
  const id = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
  return id || "process";
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
