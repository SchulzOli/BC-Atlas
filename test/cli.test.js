import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

test("CLI reference documents every command and option from the catalog", () => {
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const reference = readFileSync(
    fileURLToPath(new URL("../docs/cli-reference.md", import.meta.url)),
    "utf8"
  );
  const contract = JSON.parse(spawnSync(process.execPath, [cli, "help", "--format", "json"], { encoding: "utf8" }).stdout);
  for (const definition of contract.commands.filter(({ variantOf }) => !variantOf)) {
    const name = definition.argv.slice(1).filter((token) => !/^[<[]/u.test(token)).join(" ");
    assert.ok(reference.includes(`\`${name}\``), `${name} is missing from CLI reference`);
    const help = spawnSync(process.execPath, [cli, ...name.split(" "), "--help"], { encoding: "utf8" });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, new RegExp(`^bca ${name} - `, "u"));
    for (const option of Object.values(definition.options)) {
      assert.ok(help.stdout.includes(option.cli), `${option.cli} is missing from "${name} --help"`);
      assert.ok(reference.includes(`\`${option.cli}\``), `${option.cli} (${name}) is missing from CLI reference`);
    }
  }
});

test("overview help groups every command by feature area", () => {
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  for (const args of [[], ["--help"], ["help"]]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^BC Atlas \d/u);
    for (const heading of ["Analyze", "Export", "Integrate"]) {
      assert.match(result.stdout, new RegExp(`^${heading}$`, "mu"));
    }
    for (const command of ["check", "export", "view", "layers", "docs", "mcp"]) {
      assert.match(result.stdout, new RegExp(`^  ${command} `, "mu"));
    }
    for (const removed of ["architecture", "init", "watch", "explore", "inspect", "codegraph", "capabilities", "setup", "simulate", "refactor", "graph", "bundle", "run", "flow", "process", "update", "plugins"]) {
      assert.doesNotMatch(result.stdout, new RegExp(`^  ${removed} `, "mu"));
    }
    assert.doesNotMatch(result.stdout, /\bserve\b/u);
  }
  const docs = spawnSync(process.execPath, [cli, "docs"], { encoding: "utf8" });
  assert.equal(docs.status, 0);
  assert.match(docs.stdout, /^ {2}generate /mu);
});

test("rejects unknown commands, removed commands, and invalid enum values as usage errors", () => {
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const fixtures = fileURLToPath(new URL("./fixtures", import.meta.url));
  for (const args of [
    ["serve", fixtures],
    ["docs", "serve", fixtures],
    ["grpah"],
    ["app", fixtures],
    [fixtures],
    ["graph", fixtures],
    ["inspect", fixtures],
    ["capabilities"],
    ["architecture", fixtures],
    ["export", fixtures, "--view", "nope"],
    ["export", fixtures, "--port", "0"],
    ["export", fixtures, "--view", "explorer", "--format", "svg"],
    ["export", fixtures, "--view", "project", "--format", "html"],
    ["help", "--format", "yaml"]
  ]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
    assert.equal(result.status, 2, `${args.join(" ")}: ${result.stderr}`);
    assert.match(result.stderr, /^bca: /u);
  }
  const missing = spawnSync(process.execPath, [cli, "check", path.join(fixtures, "missing")], { encoding: "utf8" });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /path not found/u);
});

