import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const example = fileURLToPath(new URL("../examples/warehouse-app", import.meta.url));
const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));

function bca(args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 180_000, ...options });
}

function git(cwd, ...args) {
  const result = spawnSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", ...args], {
    cwd, encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  return result;
}

/** A Git repository with the warehouse app in apps/warehouse. */
function repository(remote = "https://github.com/contoso/warehouse.git") {
  const root = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-setup-"));
  const app = path.join(root, "apps", "warehouse");
  mkdirSync(path.dirname(app), { recursive: true });
  cpSync(example, app, { recursive: true });
  git(root, "init", "-q", "-b", "main");
  if (remote) git(root, "remote", "add", "origin", remote);
  git(root, "add", "-A");
  git(root, "commit", "-qm", "init");
  return { root, app };
}

test("setup plan detects the project and recommends hooks, pipeline, and schedule", () => {
  const { root, app } = repository();
  try {
    const result = bca(["setup", "plan", app, "--format", "json"]);
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.facts.app.name, "BC Atlas Warehouse Example");
    assert.equal(plan.facts.host, "github");
    assert.equal(plan.facts.appPath, "apps/warehouse");
    assert.deepEqual(plan.facts.languages, ["de-DE"]);
    assert.equal(plan.facts.uiTests.scenarios, 2);
    assert.deepEqual(plan.recommended.features, ["check", "report", "docs"]);
    assert.equal(plan.recommended.hooks, "husky");
    assert.equal(plan.recommended.ci, "github");
    assert.equal(plan.recommended.scheduleSync, "pull-request");
    assert.ok(plan.questions.every(({ id, flag, question }) => id && flag.startsWith("--") && question));
    assert.deepEqual(plan.apply.slice(0, 3), ["bca", "setup", "apply"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("setup apply previews, writes Husky hooks and a GitHub workflow, and is idempotent", () => {
  const { root, app } = repository();
  try {
    mkdirSync(path.join(root, ".husky"));
    writeFileSync(path.join(root, ".husky", "pre-commit"), "npx lint-staged\n");
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "tools", scripts: { prepare: "node setup.js" } }));

    const preview = bca(["setup", "apply", app, "--dry-run", "--format", "json"]);
    assert.equal(preview.status, 0, preview.stderr);
    const planned = JSON.parse(preview.stdout);
    assert.deepEqual(planned.files.map(({ path: file, action }) => `${action} ${file}`), [
      "create apps/warehouse/.bca.json",
      "update .husky/pre-commit",
      "create .husky/pre-push",
      "update package.json",
      "create .github/workflows/bc-atlas.yml"
    ]);
    assert.ok(!existsSync(path.join(app, ".bca.json")), "dry run writes nothing");

    const applied = bca(["setup", "apply", app]);
    assert.equal(applied.status, 0, applied.stderr);
    const config = JSON.parse(readFileSync(path.join(app, ".bca.json"), "utf8"));
    assert.deepEqual(config.automation.triggers["pre-push"], { tasks: ["report", "docs"], sync: "verify" });
    assert.deepEqual(config.automation.triggers["pre-commit"], { tasks: ["check"], sync: "none" });
    assert.equal(config.automation.triggers.schedule.cron, "0 6 * * 1");
    assert.equal(config.docs.tests, ".");

    const hook = readFileSync(path.join(root, ".husky", "pre-commit"), "utf8");
    assert.match(hook, /^npx lint-staged\n/u, "existing hook commands are kept");
    assert.match(hook, /npx --no-install bca run apps\/warehouse --trigger pre-commit \|\| exit 1/u);
    if (process.platform !== "win32") assert.ok(statSync(path.join(root, ".husky", "pre-push")).mode & 0o100);
    const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    assert.equal(packageJson.scripts.prepare, "node setup.js && husky");
    assert.equal(packageJson.devDependencies["bc-atlas"], `^${pkg.version}`);

    const workflow = readFileSync(path.join(root, ".github", "workflows", "bc-atlas.yml"), "utf8");
    assert.match(workflow, /^ {4}- cron: "0 6 \* \* 1"$/mu);
    assert.match(workflow, /BCA_TRIGGER: \$\{\{ github\.event_name == 'schedule' && 'schedule' \|\| 'ci' \}\}/u);
    assert.match(workflow, new RegExp(`npx --yes bc-atlas@${pkg.version.replaceAll(".", "\\.")} run apps/warehouse --trigger "\\$BCA_TRIGGER"`, "u"));
    assert.match(workflow, /peter-evans\/create-pull-request@v7[\s\S]*apps\/warehouse\/docs\/atlas\n {12}apps\/warehouse\/docs\/guides/u);
    assert.match(workflow, /^ {2}pull-requests: write$/mu);

    const again = bca(["setup", "apply", app, "--format", "json"]);
    assert.ok(JSON.parse(again.stdout).files.every(({ action }) => action === "unchanged"), "second apply changes nothing");
    assert.equal((readFileSync(path.join(root, ".husky", "pre-commit"), "utf8").match(/bca run/gu) ?? []).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("setup apply protects hand-written pipelines and validates answers", () => {
  const { root, app } = repository("https://dev.azure.com/contoso/Warehouse/_git/warehouse");
  try {
    writeFileSync(path.join(root, "azure-pipelines.bc-atlas.yml"), "steps: []\n");
    const skipped = bca(["setup", "apply", app, "--hooks", "none", "--format", "json"]);
    assert.equal(skipped.status, 0, skipped.stderr);
    const pipeline = JSON.parse(skipped.stdout).files.find(({ path: file }) => file === "azure-pipelines.bc-atlas.yml");
    assert.equal(pipeline.action, "skip");
    assert.equal(readFileSync(path.join(root, "azure-pipelines.bc-atlas.yml"), "utf8"), "steps: []\n");

    const forced = bca(["setup", "apply", app, "--hooks", "none", "--force"]);
    assert.equal(forced.status, 0, forced.stderr);
    const azure = readFileSync(path.join(root, "azure-pipelines.bc-atlas.yml"), "utf8");
    assert.match(azure, /^schedules:\n {2}- cron: "0 6 \* \* 1"/mu);
    assert.match(azure, /git push origin "HEAD:\$BUILD_SOURCEBRANCH"/u, "Azure DevOps recommends commit sync");

    for (const args of [
      ["--schedule", "every monday"],
      ["--schedule-sync", "pull-request"],
      ["--features", "check", "--pre-push", "report"],
      ["--hooks", "lefthook"]
    ]) {
      const result = bca(["setup", "apply", app, "--dry-run", ...args]);
      assert.equal(result.status, 2, `${args.join(" ")}: ${result.stderr}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("bca run verifies, stages, and reports generated output per trigger", () => {
  const { root, app } = repository();
  try {
    assert.equal(bca([
      "setup", "apply", app, "--features", "check,report", "--hooks", "git", "--pre-commit", "report",
      "--pre-push", "none", "--hook-sync", "stage", "--ci", "github", "--ci-sync", "verify", "--schedule", "none"
    ]).status, 0);
    git(root, "add", "-A");
    git(root, "commit", "-qm", "setup", "--no-verify");

    const stale = bca(["run", app, "--trigger", "ci", "--format", "json"]);
    assert.equal(stale.status, 1);
    const result = JSON.parse(stale.stdout);
    assert.deepEqual(result.tasks, ["check", "report"]);
    assert.deepEqual(result.outputs, ["apps/warehouse/docs/atlas"]);
    assert.ok(result.changed.includes("apps/warehouse/docs/atlas/README.md"));

    git(root, "add", "-A");
    git(root, "commit", "-qm", "output", "--no-verify");
    const fresh = bca(["run", ".", "--trigger", "ci"], { cwd: app });
    assert.equal(fresh.status, 0, fresh.stdout + fresh.stderr);
    assert.match(fresh.stdout, /verify: generated files are up to date/u, "result does not depend on the working directory");

    const unconfigured = bca(["run", app, "--trigger", "schedule"]);
    assert.equal(unconfigured.status, 1);
    assert.match(unconfigured.stderr, /not configured/u);

    // A real commit runs the plain Git hook, which regenerates and stages the report.
    const bin = path.join(root, "bin");
    mkdirSync(bin);
    writeFileSync(path.join(bin, "bca"), `#!/bin/sh\nexec "${process.execPath}" "${cli}" "$@"\n`);
    chmodSync(path.join(bin, "bca"), 0o755);
    if (process.platform !== "win32") {
      writeFileSync(path.join(app, "Extra.al"), "codeunit 50190 \"Extra Codeunit\" { procedure Run() begin end; }\n");
      git(root, "add", "-A");
      const commit = spawnSync("git", ["-c", "user.email=t@e.com", "-c", "user.name=T", "commit", "-qm", "extra"], {
        cwd: root, encoding: "utf8", env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` }
      });
      assert.equal(commit.status, 0, commit.stderr + commit.stdout);
      const files = git(root, "show", "--name-only", "--format=", "HEAD").stdout;
      assert.match(files, /apps\/warehouse\/docs\/atlas\/README\.md/u, "regenerated report is part of the commit");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("setup agent writes slash commands for Claude Code, Copilot, and Cursor", () => {
  const { root, app } = repository();
  try {
    for (const [agent, file] of [
      ["claude", ".claude/commands/bca-setup.md"],
      ["copilot", ".github/prompts/bca-setup.prompt.md"],
      ["cursor", ".cursor/commands/bca-setup.md"]
    ]) {
      const result = bca(["setup", "agent", app, "--agent", agent]);
      assert.equal(result.status, 0, result.stderr);
      const content = readFileSync(path.join(root, file), "utf8");
      assert.match(content, /bca setup plan apps\/warehouse --format json/u);
      assert.match(content, /--dry-run --format json/u);
      assert.match(content, new RegExp(`npx --yes bc-atlas@${pkg.version.replaceAll(".", "\\.")}`, "u"));
    }
    assert.match(readFileSync(path.join(root, ".github/prompts/bca-setup.prompt.md"), "utf8"), /^---\nmode: agent\n/u);
    const repeat = bca(["setup", "agent", app, "--agent", "claude"]);
    assert.equal(repeat.status, 0, "an unchanged file is not an error");
    writeFileSync(path.join(root, ".claude/commands/bca-setup.md"), "custom");
    assert.equal(bca(["setup", "agent", app, "--agent", "claude"]).status, 1);
    assert.equal(bca(["setup", "agent", app, "--agent", "claude", "--force"]).status, 0);

    const generic = bca(["setup", "agent", app]);
    assert.equal(generic.status, 0);
    assert.match(generic.stdout, /^# Set up BC Atlas/u);

    const noTerminal = bca(["setup", app], { input: "" });
    assert.equal(noTerminal.status, 2);
    assert.match(noTerminal.stderr, /interactive terminal/u);
    const accepted = bca(["setup", app, "--yes", "--dry-run"]);
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.match(accepted.stdout, /Planned changes \(dry run\)/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
