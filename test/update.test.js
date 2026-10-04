import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeDependabot } from "../src/automation/dependabot.js";
import { githubWorkflow } from "../src/automation/pipelines.js";
import { changelogBetween, compareVersions, isMajorUpdate, noticeFor, updateCheckEnabled } from "../src/update.js";

const repo = fileURLToPath(new URL("..", import.meta.url));
const version = JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8")).version;
const CHANGELOG = `# Changelog\n\n## Unreleased\n\n## 9.1.0 - 2027-02-01\n\n- Newest.\n\n## 9.0.0 - 2027-01-01\n\n### Removed\n\n- Old flag.\n\n## ${version} - 2026-10-04\n\n- Current.\n`;

test("compares versions, flags breaking updates, and extracts release notes", () => {
  assert.ok(compareVersions("0.10.0", "0.9.9") > 0);
  assert.ok(compareVersions("1.0.0-beta.1", "1.0.0") < 0);
  assert.equal(compareVersions("0.7.0", "0.7.0"), 0);
  assert.equal(isMajorUpdate("0.7.0", "0.8.0"), true, "minor bumps before 1.0 may break");
  assert.equal(isMajorUpdate("0.7.0", "0.7.3"), false);
  assert.equal(isMajorUpdate("1.2.0", "1.9.0"), false);
  assert.deepEqual(changelogBetween(CHANGELOG, version, "9.0.0").map(({ version: v }) => v), ["9.0.0"]);
  assert.deepEqual(changelogBetween(CHANGELOG, version, "9.1.0").map(({ version: v }) => v), ["9.1.0", "9.0.0"]);
  assert.match(noticeFor({ latest: "0.8.0" }, "0.7.0"), /BC Atlas 0\.8\.0 is available \(you have 0\.7\.0\)\. It may contain breaking changes\. Run "bca update"/u);
  assert.equal(noticeFor({ latest: "0.7.0" }, "0.7.0"), undefined);
});

test("never shows the update notice in CI, hooks, pipelines, or machine output", () => {
  const tty = { stderrIsTTY: true, env: {} };
  assert.equal(updateCheckEnabled({ ...tty, command: "check" }), true);
  assert.equal(updateCheckEnabled({ ...tty, command: "check", stderrIsTTY: false }), false);
  assert.equal(updateCheckEnabled({ ...tty, command: "check", env: { CI: "true" } }), false);
  assert.equal(updateCheckEnabled({ ...tty, command: "check", env: { BCA_NO_UPDATE_CHECK: "1" } }), false);
  assert.equal(updateCheckEnabled({ ...tty, command: "check", env: { NO_UPDATE_NOTIFIER: "1" } }), false);
  assert.equal(updateCheckEnabled({ ...tty, command: "check", values: { format: "json" } }), false);
  for (const command of ["run", "mcp", "capabilities", "update", "watch"]) {
    assert.equal(updateCheckEnabled({ ...tty, command }), false, command);
  }
});

test("Dependabot entries are created or added without touching other configuration", () => {
  const created = mergeDependabot(undefined);
  assert.match(created.content, /^version: 2\nupdates:\n {2}- package-ecosystem: npm/mu);
  assert.match(created.content, /dependency-name: bc-atlas/u);
  const appended = mergeDependabot("version: 2\nupdates:\n  - package-ecosystem: github-actions\n    directory: /\n");
  assert.match(appended.content, /package-ecosystem: github-actions[\s\S]*package-ecosystem: npm/u);
  assert.equal(mergeDependabot(created.content).unchanged, true);
  assert.equal(mergeDependabot("version: 2\nupdates:\n  - package-ecosystem: npm\n").skip, true);
  assert.equal(mergeDependabot("updates:\n  - package-ecosystem: pip\nregistries: {}\n").skip, true);
});

test("pipelines use the package.json version when the project declares bc-atlas", () => {
  const triggers = { ci: { tasks: ["check"], sync: "verify", outputs: [] } };
  const local = githubWorkflow({ appPath: "app", version, triggers, local: true });
  assert.match(local, /npm ci; else npm install/u);
  assert.match(local, /run: npx --no-install bca run app --trigger/u);
  const pinned = githubWorkflow({ appPath: "app", version, triggers });
  assert.match(pinned, new RegExp(`npx --yes bc-atlas@${version.replaceAll(".", "\\.")} run app`, "u"));
  assert.doesNotMatch(pinned, /npm ci/u);
});

