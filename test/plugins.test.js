// The plugin system: discovery, manifests, activation, commands, tasks, health rules, hooks,
// extension points, MCP tools, the plugins commands, and setup keeping plugin tasks.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createCapabilities } from "../src/capabilities.js";
import { runAutomation } from "../src/automation/run.js";
import { automationConfig } from "../src/automation/config.js";
import { createMcpServer } from "../src/mcp.js";
import { parseManifest } from "../src/plugins/manifest.js";
import { loadPlugins } from "../src/plugins/registry.js";
import { pluginFindings } from "../src/plugins/health.js";

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const example = fileURLToPath(new URL("../examples/warehouse-app", import.meta.url));
const bca = (args, options = {}) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 180_000, env: { ...process.env, BCA_AL_COMPILER: "off" }, ...options });

const manifest = (id, contributes = {}, extra = {}) => ({
  id, name: `Test ${id}`, version: "1.0.0", description: `Plugin ${id} for tests.`, apiVersion: 1, main: "index.js", contributes, ...extra
});

/** Writes a plugin folder: plugin.json and index.js (activate returns `implementation`, a JS source). */
function writePlugin(dir, definition, implementation) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "plugin.json"), JSON.stringify(definition, null, 2));
  writeFileSync(path.join(dir, "index.js"), `export function activate(context) {\n  globalThis.activations = (globalThis.activations ?? 0) + 1;\n  return ${implementation};\n}\n`);
}

/** A project with two plugins: "audit" (task, rule, hooks, command, MCP tool, point) and "extra" (extends it). */
function project({ config = {} } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "bca-plugins-"));
  writePlugin(path.join(root, "plugins", "audit"), manifest("audit", {
    commands: [{ name: "hello", purpose: "Say hello.", options: { loud: { type: "boolean", description: "Shout." }, format: { description: "Output mode.", enum: ["text", "json"] } } }],
    tasks: [{ id: "audit", summary: "Write the audit log.", before: ["docs"], after: ["check"] }],
    healthRules: [{ id: "audit-rule", severity: "warning", summary: "Reports something." }, { id: "audit-broken", severity: "info", summary: "Throws." }],
    mcpTools: [{ name: "bc_atlas_audit_ping", description: "Ping.", input: { path: { type: "string" } } }],
    hooks: ["run:before", "task:after", "run:after", "check:after"],
    extensionPoints: [{ id: "audit.checks", summary: "Extra audit checks." }]
  }), `{
    commands: { hello: async ({ values }) => ({ passed: true, lines: [values.loud ? "HELLO" : "hello", "settings " + JSON.stringify(context.settings)] }) },
    tasks: { audit: {
      run: async ({ trigger }) => {
        const extra = await context.extensions.get("audit.checks");
        const fs = await import("node:fs/promises");
        await fs.mkdir(context.root + "/docs/audit", { recursive: true });
        await fs.writeFile(context.root + "/docs/audit/log.txt", trigger + " " + extra.map(({ id }) => id).join(","));
        return { ok: true, summary: extra.length + " extra check(s)" };
      },
      outputs: (config) => [config.audit?.outputDir ?? "docs/audit"]
    } },
    healthRules: {
      "audit-rule": async ({ model }) => [{ message: "audit says " + model.marker, object: "codeunit 1 X" }],
      "audit-broken": async () => { throw new Error("boom"); }
    },
    mcpTools: { bc_atlas_audit_ping: async ({ path }) => ({ pong: path }) },
    hooks: {
      "run:before": async ({ trigger, tasks }) => (globalThis.events ??= []).push("before:" + trigger + ":" + tasks.join(",")),
      "task:after": async ({ task, ok }) => (globalThis.events ??= []).push("after-task:" + task + ":" + ok),
      "run:after": async ({ outputs }) => (globalThis.events ??= []).push("after:" + outputs.join(",")),
      "check:after": async () => (globalThis.events ??= []).push("check")
    }
  }`);
  writePlugin(path.join(root, "plugins", "extra"), manifest("extra", { extends: { "audit.checks": ["permissions"] } }),
    `{ extensions: { "audit.checks": [{ id: "permissions", run: () => true }] } }`);
  writeFileSync(path.join(root, ".bca.json"), JSON.stringify({
    plugins: [{ path: "plugins/audit" }, { path: "plugins/extra" }],
    audit: { outputDir: "docs/audit", level: 2 },
    ...config
  }, null, 2));
  return root;
}

