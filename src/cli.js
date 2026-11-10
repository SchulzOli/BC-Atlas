#!/usr/bin/env node
// Standalone use without BC Atlas: bca-sync <plan|run|status|describe> [project-root] [options]
// Inside BC Atlas the same commands are "bca sync plan|run|status" and the "sync" task of "bca run".
// Standalone, the architecture format needs an atlas-model source with a "path" (an export), and the
// atlas-docs format is skipped with a warning.
import fs from "node:fs/promises";
import path from "node:path";
import { bcaModule, describe } from "./index.js";

const USAGE = `Usage: bca-sync <plan|run|status|describe> [project-root] [options]

  plan       Show what each channel would write (nothing is written)
  run        Sync the channels of the trigger
  status     Plan every channel regardless of the trigger
  describe   List sources, triggers, conditions and formats

Options:
  --trigger <name>   pre-commit, pre-push, ci, schedule, manual (default manual)
  --channel <id>     Only this channel (repeatable or comma-separated); ignores the trigger
  --force            Rewrite every process, whatever the condition says
  --format json      Machine-readable result on stdout
  --config <file>    Use this file instead of <project-root>/.bca.json
`;

function parse(argv) {
  const values = { channel: [] };
  const positional = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") values.help = true;
    else if (arg === "--force") values.force = true;
    else if (["--trigger", "--channel", "--format", "--config"].includes(arg)) {
      const value = argv[++index];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      if (arg === "--channel") values.channel.push(value);
      else values[arg.slice(2)] = value;
    } else if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
    else positional.push(arg);
  }
  if (!values.channel.length) delete values.channel;
  return { command: positional[0], root: positional[1] ?? ".", values };
}

async function main() {
  const { command, root, values } = parse(process.argv.slice(2));
  if (values.help || !command) return process.stdout.write(USAGE);
  const json = values.format === "json";
  if (command === "describe") {
    const description = describe();
    return process.stdout.write(json ? `${JSON.stringify(description, null, 2)}\n` : `${Object.entries(description).map(([key, value]) => `${key}: ${typeof value === "object" ? `\n  ${Object.entries(value).map(([k, v]) => `${Array.isArray(value) ? v : `${k}: ${v}`}`).join("\n  ")}` : value}`).join("\n")}\n`);
  }
  const handler = bcaModule.commands[command];
  if (!handler) throw new Error(`unknown command "${command}"\n\n${USAGE}`);
  const projectRoot = path.resolve(root);
  const configFile = values.config ? path.resolve(values.config) : path.join(projectRoot, ".bca.json");
  const config = JSON.parse(await fs.readFile(configFile, "utf8"));
  const host = { root: projectRoot, config, trigger: values.trigger ?? "manual", log: json ? () => {} : (line) => console.error(line) };
  const result = await handler(host, values);
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else for (const line of result.lines) console.log(line);
  if (!result.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`bca-sync: ${error.message}`);
  process.exitCode = 1;
});
