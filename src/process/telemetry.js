// Telemetry: what really happened, with its time. Business Central sends telemetry to Azure
// Application Insights (page views, traces of what ran, with the AL object and how long it took).
// BC Atlas reads it as an event log and lays it over the processes: how often a step is done, how
// long it takes, how long the work waits between two steps, which ways are really taken, and
// where it goes around again.
//
//   "processTelemetry": {
//     "path": "telemetry",                 a file or a folder of exports: JSON or CSV
//     "case": "requestNo",                 the field that says which case an event belongs to
//     "steps": { "purchase-request-approve": "PR0003" },   an event id or a text that marks a step
//     "appId": "…", "days": 30             or: ask Application Insights (the key in BCA_TELEMETRY_API_KEY)
//   }
//
// An event belongs to the step whose test touches its object. Where several steps touch the same
// object, the step the case is in keeps it, else the next one on the way: telemetry of the app
// as it is tells steps apart by what only they use. `processTelemetry.steps` names an event that marks
// a step for certain. Without a case field, a case is a session, and a wait between two people
// is not seen: say which field carries the document, and it is.
import fs from "node:fs/promises";
import path from "node:path";
import { processOrder } from "./index.js";

const lower = (value) => String(value ?? "").toLowerCase();
const TYPES = { page: "page", codeunit: "codeunit", report: "report", table: "table", xmlport: "xmlport", query: "query", pageview: "page" };

/** A row with its keys in lower case, and what is in customDimensions next to them. */
function flat(row) {
  const out = {};
  for (const [key, value] of Object.entries(row ?? {})) out[lower(key)] = value;
  let dimensions = out.customdimensions;
  if (typeof dimensions === "string") {
    try {
      dimensions = JSON.parse(dimensions);
    } catch {
      dimensions = undefined;
    }
  }
  if (dimensions && typeof dimensions === "object") for (const [key, value] of Object.entries(dimensions)) out[lower(key)] ??= value;
  return out;
}

/** "00:00:01.2500000" (as Business Central writes a time span), or a number of milliseconds. */
function milliseconds(value) {
  if (value === undefined || value === null || value === "") return 0;
  const span = /^(?:(\d+)\.)?(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/u.exec(String(value).trim());
  if (span) return ((Number(span[1] ?? 0) * 24 + Number(span[2])) * 60 + Number(span[3])) * 60000 + Number(span[4]) * 1000;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

/**
 * One row of telemetry as an event, or nothing when it has no time.
 * @returns { time, duration, case, user, type, id, name, event, text }
 */
export function telemetryEvent(row, { caseField } = {}) {
  const fields = flat(row);
  const time = Date.parse(fields.timestamp ?? fields.timegenerated ?? fields.time ?? "");
  if (!Number.isFinite(time)) return undefined;
  const type = TYPES[lower(fields.alobjecttype).replace(/\s+/gu, "")] ?? (lower(fields.itemtype) === "pageview" ? "page" : undefined);
  const session = fields.session_id ?? fields.sessionid ?? fields.operation_id;
  const user = fields.user_id ?? fields.user_authenticatedid ?? fields.userid;
  // A custom dimension of the app may arrive under its own name or with the prefix Business Central gives it ("al").
  const named = lower(caseField ?? "").replace(/^customdimensions\./u, "");
  const own = named ? fields[named] ?? fields[`al${named}`] ?? fields[named.replace(/^al/u, "")] : undefined;
  return {
    time,
    duration: milliseconds(fields.duration ?? fields.executiontimeinms ?? fields.serverexecutiontime ?? fields.totaltime),
    case: String((own ?? session ?? user ?? "all") || "all"),
    ...(user ? { user: String(user) } : {}),
    ...(type ? { type } : {}),
    ...(fields.alobjectid !== undefined && fields.alobjectid !== "" ? { id: String(fields.alobjectid) } : {}),
    ...(fields.alobjectname ?? (type === "page" ? fields.name : undefined) ? { name: String(fields.alobjectname ?? fields.name) } : {}),
    ...(fields.eventid ? { event: String(fields.eventid) } : {}),
    text: String(fields.message ?? fields.name ?? "")
  };
}

function csvRows(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === "\"" && text[index + 1] === "\"") {
        cell += "\"";
        index += 1;
      } else if (character === "\"") quoted = false;
      else cell += character;
    } else if (character === "\"") quoted = true;
    else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += character;
  }
  row.push(cell);
  if (row.some((value) => value !== "")) rows.push(row);
  const [header, ...body] = rows;
  return header ? body.map((values) => Object.fromEntries(header.map((name, index) => [name.trim(), values[index] ?? ""]))) : [];
}

