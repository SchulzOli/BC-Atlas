import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { agentFile, AGENTS } from "../automation/agent.js";
import { findGitRoot } from "../automation/git.js";
import { ANSWER_FLAGS, applySetup, createPlan } from "../automation/setup.js";
import { UsageError } from "../cli/errors.js";
import { displayPath } from "../output.js";

function packageVersion() {
  return readFile(new URL("../../package.json", import.meta.url), "utf8").then((text) => JSON.parse(text).version);
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function describe(value) {
  return Array.isArray(value) ? (value.length ? value.join(", ") : "none") : String(value ?? "-");
}

function planText(plan) {
  const { facts } = plan;
  const lines = [
    `BC Atlas setup for ${facts.app ? `${facts.app.name} ${facts.app.version ?? ""}`.trim() : "this folder"}`,
    "",
    `  Git                ${facts.gitRoot ? `yes${facts.host ? ` (${facts.host})` : ""}` : "no"}`,
    `  UI tests           ${facts.uiTests.scenarios ? `${facts.uiTests.scenarios} documented scenario(s) in ${facts.uiTests.path}` : "none found"}`,
    `  Translations       ${facts.languages.join(", ") || "none"}`,
    `  Existing setup     ${[facts.config && ".bca.json", facts.husky && "Husky", ...facts.ci.githubWorkflows.map((name) => `.github/workflows/${name}`), ...facts.ci.azurePipelines].filter(Boolean).join(", ") || "none"}`,
    "",
    "Recommended answers"
  ];
  for (const question of plan.questions) {
    lines.push(`  ${question.flag.padEnd(18)} ${describe(question.recommended)}`);
  }
  lines.push(
    "",
    "Next",
    "  bca setup                    answer the questions interactively",
    "  bca setup --yes              apply the recommendations",
    "  bca setup agent --agent ...  let your AI agent guide you (claude, copilot, cursor, generic)",
    ""
  );
  return lines.join("\n");
}

function resultText(result) {
  const lines = [result.dryRun ? "Planned changes (dry run)" : "Changes"];
  for (const file of result.files) {
    lines.push(`  ${file.action.padEnd(9)} ${file.path}${file.reason ? `  (${file.reason})` : ""}`);
  }
  for (const command of result.commands) lines.push(`  ${result.dryRun ? "would run" : "ran"}  ${command}`);
  lines.push("", "Triggers");
  for (const [name, trigger] of Object.entries(result.config.automation.triggers)) {
    lines.push(`  ${name.padEnd(11)} ${trigger.tasks.join(", ") || "-"}  (sync: ${trigger.sync}${trigger.cron ? `, cron: ${trigger.cron}` : ""})`);
  }
  if (!Object.keys(result.config.automation.triggers).length) lines.push("  none");
  lines.push("", "Next steps", ...result.nextSteps.map((step) => `  ${step}`), "");
  return lines.join("\n");
}

function answersFrom(values) {
  return Object.fromEntries(Object.keys(ANSWER_FLAGS)
    .filter((id) => values[id] !== undefined)
    .map((id) => [id, values[id]]));
}

export async function setupPlanCommand(input, values) {
  const plan = await createPlan(input);
  if (values.format === "json") return printJson(plan);
  process.stdout.write(planText(plan));
}

async function apply(input, answers, values) {
  try {
    return await applySetup(input, answers, {
      dryRun: values.dryRun,
      force: values.force,
      version: await packageVersion()
    });
  } catch (error) {
    if (/must be|needs --|must also be enabled|five-field cron|available for GitHub/u.test(error.message)) {
      throw new UsageError(error.message);
    }
    throw error;
  }
}

export async function setupApplyCommand(input, values) {
  const result = await apply(input, answersFrom(values), values);
  if (values.format === "json") return printJson(result);
  process.stdout.write(resultText(result));
}

function applies(condition, answers) {
  if (!condition) return true;
  const [id, operator, value] = condition.split(" ").length === 3
    ? condition.split(" ")
    : [condition.split(" ")[0], "is not", condition.split(" ").at(-1)];
  const answer = answers[id];
  if (operator === "includes") return Array.isArray(answer) && answer.includes(value);
  return Array.isArray(answer) ? answer.length > 0 : answer !== value;
}

async function ask(rl, question) {
  const recommended = question.recommended;
  console.log(`\n${question.question}`);
  for (const [index, item] of (question.options ?? []).entries()) {
    console.log(`  ${index + 1}. ${item.value.padEnd(13)} ${item.description}`);
  }
  for (const example of question.examples ?? []) console.log(`     e.g. ${example}`);
  const hint = question.type === "multi" ? "comma-separated numbers or names" : question.options ? "number or name" : "value";
  const raw = (await rl.question(`  > (${hint}; Enter = ${describe(recommended)}) `)).trim();
  if (!raw) return recommended;
  const resolve = (token) => {
    const index = Number(token);
    return Number.isInteger(index) && question.options?.[index - 1] ? question.options[index - 1].value : token;
  };
  if (question.type === "multi") {
    const values = raw.split(",").map((token) => resolve(token.trim())).filter(Boolean);
    return values.includes("none") ? [] : values;
  }
  return resolve(raw);
}

/** Interactive wizard: the same questions an agent would relay. */
export async function setupCommand(input, values) {
  const plan = await createPlan(input);
  let answers = { ...plan.recommended };
  if (!values.yes) {
    if (!process.stdin.isTTY) {
      process.stdout.write(planText(plan));
      throw new UsageError("bca setup needs an interactive terminal; use --yes, setup apply, or setup agent");
    }
    process.stdout.write(planText(plan).split("\nRecommended answers")[0]);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      answers = {};
      for (const question of plan.questions) {
        if (!applies(question.when, answers)) continue;
        answers[question.id] = await ask(rl, question);
      }
      const preview = await apply(input, answers, { dryRun: true });
      process.stdout.write(`\n${resultText(preview)}`);
      const confirm = (await rl.question("Apply these changes? (Y/n) ")).trim().toLowerCase();
      if (confirm && !["y", "yes", "j", "ja"].includes(confirm)) {
        console.log("Nothing changed.");
        return;
      }
    } finally {
      rl.close();
    }
  }
  const result = await apply(input, answers, { dryRun: values.dryRun });
  process.stdout.write(resultText(result));
}

export async function setupAgentCommand(input, values) {
  const agent = values.agent ?? "generic";
  const root = path.resolve(input);
  const gitRoot = await findGitRoot(root) ?? root;
  const appPath = path.relative(gitRoot, root).replaceAll("\\", "/") || ".";
  const content = agentFile(agent, { version: await packageVersion(), appPath });
  const target = AGENTS[agent].file;
  if (values.print || !target) return process.stdout.write(content);
  const file = path.join(gitRoot, target);
  const current = await readFile(file, "utf8").catch(() => undefined);
  if (current !== undefined && current !== content && !values.force) {
    throw new Error(`${displayPath(file)} already exists; use --force to replace it`);
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
  console.log(`Wrote ${displayPath(file)}`);
  console.log(`Open ${AGENTS[agent].label.replace(/ \(.*/u, "")} in this repository and run /bca-setup.`);
}
