#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const input = path.join(root, "examples", "warehouse-app");
const output = path.join(root, "examples", "output");
const cli = path.join(root, "src", "cli.js");

const diagrams = [
  ["project", ["--view", "project", "--title", "Warehouse architecture"]],
  [
    "workflow",
    [
      "--view",
      "workflow",
      "--entry",
      "procedure:Warehouse Processor.Process",
      "--title",
      "Request processing flow"
    ]
  ],
  ["ui", ["--view", "ui", "--focus", "Warehouse", "--title", "Warehouse UI composition"]]
];

function run(arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...arguments_], {
      cwd: root,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`BC Atlas exited with code ${code}`));
    });
  });
}

await fs.mkdir(output, { recursive: true });
for (const [name, options] of diagrams) {
  await run(["graph", input, ...options, "--output", path.join(output, `${name}.d2`)]);
  await run([
    "graph",
    input,
    ...options,
    "--format",
    "svg",
    "--output",
    path.join(output, `${name}.svg`)
  ]);
}
