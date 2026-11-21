// What agents and people are told about BC Atlas is true: the command catalog
// (help, `bca help --format json`, the CLI reference) and the MCP tools name
// only commands, options, lenses, and stories that exist, and nothing that was
// removed. A feature that goes takes its words with it, or this test fails.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import { Workspace } from "../src/app/workspace.js";
import { createCapabilities, findCommand, VIEW_LENSES } from "../src/capabilities.js";
import { parseCommandArgs } from "../src/cli/args.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const capabilities = createCapabilities("0.0.0");

/** Words of features that BC Atlas no longer has. */
const REMOVED = [
  [/\bcomponents?\b/iu, "components (the target architecture)"],
  [/wrong[- ]way/iu, "dependencies the wrong way"],
  [/\bbaseline\b/iu, "the architecture baseline"],
  [/\bcompiler\b|\banaly[sz]ers?\b/iu, "the AL compiler and its analyzers"],
  [/\bproposals?\b/iu, "architecture proposals"],
  [/\bd2\b/iu, "D2 output"],
  [/\bpdf\b/iu, "PDF output"],
  [/\bcodegraph\b|\bobject catalog\b/iu, "the object catalog"],
  [/--at\b|--releases\b|\bhistory\//u, "the history of bca layers"],
  [/bc_atlas_(architecture|extraction_plan|generate_diagram)/u, "removed MCP tools"]
];
// `bca docs generate` still writes journey.d2 next to journey.svg.
const allowed = (text) => text.replaceAll(/journey\.d2/gu, "");

function assertCurrent(text, where) {
  for (const [pattern, what] of REMOVED) assert.doesNotMatch(allowed(text), pattern, `${where} speaks of ${what}`);
}

/** Splits an example command line like a shell: words, and "quoted words". */
function words(line) {
  return [...line.matchAll(/"([^"]*)"|(\S+)/gu)].map(([, quoted, plain]) => quoted ?? plain);
}

test("every example of the command catalog runs: its command, options, and values exist", async () => {
  const atlas = await new Workspace(path.join(root, "examples", "multi-app"), {}, { live: false }).atlas();
  const stories = new Set(atlas.stories.map(({ id }) => id));
  let checked = 0;
  for (const definition of capabilities.commands) {
    for (const example of definition.examples) {
      const argv = words(example);
      assert.equal(argv[0], "bca", example);
      const command = definition.id.split(".");
      assert.deepEqual(argv.slice(1, 1 + command.length), command, `${example} is an example of ${definition.id}`);
      // What follows a shell redirect (> model.json) is not an argument.
      const redirect = argv.indexOf(">");
      const args = argv.slice(1 + command.length, redirect < 0 ? undefined : redirect);
      const parsed = parseCommandArgs(findCommand(capabilities, definition.id), args);
      if (parsed.values.lens) assert.ok(VIEW_LENSES.includes(parsed.values.lens), `${example}: no lens ${parsed.values.lens}`);
      if (parsed.values.story) assert.ok(stories.has(parsed.values.story), `${example}: no story ${parsed.values.story}`);
      checked++;
    }
  }
  assert.ok(checked > 30, `${checked} examples`);
});

test("the command catalog speaks only of what exists", () => {
  for (const definition of capabilities.commands) {
    const texts = [definition.purpose, ...definition.rules, ...definition.examples,
      ...Object.values(definition.options).map(({ description }) => description)];
    for (const text of texts) assertCurrent(text, `bca ${definition.id}`);
  }
  for (const { summary } of [...capabilities.areas, ...capabilities.exports]) assertCurrent(summary, "the catalog");
  assertCurrent(capabilities.transport.rule, "the transport rule");
});

test("the MCP tools speak only of what exists, and of each other by name", async () => {
  const server = JSON.parse(readFileSync(path.join(root, ".mcp.json"), "utf8")).mcpServers["bc-atlas"];
  const client = new Client({ name: "bc-atlas-contract", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: server.command, args: server.args, cwd: root, stderr: "pipe" }));
  try {
    const { tools } = await client.listTools();
    const names = new Set(tools.map(({ name }) => name));
    for (const tool of tools) {
      const texts = [tool.description ?? "", ...Object.values(tool.inputSchema?.properties ?? {}).map(({ description }) => description ?? "")];
      for (const text of texts) {
        assertCurrent(text, tool.name);
        for (const [mentioned] of text.matchAll(/bc_atlas_\w+/gu)) assert.ok(names.has(mentioned), `${tool.name} names ${mentioned}, which is not a tool`);
      }
    }
    // The lenses the view tool offers are the lenses of the view.
    const lens = tools.find(({ name }) => name === "bc_atlas_view").inputSchema.properties.lens.description;
    for (const id of VIEW_LENSES) assert.ok(lens.includes(id), `bc_atlas_view does not offer the lens ${id}`);
  } finally {
    await client.close();
  }
});
