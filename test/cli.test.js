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

test("inspect command emits machine-readable resolved graph", () => {
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const fixtures = fileURLToPath(new URL("./fixtures", import.meta.url));
  const result = spawnSync(process.execPath, [cli, "inspect", fixtures], {
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  const model = JSON.parse(result.stdout);
  assert.equal(model.schemaVersion, 1);
  assert.equal(model.apps[0].name, "BC Atlas Fixture");
  assert.ok(model.edges.some(({ confidence }) => confidence === "resolved"));
  assert.ok(model.insights.hubs.length > 0);
});

test("codegraph mirrors source folders and uses type folders for root objects", () => {
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
      [cli, "codegraph", directory, "--output-dir", output],
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

    writeFileSync(path.join(output, "handwritten.md"), "keep me\n");
    rmSync(path.join(directory, "Structures.al"));
    const second = spawnSync(
      process.execPath,
      [cli, "codegraph", directory, "--output-dir", output],
      { encoding: "utf8" }
    );
    assert.equal(second.status, 0, second.stderr);
    assert.equal(readFileSync(path.join(output, "handwritten.md"), "utf8"), "keep me\n");
    assert.equal(existsSync(path.join(output, "enum", "50102-choice.md")), false);

    const unsafe = spawnSync(
      process.execPath,
      [cli, "codegraph", directory, "--output-dir", directory],
      { encoding: "utf8" }
    );
    assert.equal(unsafe.status, 1);
    assert.match(unsafe.stderr, /must not be the source/u);
    assert.ok(existsSync(path.join(directory, "Root.al")));
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
      [cli, "graph", fixtures, "--view", "call", "-o", requestedD2, "-f", "svg"],
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
      [cli, "inspect", fixtures, "--config", configPath],
      { encoding: "utf8" }
    );
    assert.equal(configured.status, 0, configured.stderr);
    const configuredModel = JSON.parse(configured.stdout);
    assert.equal(configuredModel.workflow.depth, 3);
    assert.ok(configuredModel.objects.some(({ name }) => name === "Process"));

    const selected = spawnSync(
      process.execPath,
      [cli, "inspect", fixtures, "--view", "workflow", "--entry", "Process"],
      { encoding: "utf8" }
    );
    assert.equal(selected.status, 0, selected.stderr);
    assert.ok(JSON.parse(selected.stdout).workflow.entries.length > 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("CLI reference lists every help-exposed command and option", () => {
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const reference = readFileSync(
    fileURLToPath(new URL("../docs/cli-reference.md", import.meta.url)),
    "utf8"
  );
  const helpOutputs = [
    spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" }),
    spawnSync(process.execPath, [cli, "docs", "--help"], { encoding: "utf8" })
  ];
  assert.match(helpOutputs[0].stdout, /^BC Atlas\b/u);
  assert.match(helpOutputs[0].stdout, /\bbca \[graph\]/u);
  for (const result of helpOutputs) {
    assert.equal(result.status, 0, result.stderr);
    const options = new Set(result.stdout.match(/--[a-z][a-z-]*/gu) ?? []);
    for (const option of options) {
      assert.ok(reference.includes(`\`${option}\``), `${option} is missing from CLI reference`);
    }
  }
  for (const command of ["graph", "inspect", "codegraph", "watch", "docs generate"]) {
    assert.ok(reference.includes(`\`${command}\``), `${command} is missing from CLI reference`);
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
  const result = spawnSync(process.execPath, [cli, "capabilities"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const contract = JSON.parse(result.stdout);
  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.name, "bc-atlas");
  assert.equal(contract.transport.stdout, "json");
  assert.deepEqual(contract.exitCodes, { success: 0, operation: 1, usage: 2 });
  assert.ok(contract.commands.some(({ argv }) => argv.join(" ") === "bca inspect <app-root>"));
  assert.ok(contract.commands.some(({ argv }) =>
    argv.join(" ") === "bca docs validate <test-root>"));
  const codegraph = contract.commands.find(({ id }) => id === "codegraph");
  assert.equal(codegraph.options.outputDir.cli, "--output-dir");
  assert.equal(codegraph.output.type, "directory");
  const workflow = contract.commands.find(({ id }) => id === "graph.workflow");
  assert.equal(workflow.options.view.const, "workflow");
  assert.equal(workflow.options.entry.required, true);
  assert.equal(workflow.output.type, "file");
  const graph = contract.commands.find(({ id }) => id === "graph");
  assert.equal(graph.options.rootProcedure.cli, "--root-procedure");
  assert.deepEqual(graph.options.callDirection.enum, ["incoming", "outgoing", "both"]);
  assert.equal(graph.options.expandProcedures.type, "boolean");
  assert.equal(graph.options.objectInboundDepth.cli, "--object-inbound-depth");
  assert.equal(graph.options.objectOutboundDepth.cli, "--object-outbound-depth");
  assert.equal(graph.options.sourceRef.cli, "--source-ref");
  assert.equal(graph.options.noLegend.type, "boolean");
  const set = contract.commands.find(({ id }) => id === "docs.set");
  assert.equal(set.options.expectedHash.cli, "--expected-hash");
  assert.equal(set.options.dryRun.cli, "--dry-run");

  const invalid = spawnSync(process.execPath, [cli, "capabilities", "extra"], {
    encoding: "utf8"
  });
  assert.equal(invalid.status, 2);
});
