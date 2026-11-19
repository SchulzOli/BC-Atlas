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
        "bc_atlas_app",
        "bc_atlas_app_call",
        "bc_atlas_architecture",
        "bc_atlas_architecture_adopt",
        "bc_atlas_architecture_compare",
        "bc_atlas_architecture_explain",
        "bc_atlas_architecture_templates",
        "bc_atlas_capabilities",
        "bc_atlas_check",
        "bc_atlas_docs_edit",
        "bc_atlas_docs_generate",
        "bc_atlas_docs_glossary",
        "bc_atlas_docs_list",
        "bc_atlas_docs_show",
        "bc_atlas_docs_validate",
        "bc_atlas_extraction_plan",
        "bc_atlas_generate_diagram",
        "bc_atlas_inspect",
        "bc_atlas_layers",
        "bc_atlas_report",
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
        const opened = await client.callTool({ name: "bc_atlas_app", arguments: { path: copy, lens: "components", inside: "component::Purchase" } });
        assert.equal(opened.structuredContent.title, "BC Atlas Purchasing Example");
        assert.equal(opened.structuredContent.address, "#lens=components&inside=component%3A%3APurchase");
        assert.match(opened.content[0].text, /is shown to the user/u);
        // What the page asks: the same service the VS Code extension answers with.
        const ask = async (method, params) => {
          const answer = await client.callTool({ name: "bc_atlas_app_call", arguments: { path: opened.structuredContent.path, method, ...(params ? { params } : {}) } });
          return answer.isError ? { error: answer.content[0].text } : JSON.parse(answer.content[0].text);
        };
        const atlas = await ask("atlas");
        assert.ok(atlas.live && atlas.nodes.length && atlas.architecture.score.total > 0);
        assert.ok((await ask("compareArchitecture", { to: "proposal" })).criteria.length);
        // What the view exports is saved into the project; a chat client has no editor to open a file in.
        assert.deepEqual(await ask("saveFile", { name: "../../picture.svg", content: "<svg/>" }), { path: ".bca/exports/picture.svg" });
        assert.equal(readFileSync(path.join(copy, ".bca", "exports", "picture.svg"), "utf8"), "<svg/>");
        assert.equal((await ask("openFile", { file: "src/A.al", line: 3 })).error, "src/A.al:3");
        assert.match((await ask("nope")).error, /unknown|method/iu);
      } finally {
        rmSync(copy, { recursive: true, force: true });
      }
    }

    // The architecture for an agent: why it is what it is, the current and the target state, and the templates.
    {
      const copy = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-mcp-architecture-"));
      try {
        cpSync(path.join(root, "examples", "purchasing-app"), copy, { recursive: true });
        const ask = async (name, args) => JSON.parse((await client.callTool({ name, arguments: { path: copy, ...args } })).content[0].text);
        const why = await ask("bc_atlas_architecture_explain", {});
        assert.equal(why.mode, "proposal");
        assert.ok(why.components.length && why.components.every(({ naming, why: sentences, steps }) => naming?.by && sentences.length && Object.keys(steps).length));
        assert.ok(why.steps.coupling && why.steps.kept);
        const one = await ask("bc_atlas_architecture_explain", { component: why.components[0].component });
        assert.ok(one.members.length && one.members.every(({ step }) => why.steps[step]));
        const object = await ask("bc_atlas_architecture_explain", { object: one.members[0].label });
        assert.equal(object.objects[0].component, why.components[0].component);
        assert.ok(object.objects[0].why);

        const templates = await ask("bc_atlas_architecture_templates", {});
        assert.deepEqual(templates.templates.filter(({ origin }) => origin === "preset").map(({ name }) => name), ["balanced", "follow-structure", "by-coupling", "layered", "modular-monolith", "small-steps"]);
        assert.ok(templates.criteria.some(({ id, meaning }) => id === "fewMoves" && meaning));
        const dry = await ask("bc_atlas_architecture_templates", { action: "save", name: "house", title: "Our house", values: { template: "layered", weights: { fewMoves: 7 } } });
        assert.equal(dry.written, false);
        const saved = await ask("bc_atlas_architecture_templates", { action: "save", name: "house", title: "Our house", values: { template: "layered", weights: { fewMoves: 7 } }, use: true, dryRun: false });
        assert.equal(saved.written, true);
        assert.equal(JSON.parse(readFileSync(path.join(copy, ".bca.json"), "utf8")).architecture.template, "house");
        assert.equal((await ask("bc_atlas_architecture_templates", { action: "show", name: "house" })).goals.weights.fewMoves, 7);

        const compared = await ask("bc_atlas_architecture_compare", { to: "best" });
        assert.equal(compared.template.name, "house");
        assert.equal(compared.criteria.find(({ id }) => id === "fewMoves").weight, 7);
        assert.ok(compared.candidates.length > 1 && compared.candidates.some(({ chosen }) => chosen));
        assert.ok(compared.steps.length && compared.moves.every(({ object, from, to }) => object.id && from && to));
        assert.match((await ask("bc_atlas_architecture_compare", { to: "best", format: "markdown" })).markdown, /Current and target/u);

        const planned = await ask("bc_atlas_architecture_adopt", { to: "proposal" });
        assert.equal(planned.written, false);
        assert.equal(JSON.parse(readFileSync(path.join(copy, ".bca.json"), "utf8")).architecture.components, undefined);
        const adopted = await ask("bc_atlas_architecture_adopt", { to: "proposal", dryRun: false });
        assert.ok(adopted.written && adopted.components >= 1);
        const now = await ask("bc_atlas_architecture", {});
        assert.equal(now.mode, "configured");
        assert.ok(now.score.total >= 0 && now.score.criteria.length === templates.criteria.length);
        assert.equal(now.template.name, "house");
        assert.equal((await ask("bc_atlas_architecture_explain", {})).components[0].naming.by, "declared");
      } finally {
        rmSync(copy, { recursive: true, force: true });
      }
    }

    const view = async (args) => client.callTool({ name: "bc_atlas_view", arguments: { path: path.join(root, "examples", "purchasing-app"), ...args } });
    const overview = JSON.parse((await view({})).content[0].text);
    assert.deepEqual(overview.lenses.map(({ id }) => id), ["overview", "system", "components", "apps", "modules", "data", "calls", "events", "pages", "security", "visibility"]);
    assert.equal(overview.nodes, undefined, "not every node of the project at once");
    const data = JSON.parse((await view({ lens: "data", focus: "table:50200" })).content[0].text);
    assert.ok(data.relations.some(({ kind }) => kind === "writes"));
    assert.match((await view({ inside: "codeunit:50220", format: "text" })).content[0].text, /^BC Atlas Purchasing Example: Inside Purchase Request Mgt\./u);
    assert.equal(JSON.parse((await view({ story: "architecture" })).content[0].text).steps.length, 8);
    // The documentation of a repository in sync with the source, with what to change and how.
    const layerPages = path.join(os.tmpdir(), `bc-atlas-mcp-layers-${process.pid}`);
    try {
      const layers = async (args) => JSON.parse((await client.callTool({ name: "bc_atlas_layers", arguments: { path: path.join(root, "examples", "multi-app"), output: layerPages, pictures: "none", ...args } })).content[0].text);
      const first = await layers({});
      assert.deepEqual([first.start, first.counts.apps, first.changes.length], [`${layerPages}/README.md`, 3, 7]);
      assert.deepEqual(Object.keys(first.changes[0]), ["title", "kind", "why", "how", "effort"]);
      assert.equal(first.changes[0].title, "Declare that Contoso Integration depends on Contoso Core");
      assert.match(readFileSync(path.join(layerPages, "changes.md"), "utf8"), /^# What to change, and how\n/u);
      const inSync = await layers({ check: true });
      assert.deepEqual([inSync.check, inSync.inSync, inSync.written], [true, true, 0]);
      const toChange = JSON.parse((await client.callTool({ name: "bc_atlas_view", arguments: { path: path.join(root, "examples", "multi-app"), story: "architecture" } })).content[0].text);
      assert.deepEqual([toChange.title, toChange.steps.length], ["What to change, and how", 7]);
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

  } finally {
    await client.close();
    rmSync(config, { force: true });
    rmSync(contextConfig, { force: true });
  }
});
