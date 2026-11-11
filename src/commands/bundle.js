// `bca bundle`: everything BC Atlas makes of a project, end to end, as one
// artifact. From the source it validates (the health check), simulates (the
// battle test, on process tests and recordings), writes a snapshot of every
// process test, the layered documentation with the view, and the narrative
// pages when a model is set up; it takes in the results of tests that really
// ran and the build outputs it is given; and it says in one manifest and one
// page what happened, for which commit.
//
//   bc-atlas-bundle/
//     README.md            what this bundle is, and how every step went
//     bundle.json          the manifest: source, steps, every file with its hash
//     check/               the health check: README.md, report.json
//     simulation/          the battle test: README.md, report.json
//     snapshots/           one fact snapshot per process test, from the source
//     docs/                the layered documentation, with view.html
//     narrative/           pages a model wrote from the facts (when the ai plugin is set up)
//     tests/               results of tests that ran (--test-results)
//     build/               what else belongs to it (--include): the .app file, logs
//   bc-atlas-bundle.zip    the same, as one file
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { readFileSync } from "node:fs";
import { buildLayers } from "../app/layers.js";
import { Workspace } from "../app/workspace.js";
import { findGitRoot, git } from "../automation/git.js";
import { UsageError } from "../cli/errors.js";
import { loadConfig } from "../config.js";
import { formatHealthMarkdown } from "../health.js";
import { displayPath } from "../output.js";
import { loadPlugins } from "../plugins/registry.js";
import { simulate } from "../simulation/index.js";
import { formatSimulationMarkdown, simulationResultLine } from "../simulation/report.js";
import { snapshotOf } from "../simulation/snapshots.js";
import { zipArchive } from "../zip.js";
import { runHealthCheck } from "./check.js";

export const BUNDLE_SCHEMA = "bc-atlas.bundle/1";
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const several = (value) => [value ?? []].flat().flatMap((item) => String(item).split(",")).map((item) => item.trim()).filter(Boolean);
const slug = (text) => String(text).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "process";

