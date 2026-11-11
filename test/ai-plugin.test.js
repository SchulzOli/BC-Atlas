// The built-in AI plugin (plugins/ai): narrative documentation written by a
// language model from the facts BC Atlas reads from the source. The model is
// a stand-in here: a local server that speaks the OpenAI-compatible API.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { groundingOf, resolveSettings, subjectsOf, writeWithModel } from "../plugins/ai/src/index.js";
import { Workspace } from "../src/app/workspace.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "src", "cli.js");
const purchasing = path.join(root, "examples", "purchasing-app");

/** A model endpoint that records what it is asked and answers with a page about it. */
async function standIn(answer = (body) => ({ status: 200, json: { model: body.model, choices: [{ message: { role: "assistant", content: `# Written about ${body.messages[1].content.split("\n")[0].slice(2)}\n\nA narrative.` } }], usage: { total_tokens: 7 } } })) {
  const requests = [];
  const server = http.createServer((request, response) => {
    let text = "";
    request.on("data", (chunk) => { text += chunk; });
    request.on("end", () => {
      const body = text ? JSON.parse(text) : {};
      requests.push({ url: request.url, authorization: request.headers.authorization, body });
      const { status, json, raw } = answer(body, request);
      response.writeHead(status, { "content-type": raw === undefined ? "application/json" : "text/html" });
      response.end(raw ?? JSON.stringify(json));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { requests, endpoint: `http://127.0.0.1:${server.address().port}/v1`, close: () => new Promise((resolve) => server.close(resolve)) };
}

/** Runs bca without blocking the event loop, so the stand-in in this process can answer. */
const bca = (args, { cwd, env = {} } = {}) => new Promise((resolve) => {
  const child = spawn(process.execPath, [cli, ...args], { cwd, env: { ...process.env, BCA_AL_COMPILER: "off", BCA_AI_ENDPOINT: "", BCA_AI_MODEL: "", BCA_AI_API_KEY: "", ...env } });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("close", (status) => resolve({ status, stdout, stderr }));
});

test("the grounding is the facts of a subject, and the same every time", async () => {
  const atlas = await new Workspace(purchasing, {}, { live: false }).atlas();
  const subjects = subjectsOf(atlas);
  assert.deepEqual(subjects.map(({ id, file }) => [id, file]), [["system", "system"], ["process:use-case-purchase-requests", "process-use-case-purchase-requests"], ["process:use-case-purchase-setup", "process-use-case-purchase-setup"]]);
  const process_ = groundingOf(atlas, subjects[1]);
  assert.match(process_, /^# Facts about the process Purchase requests\n\nStatus: blocked\. Handovers between roles: 2\.\n/u);
  // Who, what it proves, what each step needs, what really ran, and what is wrong with the fix.
  assert.match(process_, /## Process test: Approve a released purchase request\n[\s\S]*?Who:\n(?:- .+\n)*- Ben \(Team lead\): is assigned but blocked\n/u);
  assert.match(process_, /Proves:\n- REQ-2: A team lead approves every request \(Gap: permissions\)/u);
  assert.match(process_, /- step 3: Choose the Approve action\. Needs: execute on codeunit 50220 Purchase Request Mgt\. \(called by page 50210 Purchase Requests \(action Approve\)\)/u);
  assert.match(process_, /What really ran in Business Central \(recording "Approve a released purchase request", in sync\):\n- .+\n- Choose Approve: Action: Action Approve on Page 50210 "Purchase Requests" called Approve\./u);
  assert.match(process_, /No recording of Business Central grounds this test: what is said about it comes from the source alone\./u);
  assert.match(process_, /## Findings\n\n- error `forbidden-task-possible`: Dana \(Administrator\) can complete .+\n- error `task-blocked`: Ben \(Team lead\) cannot complete .+ Fix: Add to a permission set of the agent: `codeunit "Request Notifications" = X`/u);
  const system = groundingOf(atlas, subjects[0]);
  assert.match(system, /^# Facts about the system BC Atlas Purchasing Example\n\n16 objects in 1 app\(s\), \d+ relations between them\./u);
  assert.match(system, /## Processes\n\n- Purchase requests \(blocked\)\n- Purchase setup \(runs\)/u);
  assert.equal(groundingOf(await new Workspace(purchasing, {}, { live: false }).atlas(), subjects[1]), process_);
  assert.doesNotMatch(process_ + system, /\bbegin\b|\bend;|procedure \w+\(/u, "no source code");
});

test("the settings come from .bca.json and the environment, and the key only from the environment", () => {
  const settings = resolveSettings({ endpoint: "https://gateway.example/v1/", model: "model-a", language: "de", outputDir: "docs/told" }, { BCA_AI_API_KEY: "secret" });
  assert.deepEqual([settings.endpoint, settings.model, settings.apiKey, settings.language, settings.outputDir, settings.temperature, settings.problems], ["https://gateway.example/v1", "model-a", "secret", "de", "docs/told", 0.2, []]);
  const over = resolveSettings({ endpoint: "https://a.example/v1", model: "a", apiKeyEnv: "MY_KEY" }, { BCA_AI_ENDPOINT: "http://localhost:4000/v1/chat/completions", BCA_AI_MODEL: "b", MY_KEY: "k", BCA_AI_API_KEY: "other" });
  assert.deepEqual([over.endpoint, over.model, over.apiKey, over.keyVariable], ["http://localhost:4000/v1", "b", "k", "MY_KEY"]);
  const wrong = resolveSettings({ endpoint: "gateway", apiKey: "sk-in-a-file", temperature: 9, provider: "x" }, {});
  assert.equal(wrong.apiKey, undefined, "a key in the file is not used");
  assert.deepEqual(wrong.problems.map((problem) => problem.split(/[: ]/u)[0]), ["ai.apiKey", "ai.endpoint", "ai.temperature", "ai.provider"]);
});

test("bca ai writes a page per subject through one endpoint, and again only when the facts change", async () => {
  const model = await standIn();
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-ai-"));
  try {
    cpSync(purchasing, directory, { recursive: true });
    const config = JSON.parse(readFileSync(path.join(directory, ".bca.json"), "utf8"));
    writeFileSync(path.join(directory, ".bca.json"), JSON.stringify({ ...config, ai: { endpoint: model.endpoint, model: "any-model" } }, null, 2));
    const env = { BCA_AI_API_KEY: "secret-key" };
    const run = (...args) => bca(["ai", ...args], { cwd: directory, env });

    const status = JSON.parse((await run("status", "--format", "json")).stdout);
    assert.deepEqual([status.ready, status.endpoint, status.model, status.key, status.subjects.length], [true, model.endpoint, "any-model", "set (BCA_AI_API_KEY)", 3]);
    assert.doesNotMatch(JSON.stringify(status), /secret-key/u, "the key is never shown");

    // Nothing is sent before it is asked for.
    const planned = JSON.parse((await run("write", "--dry-run", "--format", "json")).stdout);
    assert.deepEqual(planned.pages.map(({ status: state }) => state), ["would write", "would write", "would write"]);
    assert.equal(model.requests.length, 0);
    assert.ok(!existsSync(path.join(directory, "docs", "narrative")));

    const first = await run("write");
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /written {5}docs\/narrative\/system\.md {2}\(system\)\n[\s\S]*3 page\(s\) written with any-model, 0 unchanged/u);
    assert.equal(model.requests.length, 3);
    const [request] = model.requests;
    assert.deepEqual([request.url, request.authorization, request.body.model, request.body.messages.map(({ role }) => role)], ["/v1/chat/completions", "Bearer secret-key", "any-model", ["system", "user"]]);
    assert.match(request.body.messages[0].content, /Write only from these facts\..*Write in the language with the tag "en"\./u);
    assert.match(request.body.messages[1].content, /^# Facts about the system BC Atlas Purchasing Example\n/u);
    assert.doesNotMatch(JSON.stringify(model.requests), /\bbegin\b|end;/u, "what is sent is the grounding, not the source");
    const page = readFileSync(path.join(directory, "docs", "narrative", "process-use-case-purchase-requests.md"), "utf8");
    assert.match(page, /^<!-- bc-atlas-ai grounding:[0-9a-f]{64} model:any-model -->\n# Written about Facts about the process Purchase requests\n\nA narrative\.\n\n---\n\n_Written by a language model \(any-model\) from facts BC Atlas read from the source\. The facts are in \[grounding\/process-use-case-purchase-requests\.md\]\(grounding\/process-use-case-purchase-requests\.md\); check what matters against them\._\n$/u);
    assert.match(readFileSync(path.join(directory, "docs", "narrative", "grounding", "process-use-case-purchase-requests.md"), "utf8"), /^# Facts about the process Purchase requests\n/u);

    // The facts did not change: no model is called.
    const second = JSON.parse((await run("write", "--format", "json")).stdout);
    assert.deepEqual([second.written, second.pages.map(({ status: state }) => state)], [0, ["unchanged", "unchanged", "unchanged"]]);
    assert.equal(model.requests.length, 3);
    // The simulation changes: only the page whose facts changed is written again.
    const defined = await bca(["simulate", "define", ".", "--remove", "agent:Dana"], { cwd: directory, env });
    assert.equal(defined.status, 0, defined.stderr);
    const third = JSON.parse((await run("write", "--format", "json")).stdout);
    assert.deepEqual(third.pages.filter(({ status: state }) => state === "written").map(({ id }) => id).sort(), ["process:use-case-purchase-requests", "process:use-case-purchase-setup", "system"].filter((id) => third.pages.find((item) => item.id === id).status === "written").sort());
    assert.ok(third.pages.find(({ id }) => id === "process:use-case-purchase-requests").status === "written", "Dana was in its findings");
    assert.ok(third.written < 3 || model.requests.length === 6);
    // One subject, forced; another model writes every page again.
    const before = model.requests.length;
    assert.equal(JSON.parse((await run("write", "--subject", "system", "--force", "--format", "json")).stdout).written, 1);
    assert.equal(model.requests.length, before + 1);
    const other = JSON.parse((await bca(["ai", "write", "--format", "json"], { cwd: directory, env: { ...env, BCA_AI_MODEL: "other-model" } })).stdout);
    assert.deepEqual([other.written, other.model], [3, "other-model"]);

    // The task of bca run: the same pages, as outputs of the run.
    const task = JSON.parse((await bca(["run", ".", "--tasks", "ai", "--format", "json"], { cwd: directory, env })).stdout);
    assert.deepEqual([task.passed, task.results[0].task, task.outputs], [true, "ai", ["docs/narrative"]]);

    const unknown = await run("write", "--subject", "process:nope");
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /there is no subject "process:nope"; the subjects are: system, process:use-case-purchase-requests, process:use-case-purchase-setup/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    await model.close();
  }
});

test("without an endpoint the plugin only prepares the facts, and says what is missing", async () => {
  const status = await bca(["ai", "status"], { cwd: purchasing });
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /^Not ready to write:\n {2}missing: an endpoint: set ai\.endpoint in \.bca\.json or BCA_AI_ENDPOINT .+\n {2}missing: a model: set ai\.model in \.bca\.json or BCA_AI_MODEL/u);
  const context = await bca(["ai", "context", "--subject", "process:use-case-purchase-setup"], { cwd: purchasing });
  assert.match(context.stdout, /^# Facts about the process Purchase setup\n/u);
  const write = await bca(["ai", "write"], { cwd: purchasing });
  assert.notEqual(write.status, 0);
  assert.match(write.stderr, /the AI plugin needs an endpoint: set ai\.endpoint .+; and a model: set ai\.model/u);
  assert.ok(!existsSync(path.join(purchasing, "docs", "narrative")));
});

test("what the endpoint answers wrong is said plainly", async () => {
  const settings = (endpoint) => resolveSettings({ endpoint, model: "m", timeout: 5 }, { BCA_AI_API_KEY: "k" });
  const refused = await standIn(() => ({ status: 401, json: { error: { message: "Incorrect API key provided" } } }));
  const page = await standIn(() => ({ status: 200, raw: "<html>not an api</html>" }));
  const empty = await standIn(() => ({ status: 200, json: { choices: [] } }));
  try {
    await assert.rejects(writeWithModel(settings(refused.endpoint), "facts"), /the model endpoint answered 401 \(is the key in BCA_AI_API_KEY right\?\): Incorrect API key provided/u);
    await assert.rejects(writeWithModel(settings(page.endpoint), "facts"), /did not answer with JSON; is ai\.endpoint the base URL of an OpenAI-compatible API/u);
    await assert.rejects(writeWithModel(settings(empty.endpoint), "facts"), /answered without text/u);
    await assert.rejects(writeWithModel(settings("http://127.0.0.1:9/v1"), "facts"), /the model endpoint http:\/\/127\.0\.0\.1:9\/v1 could not be reached/u);
    await assert.rejects(writeWithModel(resolveSettings({}, {}), "facts"), /the AI plugin needs an endpoint/u);
  } finally {
    await Promise.all([refused.close(), page.close(), empty.close()]);
  }
});
