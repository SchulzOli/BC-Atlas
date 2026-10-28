import fs from "node:fs/promises";
import path from "node:path";
import { CheckFailedError } from "../cli/errors.js";
import { displayPath } from "../output.js";
import { assessArchitecture } from "../blueprint/index.js";
import { writeBaseline } from "../blueprint/baseline.js";
import { architectureJson, formatArchitectureMarkdown, formatArchitectureText } from "../blueprint/report.js";
import { formatExtractionMarkdown, formatExtractionText, planExtraction } from "../blueprint/extract.js";
import { writeSurface } from "../blueprint/surface.js";

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

function renderExtraction(plan, format = "text") {
  if (format === "json") return `${JSON.stringify(plan, null, 2)}\n`;
  if (format === "markdown") return formatExtractionMarkdown(plan);
  return formatExtractionText(plan);
}

export async function architectureCommand(input, values) {
  const assessment = await assessArchitecture(input, values);
  const content = values.extract
    ? renderExtraction(planExtraction(assessment, values.extract), values.format ?? "text")
    : renderArchitecture(assessment, values.format ?? "text");
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
  if (values.updateSurface) {
    if (assessment.proposal) throw new Error("no architecture is configured yet; adopt one first (--propose --write)");
    await writeSurface(assessment.context.surfaceFile, assessment.result.surface, assessment.model);
    const objects = assessment.result.surface.reduce((total, { api }) => total + api.length, 0);
    console.error(`Recorded the public surface (${objects} object(s) other components use) in ${displayPath(assessment.context.surfaceFile)}`);
    if (!values.updateBaseline) return;
  }
  if (values.updateBaseline) {
    await writeBaseline(assessment.context.baselineFile, assessment.result.violations);
    console.error(`Accepted ${assessment.result.violations.length} violation(s) in ${displayPath(assessment.context.baselineFile)}`);
    return;
  }
  // An extraction plan is information; the architecture check stays with bca architecture and bca check.
  if (!assessment.proposal && !values.write && !values.extract && assessment.baseline.new.length) {
    throw new CheckFailedError(`${assessment.baseline.new.length} dependency(ies) violate the architecture`);
  }
}
