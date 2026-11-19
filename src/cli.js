#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { createCapabilities, findCommand } from "./capabilities.js";
import { parseCommandArgs } from "./cli/args.js";
import { describeError, UsageError } from "./cli/errors.js";
import { commandHelp, docsOverviewHelp, overviewHelp } from "./cli/help.js";
import { loadHandler } from "./cli/handlers.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

/** Maps argv to a catalog command id and the remaining arguments. */
function resolveCommand(capabilities, args) {
  const topLevel = new Set(capabilities.commands.filter(({ variantOf }) => !variantOf).map(({ id }) => id.split(".")[0]));
  const [first, second, ...rest] = args;
  if (first === "docs") {
    if (!second || second === "-h" || second === "--help" || second === "help") return { help: "docs" };
    const id = `docs.${second}`;
    if (!findCommand(capabilities, id)) {
      throw new UsageError(`unknown docs command "${second}"; see "bca docs --help"`);
    }
    return { id, args: rest };
  }
  // A command that also stands alone: bca architecture and bca architecture compare.
  if (first === "architecture" && findCommand(capabilities, `${first}.${second}`)) return { id: `${first}.${second}`, args: rest };
  if (topLevel.has(first)) return { id: first, args: args.slice(1) };
  if (first && !first.startsWith("-") && existsSync(first)) {
    throw new UsageError(`"${first}" is a path, not a command; try "bca check ${first}" or "bca export ${first}", or open it in VS Code with the BC Atlas extension`);
  }
  const close = [...topLevel].find((candidate) => candidate.startsWith(String(first).slice(0, 3)));
  throw new UsageError(first?.startsWith("-") ? `"${first}" needs a command first` : `unknown command "${first}".${close ? ` Did you mean "${close}"?` : ""}`);
}

async function main(args) {
  if (args[0] === "-V" || args[0] === "--version") {
    console.log(pkg.version);
    return undefined;
  }
  const capabilities = createCapabilities(pkg.version);
  if (!args.length || args[0] === "-h" || args[0] === "--help") {
    return process.stdout.write(overviewHelp(capabilities));
  }
  if (args[0] === "help") {
    if (args[1] === "--format" || args[1]?.startsWith("--format=")) {
      const format = args[1].includes("=") ? args[1].split("=")[1] : args[2];
      if (format !== "json" && format !== "text") throw new UsageError("--format must be json or text");
      if (format === "json") return process.stdout.write(`${JSON.stringify(capabilities, null, 2)}\n`);
      return process.stdout.write(overviewHelp(capabilities));
    }
    if (!args[1]) return process.stdout.write(overviewHelp(capabilities));
    const id = args[2] && findCommand(capabilities, `${args[1]}.${args[2]}`) ? `${args[1]}.${args[2]}` : args[1];
    if (id === "docs") return process.stdout.write(docsOverviewHelp(capabilities));
    const definition = findCommand(capabilities, id);
    if (!definition) throw new UsageError(`unknown command "${args.slice(1).join(" ")}"`);
    return process.stdout.write(commandHelp(definition));
  }

  const resolved = resolveCommand(capabilities, args);
  if (resolved.help === "docs") return process.stdout.write(docsOverviewHelp(capabilities));
  const definition = findCommand(capabilities, resolved.id);
  const parsed = parseCommandArgs(definition, resolved.args);
  if (parsed.help) return process.stdout.write(commandHelp(definition));
  const run = await loadHandler(definition, pkg.version);
  await run(parsed.input, parsed.values);
}

main(process.argv.slice(2)).catch((error) => {
  if (!error?.quiet) console.error(`bca: ${describeError(error)}`);
  if (error instanceof UsageError) console.error('Run "bca --help" for usage.');
  process.exitCode = error?.exitCode ?? 1;
});
