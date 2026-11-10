import fs from "node:fs/promises";
import path from "node:path";
import { CheckFailedError } from "../cli/errors.js";
import { displayPath } from "../output.js";
import { simulate } from "../simulation/index.js";
import { renderSimulation, simulationResultLine } from "../simulation/report.js";
import { terminalProgress } from "./check.js";

/** Runs the battle test and writes its report (the default of `bca run`: Markdown in docs/simulation). */
export async function writeSimulation(input, values = {}, context = {}) {
  const report = await simulate(input, values, context);
  const format = values.format ?? (values.output && /\.md$/iu.test(values.output) ? "markdown" : values.output && /\.json$/iu.test(values.output) ? "json" : "text");
  const content = renderSimulation(report, format, { marker: Boolean(values.output) });
  let output;
  if (values.output) {
    output = path.resolve(values.output);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, content);
  }
  return { report, content, output, format };
}

export async function simulateCommand(input, values) {
  const { report, content, output } = await writeSimulation(input, values, { onProgress: terminalProgress() });
  if (output) {
    console.error(simulationResultLine(report));
    console.error(`Wrote ${displayPath(output)}`);
  } else {
    process.stdout.write(content);
  }
  if (!report.passed) throw new CheckFailedError("battle test failed");
}
