import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { loadProject, projectLevels } from "../project.js";
import { CheckFailedError } from "../cli/errors.js";
import { displayPath } from "../output.js";
import { assessHealth, formatHealthMarkdown, formatHealthText, healthResultLine } from "../health.js";
import { renderSarif } from "../sarif.js";

/**
 * Reads a project and assesses its health.
 * @returns { loaded, levels, report }: what src/project.js read, what depends on what, and the health report
 */
export async function runHealthCheck(input, values = {}, context = {}) {
  // Strict mode becomes a fail threshold so the report is still produced.
  const loaded = await loadProject(input, { ...values, strict: false }, context);
  const settings = { ...(loaded.options.check ?? {}) };
  if (values.strict) settings.failOn = "warning";
  for (const name of ["failOn", "maxFanIn", "maxFanOut"]) {
    if (values[name] !== undefined) settings[name] = values[name];
  }
  const levels = projectLevels(loaded);
  return { loaded, levels, report: assessHealth(loaded.model, settings, { levels }) };
}

const VERSION = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;

export function renderHealth(report, format, { root, fallbackFile } = {}) {
  if (format === "json") return `${JSON.stringify(report, null, 2)}\n`;
  if (format === "sarif") return renderSarif(report, { root, fallbackFile, version: VERSION });
  if (format === "markdown") return formatHealthMarkdown(report, { heading: "# Architecture health" });
  return formatHealthText(report);
}

export async function checkCommand(input, values) {
  const { report, loaded } = await runHealthCheck(input, values);
  const { model, options } = loaded;
  const content = renderHealth(report, values.format ?? "text", {
    root: options.projectRoot,
    fallbackFile: model.apps?.[0]?.path ?? "app.json"
  });
  if (values.output) {
    const output = path.resolve(values.output);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, content);
    console.error(healthResultLine(report));
    console.error(`Wrote ${displayPath(output)}`);
  } else {
    process.stdout.write(content);
  }
  if (!report.passed) throw new CheckFailedError("health check failed");
}
