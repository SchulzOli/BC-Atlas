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
import MarkdownDocumentationReporter from "../src/docs/reporter.js";
import { loadScenario, validateScenario } from "../src/docs/scenario.js";
import { generationPrompt, healingPrompt } from "../src/docs/prompts.js";

const CONTRACT = `id: create-widget
title: Create a widget
description: Create a widget with a code and name.
goal: Create one widget.
start:
  url: https://bc.example/
prerequisites:
  - A test company is selected.
expected:
  - The widget is visible in the list.
constraints:
  - Do not post documents.
`;

test("validates and loads documentation scenarios", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "ald2tree-docs-"));
  const filename = path.join(directory, "create-widget.yml");
  try {
    writeFileSync(filename, CONTRACT);
    const scenario = await loadScenario(filename);
    assert.equal(scenario.value.id, "create-widget");
    assert.deepEqual(scenario.value.expected, ["The widget is visible in the list."]);
    assert.throws(
      () => validateScenario({ id: "Bad ID", title: "Bad", goal: "Bad", expected: ["x"] }),
      /kebab-case/u
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("generation and healing prompts preserve the scenario contract", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "ald2tree-docs-"));
  const filename = path.join(directory, "create-widget.yml");
  try {
    writeFileSync(filename, CONTRACT);
    const scenario = await loadScenario(filename);
    const options = {
      scenario,
      testPath: path.join(directory, "create-widget.spec.js"),
      bcUrl: "https://bc.example/"
    };
    const generated = generationPrompt(options);
    const healed = healingPrompt(options);
    assert.match(generated, /Prove every expected outcome/u);
    assert.match(generated, /The widget is visible in the list/u);
    assert.match(healed, /Do not delete assertions/u);
    assert.match(healed, /semantic product change/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Markdown reporter publishes passing documented tests", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "ald2tree-docs-"));
  const scenarioFile = path.join(directory, "create-widget.yml");
  const output = path.join(directory, "output");
  try {
    writeFileSync(scenarioFile, CONTRACT);
    const reporter = new MarkdownDocumentationReporter({ outputDir: output });
    reporter.onTestEnd({
      title: "Create a widget",
      annotations: [{ type: "scenario", description: scenarioFile }]
    }, {
      status: "passed",
      steps: [{
        category: "test.step",
        title: "Open Widgets",
        steps: []
      }, {
        category: "test.step",
        title: "Create the widget",
        steps: []
      }, {
        category: "test.step",
        title: "Verify: The widget is visible in the list.",
        steps: []
      }],
      attachments: [{
        name: "result",
        contentType: "image/png",
        body: Buffer.from("png")
      }]
    });

    const markdownFile = path.join(output, "create-widget.md");
    assert.ok(existsSync(markdownFile));
    const markdown = readFileSync(markdownFile, "utf8");
    assert.match(markdown, /1\. Open Widgets/u);
    assert.match(markdown, /2\. Create the widget/u);
    assert.match(markdown, /The widget is visible in the list/u);
    assert.ok(existsSync(path.join(output, "images", "create-widget-result.png")));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("docs generate dry-run emits an agent prompt without opening a browser", () => {
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const scenario = fileURLToPath(new URL("../scenarios/create-edi-partner.yml", import.meta.url));
  const result = spawnSync(process.execPath, [
    cli,
    "docs",
    "generate",
    scenario,
    "--dry-run"
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Playwright test generator/u);
  assert.match(result.stdout, /create-edi-partner\.spec\.js/u);
  assert.match(result.stdout, /Do not configure message profiles/u);
});

test("docs run executes Playwright and publishes Markdown", () => {
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const directory = mkdtempSync(path.join(process.cwd(), ".ald2tree-docs-test-"));
  const scenario = path.join(directory, "create-widget.yml");
  const executableTest = path.join(directory, "create-widget.spec.js");
  const output = path.join(directory, "output");
  try {
    writeFileSync(scenario, CONTRACT);
    writeFileSync(executableTest, `import { test } from "@playwright/test";
test("Create a widget", {
  annotation: { type: "scenario", description: ${JSON.stringify(scenario)} }
}, async ({}, testInfo) => {
  await test.step("Open Widgets", async () => {});
  await test.step("Create the widget", async () => {});
  await test.step("Verify: The widget is visible in the list.", async () => {});
  await testInfo.attach("result", {
    body: Buffer.from("png"),
    contentType: "image/png"
  });
});
`);
    const result = spawnSync(process.execPath, [
      cli,
      "docs",
      "run",
      scenario,
      "--test",
      executableTest
    ], {
      encoding: "utf8",
      env: {
        ...process.env,
        BC_DOCS_OUTPUT: output,
        BC_DOCS_RESULTS: path.join(directory, "results")
      },
      timeout: 30_000
    });

    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(path.join(output, "create-widget.md")));
    assert.ok(existsSync(path.join(output, "images", "create-widget-result.png")));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
