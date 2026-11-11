// Snapshots and the simulation, both ways (src/simulation/snapshots.js), and
// `bca bundle`: everything BC Atlas makes of a project as one artifact.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

import { taskOutputs } from "../src/automation/config.js";
import { createCapabilities, findCommand } from "../src/capabilities.js";
import { BUNDLE_SCHEMA, createBundle, testCounts } from "../src/commands/bundle.js";
import { simulate } from "../src/simulation/index.js";
import { readRecordings, SNAPSHOT_SCHEMA, snapshotOf, writeSnapshots } from "../src/simulation/snapshots.js";
import { zipArchive } from "../src/zip.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "src", "cli.js");
const purchasing = path.join(root, "examples", "purchasing-app");
const bca = (args, options = {}) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 240_000, env: { ...process.env, BCA_AL_COMPILER: "off", BCA_AI_ENDPOINT: "", BCA_AI_MODEL: "" }, ...options });
const copyOf = (example) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-bundle-"));
  cpSync(example, directory, { recursive: true });
  return directory;
};
/** The entries of a ZIP archive, read back from its central directory: [{ path, data }]. */
function unzip(archive) {
  const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = archive.readUInt16LE(end + 10);
  let at = archive.readUInt32LE(end + 16);
  const entries = [];
  for (let index = 0; index < count; index++) {
    assert.equal(archive.readUInt32LE(at), 0x02014b50);
    const method = archive.readUInt16LE(at + 10);
    const packed = archive.readUInt32LE(at + 20);
    const size = archive.readUInt32LE(at + 24);
    const nameLength = archive.readUInt16LE(at + 28);
    const local = archive.readUInt32LE(at + 42);
    const name = archive.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
    const stored = archive.subarray(start, start + packed);
    const data = method === 8 ? zlib.inflateRawSync(stored) : stored;
    assert.equal(data.length, size, name);
    assert.equal(zlib.crc32(data), archive.readUInt32LE(at + 16), name);
    entries.push({ path: name, data });
    at += 46 + nameLength;
  }
  return entries;
}

