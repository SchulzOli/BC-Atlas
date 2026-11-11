// Snapshots and the simulation, both ways.
//
// In: a recording of Business Central (a fact snapshot, as the sync plugin
// reads them) is something the agents of the company perform, like a process
// test. What really ran says what it takes: Execute on every page, codeunit,
// and report on the call stacks, and the table right of every read and write.
// A recording with the title of a process test (or named by
// simulation.grounding) adds what really ran to that test; any other
// recording is a process of its own.
//
// Out: the simulation of a process test from the source is written as a fact
// snapshot of the same schema: its steps as phases, what each step needs as
// technical steps. Whatever reads recordings reads these, and it is marked as
// what it is: read from the source, not recorded.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { normalizeIdentifier } from "../resolver.js";
import { EXECUTABLE, inherentlyExecutable, inherentTableRights } from "./access.js";

export const SNAPSHOT_SCHEMA = "bc-atlas-sync.fact-snapshot/1";
const slug = (text) => String(text).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "process";
const plain = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
/** What a method of a record does to its table. */
const TABLE_RIGHTS = { insert: "insert", modify: "modify", modifyall: "modify", delete: "delete", deleteall: "delete", rename: "modify", get: "read", find: "read", findset: "read", findfirst: "read", findlast: "read", isempty: "read", count: "read", calcfields: "read", calcsums: "read", next: "read" };

/**
 * The recordings of a folder: every fact snapshot in a JSON file.
 * @returns [{ key, file, name, feature, fingerprint, phases: [{ phase, title }], steps: [{ step, phase, kind, description, callStack }] }]
 */
export async function readRecordings(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") throw new Error(`simulation: the folder of recordings ${directory} does not exist`);
    throw error;
  });
  const recordings = [];
  for (const entry of entries.filter((item) => item.isFile() && /\.json$/iu.test(item.name)).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, entry.name);
    let data;
    try {
      data = JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      continue;
    }
    // Other JSON files of the folder (an index, a state file) are not recordings; nor is what the simulation wrote itself.
    if (data?.schema !== SNAPSHOT_SCHEMA || !data.snapshot?.processName || data.origin === "simulation") continue;
    recordings.push({
      key: slug(data.snapshot.processName),
      file,
      name: String(data.snapshot.processName),
      feature: data.snapshot.feature ? String(data.snapshot.feature) : undefined,
      fingerprint: data.snapshot.fingerprint,
      phases: (data.phases ?? []).map(({ phase, title }) => ({ phase, title: String(title ?? `Phase ${phase}`) })),
      steps: data.technicalSteps ?? []
    });
  }
  return recordings;
}

/** The recording a name stands for: its key, or its title. */
export const findRecording = (recordings, name) => recordings.find((recording) => recording.key === slug(name) || plain(recording.name) === plain(name));

/**
 * What a recording takes, phase by phase, as steps of the simulation.
 * @param model the resolved project
 * @returns [{ kind: "recorded", text, needs, notes }] one per phase that ran something
 */
export function recordedSteps(recording, model) {
  const byNumber = new Map();
  const byName = new Map();
  for (const object of model.objects) {
    if (object.id !== undefined && object.id !== "") byNumber.set(`${object.type}\u0000${object.id}`, object);
    byName.set(`${object.type}\u0000${normalizeIdentifier(object.name)}`, object);
  }
  const lookup = (frame) => {
    const type = String(frame.objectType ?? "").toLowerCase().replace(/\s+/gu, "");
    return byNumber.get(`${type}\u0000${frame.objectId}`) ?? byName.get(`${type}\u0000${normalizeIdentifier(frame.objectName ?? "")}`);
  };
  const phases = recording.phases.length ? recording.phases : [{ phase: undefined, title: recording.name }];
  return phases.map(({ phase, title }) => {
    const needs = new Map();
    const notes = new Map();
    const need = (object, right, { ui = false, executors, step }) => {
      const key = `${object.key}\u0000${right}`;
      const inherent = right === "execute" ? inherentlyExecutable(object) : inherentTableRights(object).includes(right);
      const current = needs.get(key);
      if (current) {
        current.ui ||= ui;
        current.inherent &&= inherent;
        current.executors.push(executors);
      } else {
        needs.set(key, { object, right, ui, reason: { code: "recorded", recording: recording.name, step: step.description ?? step.kind }, inherent, executors: [executors] });
      }
    };
    for (const step of recording.steps.filter((item) => phase === undefined || item.phase === phase)) {
      const frames = step.callStack ?? [];
      const found = frames.map(lookup);
      frames.forEach((frame, index) => {
        const object = found[index];
        if (!object) {
          const text = `${frame.objectType ?? "object"} ${frame.objectId ?? ""} ${frame.objectName ?? ""}`.replace(/\s+/gu, " ").trim();
          notes.set(text, { code: "recorded-unknown", object: text });
          return;
        }
        // The code on the stack before this frame is what runs it.
        const executors = found.slice(0, index).filter((item) => item && EXECUTABLE.includes(item.type)).map((item) => item.key);
        if (EXECUTABLE.includes(object.type)) {
          // The first frame is what the user opened or chose; the rest is run by code.
          need(object, "execute", { ui: index === 0 && object.type === "page", executors, step });
        } else if (object.type === "table") {
          const last = index === frames.length - 1;
          const right = TABLE_RIGHTS[String(frame.method ?? "").toLowerCase()] ?? (last && /write/iu.test(step.kind ?? "") ? "modify" : last && /read/iu.test(step.kind ?? "") ? "read" : undefined);
          if (right) need(object, right, { executors, step });
        }
      });
    }
    return { kind: "recorded", text: title, needs: [...needs.values()], notes: [...notes.values()], undecided: false };
  }).filter(({ needs, notes }) => needs.length || notes.length);
}

