// The processes of a project with everything that is said about them: the models of .bca.json, the
// processes as they are (mined from the process tests and recordings), and how each model runs.
import path from "node:path";
import { loadConfig } from "../config.js";
import { mineProcesses, PROCESS_SCHEMA, processesConfig, processJson, runProcesses } from "./index.js";
import { fetchTelemetry, readTelemetry, timeProcess, timingFindings } from "./telemetry.js";

/**
 * @param input the project
 * @param values the options of the simulation: tests, recordings, company, language, config, projectRoot, compiler;
 *   and telemetry: a file or folder of exported telemetry (default: processTelemetry.path in .bca.json)
 * @param context { report } a simulation that ran already (the view has one), cache, parseCache;
 *   { live: false } does not ask Application Insights (what is generated from the source asks nobody)
 * @returns { schema, processes: [json], runs, mined, simulated, roles, tests: [{ id, title, feature, recorded }], telemetry? }
 *   with telemetry, every run and every mined process has `timing`, and every step of a run its own
 */
export async function describeProcesses(input, values = {}, context = {}) {
  const root = path.resolve(values.projectRoot ?? input ?? ".");
  const config = (await loadConfig(root, values.config)).values;
  const processes = processesConfig(config);
  let report = context.report;
  if (report === undefined) {
    const { simulate } = await import("../simulation/index.js");
    try {
      report = await simulate(input ?? ".", values, context);
    } catch (error) {
      // Without process tests and recordings there is nobody to run a process with; the models are still there.
      if (!/no process tests found/u.test(error.message)) throw error;
    }
  }
  const runs = runProcesses(processes, report);
  const mined = report ? mineProcesses(report) : [];
  // Telemetry: what really happened, with its time, laid over the processes.
  const settings = config.processTelemetry ?? {};
  const source = values.telemetry ? path.resolve(values.telemetry) : settings.path ? path.resolve(root, settings.path) : undefined;
  let telemetry;
  if (source || (settings.appId && context.live !== false && process.env.BCA_TELEMETRY_API_KEY)) {
    const events = source ? await readTelemetry(source, { caseField: settings.case }) : await fetchTelemetry(settings, { caseField: settings.case });
    const tasks = new Map((report?.tasks ?? []).map((task) => [task.id, task]));
    for (const run of runs) {
      const timing = timeProcess(run.steps, events, tasks, settings.steps);
      if (!timing) continue;
      run.timing = timing;
      for (const step of run.steps) if (timing.steps[step.id]) step.timing = timing.steps[step.id];
      run.findings.push(...timingFindings(run, timing));
    }
    for (const found of mined) {
      const timing = timeProcess(found.steps, events, tasks, settings.steps);
      if (timing) found.timing = timing;
    }
    telemetry = {
      source: source ? path.relative(root, source).replaceAll("\\", "/") || "." : "Application Insights",
      events: events.length,
      ...(events.length ? { from: new Date(events[0].time).toISOString(), to: new Date(events.at(-1).time).toISOString() } : {}),
      case: settings.case ?? "session"
    };
  }
  return {
    schema: PROCESS_SCHEMA,
    processes: processes.map(processJson),
    runs,
    mined,
    ...(telemetry ? { telemetry } : {}),
    simulated: Boolean(report),
    roles: (report?.roles ?? []).map(({ name, description }) => ({ name, ...(description ? { description } : {}) })),
    tests: (report?.tasks ?? []).map((task) => ({ id: task.id, title: task.title, feature: task.features?.[0], recorded: Boolean(task.recorded || task.recording) }))
  };
}
