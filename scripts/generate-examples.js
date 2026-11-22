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

// Pictures of the warehouse example: a lens of the view each, as `bca view` draws it.
const pictures = [
  ["overview", ["--lens", "overview"]],
  ["data", ["--lens", "data", "--form", "diagram"]],
  ["pages", ["--lens", "pages", "--form", "diagram"]]
];

function run(arguments_, { exitCodes = [0] } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...arguments_], {
      cwd: root,
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
for (const [name, options] of pictures) {
  await run(["view", input, ...options, "--output", path.join(output, `${name}.svg`)]);
}

// The README shows these pictures as PNG, rendered from the SVG files.
const { svgToPng } = await import("../src/diagram/png.js");
const images = path.join(root, "docs", "generated", "images");
for (const [name] of pictures) {
  const svg = await fs.readFile(path.join(output, `${name}.svg`), "utf8");
  await fs.writeFile(path.join(images, `${name}-lens.png`), await svgToPng(svg, { scale: 1.5 }));
}

await run([
  "docs", "generate", input,
  "--app", input,
  "--export", "markdown,html,dita,ado-csv,bpmn",
  "--output-dir", path.join("examples", "docs")
]);

// The layered documentation of the example with three apps: the system down to each procedure.
await run(["layers", path.join("examples", "multi-app"), "-o", path.join("examples", "layers")]);
