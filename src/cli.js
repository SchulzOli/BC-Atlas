#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { createCapabilities, findCommand } from "./capabilities.js";
import { parseCommandArgs } from "./cli/args.js";
import { describeError, UsageError } from "./cli/errors.js";
import { commandHelp, docsOverviewHelp, overviewHelp } from "./cli/help.js";
import { graphCommand, inspectCommand, watchCommand } from "./commands/architecture.js";
import { checkCommand } from "./commands/check.js";
import { initCommand } from "./commands/init.js";
import { reportCommand } from "./commands/report.js";
import { runCommand } from "./commands/run.js";
import { setupAgentCommand, setupApplyCommand, setupCommand, setupPlanCommand } from "./commands/setup.js";
import { generateCodeGraph } from "./codegraph.js";
import { DOCS_COMMANDS } from "./docs/cli.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const capabilities = createCapabilities(pkg.version);

async function codegraphCommand(input, values) {
  const result = await generateCodeGraph(input, values);
  console.log(`Generated ${result.objects} object page(s); ${result.unresolved} unresolved reference(s).`);
  console.log(`Wrote ${result.outputDirectory}`);
}

async function mcpCommand() {
  const { startMcpServer } = await import("./mcp.js");
  await startMcpServer(pkg.version);
}

const HANDLERS = {
  init: initCommand,
  setup: setupCommand,
  "setup.plan": setupPlanCommand,
  "setup.apply": setupApplyCommand,
  "setup.agent": setupAgentCommand,
  report: reportCommand,
  run: runCommand,
  graph: graphCommand,
  watch: watchCommand,
  check: checkCommand,
  inspect: inspectCommand,
  codegraph: codegraphCommand,
  capabilities: () => process.stdout.write(`${JSON.stringify(capabilities, null, 2)}\n`),
  mcp: mcpCommand,
  ...DOCS_COMMANDS
};

const TOP_LEVEL = new Set(capabilities.commands
  .filter(({ variantOf }) => !variantOf)
  .map(({ id }) => id.split(".")[0]));

function suggestion(name) {
  const candidates = [...TOP_LEVEL];
  const close = candidates.find((candidate) => candidate.startsWith(name.slice(0, 3)));
  return close ? ` Did you mean "${close}"?` : "";
}

/** Maps argv to a catalog command id and the remaining arguments. */
function resolveCommand(args) {
  const [first, second, ...rest] = args;
  if (first === "docs") {
    if (!second || second === "-h" || second === "--help" || second === "help") return { help: "docs" };
    const id = `docs.${second}`;
    if (!findCommand(capabilities, id)) {
      throw new UsageError(`unknown docs command "${second}"; see "bca docs --help"`);
    }
    return { id, args: rest };
  }
  if (first === "setup" && findCommand(capabilities, `setup.${second}`)) return { id: `setup.${second}`, args: rest };
  if (TOP_LEVEL.has(first)) return { id: first, args: args.slice(1) };
  // `bca <path>` remains a shortcut for `bca graph <path>`.
  if (first && !first.startsWith("-") && existsSync(first)) return { id: "graph", args };
  if (first && !first.startsWith("-")) {
    throw new UsageError(`unknown command or path "${first}".${suggestion(first)}`);
  }
  return { id: "graph", args };
}

async function main(args) {
  if (!args.length || args[0] === "-h" || args[0] === "--help") return process.stdout.write(overviewHelp(capabilities));
  if (args[0] === "-V" || args[0] === "--version") return console.log(pkg.version);
  if (args[0] === "help") {
    if (!args[1]) return process.stdout.write(overviewHelp(capabilities));
    const id = args[1] === "docs" && args[2] ? `docs.${args[2]}` : args[1];
    if (id === "docs") return process.stdout.write(docsOverviewHelp(capabilities));
    const definition = findCommand(capabilities, id);
    if (!definition) throw new UsageError(`unknown command "${args.slice(1).join(" ")}"`);
    return process.stdout.write(commandHelp(definition));
  }

  const resolved = resolveCommand(args);
  if (resolved.help === "docs") return process.stdout.write(docsOverviewHelp(capabilities));
  const definition = findCommand(capabilities, resolved.id);
  const parsed = parseCommandArgs(definition, resolved.args);
  if (parsed.help) return process.stdout.write(commandHelp(definition));
  return HANDLERS[definition.id](parsed.input, parsed.values);
}

main(process.argv.slice(2)).catch((error) => {
  if (!error?.quiet) console.error(`bca: ${describeError(error)}`);
  if (error instanceof UsageError) console.error('Run "bca --help" for usage.');
  process.exitCode = error?.exitCode ?? 1;
});