/** An installed copy of BC Atlas (outside a Git checkout) and a fake registry. */
async function environment(latest) {
  const root = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-update-"));
  const pkg = path.join(root, "pkg");
  mkdirSync(pkg);
  for (const item of ["src", "vendor", "package.json"]) cpSync(path.join(repo, item), path.join(pkg, item), { recursive: true });
  symlinkSync(path.join(repo, "node_modules"), path.join(pkg, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  const server = http.createServer((request, response) => {
    if (request.url === "/bc-atlas/latest") return response.end(JSON.stringify({ version: latest }));
    if (request.url === "/CHANGELOG.md") return response.end(CHANGELOG);
    response.statusCode = 404;
    return response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const env = {
    ...process.env,
    BCA_REGISTRY_URL: url,
    BCA_CHANGELOG_URL: `${url}/CHANGELOG.md`,
    BCA_CACHE_DIR: path.join(root, "cache")
  };
  const cli = path.join(pkg, "src", "cli.js");
  // Async spawn: the fake registry runs in this process and must keep serving.
  const run = (args, options = {}) => new Promise((resolve) => {
    const child = spawn(process.execPath, [options.cli ?? cli, ...args], { env: { ...env, ...options.env }, cwd: options.cwd ?? root });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
  const close = async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  };
  return { root, pkg, run, env, close };
}

test("bca update reports new versions with release notes and the planned commands", async () => {
  const context = await environment("9.1.0");
  try {
    const project = path.join(context.root, "project");
    mkdirSync(project);
    writeFileSync(path.join(project, "package.json"), JSON.stringify({ devDependencies: { "bc-atlas": `^${version}` } }));
    spawnSync("git", ["init", "-q"], { cwd: project });

    const check = await context.run(["update", project, "--check", "--format", "json"]);
    assert.equal(check.status, 1, check.stderr);
    const status = JSON.parse(check.stdout);
    assert.equal(status.latest, "9.1.0");
    assert.equal(status.updateAvailable, true);
    assert.equal(status.major, true);
    assert.deepEqual(status.changelog.map(({ version: v }) => v), ["9.1.0", "9.0.0"]);
    assert.equal(status.mode, "local");
    assert.deepEqual(status.commands, ["npm install --save-dev bc-atlas@^9.1.0"]);

    const text = await context.run(["update", project, "--dry-run"]);
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, /BC Atlas 9\.1\.0 is available\. You have /u);
    assert.match(text.stdout, /### Removed\n\n- Old flag\./u);

    const global = await context.run(["update", context.root, "--check", "--format", "json"]);
    assert.deepEqual(JSON.parse(global.stdout).commands, ["npm install --global bc-atlas@9.1.0"]);

    const noPrompt = await context.run(["update", project], { env: { CI: "" } });
    assert.equal(noPrompt.status, 0);
    assert.match(noPrompt.stdout, /Run with --yes/u, "without a terminal nothing is installed");

    const source = await context.run(["update", "--check", "--format", "json"], { cli: path.join(repo, "src", "cli.js") });
    assert.equal(source.status, 1);
    assert.equal(JSON.parse(source.stdout).mode, "source", "a Git checkout is updated with git pull, not npm");
  } finally {
    await context.close();
  }
});

test("bca update --yes installs the new version and regenerates the setup files", async (t) => {
  if (process.platform === "win32") return t.skip("uses POSIX shell shims for npm and npx");
  const context = await environment("9.1.0");
  try {
    const project = path.join(context.root, "project");
    const app = path.join(project, "app");
    mkdirSync(project);
    cpSync(path.join(repo, "examples", "warehouse-app"), app, { recursive: true });
    spawnSync("git", ["init", "-q"], { cwd: project });
    const setup = await context.run(["setup", "apply", app, "--hooks", "husky", "--ci", "none", "--schedule", "none"]);
    assert.equal(setup.status, 0, setup.stderr);

    const bin = path.join(context.root, "bin");
    const log = path.join(context.root, "calls.log");
    mkdirSync(bin);
    writeFileSync(path.join(bin, "npm"), `#!/bin/sh\necho "npm $*" >> "${log}"\n`);
    writeFileSync(path.join(bin, "npx"), `#!/bin/sh\necho "npx $*" >> "${log}"\nshift 2\nexec "${process.execPath}" "${path.join(context.pkg, "src", "cli.js")}" "$@"\n`);
    chmodSync(path.join(bin, "npm"), 0o755);
    chmodSync(path.join(bin, "npx"), 0o755);

    const result = await context.run(["update", app, "--yes"], { env: { PATH: `${bin}${path.delimiter}${process.env.PATH}` } });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.deepEqual(readFileSync(log, "utf8").trim().split("\n"), [
      "npm install --save-dev bc-atlas@^9.1.0",
      "npx --no-install bca setup apply app --from-config"
    ]);
    assert.match(result.stdout, /BC Atlas 9\.1\.0 is installed\. Generated hooks, tasks, and pipelines were updated/u);
  } finally {
    await context.close();
  }
});

test("the background worker caches the latest version for the next notice", async () => {
  const context = await environment("9.1.0");
  try {
    const worker = await new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(context.pkg, "src", "update-worker.js")], { env: context.env });
      child.on("close", resolve);
    });
    assert.equal(worker, 0);
    const cache = JSON.parse(readFileSync(path.join(context.root, "cache", "update-check.json"), "utf8"));
    assert.equal(cache.latest, "9.1.0");
    assert.ok(Date.parse(cache.checkedAt) > 0);
  } finally {
    await context.close();
  }
});
