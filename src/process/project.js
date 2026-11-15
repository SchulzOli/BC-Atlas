// The processes of a project with everything that is said about them: the models of .bca.json, the
// processes as they are (mined from the process tests and recordings), and how each model runs.
import path from "node:path";
import { loadConfig } from "../config.js";
import { mineProcesses, PROCESS_SCHEMA, processesConfig, processJson, runProcesses } from "./index.js";

/**
 * @param input the project
 * @param values the options of the simulation: tests, recordings, company, language, config, projectRoot, compiler
 * @param context { report } a simulation that ran already (the view has one), cache, parseCache
 * @returns { schema, processes: [json], runs, mined, simulated, roles, tests: [{ id, title, feature, recorded }] }
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
  return {
    schema: PROCESS_SCHEMA,
    processes: processes.map(processJson),
    runs: runProcesses(processes, report),
    mined: report ? mineProcesses(report) : [],
    simulated: Boolean(report),
    roles: (report?.roles ?? []).map(({ name, description }) => ({ name, ...(description ? { description } : {}) })),
    tests: (report?.tasks ?? []).map((task) => ({ id: task.id, title: task.title, feature: task.features?.[0], recorded: Boolean(task.recorded || task.recording) }))
  };
}
