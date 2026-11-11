// The battle test: simulate how a company uses the app. Agents with roles,
// permission sets, and task groups perform the process tests (AL UI tests
// with [SCENARIO]) step by step; every step is checked against what the code
// behind it needs (needs.js) and what the agent's permission sets grant
// (access.js). One run is three things at once:
//
//   an automatic test   who is blocked where, who can do what they must not;
//                       `bca simulate` fails CI on it
//   a process test      whether each use case runs end to end across roles
//   a metadata object   the report (JSON) from which the documentation, the
//                       explanation of every permission, and the fit-gap
//                       analysis against the company's requirements are written
import { findRecording, readRecordings, recordedSteps } from "./snapshots.js";
import fs from "node:fs/promises";
import path from "node:path";
import { createArchitectureModel } from "../architecture.js";
import { FAIL_LEVELS } from "../capabilities.js";
import { loadCaptionIndex } from "../docs/captions.js";
import { loadCorpus } from "../docs/model.js";
import { plainText } from "../docs/phrases.js";
import { inlineStep, operationStep } from "../docs/steps.js";
import { buildCatalog } from "../docs/task.js";
import { normalizeIdentifier } from "../resolver.js";
import { createAccessIndex, EXECUTABLE, RIGHT_LETTERS, RIGHTS } from "./access.js";
import { createCompany } from "./company.js";
import { createTracer } from "./needs.js";
import { list, simulationText } from "./text.js";

const SEVERITY_ORDER = ["error", "warning", "info"];
// Notes that leave a step undecided: something it touches could not be found or traced.
const UNDECIDED = new Set(["page-not-found", "part-not-found", "action-not-found", "field-not-found", "symbols-only", "unresolved-run-object"]);

const quoted = (name) => `"${String(name).replaceAll('"', '""')}"`;

/** The line a permission set needs: tabledata "Purchase Request" = RM. */
export function permissionLine(object, rights) {
  const letters = RIGHTS.filter((right) => rights.includes(right)).map((right) => RIGHT_LETTERS[right]).join("");
  return object.type === "table" && !rights.includes("execute")
    ? `tabledata ${quoted(object.name)} = ${letters}`
    : `${object.type} ${quoted(object.name)} = ${letters}`;
}

function permissionLines(needs) {
  const byObject = new Map();
  for (const { object, right } of needs) {
    const key = `${object.key}\u0000${right === "execute"}`;
    if (!byObject.has(key)) byObject.set(key, { object, rights: [] });
    if (!byObject.get(key).rights.includes(right)) byObject.get(key).rights.push(right);
  }
  return [...byObject.values()].map(({ object, rights }) => permissionLine(object, rights));
}

