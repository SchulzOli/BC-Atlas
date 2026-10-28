import fs from "node:fs/promises";
import path from "node:path";
import { createArchitectureModel } from "../architecture.js";
import { CheckFailedError } from "../cli/errors.js";
import { displayPath } from "../output.js";
import { assessHealth, formatHealthMarkdown, formatHealthText, healthResultLine } from "../health.js";
import { assessArchitecture } from "../blueprint/index.js";

export async function runHealthCheck(input, values = {}, context = {}) {
  // Strict mode becomes a fail threshold so the report is still produced.
  const cache = context.cache ?? new Map();
  const architecture = await createArchitectureModel(input, { ...values, view: "project", strict: false }, { ...context, cache });
  const settings = { ...(architecture.options.check ?? {}) };
  if (values.strict) settings.failOn = "warning";
  for (const name of ["failOn", "maxFanIn", "maxFanOut"]) {
    if (values[name] !== undefined) settings[name] = values[name];
  }
  // The target architecture from .bca.json is part of the health check.
  let blueprint;
  if (architecture.options.architecture?.components?.length) {
    const model = structuredClone(cache.get(architecture.options.projectRoot));
    blueprint = await assessArchitecture(input, { ...values, propose: false }, { model });
    settings.architecture = blueprint;
  }
  return { architecture, blueprint, report: assessHealth(architecture.model, settings) };
}

export function renderHealth(report, format) {
  if (format === "json") return `${JSON.stringify(report, null, 2)}\n`;
  if (format === "markdown") return formatHealthMarkdown(report, { heading: "# Architecture health" });
  return formatHealthText(report);
}

export async function checkCommand(input, values) {
  const { report } = await runHealthCheck(input, values);
  const content = renderHealth(report, values.format ?? "text");
  if (values.output) {
    const output = path.resolve(values.output);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, content);
    console.error(healthResultLine(report));
    console.error(`Wrote ${displayPath(output)}`);
  } else {
    process.stdout.write(content);
  }
  if (!report.passed) throw new CheckFailedError("architecture health check failed");
}