test("check reports architecture health and fails on configured policy violations", () => {
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const fixtures = fileURLToPath(new URL("./fixtures", import.meta.url));
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-check-"));
  try {
    const passed = spawnSync(process.execPath, [cli, "check", fixtures, "--format", "json"], { encoding: "utf8" });
    assert.equal(passed.status, 0, passed.stderr);
    const report = JSON.parse(passed.stdout);
    assert.equal(report.passed, true);
    assert.ok(report.summary.objects > 0);
    assert.ok(report.summary.objectsByType.codeunit > 0);
    assert.ok(report.findings.some(({ rule }) => rule === "unresolved-references"));

    const text = spawnSync(process.execPath, [cli, "check", fixtures], { encoding: "utf8" });
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, /^Result: PASSED/mu);

    const strictInfo = spawnSync(process.execPath, [cli, "check", fixtures, "--fail-on", "info"], { encoding: "utf8" });
    assert.equal(strictInfo.status, 1);
    assert.match(strictInfo.stdout, /^Result: FAILED/mu);

    const config = path.join(directory, "policy.json");
    writeFileSync(config, JSON.stringify({
      forbiddenDependencies: [{ from: "**", to: "**:table:*", severity: "error", message: "no table access" }]
    }));
    const markdown = path.join(directory, "health.md");
    const violated = spawnSync(process.execPath, [
      cli, "check", fixtures, "--config", config, "--format", "markdown", "-o", markdown
    ], { encoding: "utf8" });
    assert.equal(violated.status, 1, violated.stderr);
    assert.match(readFileSync(markdown, "utf8"), /forbidden-dependency/u);

    const fanOut = spawnSync(process.execPath, [
      cli, "check", fixtures, "--max-fan-out", "1", "--fail-on", "warning", "--format", "json"
    ], { encoding: "utf8" });
    assert.equal(fanOut.status, 1);
    assert.ok(JSON.parse(fanOut.stdout).findings.some(({ rule }) => rule === "high-fan-out"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("check applies contract expectations as warnings and reports neutral fallbacks as info", () => {
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const fixture = fileURLToPath(new URL("./contract-fixtures", import.meta.url));
  const noExpectations = fileURLToPath(new URL("./contract-fixtures/no-expectations.json", import.meta.url));
  const unknownSelector = fileURLToPath(new URL("./contract-fixtures/unknown-selector.json", import.meta.url));
  const unknownMethod = fileURLToPath(new URL("./contract-fixtures/unknown-method.json", import.meta.url));

  const configured = spawnSync(process.execPath, [cli, "check", fixture, "--format", "json"], {
    encoding: "utf8"
  });
  assert.equal(configured.status, 0, configured.stderr);
  const configuredReport = JSON.parse(configured.stdout);
  const contractFindings = configuredReport.findings.filter(({ rule }) => rule === "contract-fallback");
  assert.ok(contractFindings.length > 0);
  assert.ok(contractFindings.every(({ severity, basis }) =>
    severity === "warning" && basis === "configured-policy"
  ));
  const configuredAgain = spawnSync(process.execPath, [cli, "check", fixture, "--format", "json"], {
    encoding: "utf8"
  });
  assert.equal(configuredAgain.status, 0, configuredAgain.stderr);
  assert.equal(configuredAgain.stdout, configured.stdout, "the JSON report is deterministic");
  const severityRank = { error: 3, warning: 2, info: 1 };
  assert.deepEqual(
    configuredReport.findings,
    [...configuredReport.findings].sort((left, right) =>
      severityRank[right.severity] - severityRank[left.severity] ||
      left.rule.localeCompare(right.rule) ||
      left.message.localeCompare(right.message)
    ),
    "findings use stable severity, rule, and message ordering"
  );
  assert.deepEqual(
    contractFindings.filter(({ method }) => method === "Required")
      .map(({ enumValue, bindingKind, fallbackKind }) => ({ enumValue, bindingKind, fallbackKind })),
    [{ enumValue: "Defaulted", bindingKind: "default", fallbackKind: "constant-return" }]
  );

  const strict = spawnSync(process.execPath, [
    cli, "check", fixture, "--fail-on", "warning", "--format", "json"
  ], { encoding: "utf8" });
  assert.equal(strict.status, 1);
  assert.equal(JSON.parse(strict.stdout).passed, false);

  const neutral = spawnSync(process.execPath, [
    cli, "check", fixture, "--config", noExpectations, "--format", "json"
  ], { encoding: "utf8" });
  assert.equal(neutral.status, 0, neutral.stderr);
  const neutralFindings = JSON.parse(neutral.stdout).findings.filter(({ rule }) =>
    rule === "contract-fallback"
  );
  assert.ok(neutralFindings.length > 0);
  assert.ok(neutralFindings.every(({ severity, basis }) =>
    severity === "info" && basis === "observed-code-fact"
  ));
  assert.ok(!neutralFindings.some(({ severity }) => severity === "warning"));

  for (const [config, expectedMessage] of [
    [unknownSelector, /must resolve to exactly one interface object/u],
    [unknownMethod, /unknown method "DoesNotExist"/u]
  ]) {
    const invalid = spawnSync(process.execPath, [
      cli, "check", fixture, "--config", config, "--format", "json"
    ], { encoding: "utf8" });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, expectedMessage);
  }
});

test("check reports explicitly selected context responsibilities and validates their configuration", () => {
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const fixture = fileURLToPath(new URL("./context-fixtures", import.meta.url));
  const config = fileURLToPath(new URL(`./context-fixtures/task5-config-${process.pid}.json`, import.meta.url));
  const writeConfig = (check) => writeFileSync(config, JSON.stringify({ check }));
  const run = () => spawnSync(process.execPath, [
    cli, "check", fixture, "--config", config, "--format", "json"
  ], { encoding: "utf8" });

  try {
    writeConfig({
      contexts: [{
        object: "object:codeunit:Context",
        roles: {
          planning: ["object:codeunit:PlanningService"],
          partnerResolution: ["object:codeunit:PartnerResolver"]
        },
        lazyReadMethods: ["LoadPartner()"],
        forbid: ["persistent-writes", "commits"]
      }]
    });
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.passed, true);
    assert.equal(report.contextResponsibilities.summaries.length, 1);
    assert.ok(report.contextResponsibilities.summaries[0].responsibilities.partnerResolution
      .some(({ target }) => target === "PartnerResolver"));
    assert.ok(report.contextResponsibilities.summaries[0].responsibilities.planning
      .some(({ target }) => target === "PlanningService"));
    assert.ok(report.contextResponsibilities.summaries[0].responsibilities.lazyReads
      .some(({ procedure, limitations }) => procedure === "LoadPartner()" && !limitations.length));
    assert.ok(report.findings.some(({ rule, category, severity }) =>
      rule === "context-responsibility" && category === "lazy-reads" && severity === "info"
    ));
    assert.ok(!report.findings.some(({ rule, category, severity }) =>
      rule === "context-responsibility" &&
      category === "persistent-writes" &&
      severity === "warning"
    ));

    for (const [invalid, message] of [
      [{ contexts: { object: "object:codeunit:Context" } }, /check\.contexts must be an array/u],
      [{ contexts: [{ object: "object:codeunit:Missing" }] }, /did not match any object/u],
      [{ contexts: [{ object: "object:codeunit:Context", maxCallDepth: 0 }] }, /maxCallDepth must be a positive integer/u],
      [{ contexts: [{ object: "object:codeunit:Context", maxCallDepth: null }] }, /maxCallDepth must be a positive integer/u],
      [{ contexts: [{ object: "object:codeunit:Context", roles: { partnerResolution: ["object:codeunit:Missing"] } }] }, /did not match any object/u],
      [{ contexts: [{ object: "object:codeunit:Context", roles: { planning: "object:codeunit:PlanningService" } }] }, /roles\.planning must be an array/u],
      [{ contexts: [{ object: "object:codeunit:Context", lazyReadMethods: ["Missing"] }] }, /must be a method signature/u],
      [{ contexts: [{ object: "object:codeunit:Context", lazyReadMethods: ["Missing()"] }] }, /unknown method signature/u],
      [{ contexts: [{ object: "object:codeunit:Context", forbid: ["unknown"] }] }, /forbid must contain only/u]
    ]) {
      writeConfig(invalid);
      const rejected = run();
      assert.equal(rejected.status, 1);
      assert.match(rejected.stderr, message);
    }

    for (const [category, role] of [
      ["planning", { planning: ["object:codeunit:PlanningService"] }],
      ["partner-resolution", { partnerResolution: ["object:codeunit:PartnerResolver"] }],
      ["lazy-reads", {}]
    ]) {
      writeConfig({
        failOn: "warning",
        contexts: [{
          object: "object:codeunit:Context",
          roles: role,
          lazyReadMethods: ["LoadPartner()"],
          forbid: [category]
        }]
      });
      const forbidden = run();
      assert.equal(forbidden.status, 1);
      const policyReport = JSON.parse(forbidden.stdout);
      assert.ok(policyReport.findings.some(({ rule, category: findingCategory, severity, basis }) =>
        rule === "context-responsibility" &&
        findingCategory === category &&
        severity === "warning" &&
        basis === "configured-policy"
      ));
    }

    const noContexts = spawnSync(process.execPath, [
      cli, "check", fileURLToPath(new URL("./fixtures", import.meta.url)), "--format", "json"
    ], { encoding: "utf8" });
    assert.equal(noContexts.status, 0, noContexts.stderr);
    const noContextReport = JSON.parse(noContexts.stdout);
    assert.equal("contextResponsibilities" in noContextReport, false);
    assert.ok(!noContextReport.findings.some(({ rule }) => rule === "context-responsibility"));
  } finally {
    rmSync(config, { force: true });
  }
});

test("export and check read .bca.json: what it excludes is not analyzed", () => {
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const fixtures = fileURLToPath(new URL("./fixtures", import.meta.url));
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-init-"));
  try {
    for (const file of ["app.json", "Sales.al", "Operations.al"]) {
      writeFileSync(path.join(directory, file), readFileSync(path.join(fixtures, file)));
    }
    mkdirSync(path.join(directory, "test"));
    writeFileSync(path.join(directory, "test", "Ignored.al"), "codeunit 50199 IgnoredTest { Subtype = Test; }\n");

    writeFileSync(path.join(directory, ".bca.json"), JSON.stringify({ title: "BC Atlas Fixture architecture", exclude: ["test/**"], check: { failOn: "error" } }, null, 2));

    const atlas = JSON.parse(spawnSync(process.execPath, [cli, "view", directory, "-f", "json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout);
    assert.ok(atlas.nodes.some(({ label }) => label === "Sales Poster"));
    assert.ok(!atlas.nodes.some(({ label }) => label === "IgnoredTest"));
    const check = spawnSync(process.execPath, [cli, "check", directory], { encoding: "utf8" });
    assert.equal(check.status, 0, check.stderr);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the report export writes an overview, a picture of each lens, and the health summary", () => {
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const fixtures = fileURLToPath(new URL("./fixtures", import.meta.url));
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-report-"));
  const output = path.join(directory, "atlas");
  try {
    const result = spawnSync(process.execPath, [
      cli, "export", fixtures, "--view", "report", "-o", output, "--lenses", "overview,data,nope", "--json"
    ], { encoding: "utf8", timeout: 120_000 });
    assert.equal(result.status, 0, result.stderr);
    const readme = readFileSync(path.join(output, "README.md"), "utf8");
    assert.match(readme, /^# BC Atlas Fixture architecture$/mu);
    assert.match(readme, /^## At a glance$/mu);
    assert.match(readme, /^## Architecture health$/mu);
    assert.match(readme, /!\[Data\]\(data\.svg\)/u);
    assert.match(readFileSync(path.join(output, "overview.svg"), "utf8"), /^<svg /u);
    assert.ok(!existsSync(path.join(output, "nope.svg")), "a lens the project does not have is left out");
    assert.ok(existsSync(path.join(output, "model.json")));
    assert.match(readme, /bca export \S+ --view report -o /u);

  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("package exposes the BC Atlas CLI and MCP server", () => {
  const pkg = JSON.parse(
    readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")
  );
  assert.equal(pkg.name, "bc-atlas");
  assert.deepEqual(pkg.bin, {
    bca: "./src/cli.js",
    "bca-mcp": "./src/mcp.js"
  });
});

test("exposes a versioned machine-readable CLI contract for agents", () => {
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const result = spawnSync(process.execPath, [cli, "help", "--format", "json"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const contract = JSON.parse(result.stdout);
  assert.equal(contract.schemaVersion, 2);
  assert.equal(contract.name, "bc-atlas");
  assert.equal(contract.transport.stdout, "json");
  assert.deepEqual(contract.exitCodes, { success: 0, operation: 1, usage: 2 });
  assert.deepEqual(contract.areas.map(({ id }) => id), ["analyze", "export", "integrate"]);
  assert.ok(contract.commands.every(({ area }) => contract.areas.some(({ id }) => id === area)));
  assert.deepEqual([...new Set(contract.commands.map(({ id }) => id.split(".")[0]))],
    ["check", "export", "view", "layers", "docs", "mcp"]);
  assert.ok(contract.commands.some(({ argv }) =>
    argv.join(" ") === "bca docs validate <test-root>"));
  assert.ok(!contract.commands.some(({ id }) => id === "app"), "the app lives in the VS Code extension");
  const exporter = contract.commands.find(({ id }) => id === "export");
  assert.equal(exporter.options.view.default, "app");
  assert.deepEqual(exporter.options.view.enum, ["app", "report", "knowledge-graph"]);
  assert.equal(exporter.options.output.short, "-o");
  assert.equal(exporter.options.watch.type, "boolean");
  assert.equal(exporter.options.history, undefined);
  const set = contract.commands.find(({ id }) => id === "docs.set");
  assert.equal(set.options.expectedHash.cli, "--expected-hash");
  assert.equal(set.options.dryRun.cli, "--dry-run");
});

test("every catalog command resolves to a handler, and --version loads no command module", async () => {
  const { createCapabilities } = await import("../src/capabilities.js");
  const { loadHandler } = await import("../src/cli/handlers.js");
  for (const definition of createCapabilities("0.0.0").commands) {
    assert.equal(typeof await loadHandler(definition, "0.0.0"), "function", definition.id);
  }
  await assert.rejects(loadHandler("nope", "0.0.0"), /no handler for command "nope"/u);

  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const loader = "data:text/javascript," + encodeURIComponent(
    'import{registerHooks}from"node:module";registerHooks({load(u,c,n){if(/\\/src\\/(commands|docs|analyzer)/.test(u))process.stderr.write("LOADED "+u+"\\n");return n(u,c)}});'
  );
  const result = spawnSync(process.execPath, ["--import", loader, cli, "--version"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /LOADED/u);
});

test("check finds an app that uses another without declaring it, and the setting tunes it", () => {
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const project = fileURLToPath(new URL("../examples/multi-app", import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [cli, "check", project, "--format", "json", ...args], { encoding: "utf8" });
  const report = JSON.parse(run().stdout);
  const undeclared = report.findings.filter(({ rule }) => rule === "undeclared-app-dependency");
  assert.deepEqual(undeclared.map(({ severity, app, dependency, objects, manifest, file, line }) => ({ severity, app, dependency, objects, manifest, file, line })), [{
    severity: "warning", app: "Contoso Integration", dependency: "Contoso Core", objects: ["CON Item Sync"], manifest: "integration/app.json", file: "integration/ItemSync.al", line: 10
  }], "one finding per pair of apps, on the line that uses the other app; declared dependencies are not findings");
  assert.equal(report.thresholds.undeclaredDependencies, "warning");
  assert.equal(run("--fail-on", "warning").status, 1);

  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-undeclared-"));
  try {
    const config = path.join(directory, "bca.json");
    for (const [level, expected] of [["error", "error"], ["off", undefined]]) {
      writeFileSync(config, JSON.stringify({ check: { undeclaredDependencies: level } }));
      const tuned = JSON.parse(run("--config", config).stdout);
      assert.equal(tuned.findings.find(({ rule }) => rule === "undeclared-app-dependency")?.severity, expected, level);
    }
    writeFileSync(config, JSON.stringify({ check: { undeclaredDependencies: "loud" } }));
    const wrong = run("--config", config);
    assert.equal(wrong.status, 1);
    assert.match(wrong.stderr, /check\.undeclaredDependencies must be one of: error, warning, info, off/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  // One app, nothing to declare.
  assert.ok(!JSON.parse(spawnSync(process.execPath, [cli, "check", fileURLToPath(new URL("../examples/warehouse-app", import.meta.url)), "--format", "json"], { encoding: "utf8" }).stdout)
    .findings.some(({ rule }) => rule === "undeclared-app-dependency"));
});

test("export writes files: -o - is an error, not a file named -", () => {
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-stdout-"));
  try {
    const result = spawnSync(process.execPath, [cli, "export", fileURLToPath(new URL("./fixtures", import.meta.url)), "-o", "-"], { encoding: "utf8", cwd: directory });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /-o - is not supported\. For JSON on stdout, use bca view --format json/u);
    assert.ok(!existsSync(path.join(directory, "-")));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