async function readCompanyFile(file) {
  let content;
  try {
    content = JSON.parse(await fs.readFile(path.resolve(file), "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`Invalid JSON in ${file}: ${error.message}`);
    throw error;
  }
  if (!content || typeof content !== "object" || Array.isArray(content)) throw new Error(`${file}: the company must be an object`);
  // The simulation section on its own, or a whole .bca.json.
  return content.simulation && typeof content.simulation === "object" ? content.simulation : content;
}

function stepText(op, context) {
  try {
    const step = operationStep(op, context);
    return plainText(step.items?.length ? inlineStep(step, context.language) : step.cmd).replace(/\s+/gu, " ").trim();
  } catch {
    return op.kind;
  }
}

/**
 * The clicks of a process test: the operations of its [WHEN] phases. A page
 * they work on that the test opened earlier (under [GIVEN]) is opened first,
 * as the person who performs the task has to open it too.
 */
function operationsOf(value) {
  const all = value.guideOperations ?? [];
  const sections = (value.guideSections ?? []).filter(({ operations }) => operations?.length);
  if (!sections.length) return all;
  const pagesOf = (op) => [op.page?.name, ...(op.steps ?? []).flatMap(pagesOf)].filter(Boolean).map((name) => name.toLowerCase());
  const opened = new Set();
  const steps = [];
  for (const op of sections.flatMap(({ operations }) => operations)) {
    for (const page of op.kind === "open" || op.kind === "opened" || op.kind === "dialog" ? [] : pagesOf(op)) {
      if (opened.has(page)) continue;
      opened.add(page);
      const opening = all.find((candidate) => candidate.kind === "open" && candidate.page?.name.toLowerCase() === page);
      if (opening) steps.push(opening);
    }
    for (const page of pagesOf(op)) opened.add(page);
    steps.push(op);
  }
  return steps;
}

/**
 * Runs the battle test.
 * @param input app or workspace root
 * @param values { tests, company, language, failOn, title, config, projectRoot, compiler, ... }
 * @returns the simulation report (see docs/battle-test.md)
 */
export async function simulate(input, values = {}, context = {}) {
  const cache = context.cache ?? new Map();
  const { options } = await createArchitectureModel(input, { ...values, view: "project", strict: false, title: undefined }, { ...context, cache });
  const root = options.projectRoot;
  // The whole resolved project. A view folds the objects of other apps into
  // boundary nodes and applies the filters of .bca.json; permissions need all of it.
  const model = cache.get(root);
  const settings = { ...(options.simulation ?? {}), ...(values.company ? await readCompanyFile(values.company) : {}) };
  const failOn = values.failOn ?? settings.failOn ?? "error";
  if (!FAIL_LEVELS.includes(failOn)) throw new Error(`fail-on must be one of: ${FAIL_LEVELS.join(", ")}`);
  // Rights on objects of other apps: assumed to come with that app's own
  // permission sets (D365 BASIC and the like), or checked like any other.
  const otherApps = settings.otherApps ?? "assume";
  if (!["assume", "check"].includes(otherApps)) throw new Error('simulation: otherApps must be "assume" or "check"');
  const language = values.language ?? settings.language ?? "en";
  const t = simulationText(language);
  const docsLanguage = t.language === "de" ? "de-DE" : "en-US";

  // Process tests: the folder given, else simulation.tests, else docs.tests, else the app itself.
  const configuredTests = settings.tests ?? options.docs?.tests;
  const testsRoot = values.tests ? path.resolve(values.tests) : path.resolve(root, configuredTests ?? ".");
  const corpus = await loadCorpus(testsRoot);
  if (corpus.diagnostics.some(({ severity }) => severity === "error")) {
    throw new Error(`the process tests in ${testsRoot} have errors; run "bca docs validate" for details`);
  }
  // Recordings of Business Central that the agents perform as well (simulation.recordings, --recordings).
  const recordingsDir = values.recordings ? path.resolve(values.recordings) : settings.recordings ? path.resolve(root, settings.recordings) : undefined;
  const recordings = recordingsDir ? await readRecordings(recordingsDir) : [];
  if (!corpus.scenarios.length && !recordings.length) {
    throw new Error(`no process tests found in ${testsRoot}: the battle test performs AL UI tests with a // [SCENARIO] comment (see "bca docs --help"); pass --tests or set simulation.tests in .bca.json`);
  }
  const captions = await loadCaptionIndex(root, { language: docsLanguage, parseCache: context.parseCache }).catch(() => undefined);
  const catalog = buildCatalog(corpus, { language: docsLanguage, captions });
  // A recording with the title of a process test (or named by simulation.grounding) is what that test
  // really ran; any other recording is a process of its own, in the use case of its feature.
  const plainTitle = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
  const grounded = new Map();
  for (const [id, name] of Object.entries(settings.grounding ?? {})) {
    const task = catalog.tasks.find((candidate) => normalizeIdentifier(candidate.id) === normalizeIdentifier(id));
    const recording = findRecording(recordings, name);
    if (task && recording) grounded.set(task.id, recording);
  }
  for (const recording of recordings) {
    if ([...grounded.values()].includes(recording)) continue;
    const task = catalog.tasks.find((candidate) => !grounded.has(candidate.id) && plainTitle(candidate.title) === plainTitle(recording.name));
    if (task) {
      grounded.set(task.id, recording);
      continue;
    }
    const feature = recording.feature ? recording.feature.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") : "";
    const own = { id: `recorded-${recording.key}`, title: recording.name, goal: t.recordedGoal(recording), features: feature ? [feature] : [], permissions: [], requires: [], links: { alternative: [] }, source: {}, recorded: recording,
      // The pages the recording went through: what the fit-gap analysis counts as opened.
      pages: [...new Set(recording.steps.flatMap((step) => step.callStack ?? []).filter((frame) => String(frame.objectType).toLowerCase() === "page" && frame.objectName).map((frame) => String(frame.objectName)))] };
    catalog.tasks.push(own);
    let useCase = catalog.useCases.find((candidate) => candidate.feature === feature);
    if (!useCase) {
      useCase = { id: feature ? `use-case-${feature}` : "use-case-recorded", feature, title: recording.feature ?? t.recordedUseCase, main: [], alternatives: [] };
      catalog.useCases.push(useCase);
    }
    useCase.main.push(own);
  }

  // Objects by the name of their type in the report's language: page 50210, Seite 50210.
  const label = (object) => object ? `${t.types[object.type] ?? object.type} ${object.id ? `${object.id} ` : ""}${object.name}` : "";
  const tracer = createTracer(model, {
    label,
    memberLabel: (owner, procedure) => `${label(owner)} (${procedure.action ? `${t.action} ${procedure.action}` : procedure.name})`
  });
  const fullAccess = [settings.fullAccess ?? ["SUPER"]].flat();
  if (fullAccess.some((name) => typeof name !== "string")) throw new Error("simulation: fullAccess must be a list of permission set names");
  const access = createAccessIndex(model, { fullAccess });
  const describe = (need) => ({
    object: label(need.object),
    type: need.object.type,
    id: need.object.id,
    name: need.object.name,
    right: need.right,
    letter: RIGHT_LETTERS[need.right],
    because: t.reasons[need.reason?.code]?.(need.reason) ?? "",
    ...(need.object.externalSymbol ? { external: true } : {})
  });
  const noteText = (note) => t.notes[note.code]?.(note) ?? note.code;

  // 1. What every step of every process test needs, whoever performs it.
  const tasks = catalog.tasks.map((task) => {
    const scenario = corpus.byId.get(task.id);
    const state = tracer.newState();
    const steps = !scenario ? [] : operationsOf(scenario.value).map((op, index) => {
      const { needs, notes } = tracer.operation(op, state);
      return {
        index: index + 1,
        kind: op.kind,
        text: stepText(op, { language: docsLanguage, captions }),
        page: op.page?.name,
        member: op.member,
        needs,
        notes,
        // What the code of another app needs is that app's matter, unless it is checked.
        undecided: notes.some(({ code }) => UNDECIDED.has(code) && !(code === "symbols-only" && otherApps === "assume"))
      };
    });
    // What a recording of this process shows really ran comes after the steps of the test.
    const recording = task.recorded ?? grounded.get(task.id);
    if (recording) {
      for (const step of recordedSteps(recording, model)) {
        steps.push({ ...step, index: steps.length + 1, text: task.recorded ? step.text : t.recordedStep(step.text) });
      }
    }
    return { ...task, steps, ...(recording ? { recording: recording.name } : {}) };
  });
  const taskById = new Map(tasks.map((task) => [task.id, task]));

  // 2. The company, and what each agent's permission sets grant.
  const company = createCompany(settings, catalog);
  const agents = company.agents.map((agent) => ({ ...agent, effective: access.effective(agent.permissionSets) }));

  function evaluate(need, effective) {
    if (need.inherent) return { status: "granted", how: "inherent", by: [] };
    const { granted, by } = effective.check(need.object, need.right);
    if (granted === "direct") return { status: "granted", how: "direct", by };
    if (granted === "indirect") {
      // Running an object from code takes no more than indirect Execute. Table
      // data takes code that has the permission itself, at every place it is used.
      const covered = need.right === "execute"
        ? !need.ui
        : need.executors.every((executors) => executors.some((key) => access.declares(key, need.object.key, need.right)));
      return covered ? { status: "granted", how: "indirect", by } : { status: "denied", how: "indirect-only", by };
    }
    if (need.object.externalSymbol) {
      if (otherApps === "assume") return { status: "assumed", how: "assumed", by: [] };
      // A permission set whose content is unknown may grant it.
      if (effective.opaque) return { status: "unverified", how: "unverified", by: [] };
    }
    return { status: "denied", how: "missing", by: [] };
  }

  function attempt(agent, task) {
    const steps = task.steps.map((step) => {
      const checks = step.needs.map((need) => ({ need, ...evaluate(need, agent.effective) }));
      const denied = checks.filter(({ status }) => status === "denied");
      const unverified = checks.filter(({ status }) => status === "unverified");
      return { step, checks, denied, unverified, outcome: denied.length ? "denied" : unverified.length || step.undecided ? "unverified" : "allowed" };
    });
    const blocked = steps.find(({ outcome }) => outcome === "denied");
    return {
      task,
      steps,
      outcome: blocked ? "blocked" : steps.some(({ outcome }) => outcome === "unverified") ? "unverified" : "completed",
      blockedAt: blocked?.step.index,
      denied: steps.flatMap(({ step, denied }) => denied.map((check) => ({ ...check, step }))),
      assumed: steps.flatMap(({ checks }) => checks.filter(({ status }) => status === "assumed").map(({ need }) => need)),
      unverified: steps.flatMap(({ step, unverified }) => unverified.map((check) => ({ ...check, step })))
    };
  }

  // 3. Every agent tries every process test: the assigned ones must succeed,
  // the forbidden ones must fail, the rest shows what else the agent could do.
  const findings = [];
  const finding = (severity, code, values_, action) => findings.push({
    severity,
    code,
    message: t.findings[code](values_),
    ...(action ? { action } : {}),
    ...Object.fromEntries(Object.entries(values_).filter(([key]) => ["agent", "task", "requirement"].includes(key)))
  });
  const attempts = new Map();
  for (const agent of agents) {
    const own = new Map();
    for (const task of tasks) own.set(task.id, attempt(agent, task));
    attempts.set(agent.name, own);
  }
  const attemptOf = (agent, id) => attempts.get(agent.name).get(id);
  const who = (agent) => agent.roles.length && !agent.derived && !(agent.roles.length === 1 && agent.roles[0] === agent.name)
    ? `${agent.name} (${agent.roles.join(", ")})`
    : agent.name;

  for (const problem of company.problems) {
    finding(problem.code === "assigned-and-forbidden" ? "warning" : "error", problem.code, problem, t.actions.config());
  }
  const unknownSets = new Map();
  for (const agent of agents) {
    for (const name of agent.effective.unknown) {
      if (!unknownSets.has(name)) unknownSets.set(name, []);
      unknownSets.get(name).push(agent.name);
    }
  }
  for (const [name, owners] of unknownSets) finding("warning", "unknown-permission-set", { name, owners: owners.join(", ") }, t.actions["unknown-permission-set"]());

  for (const agent of agents) {
    for (const id of agent.tasks) {
      const result = attemptOf(agent, id);
      if (result.outcome === "blocked") {
        const first = result.steps.find(({ outcome }) => outcome === "denied");
        finding("error", "task-blocked", {
          agent: who(agent),
          task: result.task.title,
          step: first.step.index,
          text: first.step.text.replace(/\.$/u, ""),
          needs: list(first.denied.map(({ need }) => t.need(t.rights[need.right], label(need.object))), t.and)
        }, t.actions["task-blocked"]({ lines: permissionLines(result.denied.map(({ need }) => need)).map((line) => `\`${line}\``).join(", ") }));
      } else if (result.outcome === "unverified") {
        finding("info", "task-unverified", { agent: who(agent), task: result.task.title }, t.actions["task-unverified"]());
      }
    }
    for (const id of agent.mustNot) {
      const result = attemptOf(agent, id);
      // Denied only when a step is: a task that cannot be verified is not proven forbidden.
      if (result.outcome === "unverified") finding("info", "task-unverified", { agent: who(agent), task: result.task.title }, t.actions["task-unverified"]());
      if (result.outcome !== "completed") continue;
      finding("error", "forbidden-task-possible", { agent: who(agent), task: result.task.title },
        t.actions["forbidden-task-possible"]({ sets: list(agent.permissionSets, t.and) }));
    }
  }

  // 4. Processes: each use case, step by step, with who performs it.
  const performersOf = (id) => agents.filter((agent) => agent.tasks.includes(id));
  const works = (status) => ["done", "unverified"].includes(status);
  const ownStatus = new Map(tasks.map((task) => {
    const outcomes = performersOf(task.id).map((agent) => attemptOf(agent, task.id).outcome);
    return [task.id, !outcomes.length ? "unstaffed"
      : outcomes.includes("completed") ? "done"
        : outcomes.includes("unverified") ? "unverified" : "blocked"];
  }));
  // [ALTERNATIVE] reads both ways: either scenario reaches the outcome.
  const alternativesOf = new Map(tasks.map(({ id }) => [id, new Set()]));
  for (const task of tasks) {
    for (const { id } of task.links.alternative) {
      if (!alternativesOf.has(id)) continue;
      alternativesOf.get(task.id).add(id);
      alternativesOf.get(id).add(task.id);
    }
  }
  const taskStatus = new Map();
  const statusOf = (id) => taskStatus.get(id)?.status ?? ownStatus.get(id);
  // What a task stands for is reached when it works, or an alternative to it does.
  const reached = (id) => works(statusOf(id)) || [...alternativesOf.get(id) ?? []].some((other) => works(statusOf(other)));
  for (const task of tasks) {
    let status = ownStatus.get(task.id);
    // A task that waits for one before it: tasks come in journey order, prerequisites first.
    const waitsFor = task.requires.map(({ id }) => id).filter((id) => ownStatus.has(id) && !reached(id));
    if (works(status) && waitsFor.length) status = "waiting";
    taskStatus.set(task.id, { status, waitsFor });
  }
  for (const task of tasks.filter(({ id }) => taskStatus.get(id).status === "unstaffed")) {
    const code = company.derived && !task.permissions.length ? "no-permissions-named" : "task-unstaffed";
    finding("warning", code, { task: task.title }, t.actions[code]());
  }
  const order = new Map(tasks.map((task, index) => [task.id, index]));
  const processes = catalog.useCases.map((useCase) => {
    const alternatives = new Set(useCase.alternatives.map(({ id }) => id));
    const members = [...useCase.main, ...useCase.alternatives].sort((a, b) => order.get(a.id) - order.get(b.id));
    const steps = members.map((member) => {
      const performers = performersOf(member.id).map((agent) => ({ agent: agent.name, roles: agent.roles, outcome: attemptOf(agent, member.id).outcome }));
      return { task: member.id, title: member.title, ...taskStatus.get(member.id), ...(alternatives.has(member.id) ? { alternative: true } : {}), performers };
    });
    // A main step that fails is fine when an alternative to it works.
    const decisive = steps.filter((step) => !step.alternative && !(!works(step.status) && reached(step.task)));
    const status = ["blocked", "unstaffed", "waiting", "unverified"].find((candidate) => decisive.some((step) => step.status === candidate)) ?? "runs";
    const lanes = decisive.map(({ performers }) => performers.find(({ outcome }) => outcome === "completed") ?? performers[0])
      .filter(Boolean).map(({ roles, agent }) => roles.join(", ") || agent);
    return {
      id: useCase.id,
      title: useCase.title,
      feature: useCase.feature || undefined,
      status,
      handovers: lanes.filter((lane, index) => index && lane !== lanes[index - 1]).length,
      steps
    };
  });

  // 5. Fit-gap: what the company needs against what the battle test showed.
  const pageNames = new Set(tasks.flatMap(({ pages }) => pages.map(normalizeIdentifier)));
  const fitGap = company.requirements.map((requirement) => {
    const linked = requirement.tasks.map((id) => taskById.get(id));
    // A process test that fails counts as covered when an alternative to it works.
    const statuses = linked.map(({ id }) => !works(statusOf(id)) && reached(id) ? "done" : statusOf(id));
    const objects = requirement.objects.map((selector) => {
      const match = /^(\w+)\s*:\s*(.+)$/u.exec(selector);
      const found = match
        ? tracer.object(match[1].toLowerCase(), match[2].trim().replace(/^"|"$/gu, ""))
        : model.objects.find(({ name, externalSymbol }) => !externalSymbol && normalizeIdentifier(name) === normalizeIdentifier(selector));
      return { selector, object: found ? label(found) : undefined };
    });
    const missingObjects = objects.filter(({ object }) => !object).map(({ selector }) => selector);
    let status;
    let action;
    if (!linked.length || requirement.missingTasks.length) {
      const proven = objects.length && !missingObjects.length;
      status = proven ? "untested" : "gap";
      action = proven
        ? t.fitActions.untested({ objects: list(objects.map(({ object }) => object), t.and) })
        : t.fitActions.gap({ missing: list([...requirement.missingTasks.map((id) => t.processTest(id)), ...missingObjects], t.and) });
    } else if (statuses.includes("blocked")) {
      status = "permission-gap";
      const denied = linked.flatMap(({ id }) => performersOf(id).flatMap((agent) => attemptOf(agent, id).denied.map(({ need }) => need)));
      action = t.fitActions[status]({ lines: permissionLines(denied).map((line) => `\`${line}\``).join(", ") });
    } else if (statuses.includes("unstaffed")) {
      status = "organization-gap";
      action = t.fitActions[status]({ tasks: list(linked.filter(({ id }) => taskStatus.get(id).status === "unstaffed").map(({ title }) => `"${title}"`), t.and) });
    } else if (statuses.includes("unverified")) {
      status = "fit-unverified";
      action = t.fitActions[status]();
    } else {
      status = "fit";
      action = "";
    }
    if (!["fit", "fit-unverified", "permission-gap"].includes(status)) {
      finding("warning", "requirement-gap", { id: requirement.id, title: requirement.title, status: t.fit[status], requirement: requirement.id }, action);
    }
    return {
      id: requirement.id,
      title: requirement.title,
      description: requirement.description,
      status,
      label: t.fit[status],
      action,
      tasks: linked.map(({ id, title }) => ({ id, title, status: taskStatus.get(id).status })),
      ...(requirement.missingTasks.length ? { missingTasks: requirement.missingTasks } : {}),
      ...(objects.length ? { objects } : {})
    };
  });
  const required = new Set(company.requirements.flatMap(({ tasks: ids }) => ids));
  const untestedPages = model.objects
    .filter((object) => object.type === "page" && !object.externalSymbol && object.metadata?.usageCategory && !/^none$/iu.test(object.metadata.usageCategory)
      && !/^api$/iu.test(object.metadata.pageType ?? "") && !pageNames.has(normalizeIdentifier(object.name)))
    .map((object) => ({ object: label(object), caption: object.metadata.caption, usageCategory: object.metadata.usageCategory }))
    .sort((a, b) => a.object.localeCompare(b.object, "en", { numeric: true }));

  // 6. The report.
  const matrixCell = (agent, task) => {
    const { outcome } = attemptOf(agent, task.id);
    if (agent.tasks.includes(task.id)) return outcome;
    if (agent.mustNot.includes(task.id)) return outcome === "completed" ? "forbidden-possible" : outcome === "unverified" ? "forbidden-unverified" : "denied-as-expected";
    return outcome === "completed" ? "able" : "unable";
  };
  const reportAttempt = (agent, result, expected) => ({
    task: result.task.id,
    title: result.task.title,
    expected,
    outcome: expected === "deny" && result.outcome === "blocked" ? "denied" : result.outcome,
    ...(result.blockedAt ? { blockedAt: result.blockedAt } : {}),
    missing: result.denied.map(({ need, step, how, by }) => ({ step: step.index, ...describe(need), reason: how, why: t.how[how](by) })),
    ...(result.denied.length ? { missingPermissions: permissionLines(result.denied.map(({ need }) => need)) } : {}),
    ...(result.unverified.length ? { unverified: result.unverified.map(({ need, step }) => ({ step: step.index, ...describe(need) })) } : {})
  });
  const reportAgents = agents.map((agent) => {
    const used = new Set(agent.tasks.flatMap((id) => taskById.get(id).steps.flatMap(({ needs }) => needs.map(({ object, right }) => `${object.key}\u0000${right}`))));
    const unused = [];
    if (agent.tasks.length) {
      for (const [key, rights] of agent.effective.grants) {
        const object = tracer.objectOf(key);
        if (!object || object.externalSymbol) continue;
        const spare = [...rights.keys()].filter((right) => !used.has(`${key}\u0000${right}`) && (right === "execute" ? EXECUTABLE.includes(object.type) : object.type === "table"));
        if (spare.length) unused.push({ object, rights: spare });
      }
    }
    return {
      name: agent.name,
      description: agent.description,
      roles: agent.roles,
      permissionSets: [
        ...agent.effective.sets.map(({ name, id, caption, includedBy, opaque }) => ({ name, id, caption, includedBy, ...(opaque ? { inSource: false } : {}) })),
        ...agent.effective.unknown.map((name) => ({ name, unknown: true }))
      ],
      taskGroups: agent.taskGroups,
      attempts: [
        ...agent.tasks.map((id) => reportAttempt(agent, attemptOf(agent, id), "complete")),
        ...agent.mustNot.map((id) => reportAttempt(agent, attemptOf(agent, id), "deny"))
      ],
      alsoAble: tasks.filter((task) => matrixCell(agent, task) === "able").map(({ id, title }) => ({ task: id, title })),
      // Rights on objects of other apps that the analyzed permission sets do not grant.
      assumedPermissions: permissionLines(agent.tasks.flatMap((id) => attemptOf(agent, id).assumed)),
      unusedPermissions: unused
        .sort((a, b) => label(a.object).localeCompare(label(b.object), "en", { numeric: true }))
        .map(({ object, rights }) => ({ object: label(object), rights: RIGHTS.filter((right) => rights.includes(right)), line: permissionLine(object, rights) }))
    };
  });

  findings.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  const counts = Object.fromEntries(SEVERITY_ORDER.map((severity) => [severity, findings.filter((item) => item.severity === severity).length]));
  const threshold = SEVERITY_ORDER.indexOf(failOn);
  const assigned = reportAgents.flatMap(({ attempts: own }) => own.filter(({ expected }) => expected === "complete"));
  const forbidden = reportAgents.flatMap(({ attempts: own }) => own.filter(({ expected }) => expected === "deny"));
  const apps = (model.apps ?? []).filter(({ external }) => !external);
  return {
    schemaVersion: 1,
    title: values.title ?? settings.title ?? t.report.title(company.name, apps.length === 1 ? apps[0].name : path.basename(root)),
    app: apps.map(({ name, version, publisher }) => ({ name, version, publisher })),
    company: { name: company.name, derived: company.derived },
    language: t.language,
    tests: path.relative(root, testsRoot).replaceAll("\\", "/") || ".",
    passed: failOn === "never" || !findings.some(({ severity }) => SEVERITY_ORDER.indexOf(severity) <= threshold),
    failOn,
    counts,
    summary: {
      agents: agents.length,
      roles: company.roles.length,
      tasks: tasks.length,
      assigned: {
        total: assigned.length,
        completed: assigned.filter(({ outcome }) => outcome === "completed").length,
        blocked: assigned.filter(({ outcome }) => outcome === "blocked").length,
        unverified: assigned.filter(({ outcome }) => outcome === "unverified").length
      },
      forbidden: {
        total: forbidden.length,
        denied: forbidden.filter(({ outcome }) => outcome === "denied").length,
        possible: forbidden.filter(({ outcome }) => outcome === "completed").length,
        unverified: forbidden.filter(({ outcome }) => outcome === "unverified").length
      },
      processes: { total: processes.length, runs: processes.filter(({ status }) => status === "runs").length },
      requirements: { total: fitGap.length, fit: fitGap.filter(({ status }) => status === "fit" || status === "fit-unverified").length }
    },
    findings,
    matrix: {
      tasks: tasks.map(({ id, title }) => ({ id, title })),
      rows: agents.map((agent) => ({ agent: agent.name, roles: agent.roles, cells: tasks.map((task) => matrixCell(agent, task)) }))
    },
    fitGap: {
      derived: company.requirementsDerived,
      requirements: fitGap,
      untestedPages,
      notRequired: company.requirementsDerived ? [] : tasks.filter(({ id }) => !required.has(id)).map(({ id, title }) => ({ task: id, title }))
    },
    processes,
    taskGroups: company.taskGroups.map(({ name, description, tasks: ids }) => ({ name, description, tasks: ids })),
    roles: company.roles.map(({ name, description, permissionSets, taskGroups, tasks: ids, mustNot }) => ({ name, description, permissionSets, taskGroups, tasks: ids, mustNot })),
    agents: reportAgents,
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      goal: task.goal,
      features: task.features,
      permissions: task.permissions,
      requires: task.requires.map(({ id }) => id),
      source: { file: path.relative(root, task.recorded?.file ?? corpus.byId.get(task.id).path).replaceAll("\\", "/"), procedure: task.source.procedure },
      ...(task.recorded ? { recorded: true } : {}),
      ...(task.recording ? { recording: task.recording } : {}),
      steps: task.steps.map(({ index, kind, text, page, member, needs, notes }) => ({
        index,
        kind,
        text,
        page,
        member,
        needs: needs.map(describe),
        ...(notes.length ? { notes: notes.map(noteText) } : {})
      }))
    }))
  };
}
