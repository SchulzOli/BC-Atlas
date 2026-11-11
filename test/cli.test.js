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

test("export of a diagram view as JSON prints the machine-readable resolved graph", () => {
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const fixtures = fileURLToPath(new URL("./fixtures", import.meta.url));
  const result = spawnSync(process.execPath, [cli, "export", fixtures, "--view", "project", "--format", "json"], {
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  const model = JSON.parse(result.stdout);
  assert.equal(model.schemaVersion, 1);
  assert.equal(model.apps[0].name, "BC Atlas Fixture");
  assert.ok(model.edges.some(({ confidence }) => confidence === "resolved"));
  assert.ok(model.insights.hubs.length > 0);
});

test("the catalog export mirrors source folders and uses type folders for root objects", () => {
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-codegraph-"));
  const feature = path.join(directory, "Feature");
  const output = path.join(directory, "generated");
  mkdirSync(feature);
  writeFileSync(path.join(directory, "app.json"), JSON.stringify({
    id: "11111111-1111-1111-1111-111111111111",
    name: "Code Graph Fixture",
    publisher: "Test",
    version: "1.0.0.0"
  }));
  writeFileSync(path.join(directory, "Root.al"), `
    namespace Demo;
    table 50100 RootTable {
      Caption = 'Root Table';
      fields {
        field(1; Code; Code[20]) { NotBlank = true; }
        field(2; MissingCode; Code[20]) { TableRelation = MissingTable.Code; }
      }
    }
  `);
  writeFileSync(path.join(feature, "Service.al"), `
    namespace Demo;
    codeunit 50101 Service {
      var RootRecord: Record RootTable;
      procedure Find(var Code: Code[20]): Boolean begin RootRecord.FindFirst(); end;
    }
  `);
  writeFileSync(path.join(directory, "Structures.al"), `
    namespace Demo;
    enum 50102 Choice { value(0; First) { Caption = 'First'; } }
    report 50103 CustomerReport {
      dataset { dataitem(Customer; RootTable) { column(Code; Code) { } } }
    }
    query 50104 CustomerQuery {
      elements { dataitem(Customer; RootTable) { filter(Code; Code) { } } }
    }
    xmlport 50105 CustomerPort {
      schema { tableelement(Customer; RootTable) { fieldelement(Code; Customer.Code) { } } }
    }
  `);

  try {
    const result = spawnSync(
      process.execPath,
      [cli, "export", directory, "--view", "catalog", "-o", output],
      { encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr);
    const rootFile = path.join(output, "table", "50100-roottable.md");
    const serviceFile = path.join(output, "Feature", "50101-service.md");
    assert.ok(existsSync(rootFile), "root object should use its type folder");
    assert.ok(existsSync(serviceFile), "nested object should mirror its source folder");
    const rootText = readFileSync(rootFile, "utf8");
    assert.match(rootText, /^---\nType: "Table"\nID: "50100"\nName: "RootTable"\nNamespace: "Demo"\nApp: "Code Graph Fixture 1\.0\.0\.0"\nCaption: "'Root Table'"\n---\n\n# Table 50100 RootTable/u);
    assert.doesNotMatch(rootText, /## Metadata/u);
    assert.match(rootText, /## Fields/u);
    assert.match(rootText, /Root Table/u);
    assert.match(rootText, /\.\.\/Feature\/50101-service\.md/u);
    assert.match(rootText, /MissingTable/u);
    assert.doesNotMatch(rootText, /Unknown/u);
    assert.match(readFileSync(serviceFile, "utf8"), /\.\.\/table\/50100-roottable\.md/u);
    assert.match(readFileSync(serviceFile, "utf8"), /procedure Find\(var Code: Code\[20\]\): Boolean/u);
    assert.match(readFileSync(path.join(output, "enum", "50102-choice.md"), "utf8"), /## Values/u);
    assert.match(readFileSync(path.join(output, "report", "50103-customerreport.md"), "utf8"), /## Dataitems[\s\S]*## Columns/u);
    assert.match(readFileSync(path.join(output, "query", "50104-customerquery.md"), "utf8"), /## Filters/u);
    assert.match(readFileSync(path.join(output, "xmlport", "50105-customerport.md"), "utf8"), /## Schema/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("renders SVG with bundled D2 WASM and normalizes a conflicting extension", () => {
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const fixtures = fileURLToPath(new URL("./fixtures", import.meta.url));
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-"));
  const requestedD2 = path.join(directory, "calls.d2");
  const expectedSvg = path.join(directory, "calls.svg");

  try {
    const result = spawnSync(
      process.execPath,
      [cli, "export", fixtures, "--view", "call", "-o", requestedD2, "-f", "svg"],
      {
        encoding: "utf8",
        env: { ...process.env, PATH: "" },
        // Cold-starting the D2 WebAssembly worker can exceed 30 seconds on
        // GitHub's macOS runners, especially when the runner is under load.
        timeout: 120_000
      }
    );

    assert.equal(result.error, undefined, result.error?.stack);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(requestedD2), "D2 source should be retained");
    assert.ok(existsSync(expectedSvg), "SVG should use the requested format extension");
    assert.match(readFileSync(expectedSvg, "utf8"), /<svg\b/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("accepts workflow entries from the CLI and an explicit workflow config", () => {
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const fixtures = fileURLToPath(new URL("./fixtures", import.meta.url));
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-workflow-"));
  const configPath = path.join(directory, "bca.workflow.json");
  writeFileSync(configPath, JSON.stringify({
    view: "workflow",
    workflow: {
      entries: ["Process"],
      depth: 3,
      maxNodes: 10,
      edgeTypes: ["calls", "events", "writes"]
    }
  }));

  try {
    const configured = spawnSync(
      process.execPath,
      [cli, "export", fixtures, "--view", "workflow", "-f", "json", "--config", configPath],
      { encoding: "utf8" }
    );
    assert.equal(configured.status, 0, configured.stderr);
    const configuredModel = JSON.parse(configured.stdout);
    assert.equal(configuredModel.workflow.depth, 3);
    assert.ok(configuredModel.objects.some(({ name }) => name === "Process"));

    const selected = spawnSync(
      process.execPath,
      [cli, "export", fixtures, "--view", "workflow", "--entry", "Process", "-o", "-", "-f", "json"],
      { encoding: "utf8" }
    );
    assert.equal(selected.status, 0, selected.stderr);
    assert.ok(JSON.parse(selected.stdout).workflow.entries.length > 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

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
    for (const heading of ["Get started", "Analyze", "Export", "Integrate"]) {
      assert.match(result.stdout, new RegExp(`^${heading}$`, "mu"));
    }
    for (const command of ["setup", "check", "simulate", "architecture", "refactor", "graph", "export", "view", "layers", "docs", "run", "update", "mcp"]) {
      assert.match(result.stdout, new RegExp(`^  ${command} `, "mu"));
    }
    for (const removed of ["init", "watch", "explore", "inspect", "codegraph", "capabilities"]) {
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
  const missing = spawnSync(process.execPath, [cli, "export", path.join(fixtures, "missing"), "--view", "project"], { encoding: "utf8" });
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

test("check formats preserve architecture origin and source evidence", () => {
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const project = fileURLToPath(new URL("../examples/multi-app", import.meta.url));
  const config = fileURLToPath(new URL(`./task3-policy-${process.pid}.json`, import.meta.url));
  writeFileSync(config, JSON.stringify({
    architecture: {
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
    }
  }));
  try {
    const run = (format) => spawnSync(process.execPath, [
      cli, "check", project, "--config", config, "--format", format
    ], { encoding: "utf8" });
    const jsonRun = run("json");
    assert.equal(jsonRun.status, 0, jsonRun.stderr);
    const finding = JSON.parse(jsonRun.stdout).findings.find(({ policy }) => policy === "no-platform-table-reads");
    assert.equal(finding.basis, "configured-policy");
    assert.equal(finding.architectureOrigin, "configured");
    assert.ok(finding.evidence.some(({ operation, member, line }) =>
      operation === "Get" && member === "Sync(Code[20])" && line === 12));

    const text = run("text");
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, /Primary location: integration\/ItemSync\.al:12/u);
    const markdown = run("markdown");
    assert.equal(markdown.status, 0, markdown.stderr);
    assert.match(markdown.stdout, /Supporting locations/u);
    const sarif = run("sarif");
    assert.equal(sarif.status, 0, sarif.stderr);
    const result = JSON.parse(sarif.stdout).runs[0].results.find(({ ruleId }) => ruleId === "dependency-rule");
    assert.equal(result.properties.basis, "configured-policy");
    assert.equal(result.properties.architectureOrigin, "configured");
    assert.ok(result.relatedLocations.length);
  } finally {
    rmSync(config, { force: true });
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

test("setup writes a starter configuration that export and check accept", () => {
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const fixtures = fileURLToPath(new URL("./fixtures", import.meta.url));
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-init-"));
  try {
    for (const file of ["app.json", "Sales.al", "Operations.al"]) {
      writeFileSync(path.join(directory, file), readFileSync(path.join(fixtures, file)));
    }
    mkdirSync(path.join(directory, "test"));
    writeFileSync(path.join(directory, "test", "Ignored.al"), "codeunit 50199 IgnoredTest { Subtype = Test; }\n");

    const created = spawnSync(process.execPath, [
      cli, "setup", "apply", directory, "--features", "check", "--hooks", "none", "--ci", "none", "--schedule", "none", "--editor", "none", "--updates", "none"
    ], { encoding: "utf8" });
    assert.equal(created.status, 0, created.stderr);
    const config = JSON.parse(readFileSync(path.join(directory, ".bca.json"), "utf8"));
    assert.equal(config.title, "BC Atlas Fixture architecture");
    assert.deepEqual(config.exclude, ["test/**"]);
    assert.equal(config.check.failOn, "error");

    const model = JSON.parse(spawnSync(process.execPath, [cli, "export", directory, "--view", "project", "-f", "json"], { encoding: "utf8" }).stdout);
    assert.ok(!model.objects.some(({ name }) => name === "IgnoredTest"));
    const check = spawnSync(process.execPath, [cli, "check", directory], { encoding: "utf8" });
    assert.equal(check.status, 0, check.stderr);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the report export writes an overview, health summary, and one diagram per view", () => {
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const fixtures = fileURLToPath(new URL("./fixtures", import.meta.url));
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-report-"));
  const output = path.join(directory, "atlas");
  try {
    const result = spawnSync(process.execPath, [
      cli, "export", fixtures, "--view", "report", "-o", output, "--views", "project,module,events", "--format", "d2", "--codegraph", "--json"
    ], { encoding: "utf8", timeout: 120_000 });
    assert.equal(result.status, 0, result.stderr);
    const readme = readFileSync(path.join(output, "README.md"), "utf8");
    assert.match(readme, /^# BC Atlas Fixture architecture$/mu);
    assert.match(readme, /^## At a glance$/mu);
    assert.match(readme, /^## Architecture health$/mu);
    assert.match(readme, /\[Object catalog\]\(objects\/index\.md\)/u);
    assert.ok(existsSync(path.join(output, "project.d2")));
    assert.ok(existsSync(path.join(output, "module.d2")));
    assert.ok(existsSync(path.join(output, "model.json")));
    assert.ok(existsSync(path.join(output, "objects", "index.md")));
    assert.match(readme, /bca export \S+ --view report -o /u);

    const invalid = spawnSync(process.execPath, [cli, "export", fixtures, "--view", "report", "-o", output, "--views", "object"], {
      encoding: "utf8"
    });
    assert.equal(invalid.status, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the report draws a view too large for every object as an overview of its groups", () => {
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-large-"));
  const app = path.join(directory, "app");
  const output = path.join(directory, "atlas");
  try {
    mkdirSync(path.join(app, "src"), { recursive: true });
    writeFileSync(path.join(app, "app.json"), JSON.stringify({
      id: "22222222-2222-2222-2222-222222222222", name: "Large", publisher: "bc-atlas", version: "1.0.0.0", dependencies: []
    }));
    for (let index = 0; index < 1501; index += 1) {
      writeFileSync(path.join(app, "src", `Enum${index}.Enum.al`), `enum ${50000 + index} "Large ${index}" { value(0; None) { } }\n`);
    }
    mkdirSync(output, { recursive: true });
    writeFileSync(path.join(output, "project.svg"), "<svg/>");

    const result = spawnSync(process.execPath, [
      cli, "export", app, "--view", "report", "-o", output, "--views", "project"
    ], { encoding: "utf8", timeout: 120_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr + result.stdout, /1 diagram\(s\) in the report, 1 as an overview of their groups/u);
    const readme = readFileSync(path.join(output, "README.md"), "utf8");
    assert.match(readme, /Overview: 1501 objects are too many to draw one by one \(at most 1500\), so each group is one box/u);
    assert.match(readme, /!\[Project overview\]\(project\.svg\)/u);
    const section = readme.slice(readme.indexOf("## Project overview"), readme.indexOf("## Architecture health"));
    assert.ok(!section.includes(directory), "the diagram section must not contain absolute paths");
    assert.ok(existsSync(path.join(output, "project.d2")));
    const svg = readFileSync(path.join(output, "project.svg"), "utf8");
    assert.match(svg, /data-collapsed="g0"/u, "the group is one box");
    assert.match(svg, /1501 objects/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the catalog export refuses to replace an unrelated non-empty directory", () => {
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const fixtures = fileURLToPath(new URL("./fixtures", import.meta.url));
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-guard-"));
  try {
    writeFileSync(path.join(directory, "keep.md"), "important");
    const result = spawnSync(process.execPath, [cli, "export", fixtures, "--view", "catalog", "-o", directory], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /refusing to replace/u);
    assert.equal(readFileSync(path.join(directory, "keep.md"), "utf8"), "important");
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
  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.name, "bc-atlas");
  assert.equal(contract.transport.stdout, "json");
  assert.deepEqual(contract.exitCodes, { success: 0, operation: 1, usage: 2 });
  assert.deepEqual(contract.areas.map(({ id }) => id), ["start", "analyze", "export", "integrate"]);
  assert.ok(contract.commands.every(({ area }) => contract.areas.some(({ id }) => id === area)));
  assert.deepEqual([...new Set(contract.commands.map(({ id }) => id.split(".")[0]))],
    ["setup", "check", "simulate", "graph", "architecture", "refactor", "export", "view", "layers", "docs", "run", "plugins", "sync", "ai", "update", "mcp"]);
  assert.deepEqual(contract.commands.filter(({ id }) => id.startsWith("sync.")).map(({ argv, plugin }) => `${argv.join(" ")} (${plugin})`),
    ["bca sync plan [app-root] (sync)", "bca sync run [app-root] (sync)", "bca sync status [app-root] (sync)", "bca sync describe (sync)"],
    "commands of the built-in sync plugin, from its plugin.json");
  assert.ok(contract.commands.some(({ argv }) =>
    argv.join(" ") === "bca docs validate <test-root>"));
  assert.ok(!contract.commands.some(({ id }) => id === "app"), "the app lives in the VS Code extension");
  const exporter = contract.commands.find(({ id }) => id === "export");
  assert.equal(exporter.options.view.default, "app");
  assert.ok(["app", "report", "explorer", "catalog", "project", "workflow"].every((view) => exporter.options.view.enum.includes(view)));
  assert.equal(exporter.options.output.short, "-o");
  assert.equal(exporter.options.rootProcedure.cli, "--root-procedure");
  assert.deepEqual(exporter.options.callDirection.enum, ["incoming", "outgoing", "both"]);
  assert.equal(exporter.options.expandProcedures.type, "boolean");
  assert.equal(exporter.options.objectInboundDepth.cli, "--object-inbound-depth");
  assert.equal(exporter.options.objectOutboundDepth.cli, "--object-outbound-depth");
  assert.equal(exporter.options.sourceRef.cli, "--source-ref");
  assert.equal(exporter.options.noLegend.type, "boolean");
  assert.equal(exporter.options.watch.type, "boolean");
  assert.equal(exporter.options.history.type, "boolean");
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