/** The rows of an export: a query result of Application Insights, a list, JSON lines, or CSV. */
export function telemetryRows(text, name = "") {
  const body = String(text).replace(/^﻿/u, "").trim();
  if (!body) return [];
  if (/\.csv$/iu.test(name) || !/^[[{]/u.test(body)) return csvRows(body);
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    // One JSON object per line.
    return body.split(/\r?\n/u).filter(Boolean).flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  }
  const tables = data?.tables ?? data?.Tables;
  if (Array.isArray(tables)) {
    return tables.flatMap((table) => {
      const columns = (table.columns ?? table.Columns ?? []).map((column) => column.name ?? column.ColumnName ?? column);
      return (table.rows ?? table.Rows ?? []).map((values) => Object.fromEntries(columns.map((column, index) => [column, values[index]])));
    });
  }
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.value)) return data.value;
  if (Array.isArray(data?.events)) return data.events;
  return [];
}

/**
 * The telemetry of a file or of every file of a folder (.json, .jsonl, .csv), as events in the order of their time.
 * @returns [{ time, duration, case, user?, type?, id?, name?, event?, text }]
 */
export async function readTelemetry(source, options = {}) {
  const stat = await fs.stat(source).catch(() => undefined);
  if (!stat) throw new Error(`processes: the telemetry ${source} does not exist`);
  const files = stat.isDirectory()
    ? (await fs.readdir(source)).filter((name) => /\.(?:json|jsonl|ndjson|csv)$/iu.test(name)).sort().map((name) => path.join(source, name))
    : [source];
  const events = [];
  for (const file of files) {
    for (const row of telemetryRows(await fs.readFile(file, "utf8"), file)) {
      const event = telemetryEvent(row, options);
      if (event) events.push(event);
    }
  }
  return events.sort((a, b) => a.time - b.time);
}

export const TELEMETRY_QUERY = (days) => `union pageViews, traces | where timestamp > ago(${days}d) | where isnotempty(customDimensions.alObjectId) or isnotempty(customDimensions.eventId) | project timestamp, itemType, name, message, duration, session_Id, user_Id, customDimensions | order by timestamp asc`;

/**
 * Asks Application Insights for the telemetry of the last days.
 * @param settings { appId, days = 30, query, endpoint } the key comes from BCA_TELEMETRY_API_KEY, never from .bca.json
 */
export async function fetchTelemetry({ appId, days = 30, query, endpoint = "https://api.applicationinsights.io" }, { key = process.env.BCA_TELEMETRY_API_KEY, caseField } = {}) {
  if (!appId) throw new Error("processes: processTelemetry needs \"appId\": the application ID of the Application Insights resource");
  if (!key) throw new Error("processes: set BCA_TELEMETRY_API_KEY to an API key of the Application Insights resource (Read telemetry); it is never read from .bca.json");
  if (!/^[1-9]\d{0,3}$/u.test(String(days))) throw new Error("processes: processTelemetry \"days\" must be a number of days, 1 or more");
  let response;
  try {
    response = await fetch(`${String(endpoint).replace(/\/+$/u, "")}/v1/apps/${encodeURIComponent(appId)}/query`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key },
      body: JSON.stringify({ query: query ?? TELEMETRY_QUERY(days) })
    });
  } catch (error) {
    throw new Error(`processes: Application Insights could not be reached: ${error.cause?.message ?? error.message}`);
  }
  const text = await response.text();
  if (!response.ok) throw new Error(`processes: Application Insights answered ${response.status}${response.status === 401 || response.status === 403 ? ": the key is not accepted" : ""}: ${text.slice(0, 200)}`);
  return telemetryRows(text).map((row) => telemetryEvent(row, { caseField })).filter(Boolean).sort((a, b) => a.time - b.time);
}

