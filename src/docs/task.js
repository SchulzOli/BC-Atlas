// Builds the presentation model for generated documentation. Each scenario
// becomes a task shaped like an OASIS DITA 1.3 task topic:
//
//   title, shortdesc   <- [SCENARIO]
//   prereq             <- [PERMISSIONS], [GIVEN], [REQUIRES]
//   steps / substeps   <- [WHEN] phases and their TestPage operations
//   stepresult         <- [THEN] between two [WHEN] phases
//   result             <- [THEN] after the last [WHEN]
//   related links      <- [NEXT], [RELATED], [ALTERNATIVE]
//
// Every renderer (Markdown guide, test case, HTML, DITA, CSV) reads this model.
import path from "node:path";
import { singular } from "./al-ui-source.js";
import { label, phrase } from "./phrases.js";
import { operationStep } from "./steps.js";

export const LINK_KINDS = ["next", "related", "alternative"];

function isEnglish(language) {
  return String(language ?? "en").toLowerCase().startsWith("en");
}

/** Title and goal in the output language; English titles use the page caption. */
export function titleFor(value, context = {}) {
  const english = isEnglish(context.language);
  const opener = value.creationTarget
    ? (value.guideOperations ?? []).find((op) => op.kind === "open" && op.mode === "new")
    : undefined;
  const target = opener && context.captions
    ? singular(context.captions.page(opener.page.name)?.caption ?? opener.page.label)
    : value.creationTarget;
  if (english && target) return { title: `Create a new ${target}`, goal: `Create a new ${target}.` };
  return { title: value.goal.replace(/[.\s]+$/u, ""), goal: value.goal };
}

function linkTarget(id, context) {
  const scenario = context.catalog?.get(id);
  return { id, title: scenario ? titleFor(scenario.value, context).title : id, exists: Boolean(scenario) };
}

function stepsFor(operations, context) {
  return operations.map((op) => operationStep(op, context));
}

function collect(steps, key) {
  return steps.flatMap((step) => [...(step[key] ?? []), ...(step.items ?? []).flatMap((item) => item[key] ?? [])]);
}

/**
 * @param scenario a loaded scenario ({ value, path, relativePath, ... })
 * @param context { language, captions, catalog }
 */
export function buildTask(scenario, context = {}) {
  const language = context.language ?? "en-US";
  const english = isEnglish(language);
  const { value } = scenario;
  const ctx = { language, captions: context.captions };

  const sections = (value.guideSections ?? []).filter(({ operations }) => operations?.length);
  let steps;
  let result;
  if (sections.length === 1) {
    // One [WHEN] phase restates the scenario; its operations are the steps.
    steps = stepsFor(sections[0].operations, ctx);
    result = sections[0].results?.length ? sections[0].results : value.expected;
  } else if (sections.length) {
    steps = sections.map((section, index) => {
      const items = stepsFor(section.operations, ctx);
      const last = index === sections.length - 1;
      return {
        phase: true,
        cmd: [section.title],
        items,
        result: last ? [] : section.results ?? [],
        expected: section.results?.length ? [section.results.join(" ")] : items.at(-1)?.expected,
        pages: collect(items, "pages"),
        actions: collect(items, "actions")
      };
    });
    const lastResults = sections.at(-1).results ?? [];
    result = lastResults.length ? lastResults : value.expected;
  } else {
    steps = stepsFor(value.guideOperations ?? [], ctx);
    result = value.expected;
  }
  if (!steps.length && value.actions?.length) {
    steps = value.actions.map((action) => ({ cmd: [action], expected: [], pages: [], actions: [] }));
  }

  const { title, goal } = titleFor(value, { ...context, language });

  const prerequisites = value.typedPrerequisites?.length
    ? value.typedPrerequisites
    : value.prerequisites.map((text) => ({ type: "general", text }));
  const guidePrerequisites = english ? value.guidePrerequisites : value.prerequisites;
  const prereqs = [
    ...value.permissions.map((permission) => ({
      kind: "permission",
      tokens: phrase(language, "label.permission", { permission: { ui: permission } })
    })),
    ...prerequisites.map((item, index) => ({
      kind: item.type,
      tokens: [item.type === "general"
        ? (english && !value.typedPrerequisites?.length ? guidePrerequisites[index] ?? item.text : item.text)
        : `${label(language, `prereq.${item.type}`)}: ${item.text}`]
    })),
    ...(value.links?.requires ?? []).map((id) => ({ kind: "requires", link: linkTarget(id, { ...context, language }) }))
  ];

  const expected = english && value.guideExpected?.length && result === value.expected ? value.guideExpected : result;
  const pages = [...new Set(collect(steps, "pages"))];
  const actions = collect(steps, "actions");
  return {
    id: value.id,
    language,
    title,
    goal,
    shortdesc: phrase(language, "label.goal", {
      goal: (english ? goal.replace(/^\p{Lu}(?!\p{Lu})/u, (letter) => letter.toLowerCase()) : goal).replace(/\.$/u, "")
    }),
    features: value.features ?? [],
    permissions: value.permissions,
    prereqs,
    examples: steps.some((step) => step.example || step.items?.some((item) => item.example)) || value.hasExampleValues,
    steps,
    result: expected,
    links: Object.fromEntries(LINK_KINDS.map((kind) => [kind, (value.links?.[kind] ?? []).map((id) => linkTarget(id, { ...context, language }))])),
    requires: (value.links?.requires ?? []).map((id) => linkTarget(id, { ...context, language })),
    pages,
    actions: [...new Map(actions.map(([page, action]) => [`${page}\u0000${action}`.toLowerCase(), { page, action }])).values()],
    source: {
      file: path.basename(scenario.path),
      relativePath: scenario.relativePath,
      procedure: value.procedure,
      hash: value.sourceHash
    }
  };
}

