#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { createCapabilities, findCommand } from "./capabilities.js";
import { parseCommandArgs } from "./cli/args.js";
import { describeError, UsageError } from "./cli/errors.js";
import { commandHelp, docsOverviewHelp, overviewHelp } from "./cli/help.js";
import { loadHandler } from "./cli/handlers.js";
import { maybeNotifyUpdate } from "./update.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

/**
 * The command catalog of this call: BC Atlas, its built-in plugins, and the plugins of the
 * project in the current directory (.bca.json "plugins", bc-atlas-plugin-* dependencies,
 * BCA_PLUGINS). A broken project plugin never blocks BC Atlas itself; "bca plugins doctor"
 * reports it.
 */
async function loadCatalog() {
  const projectMayHavePlugins = existsSync(".bca.json") || existsSync("package.json") || process.env.BCA_PLUGINS;
  if (!projectMayHavePlugins) return createCapabilities(pkg.version);
  try {
    const [{ loadConfig }, { loadPlugins }] = await Promise.all([import("./config.js"), import("./plugins/registry.js")]);
    const registry = await loadPlugins(process.cwd(), (await loadConfig(process.cwd())).values);
    return createCapabilities(pkg.version, { plugins: registry.enabled().map(({ manifest }) => manifest) });
  } catch {
    return createCapabilities(pkg.version);
  }
}

/** First words that have subcommands: docs, setup, graph, refactor, plugins, and every plugin. */
function families(capabilities) {
  return new Set(capabilities.commands.filter(({ id }) => id.includes(".")).map(({ id }) => id.split(".")[0]));
}

function familyHelp(capabilities, family) {
  const commands = capabilities.commands.filter(({ id }) => id.startsWith(`${family}.`));
  const width = Math.max(...commands.map(({ argv }) => argv.slice(0, 3).join(" ").length));
  return `${commands.map(({ argv, purpose }) => `  ${argv.slice(0, 3).join(" ").padEnd(width)}  ${purpose}`).join("\n")}\n\nRun "bca ${family} <command> --help" for details.\n`;
}

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
  // Commands that also stand alone: bca setup and bca setup plan, bca simulate and bca simulate define.
  if (["setup", "simulate"].includes(first) && findCommand(capabilities, `${first}.${second}`)) return { id: `${first}.${second}`, args: rest };
  if (first === "graph") {
    if (findCommand(capabilities, `graph.${second}`)) return { id: `graph.${second}`, args: rest };
    if (!second || ["-h", "--help", "help"].includes(second)) return { id: "graph.query", args: ["--help"] };
    throw new UsageError(`unknown graph command "${second}"; use "bca graph query" or "bca graph render"`);
  }
  if (first === "refactor") {
    if (findCommand(capabilities, `refactor.${second}`)) return { id: `refactor.${second}`, args: rest };
    if (["-h", "--help", "help"].includes(second)) return { id: "refactor.move", args: ["--help"] };
    throw new UsageError(`unknown refactoring "${second ?? ""}"; use "bca refactor move" or "bca refactor surface"`);
  }
  // bca plugins <command> and bca <plugin> <command>.
  if (families(capabilities).has(first) && !findCommand(capabilities, first)) {
    if (findCommand(capabilities, `${first}.${second}`)) return { id: `${first}.${second}`, args: rest };
    if (!second || ["-h", "--help", "help"].includes(second)) return { help: "family", family: first };
    const known = capabilities.commands.filter(({ id }) => id.startsWith(`${first}.`)).map(({ id }) => `"bca ${first} ${id.split(".")[1]}"`);
    throw new UsageError(`unknown ${first} command "${second}"; use ${known.join(", ")}`);
  }
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
    return maybeNotifyUpdate(pkg.version, { command: "version" });
  }
  const capabilities = await loadCatalog();
  if (!args.length || args[0] === "-h" || args[0] === "--help") {
    process.stdout.write(overviewHelp(capabilities));
    return maybeNotifyUpdate(pkg.version, { command: "help" });
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
    if (!findCommand(capabilities, id) && families(capabilities).has(id)) return process.stdout.write(familyHelp(capabilities, id));
    const definition = findCommand(capabilities, id);
    if (!definition) throw new UsageError(`unknown command "${args.slice(1).join(" ")}"`);
    return process.stdout.write(commandHelp(definition));
  }

  const resolved = resolveCommand(capabilities, args);
  if (resolved.help === "docs") return process.stdout.write(docsOverviewHelp(capabilities));
  if (resolved.help === "family") return process.stdout.write(familyHelp(capabilities, resolved.family));
  const definition = findCommand(capabilities, resolved.id);
  const parsed = parseCommandArgs(definition, resolved.args);
  if (parsed.help) return process.stdout.write(commandHelp(definition));
  const run = await loadHandler(definition, pkg.version);
  await run(parsed.input, parsed.values);
  await maybeNotifyUpdate(pkg.version, { command: definition.id.split(".")[0], values: parsed.values });
}

main(process.argv.slice(2)).catch((error) => {
  if (!error?.quiet) console.error(`bca: ${describeError(error)}`);
  if (error instanceof UsageError) console.error('Run "bca --help" for usage.');
  process.exitCode = error?.exitCode ?? 1;
});
