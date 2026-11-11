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

function run(arguments_, { exitCodes = [0] } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...arguments_], {
      cwd: root,
      // The examples are compared in CI, so they must not depend on whether
      // the machine has Microsoft's AL toolchain installed.
      env: { ...process.env, BCA_AL_COMPILER: "off" },
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (exitCodes.includes(code)) resolve();
      else reject(new Error(`BC Atlas exited with code ${code}`));
    });
  });
}

await fs.mkdir(output, { recursive: true });
for (const [name, options] of diagrams) {
  await run(["export", input, ...options, "--format", "d2", "--output", path.join(output, `${name}.d2`)]);
  await run([
    "export",
    input,
    ...options,
    "--format",
    "svg",
    "--output",
    path.join(output, `${name}.svg`)
  ]);
}

// The README shows these diagrams as PNG, rendered from the SVG files.
const { svgToPng } = await import("../src/diagram/png.js");
const images = path.join(root, "docs", "generated", "images");
for (const [name, image] of [["project", "project-view"], ["workflow", "workflow-view"], ["ui", "ui-view"]]) {
  const svg = await fs.readFile(path.join(output, `${name}.svg`), "utf8");
  const width = Number(/viewBox="0 0 (\d+)/u.exec(svg)[1]);
  await fs.writeFile(path.join(images, `${image}.png`), await svgToPng(svg, { scale: Math.min(1.5, 2400 / width) }));
}

await run(["export", input, "--view", "report", "-o", path.join("examples", "report"), "--codegraph"]);
await run(["export", input, "--view", "handbook", "-o", path.join("examples", "handbook"), "--catalog", path.join("examples", "report", "objects")]);
await run([
  "docs", "generate", input,
  "--app", input,
  "--export", "markdown,html,dita,ado-csv,bpmn",
  "--output-dir", path.join("examples", "docs")
]);

// The battle test of the purchasing example. Its findings are the point of
// the example, so the failed result (exit code 1) is expected.
const purchasing = path.join(root, "examples", "purchasing-app");
// The layered documentation of the example with three apps: the system down to each procedure.
await run(["layers", path.join("examples", "multi-app"), "-o", path.join("examples", "layers")]);
await run(["simulate", purchasing, "-o", path.join("examples", "simulation", "README.md")], { exitCodes: [1] });
await run(["simulate", purchasing, "-o", path.join("examples", "simulation", "README.de.md"), "--language", "de"], { exitCodes: [1] });
// A run of the simulation: Ben at work, step by step, and the picture where he is stopped and at the end.
await run(["view", purchasing, "--story", "run:Ben", "-o", path.join("examples", "simulation", "run-ben.md")]);
await run(["view", purchasing, "--story", "run:Ben", "--step", "13", "--form", "diagram", "-o", path.join("examples", "simulation", "run-ben-stopped.svg")]);
await run(["view", purchasing, "--story", "run:Ben", "--step", "15", "--form", "diagram", "-o", path.join("examples", "simulation", "run-ben.svg")]);

// The knowledge graph of the warehouse example, with a fixed date so it only changes with the source.
process.env.SOURCE_DATE_EPOCH = "1735689600";
const { writeKnowledgeGraph } = await import("../src/knowledge/index.js");
const knowledge = path.join(root, "examples", "knowledge-graph");
for (const format of ["ttl", "owl"]) {
  const result = await writeKnowledgeGraph(input, { output: path.join(knowledge, `warehouse-app.${format}`), title: "BC Atlas Warehouse Example" });
  console.log(`Wrote examples/knowledge-graph/warehouse-app.${format} (${result.triples} triples)`);
}
delete process.env.SOURCE_DATE_EPOCH;

const { createExplorerExample } = await import("./explorer-example.js");
const explorer = await createExplorerExample(root);
await fs.mkdir(path.join(root, "examples", "explorer"), { recursive: true });
await fs.writeFile(
  path.join(root, "examples", "explorer", "dependencies.json"),
  `${JSON.stringify(explorer, null, 2)}\n`
);
console.log("Wrote examples/explorer/dependencies.json");
