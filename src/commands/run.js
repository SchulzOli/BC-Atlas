import { runAutomation } from "../automation/run.js";
import { CheckFailedError } from "../cli/errors.js";

export async function runCommand(input, values) {
  const json = values.format === "json";
  const result = await runAutomation(input, {
    trigger: values.trigger,
    tasks: values.tasks,
    flows: values.flow,
    sync: values.sync,
    config: values.config,
    log: json ? () => {} : (message) => console.log(message)
  });
  if (json) {
    process.stdout.write(`${JSON.stringify({ ...result, root: undefined }, null, 2)}\n`);
  } else if (!result.tasks.length && !result.flows.length) {
    console.log(`Nothing to run for trigger "${result.trigger}". Configure it with "bca setup", define a flow with "bca flow define", or pass --tasks.`);
  } else {
    const failed = [...result.results.filter(({ ok }) => !ok).map(({ task }) => task), ...result.flows.filter(({ ok }) => !ok).map(({ flow }) => `flow ${flow}`)];
    if (result.changed.length) failed.push("sync");
    console.log(failed.length
      ? `BC Atlas ${result.trigger}: FAILED (${failed.join(", ")})`
      : `BC Atlas ${result.trigger}: OK (${[...result.tasks, ...result.flows.map(({ flow }) => `flow ${flow}`)].join(", ")})`);
    if (result.changed.length) {
      console.log(`Regenerated files are not committed. Commit them, for example: git add ${result.outputs.join(" ")}`);
    }
  }
  if (!result.passed) throw new CheckFailedError("bca run failed");
}