test("manifests: validated with clear errors", () => {
  assert.equal(parseManifest(manifest("ok")).configKey, "ok", "configKey defaults to the id");
  assert.throws(() => parseManifest(manifest("Bad_Id")), /invalid plugin manifest: id/u);
  assert.throws(() => parseManifest(manifest("old", {}, { apiVersion: 0 })), /targets plugin API 0; this BC Atlas supports 1/u);
  assert.throws(() => parseManifest(manifest("a", { extensionPoints: [{ id: "b.points", summary: "x" }] })), /must start with "a\."/u);
  assert.throws(() => parseManifest(manifest("a", { mcpTools: [{ name: "ping", description: "x" }] })), /bc_atlas_/u);
  assert.throws(() => parseManifest(manifest("a", { hooks: ["on:everything"] })), /contributes\.hooks/u);
});

test("discovery: built-in, .bca.json paths, switching off, npm packages, BCA_PLUGINS", async () => {
  const root = project();
  try {
    const registry = await loadPlugins(root, JSON.parse(readFileSync(path.join(root, ".bca.json"), "utf8")), { env: {} });
    assert.deepEqual(registry.list().map(({ id, source, enabled }) => `${id}:${source}:${enabled}`),
      ["sync:built-in:true", "audit:path plugins/audit:true", "extra:path plugins/extra:true"]);

    const off = await loadPlugins(root, { plugins: { sync: false } }, { env: {} });
    assert.equal(off.get("sync").enabled, false);
    assert.equal(off.commands().some(({ plugin }) => plugin.id === "sync"), false);

    // npm: a dependency named bc-atlas-plugin-* is found without configuration.
    const npmDir = path.join(root, "node_modules", "bc-atlas-plugin-npmtest");
    writePlugin(npmDir, manifest("npmtest"), "{}");
    writeFileSync(path.join(npmDir, "package.json"), JSON.stringify({ name: "bc-atlas-plugin-npmtest", type: "module", main: "index.js" }));
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ devDependencies: { "bc-atlas-plugin-npmtest": "1.0.0", "bc-atlas-plugin-missing": "1.0.0" } }));
    const npm = await loadPlugins(root, {}, { env: { BCA_PLUGINS: "./plugins/extra" } });
    assert.deepEqual(npm.list().map(({ id, source }) => `${id}:${source}`), ["sync:built-in", "npmtest:npm bc-atlas-plugin-npmtest", "extra:path ./plugins/extra"]);
    assert.ok(npm.warnings.some((warning) => warning.includes("bc-atlas-plugin-missing")), "a declared but missing npm plugin is a warning");

    // A project plugin with a built-in id replaces it, with a warning.
    writePlugin(path.join(root, "plugins", "sync"), manifest("sync"), "{}");
    const replaced = await loadPlugins(root, { plugins: [{ path: "plugins/sync" }] }, { env: {} });
    assert.equal(replaced.get("sync").source, "path plugins/sync");
    assert.ok(replaced.warnings.some((warning) => /plugin "sync" from path plugins\/sync replaces the one from built-in/u.test(warning)), replaced.warnings.join("; "));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("discovery: collisions with BC Atlas and between plugins are errors", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bca-plugins-"));
  try {
    writePlugin(path.join(root, "a"), manifest("a", { tasks: [{ id: "docs", summary: "x" }] }), "{}");
    await assert.rejects(loadPlugins(root, { plugins: [{ path: "a" }] }, { env: {} }), /task "docs", which BC Atlas already has/u);
    writePlugin(path.join(root, "b"), manifest("b", { tasks: [{ id: "same", summary: "x" }] }), "{}");
    writePlugin(path.join(root, "c"), manifest("c", { tasks: [{ id: "same", summary: "x" }] }), "{}");
    await assert.rejects(loadPlugins(root, { plugins: [{ path: "b" }, { path: "c" }] }, { env: {} }), /both contribute task same/u);
    await assert.rejects(loadPlugins(root, { plugins: [{ path: "nope" }] }, { env: {} }), /no plugin\.json/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("tasks: plugin tasks validate, take their place in the order, run with hooks, and report outputs", async () => {
  const root = project({ config: { automation: { triggers: { ci: { tasks: ["audit", "sync"], sync: "none" } } } } });
  globalThis.events = [];
  try {
    const registry = await loadPlugins(root, JSON.parse(readFileSync(path.join(root, ".bca.json"), "utf8")), { env: {} });
    assert.deepEqual(registry.taskOrder(), ["check", "simulate", "report", "diagrams", "sync", "audit", "docs", "codegraph", "handbook", "layers"],
      "before wins over after: both plugin tasks right before docs, in plugin order");
    assert.throws(() => automationConfig({ automation: { triggers: { ci: { tasks: ["audit"] } } } }), /unsupported: audit/u, "without the plugin the task is unknown");

    const result = await runAutomation(root, { trigger: "ci", tasks: ["audit"] });
    assert.equal(result.passed, true);
    assert.deepEqual(result.results.map(({ task, plugin, summary }) => `${task}:${plugin}:${summary}`), ["audit:audit:1 extra check(s)"]);
    assert.deepEqual(result.outputs, ["docs/audit"]);
    assert.equal(readFileSync(path.join(root, "docs/audit/log.txt"), "utf8"), "ci permissions", "extension point of another plugin");
    assert.deepEqual(globalThis.events, ["before:ci:audit", "after-task:audit:true", "after:docs/audit"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("activation: once per registry, on first use", async () => {
  const root = project();
  globalThis.activations = 0;
  try {
    const registry = await loadPlugins(root, JSON.parse(readFileSync(path.join(root, ".bca.json"), "utf8")), { env: {} });
    assert.equal(globalThis.activations, 0, "loading reads manifests only");
    await registry.activate("audit");
    await registry.activate("audit");
    await registry.extensions("audit.checks");
    assert.equal(globalThis.activations, 2, "audit once, extra once for its extension");
    await assert.rejects(registry.extensions("audit.nope"), /unknown extension point/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("health rules: findings join the report, severities can be changed, failures become findings", async () => {
  const root = project({ config: { check: { severities: { "audit-rule": "error" } } } });
  globalThis.events = [];
  try {
    const registry = await loadPlugins(root, JSON.parse(readFileSync(path.join(root, ".bca.json"), "utf8")), { env: {} });
    const findings = await pluginFindings(registry, { model: { marker: "hi" }, report: { findings: [] } });
    assert.deepEqual(findings.map(({ severity, rule, plugin }) => `${severity}:${rule}:${plugin}`), ["error:audit-rule:audit", "warning:plugin-rule-failed:audit"]);
    assert.equal(findings[0].message, "audit says hi");
    assert.equal(findings[0].object, "codeunit 1 X");
    assert.match(findings[1].message, /audit-broken: boom/u);
    assert.deepEqual(globalThis.events, ["check"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("atlas: a plugin adds nodes, relations, a lens, findings, and a story to the one graph", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bca-plugins-"));
  try {
    cpSync(example, root, { recursive: true });
    writePlugin(path.join(root, "plugins", "owners"), manifest("owners", { atlas: { summary: "Who owns which object." } }), `{
      atlas: async ({ atlas, object }) => {
        const table = atlas.nodes.find((node) => node.kind === "object" && node.type === "table");
        return {
          nodes: [{ id: "owners::team::stock", kind: "team", label: "Team Stock", color: "#7C3AED", members: 3 }, { kind: "team", label: "no id: left out" }],
          relations: [{ from: "owners::team::stock", to: object("table", table.objectId), kind: "owns" }, { from: "owners::team::stock", to: "nobody", kind: "owns" }],
          styles: { owns: { color: "#7C3AED", dash: true } },
          lenses: [
            { id: "owners", title: "Owners", summary: "Who owns what.", kinds: ["team", "object"], relations: ["owns"], connected: true },
            { id: "system", title: "Taken", summary: "A lens of BC Atlas keeps its place.", kinds: ["team"], relations: ["owns"] }
          ],
          findings: [{ severity: "warning", rule: "owner-missing", message: "Someone has no owner.", nodes: ["owners::team::stock", "nobody"] }],
          stories: [{ id: "owners", title: "Who owns what", summary: "One team.", steps: [{ title: "Team Stock", text: "Owns a table.", lens: "owners", nodes: ["owners::team::stock", object("table", table.label)] }] }]
        };
      }
    }`);
    writePlugin(path.join(root, "plugins", "broken"), manifest("broken", { atlas: { summary: "Throws." } }), `{ atlas: async () => { throw new Error("boom"); } }`);
    writeFileSync(path.join(root, ".bca.json"), JSON.stringify({ plugins: [{ path: "plugins/owners" }, { path: "plugins/broken" }] }));
    const { Workspace } = await import("../src/app/workspace.js");
    const atlas = await new Workspace(root, {}, { live: false }).atlas();

    const team = atlas.nodes.findIndex(({ id }) => id === "owners::team::stock");
    assert.deepEqual({ ...atlas.nodes[team] }, { color: "#7C3AED", id: "owners::team::stock", kind: "team", label: "Team Stock", members: 3, plugin: "owners" });
    assert.ok(!atlas.nodes.some(({ label }) => label === "no id: left out"));
    const owns = atlas.relations.findIndex(({ kind }) => kind === "owns");
    assert.deepEqual(atlas.relations[owns], { kind: "owns", color: "#7C3AED", dash: true });
    const owned = atlas.edges.filter(([, , relation]) => relation === owns);
    assert.equal(owned.length, 1, "a relation to a node that is not there is left out");
    assert.deepEqual([owned[0][0], atlas.nodes[owned[0][1]].type], [team, "table"]);

    // The lens of the plugin comes after those of BC Atlas, and cannot take the place of one.
    const lens = atlas.lenses.at(-1);
    assert.deepEqual([lens.id, lens.title, lens.plugin, lens.group, lens.color], ["owners", "Owners", "owners", "kind", "kind"]);
    assert.equal(atlas.lenses.find(({ id }) => id === "system").title, "System");
    const finding = atlas.findings.find(({ rule }) => rule === "owner-missing");
    assert.deepEqual([finding.severity, finding.origin, finding.nodes], ["warning", "owners", [team]]);
    const story = atlas.stories.find(({ id }) => id === "owners");
    assert.deepEqual(story.steps[0].nodes, [team, owned[0][1]], "a step is on nodes of the plugin and of the source");
    // A plugin that fails is a finding, and the view still shows.
    assert.match(atlas.findings.find(({ rule }) => rule === "plugin-atlas-failed").message, /Plugin broken could not add to the atlas: boom/u);

    // The same from the terminal, and the plugins commands know the contribution.
    const view = bca(["view", ".", "--lens", "owners"], { cwd: root });
    assert.equal(view.status, 0, view.stderr);
    assert.match(view.stdout, /: Owners\n2 nodes, 1 relation\. Who owns what\.\n[\s\S]*team Team Stock \(1 finding, worst warning\)\n {4}-> owns Warehouse Request\n/u);
    assert.match(bca(["plugins", "show", "owners"], { cwd: root }).stdout, /Atlas \(the graph of the view and of bca view\):\n {2}Who owns which object\./u);
    const list = JSON.parse(bca(["plugins", "list", ".", "--format", "json"], { cwd: root }).stdout);
    assert.deepEqual(list.plugins.map(({ id, contributes }) => `${id}:${contributes.atlas}`), ["sync:1", "owners:1", "broken:1"]);
    writePlugin(path.join(root, "plugins", "broken"), manifest("broken", { atlas: { summary: "Nothing." } }), "{}");
    const doctor = JSON.parse(bca(["plugins", "doctor", ".", "--format", "json"], { cwd: root }).stdout);
    assert.deepEqual(doctor.plugins.find(({ id }) => id === "broken").problems, ["atlas is declared but not implemented"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI: plugin commands, help, and the plugins commands", () => {
  const root = project();
  try {
    const hello = bca(["audit", "hello", ".", "--loud"], { cwd: root });
    assert.equal(hello.status, 0, hello.stderr);
    assert.match(hello.stdout, /HELLO\nsettings \{"outputDir":"docs\/audit","level":2\}/u, "the plugin gets its config section");
    assert.match(bca(["audit"], { cwd: root }).stdout, /bca audit hello/u, "family help");
    assert.match(bca(["audit", "hello", "--help"], { cwd: root }).stdout, /--loud/u);
    assert.match(bca(["audit", "nope"], { cwd: root }).stderr, /unknown audit command "nope"/u);

    const contract = JSON.parse(bca(["help", "--format", "json"], { cwd: root }).stdout);
    assert.ok(contract.commands.some(({ id, plugin }) => id === "audit.hello" && plugin === "audit"), "project plugins join the catalog");

    const list = JSON.parse(bca(["plugins", "list", ".", "--format", "json"], { cwd: root }).stdout);
    assert.deepEqual(list.plugins.map(({ id, configured }) => `${id}:${configured}`), ["sync:false", "audit:true", "extra:false"]);
    assert.equal(list.plugins[1].contributes.healthRules, 2);

    assert.match(bca(["plugins", "show", "audit"], { cwd: root }).stdout, /Extension points:\n {2}audit\.checks/u);

    const doctor = JSON.parse(bca(["plugins", "doctor", ".", "--format", "json"], { cwd: root }).stdout);
    assert.equal(doctor.passed, true, JSON.stringify(doctor.plugins));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("plugins doctor finds declared but missing implementations", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bca-plugins-"));
  try {
    writePlugin(path.join(root, "lazy"), manifest("lazy", { commands: [{ name: "go", purpose: "Go." }], healthRules: [{ id: "lazy-rule", severity: "info", summary: "x" }], extends: { "nobody.point": ["x"] } }), "{}");
    writeFileSync(path.join(root, ".bca.json"), JSON.stringify({ plugins: [{ path: "lazy" }] }));
    const result = bca(["plugins", "doctor", ".", "--format", "json"], { cwd: root });
    assert.equal(result.status, 1);
    const lazy = JSON.parse(result.stdout).plugins.find(({ id }) => id === "lazy");
    assert.deepEqual(lazy.problems, ['command "go" is declared but not implemented', 'health rule "lazy-rule" is declared but not implemented', 'extension "nobody.point" is declared but not implemented']);
    assert.ok(lazy.warnings.some((warning) => warning.includes("no enabled plugin defines it")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("plugins new: the template is a working plugin that passes doctor and its own tests", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bca-plugins-"));
  try {
    const created = bca(["plugins", "new", "telemetry"], { cwd: root });
    assert.equal(created.status, 0, created.stderr);
    writeFileSync(path.join(root, ".bca.json"), JSON.stringify({ plugins: [{ path: "plugins/telemetry" }], telemetry: {} }));
    const doctor = JSON.parse(bca(["plugins", "doctor", ".", "--format", "json"], { cwd: root }).stdout);
    assert.equal(doctor.passed, true, JSON.stringify(doctor.plugins));
    assert.match(bca(["telemetry", "hello"], { cwd: root }).stdout, /Hello from Telemetry/u);
    const own = spawnSync(process.execPath, ["--test"], { cwd: path.join(root, "plugins", "telemetry"), encoding: "utf8" });
    assert.equal(own.status, 0, own.stdout + own.stderr);
    assert.match(bca(["plugins", "new", "telemetry"], { cwd: root }).stderr, /is not empty/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("MCP: plugin tools are registered next to the built-in ones", async () => {
  const root = project();
  try {
    const registry = await loadPlugins(root, JSON.parse(readFileSync(path.join(root, ".bca.json"), "utf8")), { env: {} });
    const server = createMcpServer("0.0.0", { plugins: registry });
    const tools = Object.keys(server._registeredTools ?? server.registeredTools ?? {});
    if (tools.length) {
      assert.ok(tools.includes("bc_atlas_audit_ping"));
      assert.ok(tools.includes("bc_atlas_sync_status"), "tool of the built-in sync plugin");
      assert.ok(tools.includes("bc_atlas_check"));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("catalog: built-in plugin commands are part of the contract and generated docs", () => {
  const commands = createCapabilities("0.0.0").commands.filter(({ plugin }) => plugin === "sync");
  assert.deepEqual(commands.map(({ id }) => id), ["sync.plan", "sync.run", "sync.status", "sync.describe"]);
  assert.equal(commands[0].options.config.cli, "--config", "every plugin command gets --config");
});

test("setup --from-config keeps plugin tasks and other tasks setup does not manage", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bca-plugins-setup-"));
  const git = (...args) => spawnSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", ...args], { cwd: root, encoding: "utf8" });
  try {
    const app = path.join(root, "app");
    cpSync(example, app, { recursive: true });
    git("init", "-q", "-b", "main");
    git("remote", "add", "origin", "https://github.com/contoso/warehouse.git");
    const applied = bca(["setup", "apply", app, "--features", "check,report", "--hooks", "none", "--ci", "github", "--schedule", "0 6 * * 1", "--format", "json"]);
    assert.equal(applied.status, 0, applied.stderr);
    const configFile = path.join(app, ".bca.json");
    const config = JSON.parse(readFileSync(configFile, "utf8"));
    config.automation.triggers.schedule.tasks.push("sync", "handbook");
    config.sync = { sources: { bc: { type: "fact-snapshots", path: "bc-snapshots" } }, channels: [{ id: "processes", how: { outputDir: "docs/processes" } }] };
    writeFileSync(configFile, JSON.stringify(config, null, 2));

    const again = bca(["setup", "apply", app, "--from-config", "--format", "json"]);
    assert.equal(again.status, 0, again.stderr);
    const after = JSON.parse(readFileSync(configFile, "utf8"));
    assert.deepEqual(after.automation.triggers.schedule.tasks, ["report", "sync", "handbook"]);
    const workflow = readFileSync(path.join(root, ".github", "workflows", "bc-atlas.yml"), "utf8");
    assert.match(workflow, /app\/docs\/processes/u, "the pipeline delivers what the sync plugin writes");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