const stats = (values) => {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (share) => sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
  return { avg: Math.round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length), median: at(0.5), p95: at(0.95) };
};

/** A time span for people: 850 ms, 12 s, 3 min, 2.5 h, 1.5 d. */
export function span(ms) {
  if (ms === undefined) return "";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const round = (value) => (value >= 10 ? String(Math.round(value)) : String(Math.round(value * 10) / 10));
  if (ms < 60_000) return `${round(ms / 1000)} s`;
  if (ms < 3_600_000) return `${round(ms / 60_000)} min`;
  if (ms < 86_400_000) return `${round(ms / 3_600_000)} h`;
  return `${round(ms / 86_400_000)} d`;
}

/**
 * Lays the events over the steps of a process.
 * @param steps [{ id, test, after }] of a model or a mined process
 * @param events the event log (readTelemetry)
 * @param tasks the process tests and recordings of the simulation, by id: what each touches
 * @param marks { <test id>: <event id or text> } events that mark a step for certain
 * @returns undefined when no event belongs to the process, else
 *   { cases, events, matching: { certain, person, place }, from, to, throughput, variants: [{ steps, cases }], steps: { <id>: { count, cases, repeated, duration, work } }, ways: [{ from, into, count, cases, share, wait }] }
 */
export function timeProcess(steps, events, tasks, marks = {}) {
  const { order } = processOrder(steps.map((step) => ({ id: step.id, after: (step.after ?? []).map((wire) => (typeof wire === "string" ? { step: wire } : wire)) })));
  const rank = new Map(order.map((index, at) => [steps[index].id, at]));
  // What each step touches: its objects by type and ID, and by type and name.
  const touched = new Map(steps.map((step) => {
    const keys = new Set();
    for (const part of tasks.get(step.test)?.steps ?? []) {
      for (const need of part.needs ?? []) {
        keys.add(`${need.type}:${need.id}`);
        keys.add(`${need.type}:${lower(need.name)}`);
      }
    }
    return [step.id, keys];
  }));
  const marked = steps.filter((step) => marks[step.test]).map((step) => [step.id, lower(marks[step.test])]);
  const candidatesOf = (event) => {
    const sure = marked.find(([, mark]) => [mark, `al${mark}`].includes(lower(event.event)) || (mark.length > 2 && lower(event.text).includes(mark)));
    if (sure) return [sure[0]];
    if (!event.type) return [];
    const keys = [`${event.type}:${event.id}`, `${event.type}:${lower(event.name)}`];
    return steps.filter((step) => keys.some((key) => touched.get(step.id).has(key))).map(({ id }) => id);
  };
  // Who is seen doing which step, from the events only one step can have: a person does the steps of their role.
  const doers = new Map(steps.map(({ id }) => [id, new Set()]));
  for (const event of events) {
    const only = candidatesOf(event);
    if (only.length === 1 && event.user) doers.get(only[0]).add(event.user);
  }
  const stepOf = (event, current) => {
    let candidates = candidatesOf(event);
    // How sure the step is: only one step can have the event, the person tells, or only the place of the case does.
    let how = "certain";
    if (candidates.length > 1 && event.user) {
      // Of several steps: the ones this person is seen doing, else not the ones only others are seen doing.
      const own = candidates.filter((id) => doers.get(id).has(event.user));
      const free = candidates.filter((id) => !doers.get(id).size);
      candidates = own.length ? own : free.length ? free : candidates;
      how = "person";
    }
    if (candidates.length < 2) return { step: candidates[0], how };
    how = "place";
    // Several steps use it: the step the case is in keeps it for now, else the next on the way, else the way starts again.
    if (current !== undefined && candidates.includes(current)) return { step: current, open: true, how };
    const ahead = candidates.filter((id) => current === undefined || rank.get(id) > rank.get(current)).sort((a, b) => rank.get(a) - rank.get(b));
    return { step: ahead[0] ?? candidates.sort((a, b) => rank.get(a) - rank.get(b))[0], how };
  };
  const byCase = new Map();
  for (const event of events) (byCase.get(event.case) ?? byCase.set(event.case, []).get(event.case)).push(event);
  const perStep = new Map(steps.map(({ id }) => [id, { runs: [], work: [], cases: 0, repeated: 0 }]));
  const ways = new Map();
  const variants = new Map();
  const throughput = [];
  let matched = 0;
  const matching = { certain: 0, person: 0, place: 0 };
  let cases = 0;
  let from = Infinity;
  let to = -Infinity;
  for (const log of byCase.values()) {
    // The case as runs of steps: events that follow each other in one step are one run of it.
    const runs = [];
    // Events that the step the case is in could have, and the next step as well: decided when the next step shows.
    let open = [];
    const into = (run, event) => {
      run.end = Math.max(run.end, event.time + event.duration);
      run.work += event.duration;
    };
    for (const event of log) {
      const { step, open: undecided, how } = stepOf(event, runs.at(-1)?.step);
      if (!step) continue;
      matched += 1;
      matching[how] += 1;
      const last = runs.at(-1);
      if (last?.step === step) {
        if (undecided) open.push(event);
        else {
          for (const waiting of open.splice(0)) into(last, waiting);
          into(last, event);
        }
        continue;
      }
      // Another step begins. What was undecided is its beginning when another person did it, else from the longest pause on.
      let cut = open.length;
      if (last && open.length) {
        if (event.user && event.user !== last.user) cut = open.findIndex((waiting, index) => open.slice(index).every(({ user }) => user === event.user));
        else if (!event.user) {
          const times = [last.end, ...open.map(({ time }) => time), event.time];
          const gaps = times.slice(1).map((time, index) => time - times[index]);
          cut = gaps.indexOf(Math.max(...gaps));
        }
        if (cut < 0) cut = open.length;
      }
      for (const waiting of open.slice(0, cut)) into(last, waiting);
      const first = open[cut] ?? event;
      const run = { step, user: first.user, start: first.time, end: first.time + first.duration, work: first.duration };
      for (const waiting of [...open.slice(cut + 1), ...(first === event ? [] : [event])]) into(run, waiting);
      open = [];
      runs.push(run);
    }
    if (runs.length) for (const waiting of open) into(runs.at(-1), waiting);
    if (!runs.length) continue;
    cases += 1;
    from = Math.min(from, runs[0].start);
    to = Math.max(to, runs.at(-1).end);
    throughput.push(runs.at(-1).end - runs[0].start);
    const sequence = runs.map(({ step }) => step).join(" > ");
    variants.set(sequence, (variants.get(sequence) ?? 0) + 1);
    const seen = new Map();
    runs.forEach((run, index) => {
      const entry = perStep.get(run.step);
      entry.runs.push(run.end - run.start);
      entry.work.push(run.work);
      seen.set(run.step, (seen.get(run.step) ?? 0) + 1);
      const next = runs[index + 1];
      if (!next) return;
      const key = `${run.step}\n${next.step}`;
      const way = ways.get(key) ?? ways.set(key, { from: run.step, into: next.step, waits: [], cases: new Set() }).get(key);
      way.waits.push(Math.max(0, next.start - run.end));
      way.cases.add(log);
    });
    for (const [step, count] of seen) {
      perStep.get(step).cases += 1;
      if (count > 1) perStep.get(step).repeated += 1;
    }
  }
  if (!cases) return undefined;
  return {
    cases,
    events: matched,
    // How the events found their step: only one step could have them, the person told, or only where the case was.
    matching,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    throughput: stats(throughput),
    variants: [...variants].sort(([, a], [, b]) => b - a).slice(0, 8).map(([sequence, count]) => ({ steps: sequence.split(" > "), cases: count })),
    steps: Object.fromEntries([...perStep].filter(([, entry]) => entry.runs.length).map(([id, entry]) => [id, { count: entry.runs.length, cases: entry.cases, repeated: entry.repeated, duration: stats(entry.runs), work: stats(entry.work) }])),
    ways: [...ways.values()].map((way) => ({ from: way.from, into: way.into, count: way.waits.length, cases: way.cases.size, share: Math.round((way.cases.size / cases) * 100), wait: stats(way.waits) })).sort((a, b) => b.count - a.count)
  };
}

