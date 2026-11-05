import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync, strToU8 } from "fflate";
import { applyAlResults } from "../src/al/index.js";
import { parseCallGraph, parseErrorLog, readErrorLogs, runAlTools } from "../src/al/compiler.js";
import { dependencyOrder, packageCacheFolders, readAlWorkspace } from "../src/al/settings.js";
import { analyzerPaths, findAlExtension, findAlToolchain, fromExtension, fromPath } from "../src/al/toolchain.js";
import { analyze } from "../src/analyzer.js";
import { githubWorkflow, azurePipeline } from "../src/automation/pipelines.js";
import { assessHealth, formatHealthMarkdown, formatHealthText } from "../src/health.js";
import { resolveModel } from "../src/resolver.js";
import { renderSarif } from "../src/sarif.js";
import { loadSymbolPackages } from "../src/symbols.js";
import { createView } from "../src/views.js";
import { assessArchitecture } from "../src/blueprint/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "src", "cli.js");
const example = path.join(root, "examples", "warehouse-app");
const multiApp = path.join(root, "examples", "multi-app");
const fixtures = path.join(root, "test", "fixtures", "al");

function temp(prefix) {
  return mkdtempSync(path.join(os.tmpdir(), `bc-atlas-al-${prefix}-`));
}

function write(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/** A symbol package as the AL compiler writes it: a 40-byte NAVX header, then a ZIP. */
function symbolPackage(file, app) {
  const zip = zipSync({ "SymbolReference.json": strToU8(JSON.stringify({ AppId: app.id, Name: app.name, Publisher: "Microsoft", Version: app.version, Tables: [{ Id: 18, Name: "Customer" }] })) });
  const header = new Uint8Array(40);
  header.set(strToU8("NAVX"));
  write(file, Buffer.concat([header, zip]));
}

function fixture(name, folder) {
  return readFileSync(path.join(fixtures, name), "utf8").replaceAll("__ROOT__", folder.replaceAll("\\", "/"));
}

test("reads AL settings like the AL Language extension: folder over workspace, paths per project", async () => {
  const workspace = temp("settings");
  try {
    write(path.join(workspace, "core", "app.json"), JSON.stringify({ id: "c", name: "Core", dependencies: [] }));
    write(path.join(workspace, "sales", "app.json"), JSON.stringify({ id: "s", name: "Sales", dependencies: [{ id: "c", name: "Core" }] }));
    write(path.join(workspace, "sales", "src", "nested", "app.json"), JSON.stringify({ id: "m", name: "Module" }));
    write(path.join(workspace, "contoso.code-workspace"), `{
      // AL multi-root workspace
      "folders": [{ "path": "sales" }, { "path": "core" }],
      "settings": { "al.packageCachePath": ["../symbols", ".alpackages"], "al.enableCodeAnalysis": true, "al.codeAnalyzers": ["\${CodeCop}"], },
    }`);
    write(path.join(workspace, "sales", ".vscode", "settings.json"), `{
      "al.codeAnalyzers": ["\${CodeCop}", "\${UICop}"], // folder settings win
      "al.ruleSetPath": "ruleset.json"
    }`);
    mkdirSync(path.join(workspace, "symbols"));
    mkdirSync(path.join(workspace, "sales", ".alpackages"));

    const al = await readAlWorkspace(workspace);
    assert.equal(path.basename(al.workspaceFile), "contoso.code-workspace");
    assert.deepEqual(al.apps.map(({ relative }) => relative), ["core", "sales"], "nested app.json is a module, not a project");
    const [core, sales] = al.apps;
    assert.deepEqual(core.settings.packageCachePaths, [path.join(workspace, "symbols"), path.join(workspace, "core", ".alpackages")]);
    assert.deepEqual(core.settings.codeAnalyzers, ["${CodeCop}"]);
    assert.deepEqual(sales.settings.codeAnalyzers, ["${CodeCop}", "${UICop}"]);
    assert.equal(sales.settings.ruleSetPath, path.join(workspace, "sales", "ruleset.json"));
    assert.equal(sales.settings.enableCodeAnalysis, true);
    assert.deepEqual(await packageCacheFolders(al), [path.join(workspace, "symbols"), path.join(workspace, "sales", ".alpackages")],
      "only folders that exist");
    assert.deepEqual(dependencyOrder([sales, core]).map(({ relative }) => relative), ["core", "sales"]);

    const editor = await readAlWorkspace(workspace, { settings: { packageCachePath: "./cache" } });
    assert.deepEqual(editor.apps[1].settings.packageCachePaths, [path.join(workspace, "sales", "cache")], "explicit settings override every layer");

    // Editor settings rank below a project's own .vscode/settings.json, as in VS Code.
    const layered = await readAlWorkspace(workspace, { editorSettings: {
      user: { packageCachePath: "./user-cache", assemblyProbingPaths: ["./dotnet"] },
      workspaceFolder: { ruleSetPath: "editor.json", codeAnalyzers: ["${UICop}"] }
    } });
    const [layeredCore, layeredSales] = layered.apps;
    assert.deepEqual(layeredCore.settings.packageCachePaths, core.settings.packageCachePaths, "the workspace file wins over user settings");
    assert.deepEqual(layeredCore.settings.assemblyProbingPaths, [path.join(workspace, "core", "dotnet")], "user settings fill what nothing else sets");
    assert.deepEqual(layeredCore.settings.codeAnalyzers, ["${UICop}"], "the editor's folder settings win over the workspace file");
    assert.equal(layeredSales.settings.ruleSetPath, path.join(workspace, "sales", "ruleset.json"), "a project's own settings win over the editor");
    assert.deepEqual(layeredSales.settings.codeAnalyzers, ["${CodeCop}", "${UICop}"]);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("loads symbols from configured package caches and each app version once", async () => {
  const workspace = temp("symbols");
  try {
    write(path.join(workspace, "app", "app.json"), JSON.stringify({ id: "a", name: "App" }));
    write(path.join(workspace, "app", ".vscode", "settings.json"), JSON.stringify({ "al.packageCachePath": "../shared" }));
    const base = { id: "437dbf0e-84ff-417a-965d-ed2bb9650972", name: "Base Application", version: "27.0.0.0" };
    symbolPackage(path.join(workspace, "shared", "Microsoft_Base Application_27.0.0.0.app"), base);
    symbolPackage(path.join(workspace, "app", ".alpackages", "Microsoft_Base Application_27.0.0.0.app"), base);

    const plain = await loadSymbolPackages(path.join(workspace, "app"));
    assert.equal(plain.packages.length, 1);
    const model = await analyze(path.join(workspace, "app"));
    assert.equal(model.symbolPackages.length, 1, "the same app version from two caches loads once");
    assert.ok(model.objects.some(({ name, externalSymbol }) => name === "Customer" && externalSymbol));
    rmSync(path.join(workspace, "app", ".alpackages"), { recursive: true });
    const configured = await analyze(path.join(workspace, "app"));
    assert.equal(configured.symbolPackages.length, 1, "al.packageCachePath outside the project");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("symbol packages are parsed once and handed out as independent copies", async () => {
  const workspace = temp("symbol-cache");
  try {
    write(path.join(workspace, "app", "app.json"), JSON.stringify({ id: "a", name: "App" }));
    const file = path.join(workspace, "app", ".alpackages", "Microsoft_Base Application_27.0.0.0.app");
    symbolPackage(file, { id: "437dbf0e-84ff-417a-965d-ed2bb9650972", name: "Base Application", version: "27.0.0.0" });
    const first = await loadSymbolPackages(path.join(workspace, "app"));
    first.objects[0].name = "Changed";
    first.objects[0].relations.push({ kind: "uses" });
    first.packages[0].name = "Changed";
    const second = await loadSymbolPackages(path.join(workspace, "app"));
    assert.equal(second.objects[0].name, "Customer", "a caller's change does not reach the cache");
    assert.deepEqual(second.objects[0].relations, []);
    assert.equal(second.packages[0].name, "Base Application");
    assert.equal(second.objects[0].app, second.packages[0], "objects point to their package's app");
    assert.notEqual(second.objects[0], first.objects[0]);

    // A new download (other size or time) is parsed again.
    symbolPackage(file, { id: "437dbf0e-84ff-417a-965d-ed2bb9650972", name: "Base Application", version: "28.0.0.0" });
    utimesSync(file, new Date(), new Date(Date.now() + 5000));
    assert.equal((await loadSymbolPackages(path.join(workspace, "app"))).packages[0].version, "28.0.0.0");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("finds the AL compiler in the AL Language extension, old and new layouts, and the .NET tool", async () => {
  // The real path: Windows temp folders can use 8.3 names (RUNNER~1) that
  // resolving the `al` executable expands.
  const home = realpathSync.native(temp("home"));
  try {
    const extensions = path.join(home, ".vscode", "extensions");
    const old = path.join(extensions, "ms-dynamics-smb.al-14.2.1180208");
    write(path.join(old, "bin", "linux", "alc"), "");
    write(path.join(old, "bin", "Analyzers", "Microsoft.Dynamics.Nav.CodeCop.dll"), "");
    const current = path.join(extensions, "ms-dynamics-smb.al-18.1.1960000");
    write(path.join(current, "bin", "alc"), "");
    write(path.join(current, "bin", "altool"), "");
    write(path.join(current, "bin", "Microsoft.Dynamics.Nav.CodeCop.dll"), "");

    const env = { PATH: "" };
    assert.equal((await findAlExtension({ env, home })).version, "18.1.1960000", "the newest extension");
    const tools = await findAlToolchain({ env, home, platform: "linux" });
    assert.equal(tools.source, "vscode-extension");
    assert.equal(tools.alc.command, path.join(current, "bin", "alc"));
    assert.equal(tools.altool.command, path.join(current, "bin", "altool"));
    assert.deepEqual(analyzerPaths(["${CodeCop}", "UICop", "${AnalyzerFolder}/Custom.dll"], tools, home), [
      path.join(current, "bin", "Microsoft.Dynamics.Nav.CodeCop.dll"),
      path.join(current, "bin", "Microsoft.Dynamics.Nav.UICop.dll"),
      path.join(current, "bin", "Custom.dll")
    ]);
    const legacy = await fromExtension(old, { platform: "linux" });
    assert.equal(legacy.alc.command, path.join(old, "bin", "linux", "alc"));
    assert.equal(legacy.analyzerFolder, path.join(old, "bin", "Analyzers"));
    assert.equal(legacy.altool, undefined);

    assert.equal(await findAlToolchain({ env: { ...env, BCA_AL_COMPILER: "off" }, home }), undefined);
    assert.equal(await findAlToolchain({ compiler: "off", env, home }), undefined);
    assert.equal((await findAlToolchain({ extensionPath: old, env, home, platform: "linux" })).location, old, "the extension VS Code reports wins");

    const tool = path.join(home, ".dotnet", "tools");
    write(path.join(tool, "al"), "");
    const store = path.join(tool, ".store", "microsoft.dynamics.businesscentral.development.tools", "18.1.43.24897",
      "microsoft.dynamics.businesscentral.development.tools", "18.1.43.24897", "tools", "net8.0", "any");
    write(path.join(store, "Microsoft.Dynamics.Nav.CodeCop.dll"), "");
    rmSync(extensions, { recursive: true });
    const dotnet = await findAlToolchain({ env, home, platform: "linux" });
    assert.equal(dotnet.source, "dotnet-tool");
    assert.equal(dotnet.version, "18.1.43.24897");
    assert.deepEqual(dotnet.alc, { command: path.join(tool, "al"), args: ["compile", "--"] }, "al compile passes arguments to alc");
    assert.equal(dotnet.analyzerFolder, store);

    write(path.join(home, "tools", "alc.dll"), "");
    assert.deepEqual((await fromPath(path.join(home, "tools", "alc.dll"))).alc, { command: "dotnet", args: [path.join(home, "tools", "alc.dll")] });
    await assert.rejects(findAlToolchain({ compiler: path.join(home, "missing"), env, home }), /AL compiler not found/u);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("parses AL compiler error logs from alc, al workspace compile, and AL-Go", async () => {
  const folder = temp("logs");
  try {
    const diagnostics = parseErrorLog(JSON.parse(fixture("warehouse.errorLog.json", example)), { root: example });
    assert.ok(diagnostics.length >= 10);
    const unused = diagnostics.find(({ code }) => code === "AA0137");
    assert.deepEqual(unused, {
      severity: "warning",
      code: "AA0137",
      message: "Variable 'WarehouseRequest' is unused in 'ValidateRequest'.",
      file: "Inventory.al",
      line: unused.line,
      column: unused.column,
      endLine: unused.endLine,
      endColumn: unused.endColumn,
      helpLink: unused.helpLink,
      category: "Design",
      origin: "al"
    });
    assert.match(unused.helpLink, /codecop-aa0137/u);
    assert.ok(diagnostics.some(({ code, severity }) => code === "AW0005" && severity === "info"));

    const suppressed = parseErrorLog({ issues: [
      { ruleId: "AA0001", properties: { severity: "Warning", isSuppressedInSource: "True" } },
      { ruleId: "AA0002", properties: { severity: "Hidden" } },
      { ruleId: "AL1022", fullMessage: "Package missing", locations: [], properties: { severity: "Error" } }
    ] });
    assert.deepEqual(suppressed.map(({ code }) => code), ["AL1022"], "suppressed and hidden diagnostics are left out");

    write(path.join(folder, "Core_20261028.errorLog.json"), JSON.stringify({ version: "0.2", issues: [{ ruleId: "AL0185", fullMessage: "Table 'X' is missing",
      locations: [{ analysisTarget: [{ uri: path.join(example, "Inventory.al"), region: { startLine: 3, startColumn: 1 } }] }], properties: { severity: "Error" } }] }));
    write(path.join(folder, "notes.json"), "{}");
    const imported = await readErrorLogs(folder, { root: example });
    assert.deepEqual(imported.map(({ code, file, line }) => [code, file, line]), [["AL0185", "Inventory.al", 3]]);
    await assert.rejects(readErrorLogs(path.join(folder, "notes.json")), /not an AL compiler error log/u);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("the AL compiler resolves calls and its diagnostics replace parse errors", async () => {
  const graph = parseCallGraph(fixture("warehouse.graph.jsonl", example), { root: example });
  assert.ok(graph.edges.every(({ caller, callee }) => caller !== callee), "declaration self-edges are dropped");
  assert.equal(graph.nodes.get([...graph.nodes.keys()].find((id) => id.includes("Codeunit 50101") && id.endsWith("Warehouse Processor"))).type, "codeunit");

  const plain = resolveModel(await analyze(example));
  const plainCalls = createView(structuredClone(plain), "call", {}).edges;
  assert.ok(plainCalls.some(({ to }) => to === "call-framework"), "source-level analysis leaves built-in calls unresolved");

  const model = await analyze(example);
  model.diagnostics.push({ severity: "error", code: "parse-error", message: "tree-sitter reported one or more syntax errors", file: "Inventory.al" });
  const diagnostics = parseErrorLog(JSON.parse(fixture("warehouse.errorLog.json", example)), { root: example });
  const alFiles = readdirSync(example).filter((name) => name.endsWith(".al"));
  const files = Object.fromEntries(alFiles.map((name) => [name, createHash("sha256").update(readFileSync(path.join(example, name))).digest("hex")]));
  await applyAlResults(model, { graph, diagnostics, files, toolchain: { source: "dotnet-tool", version: "18.1", location: "al" } });
  assert.equal(model.al.calls.resolved, 6);
  assert.ok(model.al.calls.builtin >= 20);
  assert.ok(!model.diagnostics.some(({ code }) => code === "parse-error"), "compiler diagnostics replace tree-sitter parse errors");
  assert.ok(model.diagnostics.some(({ code }) => code === "AA0215"));

  const calls = createView(resolveModel(model), "call", {}).edges;
  assert.ok(!calls.some(({ to }) => to === "call-framework"), "built-in methods are not dependencies");
  assert.ok(calls.filter(({ to, kind }) => to && kind === "calls").every(({ resolvedBy }) => resolvedBy === "compiler"));

  const stale = await analyze(example);
  await applyAlResults(stale, { graph, diagnostics, files: Object.fromEntries(alFiles.map((name) => [name, "changed since"])) });
  assert.equal(stale.al.calls.resolved, 0, "changed files fall back to the source-level analysis");
  assert.ok(!stale.diagnostics.some(({ origin }) => origin === "al"), "diagnostics of changed files are dropped");
});

test("health checks keep compiler findings with ranges; SARIF carries them for code scanning", async () => {
  const model = await analyze(example);
  await applyAlResults(model, { diagnostics: parseErrorLog(JSON.parse(fixture("warehouse.errorLog.json", example)), { root: example }) });
  const resolved = resolveModel(model);
  resolved.al = model.al;
  const report = assessHealth(createView(resolved, "project", {}));
  const unused = report.findings.find(({ rule }) => rule === "AA0137");
  assert.equal(unused.message, "AA0137: Variable 'WarehouseRequest' is unused in 'ValidateRequest'.");
  assert.equal(unused.origin, "al");
  assert.ok(unused.column && unused.endColumn);
  assert.ok(report.findings.some(({ rule, severity }) => rule === "AW0005" && severity === "info"), "compiler info diagnostics are findings");

  report.findings.push({ severity: "info", rule: "orphan-objects", message: "1 object(s) without relationships" });
  const sarif = JSON.parse(renderSarif(report, { root: example, fallbackFile: "app.json", version: "1.0.0" }));
  assert.equal(sarif.version, "2.1.0");
  const run = sarif.runs[0];
  assert.equal(run.tool.driver.name, "BC Atlas");
  assert.match(run.originalUriBaseIds.SRCROOT.uri, /^file:\/\/.*warehouse-app\/$/u);
  const result = run.results.find(({ ruleId }) => ruleId === "AA0137");
  assert.equal(result.level, "warning");
  assert.equal(result.locations[0].physicalLocation.artifactLocation.uri, "Inventory.al");
  assert.equal(result.locations[0].physicalLocation.region.startColumn, unused.column);
  assert.match(run.tool.driver.rules[result.ruleIndex].helpUri, /codecop-aa0137/u);
  const orphans = run.results.find(({ ruleId }) => ruleId === "orphan-objects");
  assert.equal(orphans.level, "note");
  assert.equal(orphans.locations[0].physicalLocation.artifactLocation.uri, "app.json", "findings without a file anchor at the manifest");
});

test("health and SARIF retain configured architecture evidence and origin", async () => {
  const architecture = {
    components: [
      { name: "Core", layer: 0, match: ["app:Contoso Core"] },
      { name: "Sales", layer: 1, match: ["app:Contoso Sales"] },
      { name: "Integration", layer: 2, match: ["app:Contoso Integration"] }
    ],
    rules: [{
      name: "no-platform-table-reads",
      from: "component:Integration",
      to: "type:table",
      kinds: ["reads"],
      severity: "warning"
    }]
  };
  const blueprint = await assessArchitecture(multiApp, { architecture });
  const report = assessHealth(blueprint.model, { architecture: blueprint });
  const finding = report.findings.find(({ rule, policy }) =>
    rule === "dependency-rule" && policy === "no-platform-table-reads");

  assert.equal(finding.basis, "configured-policy");
  assert.equal(finding.architectureOrigin, "configured");
  assert.equal(finding.file, "integration/ItemSync.al");
  assert.equal(finding.line, 12);
  assert.equal(finding.resolution.strategy, "follow-rule");
  assert.ok(finding.evidence.some(({ kind, operation, member, file, line }) =>
    kind === "reads" && operation === "Get" && member === "Sync(Code[20])" &&
    file === "integration/ItemSync.al" && line === 12));
  assert.deepEqual(finding.limitations, []);

  const jsonFinding = JSON.parse(JSON.stringify(report)).findings.find(({ policy }) => policy === "no-platform-table-reads");
  assert.equal(jsonFinding.basis, "configured-policy");
  assert.equal(jsonFinding.evidence.find(({ operation }) => operation === "Get").member, "Sync(Code[20])");
  assert.match(formatHealthText(report), /Primary location: integration\/ItemSync\.al:12/u);
  assert.match(formatHealthMarkdown(report), /Supporting locations/u);
  const supportingLine = formatHealthText(JSON.parse(JSON.stringify(report))).split("\n")
    .find((line) => line.includes("Supporting locations:"));
  assert.match(supportingLine, /writes Modify Sync\(Code\[20\]\) \(integration\/ItemSync\.al:13\)/u);
  assert.doesNotMatch(supportingLine, /reads Get Sync/u);

  const sarif = JSON.parse(renderSarif(report, { root: multiApp, fallbackFile: "app.json", version: "1.0.0" }));
  const result = sarif.runs[0].results.find(({ ruleId }) => ruleId === "dependency-rule");
  assert.equal(result.properties.basis, "configured-policy");
  assert.equal(result.properties.architectureOrigin, "configured");
  assert.equal(result.locations[0].physicalLocation.region.startLine, 12);
  assert.ok(result.relatedLocations.some(({ physicalLocation, message }) =>
    physicalLocation.region.startLine === 13 && /writes/u.test(message.text)));
  assert.ok(result.relatedLocations.every(({ physicalLocation }) => physicalLocation.region.startLine !== 12));
});

test("CLI health JSON retains all evidence and limitations when text and Markdown truncate", () => {
  const project = mkdtempSync(path.join(root, "test", "health-evidence-"));
  cpSync(path.join(root, "test", "contract-fixtures"), project, { recursive: true });
  const source = path.join(project, "Contracts.al");
  writeFileSync(source, readFileSync(source, "utf8").replace(
    "procedure Required(): Boolean begin exit(true); end;",
    `procedure Required(): Boolean
    begin
      if true then
        exit(true)
      else if false then
        exit(true)
      else if true then
        exit(true)
      else
        exit(true);
    end;`
  ));
  const run = (format) => {
    const result = spawnSync(process.execPath, [
      cli, "check", project, "--format", format
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  try {
    const finding = JSON.parse(run("json")).findings.find(({ rule, method }) =>
      rule === "contract-fallback" && method === "Required");
    assert.equal(finding.evidence.length, 8, "binding, three conditionals, and four returns remain in JSON");
    assert.deepEqual(finding.limitations, [
      "Body classification is structural and is not proof of runtime behavior."
    ]);
    assert.deepEqual(finding.evidence.map(({ line }) => line), [27, 11, 12, 13, 14, 15, 16, 18]);
    for (const format of ["text", "markdown"]) {
      const output = run(format);
      assert.ok(output.includes("3 additional evidence item(s) omitted; use JSON for all evidence"));
      assert.ok(output.includes(`Limitations: ${finding.limitations[0]}`));
      for (const { line } of finding.evidence.slice(0, 5)) {
        assert.ok(output.includes(`Contracts.al:${line}`), `displayed evidence at line ${line}`);
      }
      for (const { line } of finding.evidence.slice(5)) {
        assert.ok(!output.includes(`Contracts.al:${line}`), `omitted evidence at line ${line}`);
      }
    }
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("bca check imports an error log from any AL build and writes SARIF", () => {
  const folder = temp("check");
  try {
    const app = path.join(folder, "app");
    cpSync(example, app, { recursive: true });
    write(path.join(folder, "logs", "app.errorLog.json"), fixture("warehouse.errorLog.json", app));
    const run = spawnSync(process.execPath, [cli, "check", app, "--compiler-log", path.join(folder, "logs"), "--format", "sarif"], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const sarif = JSON.parse(run.stdout);
    assert.ok(sarif.runs[0].results.some(({ ruleId }) => ruleId === "AA0215"));
    const text = spawnSync(process.execPath, [cli, "check", app, "--compiler-log", path.join(folder, "logs"), "--fail-on", "warning"], { encoding: "utf8" });
    assert.equal(text.status, 1, "compiler warnings count for --fail-on");
    assert.match(text.stdout, /AL compiler +diagnostics imported from an error log; \d+ compiler diagnostic\(s\)/u);
    assert.match(text.stdout, /WARN {3}AA0137: Variable 'WarehouseRequest' is unused in 'ValidateRequest'\. \(Inventory\.al:\d+\)/u);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("generated pipelines install the AL compiler", () => {
  const triggers = { ci: { tasks: ["check"], sync: "verify" } };
  assert.match(githubWorkflow({ appPath: ".", version: "1.0.0", triggers, alTools: true }),
    /Install the AL compiler[\s\S]*dotnet tool install --global Microsoft\.Dynamics\.BusinessCentral\.Development\.Tools/u);
  assert.doesNotMatch(githubWorkflow({ appPath: ".", version: "1.0.0", triggers }), /dotnet tool/u);
  assert.match(azurePipeline({ appPath: ".", version: "1.0.0", triggers, alTools: true }), /task\.prependpath\]\$HOME\/\.dotnet\/tools/u);
});

test("generated pipelines keep the BC Atlas cache between runs", () => {
  const triggers = { ci: { tasks: ["check"], sync: "verify" } };
  const github = githubWorkflow({ appPath: ".", version: "1.0.0", triggers });
  assert.match(github, /uses: actions\/cache@v\d+\n\s+with:\n\s+path: \$\{\{ runner\.temp \}\}\/bc-atlas-cache/u);
  assert.match(github, /BCA_CACHE_DIR: \$\{\{ runner\.temp \}\}\/bc-atlas-cache\n\s+run: npx/u);
  assert.ok(github.indexOf("actions/cache") < github.indexOf("Run BC Atlas"), "the cache is restored before the run");
  const azure = azurePipeline({ appPath: ".", version: "1.0.0", triggers });
  assert.match(azure, /task: Cache@2[\s\S]*path: \$\(Pipeline\.Workspace\)\/bc-atlas-cache/u);
  assert.match(azure, /displayName: Run BC Atlas\n\s+env:\n\s+BCA_CACHE_DIR: \$\(Pipeline\.Workspace\)\/bc-atlas-cache/u);
});

// Runs only where Microsoft's AL toolchain is installed (dotnet tool
// install --global Microsoft.Dynamics.BusinessCentral.Development.Tools).
const realToolchain = await findAlToolchain({ env: { ...process.env, BCA_AL_COMPILER: "" } }).catch(() => undefined);

test("compiles with the real AL toolchain without touching the repository", { skip: !realToolchain && "AL toolchain not installed" }, async () => {
  const folder = temp("real");
  const cache = process.env.BCA_CACHE_DIR;
  process.env.BCA_CACHE_DIR = path.join(folder, "cache");
  try {
    const app = path.join(folder, "app");
    cpSync(example, app, { recursive: true });
    const before = readdirSync(app, { recursive: true }).sort();
    const progress = [];
    const result = await runAlTools(app, { toolchain: realToolchain, analyzers: ["CodeCop"], onProgress: (message) => progress.push(message) });
    assert.deepEqual(readdirSync(app, { recursive: true }).sort(), before, "alc writes into a copy, never into the project");
    assert.equal(result.projects.length, 1);
    assert.equal(result.projects[0].succeeded, true, JSON.stringify(result.diagnostics.filter(({ severity }) => severity === "error")));
    assert.ok(result.diagnostics.some(({ code, file }) => code === "AA0215" && file), "CodeCop ran");
    assert.ok(progress.some((message) => message.includes("Compiling 1 AL project")));
    if (result.graph) assert.ok(result.graph.edges.some(({ kind }) => kind === "Event"), "the call graph has event edges");
    const again = await runAlTools(app, { toolchain: realToolchain, analyzers: ["CodeCop"] });
    assert.equal(again.key, result.key, "unchanged source reuses the cached result");
  } finally {
    if (cache === undefined) delete process.env.BCA_CACHE_DIR;
    else process.env.BCA_CACHE_DIR = cache;
    rmSync(folder, { recursive: true, force: true });
  }
});

test("health reports omit absent architecture origin and keep Markdown evidence cells intact", () => {
  const report = {
    summary: { objectsByType: {}, relationshipsByKind: {}, apps: [] },
    counts: {},
    hubs: [],
    findings: [1, 2, 3].map(() => ({
      severity: "warning",
      rule: "contract-fallback",
      message: "Silent fallback",
      basis: "configured-policy",
      file: "a|b.al",
      line: 2,
      primaryEvidence: { file: "a|b.al", line: 2 },
      evidence: [{ file: "a|b.al", line: 2 }, { file: "c.al", line: 3 }],
      limitations: ["x | y"]
    }))
  };
  const text = formatHealthText(report);
  assert.doesNotMatch(text, /architecture origin: undefined/u);
  assert.match(text, /\[basis: configured-policy\]/u);

  const markdown = formatHealthMarkdown(report, { limit: 2 }).split("| Severity |")[1];
  assert.doesNotMatch(markdown, /undefined/u);
  assert.match(markdown, /Silent fallback \(`a\\\|b\.al:2`\)/u);
  assert.doesNotMatch(markdown, /\\\\\|/u);
  assert.match(markdown, /Primary location: `a\\\|b\.al:2`/u);
  assert.match(markdown, /Limitations: x \\\| y/u);
  assert.match(markdown, /\| \| \| 1 more finding\(s\) \| \|/u);
});

// A stand-in for alc: records its arguments and, like alc, fails with AL1018
// on a missing directory and with an error on a missing rule set or analyzer.
function fakeAlc(folder) {
  const argsFile = path.join(folder, "args.json");
  const script = path.join(folder, "alc.cjs");
  writeFileSync(script, `
    const fs = require("node:fs");
    const args = process.argv.slice(2);
    fs.writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(args));
    const values = (name) => args.filter((arg) => arg.startsWith("/" + name + ":"))
      .flatMap((arg) => arg.slice(name.length + 2).split(";"));
    const issues = [
      ...values("packagecachepath").concat(values("assemblyprobingpaths")).filter((dir) => !fs.existsSync(dir))
        .map((dir) => ({ ruleId: "AL1018", fullMessage: "Directory '" + dir + "' could not be found.", properties: { severity: "Error" } })),
      ...values("ruleset").concat(values("analyzer")).filter((file) => !fs.existsSync(file))
        .map((file) => ({ ruleId: "AL1000", fullMessage: "File '" + file + "' could not be found.", properties: { severity: "Error" } })),
      ...(values("packagecachepath").some((dir) => fs.existsSync(dir) && fs.readdirSync(dir).some((name) => name.endsWith(".app")))
        ? [] : [{ ruleId: "AL1022", fullMessage: "A package with publisher 'Microsoft' could not be found.", properties: { severity: "Error" } }])
    ];
    const log = values("errorlog")[0];
    fs.writeFileSync(log, JSON.stringify({ issues }));
    process.exit(issues.length ? 1 : 0);
  `);
  return {
    toolchain: { source: "config", location: script, alc: { command: process.execPath, args: [script] } },
    args: () => JSON.parse(readFileSync(argsFile, "utf8"))
  };
}

async function withAlCache(folder, run) {
  const cache = process.env.BCA_CACHE_DIR;
  process.env.BCA_CACHE_DIR = path.join(folder, "cache");
  try {
    return await run();
  } finally {
    if (cache === undefined) delete process.env.BCA_CACHE_DIR;
    else process.env.BCA_CACHE_DIR = cache;
  }
}

function alProject(folder) {
  const app = path.join(folder, "app");
  cpSync(example, app, { recursive: true });
  mkdirSync(path.join(app, ".alpackages"), { recursive: true });
  writeFileSync(path.join(app, ".alpackages", "Microsoft_System_27.0.0.0.app"), "");
  return app;
}

test("alc only receives probing and package folders that exist (AL1018)", async () => {
  const folder = temp("probing");
  await withAlCache(folder, async () => {
    const app = alProject(folder);
    mkdirSync(path.join(app, "dotnet"));
    const alc = fakeAlc(folder);
    const result = await runAlTools(app, {
      toolchain: alc.toolchain,
      graph: false,
      cache: false,
      al: { settings: { assemblyProbingPaths: ["./.netpackages", "./dotnet"], packageCachePath: ["./.alpackages", "./missing"] } }
    });
    const args = alc.args();
    assert.deepEqual(result.diagnostics, []);
    assert.ok(result.projects.every(({ succeeded }) => succeeded));
    assert.ok(args.some((arg) => arg === `/assemblyprobingpaths:${path.join(app, "dotnet")}`), args.join(" "));
    assert.ok(!args.some((arg) => arg.includes(".netpackages") || arg.includes("missing")), args.join(" "));
  });
});

test("a missing rule set or analyzer is reported and left out instead of stopping alc", async () => {
  const folder = temp("ruleset");
  await withAlCache(folder, async () => {
    const app = alProject(folder);
    writeFileSync(path.join(app, "present.dll"), "");
    const alc = fakeAlc(folder);
    const result = await runAlTools(app, {
      toolchain: alc.toolchain,
      graph: false,
      cache: false,
      al: { settings: { ruleSetPath: "./missing.ruleset.json", enableCodeAnalysis: true, codeAnalyzers: ["./present.dll", "./absent.dll"] } }
    });
    const args = alc.args();
    assert.ok(result.projects.every(({ succeeded }) => succeeded));
    assert.deepEqual(result.diagnostics.map(({ code, severity }) => `${severity} ${code}`).sort(), [
      "warning al-analyzer-missing",
      "warning al-ruleset-missing"
    ]);
    assert.match(result.diagnostics.find(({ code }) => code === "al-ruleset-missing").message, /missing\.ruleset\.json does not exist; compiled with the default rules/u);
    assert.ok(args.includes(`/analyzer:${path.join(app, "present.dll")}`), args.join(" "));
    assert.ok(!args.some((arg) => arg.startsWith("/ruleset:") || arg.includes("absent.dll")), args.join(" "));
  });
});

test("a compile without any symbol packages explains how to get them", async () => {
  const folder = temp("symbols");
  await withAlCache(folder, async () => {
    const app = path.join(folder, "app");
    cpSync(example, app, { recursive: true });
    rmSync(path.join(app, ".alpackages"), { recursive: true, force: true });
    const result = await runAlTools(app, { toolchain: fakeAlc(folder).toolchain, graph: false, cache: false });
    const hint = result.diagnostics.find(({ code }) => code === "al-symbols-missing");
    assert.ok(hint, JSON.stringify(result.diagnostics));
    assert.equal(hint.file, "app.json");
    assert.match(hint.message, /no symbol packages were found \(\.alpackages\).*AL: Download Symbols/u);
  });
});

test("VS Code variables in al.* settings resolve against the folder that sets them", async () => {
  const folder = temp("variables");
  const root = path.join(folder, "repo");
  const app = path.join(root, "app");
  mkdirSync(path.join(root, ".vscode"), { recursive: true });
  mkdirSync(path.join(app, ".vscode"), { recursive: true });
  writeFileSync(path.join(app, "app.json"), JSON.stringify({ id: "1", name: "App", publisher: "Me", version: "1.0.0.0" }));
  writeFileSync(path.join(root, ".vscode", "settings.json"), JSON.stringify({ "al.packageCachePath": "${workspaceFolder}/symbols" }));
  writeFileSync(path.join(app, ".vscode", "settings.json"), JSON.stringify({ "al.ruleSetPath": "${workspaceFolder}/rules.json" }));
  let workspace = await readAlWorkspace(root);
  assert.deepEqual(workspace.apps[0].settings.packageCachePaths, [path.join(root, "symbols")]);
  assert.equal(workspace.apps[0].settings.ruleSetPath, path.join(app, "rules.json"));
  process.env.BCA_TEST_PROBE = path.join(folder, "probe");
  try {
    workspace = await readAlWorkspace(root, { settings: { assemblyProbingPaths: ["~/probe", "${env:BCA_TEST_PROBE}/x"] } });
  } finally {
    delete process.env.BCA_TEST_PROBE;
  }
  assert.deepEqual(workspace.apps[0].settings.assemblyProbingPaths, [path.join(os.homedir(), "probe"), path.join(folder, "probe", "x")]);
});
