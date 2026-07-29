import { parseArgs } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { loadScenario, generatedTestPath } from "./scenario.js";
import { generationPrompt, healingPrompt } from "./prompts.js";
import { runCodex, runPlaywright } from "./process.js";

const HELP = `ald2tree docs - AI-generated executable Business Central documentation

Usage:
  ald2tree docs generate [options] <scenario.yml>
  ald2tree docs run [options] <scenario.yml>
  ald2tree docs heal [options] <scenario.yml>

Options:
      --bc-url <url>          Business Central URL (or use BC_URL)
      --test-dir <path>       Generated tests (default: docs-tests/generated)
      --test <path>           Override the generated Playwright test path
      --config <path>         Playwright config (default: playwright.docs.config.js)
      --agent-command <path>  Codex executable (default: codex or CODEX_BIN)
      --agent-sandbox <mode>  workspace-write (default) or danger-full-access
      --dry-run               Print the agent prompt without running Codex
      --headed                Show the browser during 'run'
  -h, --help                  Show help
`;

const OPTIONS = {
  "bc-url": { type: "string" },
  "test-dir": { type: "string" },
  test: { type: "string" },
  config: { type: "string" },
  "agent-command": { type: "string" },
  "agent-sandbox": { type: "string" },
  "dry-run": { type: "boolean" },
  headed: { type: "boolean" },
  help: { type: "boolean", short: "h" }
};

export async function docsMain(args) {
  if (args[0] === "--help" || args[0] === "-h") return console.log(HELP);
  const command = args[0];
  const { values, positionals } = parseArgs({
    args: args.slice(1),
    allowPositionals: true,
    strict: true,
    options: OPTIONS
  });
  if (values.help || !command) return console.log(HELP);
  if (!["generate", "run", "heal"].includes(command)) {
    throw new Error(`unknown docs command: ${command}`);
  }
  if (positionals.length !== 1) throw new Error(`docs ${command} expects one scenario file`);

  const scenario = await loadScenario(positionals[0]);
  const testPath = values.test
    ? path.resolve(values.test)
    : generatedTestPath(scenario.value, values["test-dir"]);
  const bcUrl = values["bc-url"] ?? process.env.BC_URL ?? scenario.value.start.url;
  if (!bcUrl) throw new Error("Business Central URL is required via --bc-url, BC_URL, or start.url");

  if (command === "run") {
    return runPlaywright(testPath, {
      config: values.config,
      bcUrl,
      headed: values.headed
    });
  }

  const prompt = command === "generate"
    ? generationPrompt({ scenario, testPath, bcUrl })
    : healingPrompt({ scenario, testPath, bcUrl });
  if (values["dry-run"]) return console.log(prompt);
  const sandbox = values["agent-sandbox"] ?? "workspace-write";
  if (!["workspace-write", "danger-full-access"].includes(sandbox)) {
    throw new Error("--agent-sandbox must be workspace-write or danger-full-access");
  }
  const originalScenario = await fs.readFile(scenario.path, "utf8");
  let agentError;
  try {
    await runCodex(prompt, {
      executable: values["agent-command"],
      sandbox
    });
  } catch (error) {
    agentError = error;
  }
  const currentScenario = await fs.readFile(scenario.path, "utf8");
  if (currentScenario !== originalScenario) {
    await fs.writeFile(scenario.path, originalScenario);
    throw new Error(`agent modified immutable scenario; restored ${scenario.relativePath}`, {
      cause: agentError
    });
  }
  if (agentError) throw agentError;
}

export { HELP as DOCS_HELP };