/**
 * What the timing of a process says should change.
 * @param run a run of a model (runProcesses), with its steps
 * @param timing its timing (timeProcess)
 * @returns findings: [{ severity, rule, message, fix, step? }]
 */
export function timingFindings(run, timing) {
  const findings = [];
  const title = (id) => `"${run.steps.find((step) => step.id === id)?.title ?? id}"`;
  const lane = (id) => run.steps.find((step) => step.id === id)?.lane ?? "";
  const wired = new Set(run.steps.flatMap((step) => step.after.map((wire) => `${wire.step}\n${step.id}`)));
  // Where the work waits longest.
  const waits = timing.ways.filter((way) => way.wait && way.from !== way.into && way.count >= 2).sort((a, b) => b.wait.avg - a.wait.avg);
  const longest = waits[0];
  if (longest && longest.wait.avg > 60_000 && (!timing.throughput || longest.wait.avg >= timing.throughput.avg * 0.25)) {
    const handover = lane(longest.from) !== lane(longest.into);
    findings.push({ severity: "warning", rule: "process-wait", message: `In the process ${run.title} the work waits ${span(longest.wait.avg)} on average between ${title(longest.from)} and ${title(longest.into)}${handover ? ` (from ${lane(longest.from)} to ${lane(longest.into)})` : ""}: the longest wait, of ${span(timing.throughput?.avg)} a case takes.`, fix: handover ? `See how ${lane(longest.into)} learns that there is work: a notification, a list of what is due, or a step ${lane(longest.from)} can do too.` : "See what the step waits for, and whether it can start earlier.", step: longest.into });
  }
  for (const [id, step] of Object.entries(timing.steps)) {
    // Done again and again.
    if (step.repeated >= 2 && step.repeated / step.cases >= 0.2) {
      findings.push({ severity: "warning", rule: "process-rework", message: `In the process ${run.title} the step ${title(id)} is done more than once in ${step.repeated} of ${step.cases} cases.`, fix: "That is rework. See which earlier step lets through what has to be done again.", step: id });
    }
  }
  // The step that takes longest, when it stands out.
  const slow = Object.entries(timing.steps).filter(([, step]) => step.duration && step.count >= 2).sort(([, a], [, b]) => b.duration.avg - a.duration.avg);
  if (slow.length > 1 && slow[0][1].duration.avg > 10_000 && slow[0][1].duration.avg >= slow[1][1].duration.avg * 2) {
    findings.push({ severity: "info", rule: "process-step-slow", message: `In the process ${run.title} the step ${title(slow[0][0])} takes ${span(slow[0][1].duration.avg)} on average (${span(slow[0][1].duration.p95)} for the slowest), more than twice as long as any other step.`, fix: "See what the step does in the app: the objects it touches are in its form and in bca process --mine.", step: slow[0][0] });
  }
  // What the telemetry has and the model has not, and the other way round.
  for (const way of timing.ways) {
    if (way.from !== way.into && !wired.has(`${way.from}\n${way.into}`) && way.cases >= 2 && way.share >= 10) {
      findings.push({ severity: "info", rule: "process-way-not-in-model", message: `In ${way.cases} of ${timing.cases} cases ${title(way.into)} follows ${title(way.from)}, which the process ${run.title} does not have.`, fix: "Wire that way, with its name, or see why the work goes it.", step: way.into });
    }
  }
  // How much of it is a guess.
  if (timing.matching.place / timing.events >= 0.3) {
    findings.push({ severity: "info", rule: "process-telemetry-uncertain", message: `Of the ${timing.events} events of the process ${run.title}, ${timing.matching.place} could belong to several steps and were given to the step the case was in: the times of those steps are an estimate.`, fix: "Let the app send an event that marks each step (Session.LogMessage with an event id), and name it in processTelemetry.steps." });
  }
  for (const step of run.steps) {
    if (step.test && !timing.steps[step.id] && step.status !== "unknown") {
      findings.push({ severity: "info", rule: "process-step-not-seen", message: `The step ${title(step.id)} of the process ${run.title} is not in the telemetry of ${timing.cases} cases.`, fix: "Either nobody does it, or it cannot be told apart from another step by the objects it uses: name an event that marks it (processTelemetry.steps).", step: step.id });
    }
  }
  return findings;
}
