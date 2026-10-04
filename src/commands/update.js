import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { findGitRoot } from "../automation/git.js";
import { CheckFailedError } from "../cli/errors.js";
import {
  changelogBetween, compareVersions, fetchChangelog, fetchLatestVersion, isMajorUpdate, PACKAGE_NAME
} from "../update.js";

const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}

/** Where the running BC Atlas comes from and how to replace it. */
async function installPlan(input, latest) {
  const root = path.resolve(input ?? ".");
  const own = realpathSync(PACKAGE_ROOT);
  const commands = [];
  let mode;
  let projectRoot;
  if (existsSync(path.join(own, ".git")) && !own.split(path.sep).includes("node_modules")) {
    mode = "source";
  } else {
    projectRoot = await findGitRoot(root) ?? root;
    const pkg = await readJson(path.join(projectRoot, "package.json"));
    const declared = pkg?.devDependencies?.[PACKAGE_NAME] ? "--save-dev" : pkg?.dependencies?.[PACKAGE_NAME] ? "--save" : undefined;
    if (declared) {
      mode = "local";
      commands.push({ cwd: projectRoot, argv: ["npm", "install", declared, `${PACKAGE_NAME}@^${latest}`] });
    } else {
      mode = "global";
      commands.push({ cwd: root, argv: ["npm", "install", "--global", `${PACKAGE_NAME}@${latest}`] });
    }
  }
  const config = await readJson(path.join(root, ".bca.json"));
  if (mode !== "source" && config?.automation) {
    // The new version regenerates hooks, tasks, pipelines, and agent commands.
    const bca = mode === "local" ? ["npx", "--no-install", "bca"] : ["bca"];
    const cwd = projectRoot ?? root;
    commands.push({ cwd, argv: [...bca, "setup", "apply", path.relative(cwd, root).replaceAll("\\", "/") || ".", "--from-config"] });
  }
  return { mode, commands };
}

function display(command) {
  return command.argv.map((part) => (/^[\w@^./:=-]+$/u.test(part) ? part : `"${part}"`)).join(" ");
}

function execute(command) {
  const result = spawnSync(command.argv[0], command.argv.slice(1), {
    cwd: command.cwd,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  if (result.error) throw new Error(`${command.argv[0]} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${display(command)} failed with exit code ${result.status}`);
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return !answer || ["y", "yes", "j", "ja"].includes(answer);
  } finally {
    rl.close();
  }
}

export async function checkForUpdate(current) {
  const latest = await fetchLatestVersion();
  const updateAvailable = compareVersions(latest, current) > 0;
  let changelog = [];
  if (updateAvailable) {
    try {
      changelog = changelogBetween(await fetchChangelog(), current, latest);
    } catch {
      // The update works without release notes.
    }
  }
  return { current, latest, updateAvailable, major: updateAvailable && isMajorUpdate(current, latest), changelog };
}

export async function updateCommand(input, values) {
  const current = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")).version;
  let status;
  try {
    status = await checkForUpdate(current);
  } catch (error) {
    throw new Error(`cannot check for updates: ${error.message}`);
  }
  const plan = status.updateAvailable ? await installPlan(input, status.latest) : { mode: undefined, commands: [] };
  const json = values.format === "json";
  const report = { ...status, mode: plan.mode, commands: plan.commands.map(display), applied: false };

  if (!status.updateAvailable) {
    if (json) return process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return console.log(`BC Atlas ${current} is up to date.`);
  }

  if (!json) {
    console.log(`BC Atlas ${status.latest} is available. You have ${current}.`);
    if (status.major) console.log("This update may contain breaking changes; read the notes below.");
    for (const section of status.changelog) console.log(`\n${section.text}`);
    if (!status.changelog.length) console.log("Release notes: https://github.com/SchulzOli/BC-Atlas/blob/main/CHANGELOG.md");
    console.log("");
  }

  if (plan.mode === "source") {
    if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else console.log("This BC Atlas runs from a source checkout; update it with git pull and npm ci.");
    if (values.check) throw new CheckFailedError("update available");
    return;
  }
  if (values.check || values.dryRun) {
    if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else console.log(["To update, BC Atlas will run:", ...plan.commands.map((command) => `  ${display(command)}`)].join("\n"));
    if (values.check) throw new CheckFailedError("update available");
    return;
  }

  let proceed = values.yes;
  if (!proceed) {
    if (!process.stdin.isTTY) {
      console.log(["Run with --yes to update without a prompt, or run:", ...plan.commands.map((command) => `  ${display(command)}`)].join("\n"));
      return;
    }
    console.log(["BC Atlas will run:", ...plan.commands.map((command) => `  ${display(command)}`)].join("\n"));
    proceed = await confirm(`Update to ${status.latest} now? (Y/n) `);
  }
  if (!proceed) return console.log("Nothing changed.");
  for (const command of plan.commands) execute(command);
  report.applied = true;
  if (json) return process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nBC Atlas ${status.latest} is installed.${plan.commands.length > 1 ? " Generated hooks, tasks, and pipelines were updated; review and commit the changes." : ""}`);
}
