import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadLocalMcpServer() {
  return JSON.parse(readFileSync(path.join(root, ".mcp.json"), "utf8")).mcpServers["bc-atlas"];
}

test("provides a portable MCP config for direct local tool calls", () => {
  assert.deepEqual(loadLocalMcpServer(), {
    command: "node",
    args: ["src/mcp.js"]
  });
});

test("serves BC Atlas tools over MCP stdio", async () => {
  const mcpServer = loadLocalMcpServer();
  const config = path.join(root, "test", `task3-mcp-policy-${process.pid}.json`);
  const contextConfig = path.join(root, "test", `task5-mcp-context-${process.pid}.json`);
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
  const client = new Client({ name: "bc-atlas-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: mcpServer.command,
    args: mcpServer.args,
    cwd: root,
    env: { ...process.env },
    stderr: "pipe"
  });

  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map(({ name }) => name).sort(),
      [
        "bc_atlas_architecture",
        "bc_atlas_capabilities",
        "bc_atlas_check",
        "bc_atlas_docs_edit",
        "bc_atlas_docs_generate",
        "bc_atlas_docs_glossary",
        "bc_atlas_docs_list",
        "bc_atlas_docs_show",
        "bc_atlas_docs_validate",
        "bc_atlas_explore",
        "bc_atlas_extraction_plan",
        "bc_atlas_generate_diagram",
        "bc_atlas_graph_query",
        "bc_atlas_graph_render",
        "bc_atlas_handbook",
        "bc_atlas_inspect",
        "bc_atlas_refactor_move",
        "bc_atlas_refactor_surface",
        "bc_atlas_report",
        "bc_atlas_run",
        "bc_atlas_setup_apply",
        "bc_atlas_setup_plan",
        "bc_atlas_simulate",
        "bc_atlas_simulation_define",
        "bc_atlas_sync_status",
        "bc_atlas_update_check",
        "bc_atlas_view"
      ]
    );

    const result = await client.callTool({ name: "bc_atlas_capabilities", arguments: {} });
    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /"name": "bc-atlas"/u);

    const inspection = await client.callTool({
      name: "bc_atlas_inspect",
      arguments: { path: path.join(root, "test", "fixtures"), view: "project" }
    });
    assert.equal(inspection.isError, undefined);
    const model = JSON.parse(inspection.content[0].text);
    assert.ok(model.files > 0);
    assert.ok(model.objects.length > 0);

    const handbook = await client.callTool({
      name: "bc_atlas_handbook",
      arguments: { path: path.join(root, "examples", "warehouse-app"), page: "data", language: "de" }
    });
    assert.equal(handbook.isError, undefined);
    const { pages } = JSON.parse(handbook.content[0].text);
    assert.deepEqual(pages.map(({ page }) => page), ["data"]);
    assert.match(pages[0].markdown, /Geschrieben von/u, "an agent reads who writes each table");

    const battle = await client.callTool({
      name: "bc_atlas_simulate",
      arguments: { path: path.join(root, "examples", "purchasing-app"), agent: "Ben" }
    });
    assert.equal(battle.isError, undefined);
    const simulation = JSON.parse(battle.content[0].text);
    assert.equal(simulation.passed, false);
    assert.deepEqual(simulation.agents.map(({ name }) => name), ["Ben"], "agent returns one agent's details");
    assert.deepEqual(simulation.agents[0].attempts.find(({ outcome }) => outcome === "blocked").missingPermissions, ['codeunit "Request Notifications" = X']);
    assert.ok(simulation.tasks.every(({ steps }) => steps === undefined), "process tests are listed; their steps come with task");
    // The view without a window: what there is to see, a lens, an opened object, a story, a picture.
    const view = async (args) => client.callTool({ name: "bc_atlas_view", arguments: { path: path.join(root, "examples", "purchasing-app"), ...args } });
    const overview = JSON.parse((await view({})).content[0].text);
    assert.deepEqual(overview.lenses.slice(-5).map(({ id, nodes }) => [id, nodes]), [["processes", 15], ["people", 14], ["requirements", 11], ["simulation", 21], ["sync", 9]]);
    assert.equal(overview.nodes, undefined, "not every node of the project at once");
    const people = JSON.parse((await view({ lens: "people", focus: "person:Ben" })).content[0].text);
    assert.ok(people.relations.some(({ kind }) => kind === "blocked"));
    assert.equal(people.nodes.find(({ label }) => label === "Ben (Team lead)").findings[0].rule, "task-blocked");
    assert.match((await view({ inside: "codeunit:50220", format: "text" })).content[0].text, /^BC Atlas Purchasing Example: Inside Purchase Request Mgt\./u);
    assert.equal(JSON.parse((await view({ story: "fix" })).content[0].text).steps.length, 4);
    const picture = path.join(os.tmpdir(), `bc-atlas-mcp-view-${process.pid}.svg`);
    try {
      const written = JSON.parse((await view({ lens: "data", form: "diagram", output: picture })).content[0].text);
      assert.deepEqual({ format: written.format, title: written.title, nodes: written.nodes }, { format: "svg", title: "Data", nodes: 7 });
      assert.match(readFileSync(picture, "utf8"), /^<svg /u);
    } finally {
      rmSync(picture, { force: true });
    }
    const noFile = await view({ lens: "data", format: "png" });
    assert.equal(noFile.isError, true);
    assert.match(noFile.content[0].text, /a png picture needs output/u);

    // Defining the simulation: the same operations as the Simulate menu and bca simulate define.
    const copy = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-mcp-simulation-"));
    try {
      cpSync(path.join(root, "examples", "purchasing-app"), copy, { recursive: true });
      const define = async (args) => JSON.parse((await client.callTool({ name: "bc_atlas_simulation_define", arguments: { path: copy, ...args } })).content[0].text);
      const shown = await define({});
      assert.deepEqual([shown.written, shown.derived, shown.definition.agents.map(({ name }) => name)], [false, false, ["Anna", "Ben", "Carla", "Dana"]]);
      const tried = await define({ dryRun: true, operations: [{ op: "set", kind: "agent", name: "Eve", roles: ["Purchaser"], mustNot: ["Approval"] }] });
      assert.equal(tried.written, false);
      assert.ok(tried.definition.agents.some(({ name }) => name === "Eve"));
      assert.ok(!JSON.parse(readFileSync(path.join(copy, ".bca.json"), "utf8")).simulation.agents.some(({ name }) => name === "Eve"), "a dry run writes nothing");
      // The fix an agent would make: give the team lead what the blocked step needs, and ask again.
      const before = shown.result.findings.filter(({ code }) => code === "forbidden-task-possible").length;
      const fixed = await define({ operations: [{ op: "remove", kind: "agent", name: "Dana" }] });
      assert.equal(fixed.written, true);
      assert.equal(fixed.result.findings.filter(({ code }) => code === "forbidden-task-possible").length, before - 1);
      const wrong = await client.callTool({ name: "bc_atlas_simulation_define", arguments: { path: copy, operations: [{ op: "remove", kind: "role", name: "Nobody" }] } });
      assert.equal(wrong.isError, true);
      assert.match(wrong.content[0].text, /there is no role "Nobody" to remove/u);
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }

    const unknownAgent = await client.callTool({
      name: "bc_atlas_simulate",
      arguments: { path: path.join(root, "examples", "purchasing-app"), agent: "Nobody" }
    });
    assert.equal(unknownAgent.isError, true);
    assert.match(unknownAgent.content[0].text, /agent "Nobody" was not found; known: Anna, Ben, Carla, Dana/u);

    const health = await client.callTool({
      name: "bc_atlas_check",
      arguments: { path: path.join(root, "test", "fixtures") }
    });
    assert.equal(health.isError, undefined);
    const healthReport = JSON.parse(health.content[0].text);
    assert.equal(healthReport.passed, true);
    assert.equal("contextResponsibilities" in healthReport, false);

    const architectureHealth = await client.callTool({
      name: "bc_atlas_check",
      arguments: { path: path.join(root, "examples", "multi-app"), config }
    });
    assert.equal(architectureHealth.isError, undefined);
    const report = JSON.parse(architectureHealth.content[0].text);
    const finding = report.findings.find(({ policy }) => policy === "no-platform-table-reads");
    assert.equal(finding.basis, "configured-policy");
    assert.equal(finding.architectureOrigin, "configured");
    assert.ok(finding.evidence.some(({ operation, member, file }) =>
      operation === "Get" && member === "Sync(Code[20])" && file === "integration/ItemSync.al"));
    const cliReport = spawnSync(process.execPath, [
      path.join(root, "src", "cli.js"),
      "check",
      path.join(root, "examples", "multi-app"),
      "--config",
      config,
      "--format",
      "json"
    ], { encoding: "utf8" });
    assert.equal(cliReport.status, 0, cliReport.stderr);
    assert.deepEqual(JSON.parse(cliReport.stdout), report, "CLI and MCP expose the same canonical health JSON");

    writeFileSync(contextConfig, JSON.stringify({
      check: {
        contexts: [{
          object: "object:codeunit:Context",
          roles: { partnerResolution: ["object:codeunit:PartnerResolver"] },
          lazyReadMethods: ["LoadPartner()"],
          forbid: []
        }]
      }
    }));
    const contextHealth = await client.callTool({
      name: "bc_atlas_check",
      arguments: {
        path: path.join(root, "test", "context-fixtures"),
        config: contextConfig
      }
    });
    assert.equal(contextHealth.isError, undefined);
    const contextReport = JSON.parse(contextHealth.content[0].text);
    assert.equal(contextReport.passed, true);
    assert.ok(contextReport.contextResponsibilities.summaries[0].responsibilities.partnerResolution
      .some(({ target }) => target === "PartnerResolver"));
    assert.ok(contextReport.findings.some(({ rule, category, severity }) =>
      rule === "context-responsibility" && category === "lazy-reads" && severity === "info"
    ));

    const move = await client.callTool({
      name: "bc_atlas_refactor_move",
      arguments: {
        path: path.join(root, "examples", "monolith"),
        object: "codeunit:50001",
        to: "Warehouse",
        folder: "src/Warehouse",
        namespace: "Contoso.Warehouse",
        dryRun: true
      }
    });
    assert.equal(move.isError, undefined, move.content[0]?.text);
    const movePlan = JSON.parse(move.content[0].text);
    assert.equal(movePlan.to.component, "Warehouse");
    assert.equal(movePlan.to.file, "src/Warehouse/WarehouseHooks.Codeunit.al");
    assert.equal(movePlan.to.namespace, "Contoso.Warehouse");
    assert.equal(movePlan.applied, false);
  } finally {
    await client.close();
    rmSync(config, { force: true });
    rmSync(contextConfig, { force: true });
  }
});
