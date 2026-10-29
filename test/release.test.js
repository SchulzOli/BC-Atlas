import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));

test("the npm package and the VS Code extension are released under one version", () => {
  const version = read("package.json").version;
  assert.equal(read("vscode/package.json").version, version, "set both with npm run version:set -- <version>");
  for (const file of ["package-lock.json", "vscode/package-lock.json"]) {
    const lock = read(file);
    assert.equal(lock.version, version, `${file} is out of date`);
    assert.equal(lock.packages[""].version, version, `${file} is out of date`);
  }
});
