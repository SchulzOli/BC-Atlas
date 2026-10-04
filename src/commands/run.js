import { runAutomation } from "../automation/run.js";
import { CheckFailedError } from "../cli/errors.js";

export async function runCommand(input, values) {
  const json = values.format === "json";
  const result = await runAutomation(input, {
    trigger: values.trigger,
    tasks: values.tasks,
    sync: values.sync,
    config: values.config,
    log: json ? () => {} : (message) => console.log(message)
  });
  if (json) {
    process.stdout.write(`${JSON.stringify({ ...result, root: undefined }, null, 2)}\n`);
  } else if (!result.tasks.length) {
    console.log(`Nothing to run for trigger "${result.trigger}". Configure it with "bca setup" or pass --tasks.`);
  } else {
    const failed = result.results.filter(({ ok }) => !ok).map(({ task }) => task);
    if (result.changed.length) failed.push("sync");
    console.log(failed.length
      ? `BC Atlas ${result.trigger}: FAILED (${failed.join(", ")})`
      : `BC Atlas ${result.trigger}: OK (${result.tasks.join(", ")})`);
    if (result.changed.length) {
      console.log(`Regenerated files are not committed. Commit them, for example: git add ${result.outputs.join(" ")}`);
    }
  }
  if (!result.passed) throw new CheckFailedError("bca run failed");
}
