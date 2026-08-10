import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
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
  for (const command of ["graph", "inspect", "watch", "docs generate"]) {
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
  const workflow = contract.commands.find(({ id }) => id === "graph.workflow");
  assert.equal(workflow.options.view.const, "workflow");
  assert.equal(workflow.options.entry.required, true);
  assert.equal(workflow.output.type, "file");
  const set = contract.commands.find(({ id }) => id === "docs.set");
  assert.equal(set.options.expectedHash.cli, "--expected-hash");
  assert.equal(set.options.dryRun.cli, "--dry-run");

  const invalid = spawnSync(process.execPath, [cli, "capabilities", "extra"], {
    encoding: "utf8"
  });
  assert.equal(invalid.status, 2);
});