/** Every file below a path, as [relative path, absolute path]. */
async function filesBelow(start, base = path.dirname(start)) {
  const stat = await fs.stat(start).catch(() => undefined);
  if (!stat) throw new UsageError(`${start} does not exist`);
  if (stat.isFile()) return [[path.relative(base, start).replaceAll("\\", "/"), start]];
  const found = [];
  for (const entry of (await fs.readdir(start, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    found.push(...await filesBelow(path.join(start, entry.name), base));
  }
  return found;
}

/**
 * What a file of test results says: JUnit (testsuite) or xUnit (assembly) XML.
 * @returns { tests, failed, skipped } or undefined when it is neither
 */
export function testCounts(xml) {
  const number = (tag, name) => [...xml.matchAll(new RegExp(`<${tag}\\b[^>]*\\b${name}="(\\d+)"`, "gu"))].reduce((sum, [, value]) => sum + Number(value), 0);
  if (/<assembly\b[^>]*\btotal="/u.test(xml)) return { tests: number("assembly", "total"), failed: number("assembly", "failed"), skipped: number("assembly", "skipped") };
  if (/<testsuite\b[^>]*\btests="/u.test(xml)) return { tests: number("testsuite", "tests"), failed: number("testsuite", "failures") + number("testsuite", "errors"), skipped: number("testsuite", "skipped") };
  return undefined;
}

/**
 * Builds the bundle.
 * @param input the project
 * @param values { output, testResults, include, noZip, noNarrative, pictures, title, ... } and the analysis options
 * @returns { output, zip, passed, manifest }
 */
export async function createBundle(input, values = {}, context = {}) {
  const root = path.resolve(values.projectRoot ?? input ?? ".");
  const config = (await loadConfig(root, values.config).catch(() => ({ values: {} }))).values;
  const output = path.resolve(values.output ?? "bc-atlas-bundle");
  if (path.resolve(output) === root) throw new UsageError("the bundle needs a folder of its own, not the project");
  const analysis = Object.fromEntries(["projectRoot", "config", "compiler", "compilerLog", "paths"].filter((key) => values[key] !== undefined).map((key) => [key, values[key]]));
  const files = new Map();
  const steps = [];
  const put = (file, content) => files.set(file, Buffer.isBuffer(content) ? content : Buffer.from(content));
  const step = (id, title, status, summary) => steps.push({ id, title, status, summary });

  // 1. Validation: the health check of the source.
  const { report: health } = await runHealthCheck(root, analysis, context);
  put("check/README.md", `# Health check\n\n${formatHealthMarkdown(health, { heading: "## Result" })}\n`);
  put("check/report.json", `${JSON.stringify(health, null, 2)}\n`);
  step("check", "Validation", health.passed ? "passed" : "failed", `${health.counts.error} error(s), ${health.counts.warning} warning(s), ${health.counts.info} info`);

  // 2. Simulation: the battle test on process tests and recordings, and a snapshot of each process test.
  let simulation;
  try {
    simulation = await simulate(root, analysis, context);
  } catch (error) {
    if (!/no process tests found/u.test(error.message)) throw error;
    step("simulate", "Simulation", "skipped", "the project has no process tests (AL UI tests with [SCENARIO]) and no recordings");
  }
  if (simulation) {
    put("simulation/README.md", formatSimulationMarkdown(simulation));
    put("simulation/report.json", `${JSON.stringify(simulation, null, 2)}\n`);
    step("simulate", "Simulation", simulation.passed ? "passed" : "failed", simulationResultLine(simulation));
    const tests = simulation.tasks.filter((task) => !task.recorded);
    for (const task of tests) put(`snapshots/${slug(task.id)}.json`, `${JSON.stringify(snapshotOf(task, simulation), null, 2)}\n`);
    step("snapshots", "Snapshots from the source", tests.length ? "passed" : "skipped", tests.length ? `${tests.length} process test(s) as fact snapshots` : "no process tests");
  }
  const runsOf = (atlas) => atlas.stories.filter(({ kind }) => kind === "run");

  // 3. Documentation: the layers from the system down to each procedure, and the view of it.
  const layers = await buildLayers(new Workspace(root, analysis, { live: false }), { pictures: values.pictures ?? config.layers?.pictures ?? "auto", view: true });
  for (const [file, content] of layers.files) put(`docs/${file}`, content);
  const counts = layers.manifest.counts;
  step("docs", "Documentation", "passed", `${counts.objects} object(s) in ${counts.apps} app(s), ${layers.files.size} file(s)`);
  // The runs of the simulation are pages of the documentation: one per person, step by step, with the picture the run built.
  const runs = runsOf(layers.atlas);
  if (runs.length) steps.splice(steps.findIndex(({ id }) => id === "snapshots") + 1, 0, { id: "runs", title: "Runs, step by step", status: "passed", summary: `${runs.length} run(s), one per person: ${runs.map(({ title }) => title).join(", ")}` });

  // 4. Narrative: what a model writes from the facts, when one is set up. It never fails the bundle.
  if (values.noNarrative) step("narrative", "Narrative", "skipped", "switched off");
  else {
    try {
      const registry = await loadPlugins(root, config);
      const plugin = registry.list().find(({ id, enabled }) => id === "ai" && enabled);
      const status = plugin ? await (await registry.activate("ai")).commands.status({ root, values: {} }) : undefined;
      if (!status?.ready) step("narrative", "Narrative", "skipped", plugin ? "no model is set up (ai.endpoint and ai.model, see bca ai status)" : "the ai plugin is switched off");
      else {
        const temporary = path.join(output, ".narrative");
        const written = await (await registry.activate("ai")).commands.write({ root, values: { output: temporary, force: true } });
        for (const [file, absolute] of await filesBelow(temporary, temporary)) put(`narrative/${file}`, await fs.readFile(absolute));
        await fs.rm(temporary, { recursive: true, force: true });
        step("narrative", "Narrative", "passed", `${written.written} page(s) written with ${written.model}`);
      }
    } catch (error) {
      step("narrative", "Narrative", "skipped", `not written: ${error.message}`);
    }
  }

  // 5. What ran outside BC Atlas: the results of tests, and build outputs.
  const results = several(values.testResults);
  if (results.length) {
    const totals = { tests: 0, failed: 0, skipped: 0 };
    let read = 0;
    for (const item of results) {
      for (const [file, absolute] of await filesBelow(path.resolve(item))) {
        const content = await fs.readFile(absolute);
        put(`tests/${file}`, content);
        const found = /\.xml$/iu.test(file) ? testCounts(content.toString("utf8")) : undefined;
        if (!found) continue;
        read++;
        for (const key of Object.keys(totals)) totals[key] += found[key];
      }
    }
    step("tests", "Tests that ran", !read ? "skipped" : totals.failed ? "failed" : "passed", read ? `${totals.tests} test(s), ${totals.failed} failed, ${totals.skipped} skipped, from ${read} result file(s)` : "no JUnit or xUnit result file among the given paths");
  } else step("tests", "Tests that ran", "skipped", "no results given (--test-results); BC Atlas reads the source and runs no test itself");
  const included = several(values.include);
  if (included.length) {
    let count = 0;
    for (const item of included) {
      for (const [file, absolute] of await filesBelow(path.resolve(item))) {
        put(`build/${file}`, await fs.readFile(absolute));
        count++;
      }
    }
    step("build", "Build outputs", "passed", `${count} file(s) included`);
  } else step("build", "Build outputs", "skipped", "nothing included (--include)");

  // The source this is a bundle of.
  const repository = await findGitRoot(root);
  const read = (...args) => (repository ? git(repository, args) : undefined);
  const commit = read("rev-parse", "HEAD");
  const source = {
    commit: commit?.status === 0 ? commit.stdout.trim() : undefined,
    branch: commit?.status === 0 ? read("rev-parse", "--abbrev-ref", "HEAD").stdout.trim() : undefined,
    dirty: commit?.status === 0 ? Boolean(read("status", "--porcelain", "--", root).stdout.trim()) : undefined
  };
  const passed = steps.every(({ status }) => status !== "failed");
  const title = values.title ?? layers.atlas.title;
  const createdAt = (context.now ?? new Date()).toISOString();
  const mark = { passed: "✅ passed", failed: "❌ failed", skipped: "– skipped" };
  const where = { check: "check/README.md", simulate: "simulation/README.md", runs: "docs/README.md#stories", snapshots: "snapshots/", docs: "docs/README.md", narrative: "narrative/", tests: "tests/", build: "build/" };
  put("README.md", [
    `# ${title}: bundle`, "",
    `${passed ? "Everything passed." : "Not everything passed."} Made by BC Atlas ${pkg.version} on ${createdAt.slice(0, 10)}${source.commit ? ` from commit \`${source.commit.slice(0, 10)}\`${source.branch && source.branch !== "HEAD" ? ` on \`${source.branch}\`` : ""}${source.dirty ? ", with changes that are not committed" : ""}` : ""}.`, "",
    "| Step | Result | What | Where |", "| --- | --- | --- | --- |",
    ...steps.map(({ id, title: name, status, summary }) => `| ${name} | ${mark[status]} | ${String(summary).replaceAll("|", "\\|")} | ${status === "skipped" ? "" : `[${where[id]}](${where[id]})`} |`), "",
    "Start with [docs/README.md](docs/README.md): the system from the whole down to each procedure. [docs/view.html](docs/view.html) is the BC Atlas view of it, to open in a browser.", "",
    "`bundle.json` lists the source, every step, and every file with its hash.", ""
  ].join("\n"));
  const listed = [...files].sort(([a], [b]) => a.localeCompare(b)).map(([file, data]) => ({ path: file, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") }));
  const manifest = { schema: BUNDLE_SCHEMA, title, createdAt, bcAtlas: pkg.version, source, passed, steps, counts, files: listed };
  put("bundle.json", `${JSON.stringify(manifest, null, 2)}\n`);

  // The folder holds exactly the bundle: what an earlier run left is gone.
  await fs.rm(output, { recursive: true, force: true });
  for (const [file, data] of files) {
    const target = path.join(output, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
  }
  let zip;
  if (!values.noZip) {
    zip = `${output}.zip`;
    await fs.writeFile(zip, zipArchive([...files].sort(([a], [b]) => a.localeCompare(b)).map(([file, data]) => ({ path: `${path.basename(output)}/${file}`, data })), context.now ?? new Date()));
  }
  return { output, zip, passed, manifest };
}

export async function bundleCommand(input, values) {
  const { output, zip, passed, manifest } = await createBundle(input, values);
  if (values.format === "json") process.stdout.write(`${JSON.stringify({ ...manifest, files: manifest.files.length, output: displayPath(output), zip: zip ? displayPath(zip) : undefined }, null, 2)}\n`);
  else {
    const mark = { passed: "ok     ", failed: "FAILED ", skipped: "skipped" };
    console.error([
      `${manifest.title}: ${passed ? "everything passed" : "not everything passed"}`,
      ...manifest.steps.map(({ title, status, summary }) => `  ${mark[status]}  ${title.padEnd(26)} ${summary}`),
      `Wrote ${manifest.files.length + 1} file(s) to ${displayPath(output)}${zip ? ` and ${displayPath(zip)}` : ""}`
    ].join("\n"));
  }
  if (!passed) process.exitCode = 1;
}
