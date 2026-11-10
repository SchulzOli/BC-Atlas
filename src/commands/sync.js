// bca sync plan|run|status: delegates to the module that owns "sync" (bc-atlas-sync). BC Atlas
// only loads the module and provides the host; what, when and how to sync is the module's manifest.
import path from "node:path";
import { loadConfig } from "../config.js";
import { createModuleHost, loadModules, moduleForCommand } from "../modules.js";

const MISSING = "bca sync needs the bc-atlas-sync module: run \"npm install --save-dev bc-atlas-sync\" in the project and add \"modules\": [\"bc-atlas-sync\"] to .bca.json (or { \"name\": \"bc-atlas-sync\", \"path\": \"<checkout>\" } for a local checkout)";

async function runSyncCommand(subcommand, input, values) {
  const root = path.resolve(input ?? ".");
  const config = (await loadConfig(root, values.config)).values;
  const owner = moduleForCommand(await loadModules(root, config), "sync");
  if (!owner) throw new Error(MISSING);
  const handler = owner.module.commands?.[subcommand];
  if (typeof handler !== "function") throw new Error(`module ${owner.name} has no "${subcommand}" command`);

  const json = values.format === "json";
  const log = json ? () => {} : (line) => console.error(line);
  const host = createModuleHost({ root, config, trigger: values.trigger ?? "manual", values: {}, log });
  const result = await handler(host, { trigger: values.trigger, channel: values.channel, force: values.force });

  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else for (const line of result?.lines ?? [JSON.stringify(result)]) console.log(line);
  if (result && result.passed === false) process.exitCode = 1;
  return result;
}

export const syncPlanCommand = (input, values) => runSyncCommand("plan", input, values);
export const syncRunCommand = (input, values) => runSyncCommand("run", input, values);
export const syncStatusCommand = (input, values) => runSyncCommand("status", input, values);
