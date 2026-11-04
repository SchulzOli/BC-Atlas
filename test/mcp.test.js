import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("serves BC Atlas tools over MCP stdio", async () => {
  const config = path.join(root, "test", `task3-mcp-policy-${process.pid}.json`);
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
    command: process.execPath,
    args: [path.join(root, "src", "mcp.js")],
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
        "bc_atlas_inspect",
        "bc_atlas_refactor_move",
        "bc_atlas_refactor_surface",
        "bc_atlas_report",
        "bc_atlas_run",
        "bc_atlas_setup_apply",
        "bc_atlas_setup_plan",
        "bc_atlas_update_check"
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

    const health = await client.callTool({
      name: "bc_atlas_check",
      arguments: { path: path.join(root, "test", "fixtures") }
    });
    assert.equal(health.isError, undefined);
    assert.equal(JSON.parse(health.content[0].text).passed, true);

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
  } finally {
    await client.close();
    rmSync(config, { force: true });
  }
});
