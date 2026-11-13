import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createArchitectureModel } from "../architecture.js";
import { CheckFailedError, UsageError } from "../cli/errors.js";
import { displayPath } from "../output.js";
import { assessHealth, formatHealthMarkdown, formatHealthText, healthResultLine } from "../health.js";
import { compareHealth } from "../health-trend.js";
import { assessArchitecture } from "../blueprint/index.js";
import { renderSarif } from "../sarif.js";
import { withPluginFindings } from "../plugins/health.js";

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
  // Plugins add their own rules (plugin.json contributes.healthRules).
  const report = await withPluginFindings(assessHealth(architecture.model, settings), {
    root: architecture.options.projectRoot,
    configPath: values.config,
    model: architecture.model
  });
  return { architecture, blueprint, report };
}

const VERSION = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;

/** Progress of the AL compile on stderr, for people at a terminal only. */
export function terminalProgress() {
  return process.stderr.isTTY ? (message) => console.error(`${message} ...`) : undefined;
}

export function renderHealth(report, format, { root, fallbackFile } = {}) {
  if (format === "json") return `${JSON.stringify(report, null, 2)}\n`;
  if (format === "sarif") return renderSarif(report, { root, fallbackFile, version: VERSION });
  if (format === "markdown") return formatHealthMarkdown(report, { heading: "# Architecture health" });
  return formatHealthText(report);
}

/** The report with its trend against an earlier report of `bca check --format json`. */
export async function withTrend(report, file) {
  let previous;
  try {
    previous = JSON.parse(await fs.readFile(path.resolve(file), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") throw new UsageError(`--compare: file not found: ${file}`);
    if (!(error instanceof SyntaxError)) throw error;
    throw new UsageError(`--compare: ${file} is not JSON; write one with "bca check --format json -o <file>"`);
  }
  try {
    return { ...report, trend: compareHealth(report, previous, { source: displayPath(path.resolve(file)) }) };
  } catch {
    throw new UsageError(`--compare: ${file} is not a health report; write one with "bca check --format json -o <file>"`);
  }
}

export async function checkCommand(input, values) {
  const result = await runHealthCheck(input, values, { onProgress: terminalProgress() });
  const { architecture } = result;
  const report = values.compare ? await withTrend(result.report, values.compare) : result.report;
  const { model, options } = architecture;
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
  if (!report.passed) throw new CheckFailedError("architecture health check failed");
}