/** True when the goal adds nothing to the title. */
export function sameAsTitle(task) {
  return task.goal.replace(/[.\s]+$/u, "").toLowerCase() === task.title.toLowerCase();
}

/** "warehouse-requests" -> "Warehouse requests"; free text stays as written. */
export function humanizeFeature(feature) {
  if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/u.test(feature)) return feature;
  const words = feature.replace(/[-_]+/gu, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function slug(value) {
  return String(value).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/gu, "")
    .replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "other";
}

/** Orders scenarios so that prerequisites and predecessors come first. */
function journeyOrder(tasks) {
  const ids = new Set(tasks.map(({ id }) => id));
  const before = new Map(tasks.map(({ id }) => [id, new Set()]));
  for (const task of tasks) {
    for (const { id } of task.requires) if (ids.has(id)) before.get(task.id).add(id);
    for (const { id } of task.links.next) if (ids.has(id)) before.get(id).add(task.id);
  }
  const ordered = [];
  const state = new Map();
  const visit = (id) => {
    if (state.get(id)) return;
    state.set(id, "visiting");
    for (const previous of [...before.get(id)].sort()) if (!state.get(previous)) visit(previous);
    state.set(id, "done");
    ordered.push(id);
  };
  for (const { id } of [...tasks].sort((left, right) => left.id.localeCompare(right.id))) visit(id);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return ordered.map((id) => byId.get(id));
}

function pageLabel(name, captions) {
  return captions?.page(name)?.caption ?? name;
}

/**
 * Builds the documentation catalog: tasks plus use cases (per [FEATURE]),
 * indexes by page and permission set, the journey graph, and page coverage.
 */
export function buildCatalog(corpus, context = {}) {
  const language = context.language ?? "en-US";
  const tasks = journeyOrder(corpus.scenarios.map((scenario) =>
    buildTask(scenario, { ...context, language, catalog: corpus.byId })));

  const groups = new Map();
  for (const task of tasks) {
    for (const feature of task.features.length ? task.features : [""]) {
      if (!groups.has(feature)) groups.set(feature, []);
      groups.get(feature).push(task);
    }
  }
  const useCases = [...groups.entries()]
    .sort(([left], [right]) => (left === "") - (right === "") || left.localeCompare(right))
    .map(([feature, members]) => {
      const alternatives = new Set(members.flatMap((task) => task.links.alternative.map(({ id }) => id)));
      const main = members.filter(({ id }) => !alternatives.has(id));
      return {
        id: feature ? `use-case-${slug(feature)}` : "use-case-other",
        feature,
        title: feature ? humanizeFeature(feature) : label(language, "label.unassigned"),
        main: main.length ? main : members,
        alternatives: main.length ? members.filter(({ id }) => alternatives.has(id)) : []
      };
    });

  const index = (keyOf) => {
    const map = new Map();
    for (const task of tasks) {
      for (const key of keyOf(task)) {
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(task);
      }
    }
    return [...map.entries()].sort(([left], [right]) => left.localeCompare(right))
      .map(([name, members]) => ({ name, tasks: members }));
  };
  const byPage = index((task) => task.pages.map((page) => pageLabel(page, context.captions)));
  const byPermission = index((task) => task.permissions);

  const ids = new Set(tasks.map(({ id }) => id));
  const journey = [];
  for (const task of tasks) {
    for (const { id } of task.requires) if (ids.has(id)) journey.push({ from: task.id, to: id, kind: "requires" });
    for (const kind of LINK_KINDS) {
      for (const { id } of task.links[kind]) if (ids.has(id)) journey.push({ from: task.id, to: id, kind });
    }
  }

  let coverage;
  if (context.captions) {
    const touched = new Set(tasks.flatMap(({ pages }) => pages.map((page) => page.toLowerCase())));
    const invoked = new Set(tasks.flatMap(({ actions }) =>
      actions.map(({ page, action }) => `${page}\u0000${action}`.toLowerCase())));
    const appPages = [...context.captions.pages.values()].filter(({ id }) => id !== undefined)
      .sort((left, right) => left.caption.localeCompare(right.caption));
    const covered = appPages.filter(({ name }) => touched.has(name.toLowerCase()));
    coverage = {
      total: appPages.length,
      covered: covered.length,
      untouchedPages: appPages.filter(({ name }) => !touched.has(name.toLowerCase()))
        .map(({ name, caption, id }) => ({ name, caption, id })),
      unusedActions: covered.flatMap((page) => [...page.actions.values()]
        .filter(({ name }) => !invoked.has(`${page.name}\u0000${name}`.toLowerCase()))
        .map(({ name, caption }) => ({ page: page.caption, action: caption ?? name })))
    };
  }

  return { language, title: context.title, tasks, useCases, byPage, byPermission, journey, coverage };
}