const KINDS = { execute: "Code Execution", read: "Database Read", insert: "Database Write", modify: "Database Write", delete: "Database Write" };
const TYPE_NAMES = { page: "Page", codeunit: "Codeunit", table: "Table", report: "Report", xmlport: "XmlPort", query: "Query" };

/**
 * A process test of a simulation report as a fact snapshot: what the source says each step needs.
 * @param task a task of the report (see simulate)
 * @param report the report it is from, for who performs it
 */
export function snapshotOf(task, report) {
  const phases = task.steps.map((step) => ({ phase: step.index, title: step.text }));
  const technicalSteps = [];
  for (const step of task.steps) {
    for (const need of step.needs) {
      technicalSteps.push({
        step: technicalSteps.length + 1,
        phase: step.index,
        kind: need.right === "execute" && need.type === "page" ? "Page Open" : KINDS[need.right] ?? "Code Execution",
        description: `${need.right[0].toUpperCase()}${need.right.slice(1)} on ${need.object}${need.because ? `: ${need.because}` : ""}`,
        callStack: [{ objectType: TYPE_NAMES[need.type] ?? need.type, objectId: /^\d+$/u.test(String(need.id)) ? Number(need.id) : need.id, objectName: need.name }]
      });
    }
  }
  const performers = (report.agents ?? []).flatMap((agent) => (agent.attempts ?? []).filter((attempt) => attempt.task === task.id)
    .map((attempt) => ({ agent: agent.name, roles: agent.roles, expected: attempt.expected, outcome: attempt.outcome, ...(attempt.blockedAt ? { blockedAt: attempt.blockedAt } : {}) })));
  const fingerprint = createHash("sha256").update(JSON.stringify([task.title, phases, technicalSteps])).digest("hex").slice(0, 12);
  return {
    schema: SNAPSHOT_SCHEMA,
    origin: "simulation",
    _note: "Written by bca simulate from the AL source: what each step of the process test needs. Read from the code, not recorded in Business Central.",
    snapshot: { no: 1, processName: task.title, ...(task.features?.[0] ? { feature: task.features[0] } : {}), fingerprint: `source-${fingerprint}` },
    source: task.source,
    phases,
    technicalSteps,
    simulation: { company: report.company?.name, performers }
  };
}

/**
 * Writes one snapshot per process test of a report into a folder, and removes the ones of tests that are gone.
 * @returns the files written, relative to the folder
 */
export async function writeSnapshots(report, directory) {
  await fs.mkdir(directory, { recursive: true });
  const wanted = new Map(report.tasks.filter((task) => !task.recorded).map((task) => [`${slug(task.id)}.json`, `${JSON.stringify(snapshotOf(task, report), null, 2)}\n`]));
  for (const entry of await fs.readdir(directory)) {
    if (!entry.endsWith(".json") || wanted.has(entry)) continue;
    const text = await fs.readFile(path.join(directory, entry), "utf8").catch(() => "");
    // Only what this command wrote before.
    if (text.includes('"origin": "simulation"')) await fs.rm(path.join(directory, entry));
  }
  for (const [file, content] of wanted) {
    const target = path.join(directory, file);
    if ((await fs.readFile(target, "utf8").catch(() => undefined)) !== content) await fs.writeFile(target, content);
  }
  return [...wanted.keys()].sort();
}
