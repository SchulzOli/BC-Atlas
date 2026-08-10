import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("serves BC Atlas tools over MCP stdio", async () => {
  const client = new Client({ name: "bc-atlas-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, "src", "mcp.js")],
    cwd: root,
    stderr: "pipe"
  });

  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map(({ name }) => name).sort(),
      [
        "bc_atlas_capabilities",
        "bc_atlas_docs_edit",
        "bc_atlas_docs_generate",
        "bc_atlas_docs_glossary",
        "bc_atlas_docs_list",
        "bc_atlas_docs_show",
        "bc_atlas_docs_validate",
        "bc_atlas_generate_diagram",
        "bc_atlas_inspect"
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
  } finally {
    await client.close();
  }
});
