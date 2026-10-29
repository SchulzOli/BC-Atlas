#!/usr/bin/env node
// Sets one version for the npm package and the VS Code extension, with their
// lock files, so both are released under the same number:
//   npm run version:set -- 0.10.0
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version ?? "")) {
  console.error("Usage: npm run version:set -- <major.minor.patch>");
  process.exit(2);
}

const update = (file, change) => {
  const target = path.join(root, file);
  const json = JSON.parse(readFileSync(target, "utf8"));
  change(json);
  writeFileSync(target, `${JSON.stringify(json, null, 2)}\n`);
};

for (const folder of [".", "vscode"]) {
  update(path.join(folder, "package.json"), (manifest) => {
    manifest.version = version;
  });
  update(path.join(folder, "package-lock.json"), (lock) => {
    lock.version = version;
    if (lock.packages?.[""]) lock.packages[""].version = version;
  });
}
console.log(`bc-atlas and the VS Code extension are now ${version}`);