/** Number of clicks in a task: phases count their items. */
export function clickCount(task) {
  return task.steps.reduce((count, step) => count + (step.phase ? step.items.length : 1), 0);
}

/**
 * D2 source for the journey between scenarios, grouped by use case. Every
 * scenario is a card with its permission set and number of steps; [NEXT] and
 * [REQUIRES] read as one flow arrow, alternatives and related guides as
 * dashed lines.
 */
export function journeyD2(catalog) {
  if (!catalog.journey.length) return undefined;
  const { language } = catalog;
  const quote = (value) => `"${String(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"").replace(/\r?\n/gu, "\\n")}"`;
  const linked = new Set(catalog.journey.flatMap(({ from, to }) => [from, to]));
  const lines = [
    "direction: right",
    "classes: {",
    "  use-case: { style: { fill: \"#f6f8fa\"; stroke: \"#c9d1d9\"; border-radius: 12; font-color: \"#1b1f24\"; font-size: 18 } }",
    "  scenario: { style: { fill: \"#eef4fd\"; stroke: \"#0b62d6\"; stroke-width: 2; border-radius: 10; font-color: \"#1b1f24\"; font-size: 15 } }",
    "  flow: { style: { stroke: \"#0b62d6\"; stroke-width: 2 } }",
    "  alternative: { style: { stroke: \"#e09400\"; stroke-width: 2; stroke-dash: 5; font-color: \"#8a5a00\" } }",
    "  related: { style: { stroke: \"#9aa4b0\"; stroke-dash: 3; font-color: \"#5b6470\" } }",
    "}",
    ""
  ];
  const owner = new Map();
  for (const useCase of catalog.useCases) {
    const members = [...useCase.main, ...useCase.alternatives].filter(({ id }) => linked.has(id) && !owner.has(id));
    if (!members.length) continue;
    lines.push(`${quote(useCase.id)}: ${quote(useCase.title)} {`, "  class: use-case");
    for (const task of members) {
      owner.set(task.id, useCase.id);
      const count = clickCount(task);
      const details = [
        task.permissions.join(", ") || label(language, "process.user"),
        count === 1 ? label(language, "process.step") : label(language, "process.steps", { count: String(count) })
      ].join(" · ");
      lines.push(`  ${quote(task.id)}: ${quote(`${task.title}\n${details}`)} { class: scenario }`);
    }
    lines.push("}", "");
  }
  const ref = (id) => (owner.has(id) ? `${quote(owner.get(id))}.${quote(id)}` : quote(id));
  const seen = new Set();
  const edge = (from, to, kind, text) => {
    const key = kind === "flow" ? `${from}\u0000${to}` : [from, to].sort().join("\u0000");
    if (seen.has(`${kind}\u0000${key}`)) return;
    seen.add(`${kind}\u0000${key}`);
    const arrow = kind === "flow" ? "->" : "--";
    lines.push(`${ref(from)} ${arrow} ${ref(to)}${text ? `: ${quote(text)}` : ""} { class: ${kind} }`);
  };
  for (const { from, to, kind } of catalog.journey) {
    if (kind === "next") edge(from, to, "flow");
    else if (kind === "requires") edge(to, from, "flow");
    else if (kind === "alternative") edge(from, to, "alternative", label(language, "journey.alternative"));
    else edge(from, to, "related", label(language, "journey.related"));
  }
  return `${lines.join("\n")}\n`;
}
