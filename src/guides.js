// The user guides of a project, joined with its source: which page each
// documented AL UI test (src/docs) opens and which of its actions it uses,
// which UI tests have no documentation yet, and which pages no guide covers.
// The view (src/app/atlas.js), `bca check`, `bca layers`, and the MCP tools
// read the guides from here.
import path from "node:path";
import { findGitRoot } from "./git.js";
import { findUiTests, loadCorpus } from "./docs/model.js";
import { titleFor } from "./docs/task.js";
import { normalizeIdentifier } from "./resolver.js";

// Pages that are parts of other pages or serve no user: a guide opens their host.
const NOT_FOR_USERS = new Set(["listpart", "cardpart", "api", "navigatepage", "headlinepart", "promptdialog", "rolecenter"]);

const posix = (file) => file.replaceAll("\\", "/");

/**
 * The documented UI tests of a project: from `docs.tests` of .bca.json, or
 * the folder with the most scenarios.
 * @param options the merged options of a project (projectRoot, docs)
 * @returns { path, corpus } or undefined when the project has none
 */
export async function loadGuideCorpus(options) {
  const root = options.projectRoot;
  let relative = options.docs?.tests;
  if (!relative) {
    const found = await findUiTests(root, await findGitRoot(root)).catch(() => undefined);
    if (!found?.scenarios) return undefined;
    relative = found.path;
  }
  const corpus = await loadCorpus(path.resolve(root, relative)).catch(() => undefined);
  if (!corpus?.scenarios.length && !corpus?.undocumented.length) return undefined;
  return { path: relative, corpus };
}

/** True for a page a user opens: not a part, an API, or a role center. */
export function isUserPage(object) {
  return object.type === "page" && !object.externalSymbol && !object.boundaryCategory
    && !NOT_FOR_USERS.has(String(object.metadata?.pageType ?? "").toLowerCase())
    && !/^test/iu.test(object.metadata?.subtype ?? "");
}

/**
 * Joins the guides with the model: every scenario with the page objects its
 * steps use, the UI tests without documentation, and the pages no guide covers.
 * @param model the model of a project (src/project.js)
 * @param found what loadGuideCorpus returned
 * @param options the merged options (projectRoot)
 * @returns { path, guides: [{ id, title, goal, features, journeys, roles, permissions, runbook, file, line, procedure, pages: [{ key, steps, actions }] }], undocumented: [{ file, line, procedure }], uncovered: [page key] }
 */
export function linkGuides(model, found, options) {
  if (!found) return undefined;
  const { corpus } = found;
  const root = options.projectRoot;
  const relative = (file) => posix(path.relative(root, file));
  // A TestPage names the page as its object does; prefer the page of the workspace.
  const pages = new Map();
  for (const object of model.objects.filter(({ type }) => type === "page")) {
    const name = normalizeIdentifier(object.name);
    if (!pages.has(name) || (pages.get(name).externalSymbol && !object.externalSymbol)) pages.set(name, object);
  }
  const guides = corpus.scenarios.map(({ path: file, value }) => {
    const used = new Map();
    // The [WHEN] phases hold the steps of the guide; without phases, the whole test does.
    const phases = (value.guideSections ?? []).flatMap(({ operations: items }) => items ?? []);
    const operations = phases.length ? phases : value.guideOperations ?? [];
    for (const operation of operations) {
      const object = operation.page?.name && pages.get(normalizeIdentifier(operation.page.name));
      if (!object) continue;
      const entry = used.get(object.key) ?? used.set(object.key, { key: object.key, steps: 0, actions: new Set() }).get(object.key);
      entry.steps++;
      if (operation.kind === "invoke" && !operation.sections?.length) entry.actions.add(operation.member);
    }
    return {
      id: value.id,
      title: titleFor(value, { language: "en-US" }).title,
      goal: value.goal,
      features: value.features ?? [],
      journeys: value.journeys ?? [],
      roles: value.roles ?? [],
      permissions: value.permissions ?? [],
      runbook: value.runbook,
      requires: value.links?.requires ?? [],
      next: value.links?.next ?? [],
      file: relative(file),
      line: value.line,
      procedure: value.procedure,
      pages: [...used.values()].map((entry) => ({ ...entry, actions: [...entry.actions].sort() }))
    };
  });
  const covered = new Set(guides.flatMap(({ pages: used }) => used.map(({ key }) => key)));
  return {
    path: found.path,
    guides,
    undocumented: corpus.undocumented.map(({ path: file, line, procedure }) => ({ file: relative(file), line, procedure })),
    uncovered: model.objects.filter(isUserPage).map(({ key }) => key).filter((key) => !covered.has(key)).sort()
  };
}

/** The guides that use a page object, by its key. */
export function guidesByPage(linked) {
  const byPage = new Map();
  for (const guide of linked?.guides ?? []) {
    for (const { key } of guide.pages) (byPage.get(key) ?? byPage.set(key, []).get(key)).push(guide);
  }
  return byPage;
}