test("the simulation of a process test is written as a fact snapshot, from the source", async () => {
  const report = await simulate(purchasing, { compiler: "off" });
  const approve = report.tasks.find(({ id }) => id === "purchase-request-approve");
  const snapshot = snapshotOf(approve, report);
  assert.deepEqual([snapshot.schema, snapshot.origin, snapshot.snapshot.processName, snapshot.snapshot.feature], [SNAPSHOT_SCHEMA, "simulation", "Approve a released purchase request", "purchase-requests"]);
  assert.match(snapshot.snapshot.fingerprint, /^source-[0-9a-f]{12}$/u);
  // Its steps are the phases; what each step needs are the technical steps, each on the object it is about.
  assert.deepEqual(snapshot.phases.map(({ phase }) => phase), approve.steps.map(({ index }) => index));
  assert.equal(snapshot.technicalSteps.length, approve.steps.reduce((sum, step) => sum + step.needs.length, 0));
  const insert = snapshot.technicalSteps.find(({ description }) => description.startsWith("Insert on table 50202 Request Approval Entry"));
  assert.deepEqual([insert.kind, insert.phase, insert.callStack], ["Database Write", 3, [{ objectType: "Table", objectId: 50202, objectName: "Request Approval Entry" }]]);
  assert.equal(snapshot.technicalSteps.find(({ description }) => description.startsWith("Execute on page 50210")).kind, "Page Open");
  // Who performs it, and how far they get.
  assert.deepEqual(snapshot.simulation.performers.find(({ agent }) => agent === "Ben"), { agent: "Ben", roles: ["Team lead"], expected: "complete", outcome: "blocked", blockedAt: 3 });
  assert.deepEqual(snapshotOf(approve, report), snapshot, "the same source gives the same snapshot");

  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-snapshots-"));
  try {
    writeFileSync(path.join(directory, "old-test.json"), JSON.stringify({ schema: SNAPSHOT_SCHEMA, origin: "simulation" }, null, 2));
    writeFileSync(path.join(directory, "recorded.json"), JSON.stringify({ schema: SNAPSHOT_SCHEMA, snapshot: { processName: "Recorded" } }, null, 2));
    const written = await writeSnapshots(report, directory);
    assert.deepEqual(written, ["purchase-request-approve.json", "purchase-request-create.json", "purchase-request-order.json", "purchase-request-release.json", "purchase-request-setup.json"]);
    assert.deepEqual(readdirSync(directory).sort(), [...written, "recorded.json"].sort(), "a snapshot of a test that is gone goes; a recording stays");
    // What the simulation wrote is not a recording to perform.
    assert.deepEqual((await readRecordings(directory)).map(({ name }) => name), ["Recorded"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("recordings of Business Central are performed like process tests", async () => {
  const directory = copyOf(purchasing);
  try {
    const recordings = path.join(directory, "recordings");
    // A process that was recorded but has no test: the approval, under another name.
    const recorded = JSON.parse(readFileSync(path.join(recordings, "approve-a-released-purchase-request.json"), "utf8"));
    writeFileSync(path.join(recordings, "reject-a-purchase-request.json"), JSON.stringify({ ...recorded, snapshot: { ...recorded.snapshot, processName: "Reject a purchase request", fingerprint: "pr-reject-1" } }, null, 2));
    const before = await simulate(directory, { compiler: "off" });
    const report = await simulate(directory, { compiler: "off", recordings });
    assert.equal(report.tasks.length, before.tasks.length + 1);

    // It is a process of its own, in the use case of its feature, and what really ran says what it takes.
    const reject = report.tasks.find(({ id }) => id === "recorded-reject-a-purchase-request");
    assert.deepEqual([reject.title, reject.recorded, reject.features, reject.source.file], ["Reject a purchase request", true, ["purchase-requests"], "recordings/reject-a-purchase-request.json"]);
    assert.deepEqual(reject.steps.map(({ text }) => text), ["Open the released request on the Purchase Requests page", "Choose Approve"]);
    assert.deepEqual(reject.steps[1].needs.map(({ letter, object }) => `${letter} ${object}`), ["X page 50210 Purchase Requests", "X codeunit 50220 Purchase Request Mgt.", "R table 50201 Purchase Request Setup", "M table 50200 Purchase Request", "I table 50202 Request Approval Entry", "X codeunit 50222 Request Notifications"]);
    assert.match(reject.steps[1].needs[1].because, /^it ran in Business Central \(recording "Reject a purchase request": /u);
    assert.ok(report.processes.find(({ title }) => title === "Purchase requests").steps.some(({ task, status }) => task === reject.id && status === "unstaffed"));
    assert.ok(report.findings.some(({ code, message }) => code === "task-unstaffed" && message.includes("Reject a purchase request")));
    // Assigned to a role, the agent of that role is checked against what ran: the team lead lacks the subscriber's codeunit here too.
    const config = JSON.parse(readFileSync(path.join(directory, ".bca.json"), "utf8"));
    config.simulation.recordings = "recordings";
    config.simulation.roles.find(({ name }) => name === "Team lead").tasks = [reject.id];
    writeFileSync(path.join(directory, ".bca.json"), JSON.stringify(config, null, 2));
    const assigned = await simulate(directory, { compiler: "off" });
    const blocked = assigned.findings.find(({ code, task }) => code === "task-blocked" && task === "Reject a purchase request");
    assert.match(blocked.message, /Ben \(Team lead\) cannot complete "Reject a purchase request": step 2 \(Choose Approve\) needs Execute on codeunit 50222 Request Notifications/u);

    // A recording with the title of a process test is what that test really ran: its phases follow the steps of the test.
    const create = report.tasks.find(({ id }) => id === "purchase-request-create");
    assert.equal(create.recording, "Create a new Purchase Request");
    assert.equal(create.steps.length, before.tasks.find(({ id }) => id === "purchase-request-create").steps.length + 2);
    assert.equal(create.steps.at(-1).text, "In Business Central this ran: Enter the number, the description, and the amount.");
    assert.deepEqual(report.summary.assigned, before.summary.assigned, "the test and the recording agree: nobody is blocked by what really ran");

    // What ran outside the analyzed source is said, not guessed.
    const foreign = { ...recorded, snapshot: { ...recorded.snapshot, processName: "Post something", fingerprint: "x" }, technicalSteps: [{ step: 1, phase: 1, kind: "Code Execution", description: "Posting", callStack: [{ objectType: "Codeunit", objectId: 80, objectName: "Sales-Post" }] }] };
    writeFileSync(path.join(recordings, "post-something.json"), JSON.stringify(foreign, null, 2));
    const unknown = (await simulate(directory, { compiler: "off" })).tasks.find(({ id }) => id === "recorded-post-something");
    assert.deepEqual(unknown.steps[0].notes, ["Codeunit 80 Sales-Post ran in Business Central but is not part of the analyzed source."]);
    await assert.rejects(simulate(directory, { compiler: "off", recordings: path.join(directory, "nowhere") }), /the folder of recordings .+nowhere does not exist/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("bca simulate writes snapshots, and the simulate task of bca run with simulation.snapshotDir", () => {
  const command = findCommand(createCapabilities("0.0.0"), "simulate");
  assert.ok(command.options.recordings && command.options.snapshots);
  assert.deepEqual(taskOutputs("simulate", { simulation: { snapshotDir: "docs/snapshots" } }), ["docs/simulation", "docs/snapshots"]);
  const directory = copyOf(purchasing);
  try {
    const run = bca(["simulate", ".", "--snapshots", "out/snapshots", "--recordings", "recordings"], { cwd: directory });
    assert.equal(run.status, 1, "the example fails by design");
    assert.match(run.stderr, /Wrote 5 snapshot\(s\) to out\/snapshots/u);
    assert.equal(JSON.parse(readFileSync(path.join(directory, "out", "snapshots", "purchase-request-create.json"), "utf8")).origin, "simulation");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a ZIP archive holds what it was given", () => {
  const files = [{ path: "a/über.md", data: Buffer.from("# Über\n".repeat(200)) }, { path: "b.bin", data: Buffer.from([0, 1, 2, 3]) }, { path: "empty.txt", data: Buffer.alloc(0) }];
  const read = unzip(zipArchive(files, new Date(2026, 0, 2, 3, 4, 6)));
  assert.deepEqual(read.map(({ path: name }) => name), files.map(({ path: name }) => name));
  for (const [index, { data }] of read.entries()) assert.ok(data.equals(files[index].data));
});

test("test results are counted, whatever wrote them", () => {
  assert.deepEqual(testCounts('<testsuites><testsuite name="a" tests="4" failures="1" errors="1" skipped="0"/><testsuite tests="2" failures="0" errors="0" skipped="1"/></testsuites>'), { tests: 6, failed: 2, skipped: 1 });
  assert.deepEqual(testCounts('<assemblies><assembly name="x" total="5" passed="4" failed="1" skipped="0"></assembly></assemblies>'), { tests: 5, failed: 1, skipped: 0 });
  assert.equal(testCounts("<html></html>"), undefined);
});

test("bca bundle makes one artifact of the whole: validation, simulation, snapshots, documentation, tests, build", async () => {
  const directory = copyOf(purchasing);
  try {
    mkdirSync(path.join(directory, "output"));
    writeFileSync(path.join(directory, "output", "Purchasing.app"), "not a real app");
    writeFileSync(path.join(directory, "TestResults.xml"), '<testsuites><testsuite name="UI" tests="5" failures="0" errors="0" skipped="0"/></testsuites>');
    const { output, zip, passed, manifest } = await createBundle(directory, { compiler: "off", output: path.join(directory, "out", "bundle"), testResults: [path.join(directory, "TestResults.xml")], include: [path.join(directory, "output")], noNarrative: true }, { now: new Date("2026-11-11T12:00:00Z") });
    assert.equal(manifest.schema, BUNDLE_SCHEMA);
    assert.deepEqual(manifest.steps.map(({ id, status }) => `${id}:${status}`), ["check:passed", "simulate:failed", "snapshots:passed", "docs:passed", "narrative:skipped", "tests:passed", "build:passed"]);
    assert.equal(passed, false, "the simulation of the example fails, so the bundle says so");
    assert.equal(manifest.steps.find(({ id }) => id === "tests").summary, "5 test(s), 0 failed, 0 skipped, from 1 result file(s)");
    assert.deepEqual([manifest.title, manifest.createdAt, manifest.counts.objects], ["BC Atlas Purchasing Example", "2026-11-11T12:00:00.000Z", 16]);

    // Everything is there, and the manifest names every file with its hash.
    for (const file of ["README.md", "bundle.json", "check/README.md", "check/report.json", "simulation/README.md", "simulation/report.json", "snapshots/purchase-request-approve.json", "docs/README.md", "docs/view.html", "docs/atlas.json", "tests/TestResults.xml", "build/output/Purchasing.app"]) {
      assert.ok(existsSync(path.join(output, file)), file);
    }
    assert.ok(manifest.files.every(({ path: file, bytes, sha256 }) => readFileSync(path.join(output, file)).length === bytes && /^[0-9a-f]{64}$/u.test(sha256)));
    assert.ok(!manifest.files.some(({ path: file }) => file === "bundle.json"), "the manifest lists what it describes");
    const readme = readFileSync(path.join(output, "README.md"), "utf8");
    assert.match(readme, /^# BC Atlas Purchasing Example: bundle\n\nNot everything passed\. Made by BC Atlas \d+\.\d+\.\d+ on 2026-11-11/u);
    assert.match(readme, /\| Simulation \| ❌ failed \| FAILED - 6 completed, 1 blocked.+\| \[simulation\/README\.md\]\(simulation\/README\.md\) \|/u);
    assert.match(readme, /\| Narrative \| – skipped \| switched off \| {2}\|/u);

    // The ZIP file is the same, below one folder.
    const entries = unzip(readFileSync(zip));
    assert.equal(entries.length, manifest.files.length + 1);
    assert.ok(entries.every(({ path: file }) => file.startsWith("bundle/")));
    assert.ok(entries.find(({ path: file }) => file === "bundle/README.md").data.equals(readFileSync(path.join(output, "README.md"))));

    // A test that failed where it really ran fails the bundle; a run replaces what the folder held.
    writeFileSync(path.join(output, "stale.txt"), "old");
    writeFileSync(path.join(directory, "TestResults.xml"), '<testsuites><testsuite tests="5" failures="2" errors="0" skipped="0"/></testsuites>');
    const run = bca(["bundle", ".", "-o", "out/bundle", "--test-results", "TestResults.xml", "--no-zip", "--no-narrative", "--format", "json"], { cwd: directory });
    assert.equal(run.status, 1);
    const again = JSON.parse(run.stdout);
    assert.deepEqual([again.steps.find(({ id }) => id === "tests").status, again.steps.find(({ id }) => id === "build").status, again.zip], ["failed", "skipped", undefined]);
    assert.ok(!existsSync(path.join(output, "stale.txt")));
    assert.equal(bca(["bundle", ".", "-o", "."], { cwd: directory }).status, 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a project without process tests still gets its bundle", async () => {
  const directory = copyOf(path.join(root, "examples", "multi-app"));
  try {
    const { manifest, passed } = await createBundle(directory, { compiler: "off", output: path.join(directory, "bundle"), noZip: true, noNarrative: true });
    assert.deepEqual(manifest.steps.map(({ id, status }) => `${id}:${status}`), ["check:failed", "simulate:skipped", "docs:passed", "narrative:skipped", "tests:skipped", "build:skipped"]);
    assert.equal(passed, false, "the health check of this example has an error");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
