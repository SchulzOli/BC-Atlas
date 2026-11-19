#!/usr/bin/env node

// Syntax-checks every JavaScript module in src/ and scripts/ without
// executing it, so new files are covered automatically.
import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function javascriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await javascriptFiles(target));
    else if (/\.(?:js|mjs)$/u.test(entry.name)) files.push(target);
  }
  return files;
}

const files = [
  ...await javascriptFiles(path.join(root, "src")),
  ...await javascriptFiles(path.join(root, "scripts"))
];
let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    failed++;
    process.stderr.write(result.stderr);
  }
}
if (failed) {
  console.error(`${failed} of ${files.length} file(s) failed the syntax check.`);
  process.exitCode = 1;
} else {
  console.log(`Syntax check passed for ${files.length} file(s).`);
}
