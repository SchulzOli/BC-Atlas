import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = {
  schemaVersion: 1,
  messageFamily: "ORDERS",
  compilerValidated: false,
  roots: { legacy: ["A"], target: ["D"] },
  nodes: [
    { id: "A", label: 'Orders <"core">', type: "codeunit", origin: "workspace" },
    { id: "B", label: "Buffer", type: "table", origin: "workspace" },
    { id: "C", label: "External", origin: "unresolved" },
    { id: "D", label: "Caller", type: "page", origin: "workspace" },
    { id: "E", label: "Unrelated", type: "table", origin: "workspace" }
  ],
  edges: [
    { id: "AB", source: "A", target: "B", kinds: { calls: 2, uses: 1 }, evidence: [{ file: "Orders.al", line: 10 }], evidenceSampled: true },
    { id: "BC", source: "B", target: "C", kinds: { reads: 1 } },
    { id: "BA", source: "B", target: "A", kinds: { calls: 1 }, inCycle: true },
    { id: "DA", source: "D", target: "A", kinds: { runs: 1 } }
  ]
};

const cli = (args) => spawnSync(process.execPath, [path.join(root, "src", "cli.js"), ...args], {
  encoding: "utf8", env: { ...process.env, BCA_UPDATE_CHECK: "off" }
});

