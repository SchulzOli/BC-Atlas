import fs from "node:fs/promises";
import path from "node:path";
import { CheckFailedError } from "../cli/errors.js";
import { displayPath } from "../output.js";
import { assessArchitecture } from "../blueprint/index.js";
import { writeBaseline } from "../blueprint/baseline.js";
import { architectureJson, formatArchitectureMarkdown, formatArchitectureText } from "../blueprint/report.js";

export function renderArchitecture(assessment, format = "text") {
  if (format === "json") return `${JSON.stringify(architectureJson(assessment), null, 2)}\n`;
  if (format === "markdown") return formatArchitectureMarkdown(assessment);
  return formatArchitectureText(assessment);
}

/** Saves the evaluated architecture in .bca.json, keeping every other setting. */
export async function writeArchitectureConfig(assessment) {
  const file = assessment.context.config.path ?? path.join(assessment.context.projectRoot, ".bca.json");
  let config = {};
  try {
    config = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  config.architecture = { ...(config.architecture ?? {}), ...assessment.architecture };
  await fs.writeFile(file, `${JSON.stringify(config, null, 2)}\n`);
  return file;
}

export async function architectureCommand(input, values) {
  const assessment = await assessArchitecture(input, values);
  const content = renderArchitecture(assessment, values.format ?? "text");
  if (values.output) {
    const output = path.resolve(values.output);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, content);
    console.error(`Wrote ${displayPath(output)}`);
  } else {
    process.stdout.write(content);
  }
  if (values.write) {
    console.error(`Saved the architecture to ${displayPath(await writeArchitectureConfig(assessment))}`);
  }
  if (values.updateBaseline) {
    await writeBaseline(assessment.context.baselineFile, assessment.result.violations);
    console.error(`Accepted ${assessment.result.violations.length} violation(s) in ${displayPath(assessment.context.baselineFile)}`);
    return;
  }
  if (!assessment.proposal && !values.write && assessment.baseline.new.length) {
    throw new CheckFailedError(`${assessment.baseline.new.length} dependency(ies) violate the architecture`);
  }
}
