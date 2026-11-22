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
    forbiddenDependencies: [{ from: "**", to: "**:table:*", severity: "warning", message: "no table access" }]
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
        "bc_atlas_app",
        "bc_atlas_app_call",
        "bc_atlas_capabilities",
        "bc_atlas_check",
        "bc_atlas_docs_edit",
        "bc_atlas_docs_generate",
        "bc_atlas_docs_glossary",
        "bc_atlas_docs_list",
        "bc_atlas_docs_show",
        "bc_atlas_docs_suggest",
        "bc_atlas_docs_validate",
        "bc_atlas_inspect",
        "bc_atlas_layers",
        "bc_atlas_view"
      ]
    );

    const result = await client.callTool({ name: "bc_atlas_capabilities", arguments: {} });
    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /"name": "bc-atlas"/u);

    const inspection = await client.callTool({
      name: "bc_atlas_inspect",
      arguments: { path: path.join(root, "test", "fixtures") }
    });
    assert.equal(inspection.isError, undefined);
    const part = JSON.parse(inspection.content[0].text);
    assert.equal(part.schema, "bc-atlas.inspect/1");
    assert.ok(part.summary.files > 0 && part.objects.length > 0);
    const one = JSON.parse((await client.callTool({ name: "bc_atlas_inspect", arguments: { path: path.join(root, "test", "fixtures"), select: ["object:codeunit:Sales Poster"], detail: "full" } })).content[0].text);
    assert.deepEqual(one.objects.map(({ name }) => name), ["Sales Poster"]);
    assert.ok(one.objects[0].procedures.length, "full detail has the members");

    // The view without a window: what there is to see, a lens, an opened object, a story, a picture.
    // The view as an MCP App: a tool that shows it, the page as a ui:// resource, and the requests of the page.
    {
      const shows = tools.find(({ name }) => name === "bc_atlas_app");
      assert.deepEqual(shows._meta.ui, { resourceUri: "ui://bc-atlas/view.html" });
      assert.equal(shows._meta["ui/resourceUri"], "ui://bc-atlas/view.html", "hosts of the first version read this key");
      assert.deepEqual(tools.find(({ name }) => name === "bc_atlas_app_call")._meta.ui.visibility, ["app"], "only the page calls it");
      const { resources } = await client.listResources();
      assert.equal(resources.find(({ uri }) => uri === "ui://bc-atlas/view.html").mimeType, "text/html;profile=mcp-app");
      const page = (await client.readResource({ uri: "ui://bc-atlas/view.html" })).contents[0];
      assert.equal(page.mimeType, "text/html;profile=mcp-app");
      assert.ok(page.text.includes('data-host="mcp"') && page.text.includes("window.BCA_MCP_HOST") && page.text.includes('"mode":"mcp"'));
      assert.ok(!/<script[^>]+src=|<link[^>]+href="http/u.test(page.text), "the page loads nothing from elsewhere");

      const copy = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-mcp-app-"));
      try {
        cpSync(path.join(root, "examples", "purchasing-app"), copy, { recursive: true });
        const opened = await client.callTool({ name: "bc_atlas_app", arguments: { path: copy, lens: "data", select: "table:50200" } });
        assert.equal(opened.structuredContent.title, "BC Atlas Purchasing Example");
        assert.equal(opened.structuredContent.address, "#lens=data&sel=table%3A50200");
        assert.match(opened.content[0].text, /is shown to the user/u);
        // What the page asks: the same service the VS Code extension answers with.
        const ask = async (method, params) => {
          const answer = await client.callTool({ name: "bc_atlas_app_call", arguments: { path: opened.structuredContent.path, method, ...(params ? { params } : {}) } });
          return answer.isError ? { error: answer.content[0].text } : JSON.parse(answer.content[0].text);
        };
        const atlas = await ask("atlas");
        assert.ok(atlas.live && atlas.nodes.length && atlas.lenses.length);
        assert.ok((await ask("inside", { id: atlas.nodes.find(({ kind, type, external }) => kind === "object" && type === "codeunit" && !external).id })).nodes.length);
        // What the view exports is saved into the project; a chat client has no editor to open a file in.
        assert.deepEqual(await ask("saveFile", { name: "../../picture.svg", content: "<svg/>" }), { path: ".bca/exports/picture.svg" });
        assert.equal(readFileSync(path.join(copy, ".bca", "exports", "picture.svg"), "utf8"), "<svg/>");
        assert.equal((await ask("openFile", { file: "src/A.al", line: 3 })).error, "src/A.al:3");
        assert.match((await ask("nope")).error, /unknown|method/iu);
      } finally {
        rmSync(copy, { recursive: true, force: true });
      }
    }

    const view = async (args) => client.callTool({ name: "bc_atlas_view", arguments: { path: path.join(root, "examples", "purchasing-app"), ...args } });
    const overview = JSON.parse((await view({})).content[0].text);
    assert.deepEqual(overview.lenses.map(({ id }) => id), ["overview", "system", "apps", "modules", "data", "calls", "events", "pages", "security", "visibility"]);
    assert.equal(overview.nodes, undefined, "not every node of the project at once");
    const data = JSON.parse((await view({ lens: "data", focus: "table:50200" })).content[0].text);
    assert.ok(data.relations.some(({ kind }) => kind === "writes"));
    assert.match((await view({ inside: "codeunit:50220", format: "text" })).content[0].text, /^BC Atlas Purchasing Example: Inside Purchase Request Mgt\./u);
    assert.ok(JSON.parse((await view({ story: "system" })).content[0].text).steps.length > 3);
    assert.equal((await view({ story: "architecture" })).isError, true);
    // The documentation of a repository in sync with the source.
    const layerPages = path.join(os.tmpdir(), `bc-atlas-mcp-layers-${process.pid}`);
    try {
      const layers = async (args) => JSON.parse((await client.callTool({ name: "bc_atlas_layers", arguments: { path: path.join(root, "examples", "multi-app"), output: layerPages, pictures: "none", ...args } })).content[0].text);
      const first = await layers({});
      assert.deepEqual([first.start, first.counts.apps, first.counts.namespaces, first.changes], [`${layerPages}/README.md`, 3, 4, undefined]);
      assert.match(readFileSync(path.join(layerPages, "architecture.md"), "utf8"), /^# How it is connected\n/u);
      const inSync = await layers({ check: true });
      assert.deepEqual([inSync.check, inSync.inSync, inSync.written], [true, true, 0]);
    } finally {
      rmSync(layerPages, { recursive: true, force: true });
    }
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
    assert.ok(report.findings.some(({ rule, message }) => rule === "forbidden-dependency" && message === "no table access"));
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

  } finally {
    await client.close();
    rmSync(config, { force: true });
    rmSync(contextConfig, { force: true });
  }
});