test("saved graph queries preserve evidence, direction and cycles without analyzing AL", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bca-graph-query-"));
  const input = path.join(directory, "graph.json");
  try {
    await fs.writeFile(input, JSON.stringify(fixture));
    const cases = [
      { args: ["--root-group", "legacy", "--depth", "0"], nodes: ["A"], edges: [] },
      { args: ["--root-group", "legacy"], nodes: ["A", "B"], edges: ["AB"] },
      { args: ["--root", "A", "--depth", "2"], nodes: ["A", "B", "C"], edges: ["AB", "BC", "BA"] },
      { args: ["--root", "A", "--direction", "incoming"], nodes: ["A", "B", "D"], edges: ["BA", "DA"] },
      { args: ["--root", "A", "--direction", "both"], nodes: ["A", "B", "D"], edges: ["AB", "BA", "DA"] },
      { args: ["--root", "A", "--depth", "2", "--kind", "calls"], nodes: ["A", "B"], edges: ["AB", "BA"] }
    ];
    for (const { args, nodes, edges } of cases) {
      const result = cli(["graph", "query", input, ...args]);
      assert.equal(result.status, 0, result.stderr);
      const graph = JSON.parse(result.stdout);
      assert.deepEqual(graph.nodes.map(({ id }) => id), nodes);
      assert.deepEqual(graph.edges.map(({ id }) => id), edges);
      assert.equal(graph.metadata.messageFamily, "ORDERS");
      assert.equal(graph.metadata.compilerValidated, false);
      if (edges.includes("AB")) assert.deepEqual(graph.edges.find(({ id }) => id === "AB"), fixture.edges[0]);
    }
    const full = cli(["graph", "query", input]);
    assert.equal(full.status, 0, full.stderr);
    assert.equal(JSON.parse(full.stdout).nodes.length, 5);
    const focused = path.join(directory, "focused.json");
    assert.equal(cli(["graph", "query", input, "--root-group", "legacy", "-o", focused]).status, 0);
    const reloaded = cli(["graph", "query", focused]);
    assert.equal(reloaded.status, 0, reloaded.stderr);
    assert.equal(JSON.parse(reloaded.stdout).metadata.messageFamily, "ORDERS");
    assert.deepEqual(JSON.parse(reloaded.stdout).edges[0].evidence, [{ file: "Orders.al", line: 10 }]);
    assert.deepEqual(JSON.parse(reloaded.stdout).selection.roots, ["A"]);
    assert.equal(cli(["graph", "render", focused, "-o", path.join(directory, "reloaded.svg")]).status, 0);
    assert.match(await fs.readFile(path.join(directory, "reloaded.svg"), "utf8"), /fill="#dbeafe"/u);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("root labels must be unambiguous and invalid graph data reports a specific error", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bca-graph-validation-"));
  const input = path.join(directory, "graph.json");
  try {
    await fs.writeFile(input, JSON.stringify({
      ...fixture, nodes: fixture.nodes.map((node) => node.id === "B" ? { ...node, label: fixture.nodes[0].label } : node)
    }));
    const ambiguous = cli(["graph", "query", input, "--root", fixture.nodes[0].label]);
    assert.notEqual(ambiguous.status, 0);
    assert.match(ambiguous.stderr, /ambiguous/u);
    const exact = cli(["graph", "query", input, "--root", "B", "--depth", "0"]);
    assert.equal(exact.status, 0, exact.stderr);
    assert.deepEqual(JSON.parse(exact.stdout).nodes.map(({ id }) => id), ["B"]);
    for (const [graph, message] of [
      [{ ...fixture, nodes: [null] }, /invalid.*node/u],
      [{ ...fixture, edges: [null] }, /invalid.*edge/u],
      [{ ...fixture, roots: { legacy: "A" } }, /invalid.*root/u]
    ]) {
      await fs.writeFile(input, JSON.stringify(graph));
      const result = cli(["graph", "query", input]);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, message);
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("graph query selects temporal levels and frames without resurrecting removed nodes", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bca-graph-frame-"));
  const input = path.join(directory, "temporal.json");
  try {
    await fs.writeFile(input, JSON.stringify({
      schema: "bc-atlas.graph", schemaVersion: 1,
      timeline: { frames: [{ id: "old" }, { id: "new" }] },
      levels: {
        object: {
          nodes: fixture.nodes.slice(0, 3).map((node, index) => ({ ...node, presence: index === 2 ? [[0, 1]] : [[0, null]] })),
          edges: fixture.edges.slice(0, 2).map((edge, index) => ({ ...edge, presence: index === 1 ? [[0, 1]] : [[0, null]] }))
        },
        app: { nodes: [{ id: "app", label: "My App", presence: [[0, null]] }], edges: [] }
      }
    }));
    for (const [args, ids] of [[[], ["A", "B"]], [["--frame", "0"], ["A", "B", "C"]], [["--level", "app"], ["app"]]]) {
      const result = cli(["graph", "query", input, ...args]);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout).nodes.map(({ id }) => id), ids);
    }
    const absent = cli(["graph", "query", input, "--root", "C"]);
    assert.notEqual(absent.status, 0);
    assert.match(absent.stderr, /root.*C/iu);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("graph tools reject invalid inputs explicitly and do not overwrite their input", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bca-graph-invalid-"));
  const input = path.join(directory, "graph.json");
  try {
    await fs.writeFile(input, JSON.stringify(fixture));
    for (const args of [
      ["--root", "missing"], ["--root-group", "missing"], ["--depth", "-1"],
      ["--depth", "1.5"], ["--frame", "99"], ["--level", "missing"],
      ["--root", "A", "-o", input]
    ]) {
      const result = cli(["graph", "query", input, ...args]);
      assert.notEqual(result.status, 0, JSON.stringify(args));
      assert.ok(result.stderr.length > 0);
    }
    assert.deepEqual(JSON.parse(await fs.readFile(input, "utf8")), fixture);
    for (const invalid of [
      { ...fixture, schemaVersion: 99 },
      { ...fixture, nodes: [...fixture.nodes, fixture.nodes[0]] },
      { ...fixture, edges: [{ id: "bad", source: "A", target: "missing" }] },
      { nodes: [], edges: [] }
    ]) {
      await fs.writeFile(input, JSON.stringify(invalid));
      assert.notEqual(cli(["graph", "query", input]).status, 0);
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("saved graphs render every selected node and edge with safe labels and highlighted roots", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bca-graph-render-"));
  const input = path.join(directory, "graph.json");
  try {
    await fs.writeFile(input, JSON.stringify(fixture));
    for (const format of ["svg", "html", "dot", "json"]) {
      const output = path.join(directory, `focused.${format}`);
      const result = cli(["graph", "render", input, "--root-group", "legacy", "-o", output]);
      assert.equal(result.status, 0, result.stderr);
      const content = await fs.readFile(output, "utf8");
      if (format === "svg" || format === "html") {
        assert.equal((content.match(/class="node"/gu) ?? []).length, 2);
        assert.equal((content.match(/class="edge"/gu) ?? []).length, 1);
        assert.match(content, /data-object="A"/u);
        assert.match(content, /Orders &lt;&quot;core&quot;&gt;/u);
        assert.match(content, /#dbeafe/u);
      } else if (format === "dot") {
        assert.match(content, /"A" -> "B"/u);
        assert.match(content, /Orders <\\"core\\">/u);
      } else {
        assert.deepEqual(JSON.parse(content).nodes.map(({ id }) => id), ["A", "B"]);
      }
    }
    const capped = cli(["graph", "render", input, "--max-nodes", "2", "-o", path.join(directory, "too-big.svg")]);
    assert.notEqual(capped.status, 0);
    assert.match(capped.stderr, /focus|query/iu);
    await assert.rejects(fs.stat(path.join(directory, "too-big.svg")), { code: "ENOENT" });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("CLI and MCP use the same saved graph query and rendering contract", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bca-graph-mcp-"));
  const input = path.join(directory, "graph.json");
  const client = new Client({ name: "graph-platform-test", version: "1.0.0" });
  try {
    await fs.writeFile(input, JSON.stringify(fixture));
    await client.connect(new StdioClientTransport({
      command: process.execPath, args: [path.join(root, "src", "mcp.js")],
      cwd: root, env: { ...process.env }, stderr: "pipe"
    }));
    const query = await client.callTool({
      name: "bc_atlas_graph_query", arguments: { path: input, rootGroup: "legacy", depth: 2 }
    });
    assert.equal(query.isError, undefined, query.content[0].text);
    const result = cli(["graph", "query", input, "--root-group", "legacy", "--depth", "2"]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(query.content[0].text), JSON.parse(result.stdout));
    const rendered = await client.callTool({
      name: "bc_atlas_graph_render",
      arguments: { path: input, rootGroup: "legacy", output: path.join(directory, "mcp.svg") }
    });
    assert.equal(rendered.isError, undefined, rendered.content[0].text);
    assert.deepEqual(JSON.parse(rendered.content[0].text).nodes, 2);
    const svg = await fs.readFile(path.join(directory, "mcp.svg"), "utf8");
    assert.equal((svg.match(/class="edge"/gu) ?? []).length, 1);
    const invalid = await client.callTool({ name: "bc_atlas_graph_query", arguments: { path: input, root: ["missing"] } });
    assert.equal(invalid.isError, true);
  } finally {
    await client.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
