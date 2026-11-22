// Parses AL UI-test procedures into deterministic documentation data: the
// structure of a file (tree-sitter), its [Test] procedures, the UI helpers
// they call, their [WHEN] phases and handlers. The tags are read by
// al-tags.js, the TestPage statements by al-ui-operations.js.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Language, Parser } from "web-tree-sitter";
import {
  commentValues,
  documentIdentity,
  parsedLinks,
  parsedPrerequisites,
  tagDiagnostics,
  taggedComments,
  taggedEntries,
  uniqueValues
} from "./al-tags.js";
import { collectTestPages, deriveGuidance, legacyStep, TEST_PAGE_PATTERN, UI_OPERATION_DETECTOR } from "./al-ui-operations.js";
import { canonicalTag, RUNBOOK_TAGS } from "./tags.js";

const AL_TEST_PATTERN = /\[Test\](?:\s*\[[^\]]+\])*\s*procedure\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/giu;
const GRAMMAR_PATH = fileURLToPath(
  new URL("../../vendor/tree-sitter-al.wasm", import.meta.url)
);
let languagePromise;

async function getLanguage() {
  if (!languagePromise) {
    languagePromise = (async () => {
      await Parser.init();
      return Language.load(GRAMMAR_PATH);
    })();
  }
  return languagePromise;
}

function portablePath(filename) {
  return filename.replaceAll("\\", "/");
}


function sourceReference(filename, procedure) {
  const relativePath = portablePath(path.relative(process.cwd(), filename));
  return `${relativePath}#${procedure}`;
}

function splitReference(reference, procedure) {
  if (procedure) return { filename: reference, procedure };
  const separator = reference.lastIndexOf("#");
  if (separator > 0 && reference.slice(0, separator).toLowerCase().endsWith(".al")) {
    return {
      filename: reference.slice(0, separator),
      procedure: reference.slice(separator + 1)
    };
  }
  return { filename: reference, procedure: undefined };
}


// Parsing a file once serves all of its tests.
const structures = new Map();

/**
 * The procedures of an AL file with their exact ranges and attributes
 * ([Test], [ModalPageHandler], ...), and the codeunit's OnRun trigger, where
 * Microsoft's tests keep the [FEATURE] of the whole codeunit.
 */
async function fileStructure(source) {
  if (structures.has(source)) return structures.get(source);
  const language = await getLanguage();
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(source);
  const procedures = new Map();
  const ranges = new Map();
  const attributes = new Map();
  let onRun = "";
  const visit = (node) => {
    if (node.type === "procedure") {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        const name = source.slice(nameNode.startIndex, nameNode.endIndex).toLowerCase();
        procedures.set(name, source.slice(node.startIndex, node.endIndex));
        ranges.set(name, { start: node.startIndex, end: node.endIndex });
        const names = [];
        for (let sibling = node.previousNamedSibling; sibling?.type === "attribute_item"; sibling = sibling.previousNamedSibling) {
          names.unshift(source.slice(sibling.startIndex, sibling.endIndex));
        }
        attributes.set(name, names);
      }
    }
    if (node.type === "trigger_declaration" && /^trigger\s+OnRun\b/iu.test(source.slice(node.startIndex, node.endIndex))) {
      onRun = source.slice(node.startIndex, node.endIndex);
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(tree.rootNode);
  const structure = { procedures, ranges, attributes, onRun };
  if (structures.size > 16) structures.delete(structures.keys().next().value);
  structures.set(source, structure);
  return structure;
}

function bareProcedureCalls(source) {
  return [...source.matchAll(
    /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\([^;]*\);\s*$/gimu
  )];
}

function helperContainsUi(name, procedures, visiting = new Set(), depth = 0) {
  if (depth >= 8 || visiting.has(name)) return false;
  const source = procedures.get(name);
  if (!source) return false;
  if (UI_OPERATION_DETECTOR.test(source)) return true;
  const next = new Set(visiting).add(name);
  return bareProcedureCalls(source).some((match) =>
    helperContainsUi(match[1].toLowerCase(), procedures, next, depth + 1)
  );
}

function expandUiHelpers(source, procedures, visiting = new Set(), depth = 0) {
  if (depth >= 8) return { source, expanded: [] };
  const expanded = [];
  const value = source.replace(
    /^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*\([^;]*\);\s*$/gimu,
    (statement, indentation, rawName) => {
      const name = rawName.toLowerCase();
      if (
        visiting.has(name) ||
        !procedures.has(name) ||
        !helperContainsUi(name, procedures)
      ) return statement;
      const nested = expandUiHelpers(
        procedures.get(name),
        procedures,
        new Set(visiting).add(name),
        depth + 1
      );
      expanded.push(rawName, ...nested.expanded);
      return nested.source
        .split(/\r?\n/u)
        .map((line) => `${indentation}${line}`)
        .join("\n");
    }
  );
  return { source: value, expanded: [...new Set(expanded)] };
}

function whenBlocks(source) {
  const markers = [...source.matchAll(
    /^\s*\/\/\s*\[WHEN\](?:\/\[THEN\])?\s*(.*)$/gimu
  )].filter((match) => match[1].trim());
  return markers.map((marker, index) => {
    const afterMarker = marker.index + marker[0].length;
    const nextMarker = source.slice(afterMarker).search(
      /^\s*\/\/\s*\[(?:WHEN|THEN)\](?:\/\[[A-Z]+\])?/gimu
    );
    const end = nextMarker < 0 ? source.length : afterMarker + nextMarker;
    const nextWhen = markers[index + 1]?.index ?? source.length;
    const results = taggedEntries(source.slice(end, nextWhen))
      .filter(({ tag }) => canonicalTag(tag) === "THEN")
      .map(({ text }) => text.trim())
      .filter(Boolean);
    return {
      title: marker[1].trim(),
      start: afterMarker,
      source: source.slice(afterMarker, end),
      results,
      index
    };
  });
}

// Operations after which Business Central can open a dialog, most likely first:
// actions, then entering values, then opening and closing pages.
const TRIGGERS = [
  new Set(["invoke", "button", "lookup", "drilldown", "assist-edit"]),
  new Set(["set", "new-line"]),
  new Set(["open", "close"])
];

/**
 * Pages and confirmations the test answers in handler procedures
 * ([HandlerFunctions('...')]) become steps: "When the X page opens, ...".
 */
function handlerOperations(attributes, structure) {
  const declared = attributes.map((item) => item.match(/^\[\s*HandlerFunctions\s*\(\s*'([^']*)'/iu)?.[1]).filter(Boolean)
    .flatMap((list) => list.split(",").map((name) => name.trim().toLowerCase()).filter(Boolean));
  const operations = [];
  for (const name of declared) {
    const source = structure.procedures.get(name);
    if (!source) continue;
    const kinds = (structure.attributes.get(name) ?? []).join(" ");
    if (/\[\s*ConfirmHandler\b/iu.test(kinds)) {
      const reply = source.match(/\bReply\s*:=\s*(true|false)\s*;/iu)?.[1]?.toLowerCase();
      operations.push({ kind: "confirm", answer: reply === "true" ? "yes" : reply === "false" ? "no" : undefined });
      continue;
    }
    if (!/\[\s*(?:ModalPageHandler|PageHandler|RequestPageHandler)\b/iu.test(kinds)) continue;
    const pages = collectTestPages(source);
    const page = pages.values().next().value;
    if (!page) continue;
    const steps = deriveGuidance(source, pages).operations;
    if (steps.length) operations.push({ kind: "dialog", page, steps });
  }
  return operations;
}

/**
 * Inserts handler steps where a dialog most likely appears: before a page
 * that code opens (posting asks first, then shows the posted document),
 * after an action that opens a page, else after the first action (or the
 * first entry, or the first page opened) that can open a dialog.
 */
function placeHandlers(sections, operations, handlers) {
  if (!handlers.length) return;
  const lists = [...sections.map(({ operations: items }) => items), operations];
  for (const list of lists) {
    const opened = list.findIndex((op) => op.kind === "opened");
    if (opened >= 0) return void list.splice(opened, 0, ...handlers);
    const opener = list.findIndex((op) => op.opens);
    if (opener >= 0) return void list.splice(opener + 1, 0, ...handlers);
  }
  for (const kinds of TRIGGERS) {
    for (const list of lists) {
      const index = list.findIndex((op) => kinds.has(op.kind));
      if (index >= 0) return void list.splice(index + 1, 0, ...handlers);
    }
  }
}

function guidePrerequisites(items, creationTarget) {
  return items.map((item) => {
    if (creationTarget && /^No .+ exists yet\.$/iu.test(item)) {
      return `Make sure the ${creationTarget} you want to create does not already exist.`;
    }
    return item;
  });
}

function guideExpectedResults(items, creationTarget) {
  return items.map((item) => {
    if (creationTarget && /^The .+ persisted with the values entered in the list\.$/iu.test(item)) {
      return `The ${creationTarget} is saved with the values you entered.`;
    }
    return item;
  });
}

// What the OnRun trigger can say for every test of the codeunit.
const CODEUNIT_TAGS = new Set(["FEATURE", "JOURNEY", "ROLE"]);

export async function parseAlUiTest(source, filename, requestedProcedure) {
  const tests = [...source.matchAll(AL_TEST_PATTERN)];
  if (!tests.length) throw new Error(`${path.basename(filename)} contains no [Test] procedures`);

  const available = tests.map((match) => match[1]);
  const selected = requestedProcedure
    ? tests.find((match) => match[1].toLowerCase() === requestedProcedure.toLowerCase())
    : tests.length === 1 ? tests[0] : undefined;
  if (!selected) {
    if (requestedProcedure) {
      throw new Error(
        `${path.basename(filename)} has no [Test] procedure ${requestedProcedure}; available: ${available.join(", ")}`
      );
    }
    throw new Error(
      `${path.basename(filename)} contains multiple [Test] procedures; select one with --procedure: ${available.join(", ")}`
    );
  }

  // The test ends where its procedure ends, so helpers after it never leak in.
  const structure = await fileStructure(source);
  const parsedRange = structure.ranges.get(selected[1].toLowerCase());
  let end;
  if (parsedRange && parsedRange.end > selected.index) end = parsedRange.end;
  else {
    const remainder = source.slice(selected.index);
    const boundary = remainder.slice(selected[0].length)
      .search(/\n {4}(?=#(?:end)?region\b|\[[A-Za-z]|(?:local\s+|internal\s+)?procedure\b)/u);
    end = boundary < 0 ? source.length : selected.index + selected[0].length + boundary;
  }
  const sourceText = source.slice(selected.index, end).trim().replace(/\n\s*\}\s*$/u, "");
  // Tags of the whole codeunit (its OnRun trigger) come first.
  const codeunitEntries = taggedEntries(structure.onRun).filter(({ tag }) => CODEUNIT_TAGS.has(canonicalTag(tag)));
  const entries = [...codeunitEntries, ...taggedEntries(sourceText)];
  const comments = taggedComments(entries);
  const diagnostics = tagDiagnostics(entries);
  const scenarios = commentValues(comments, "SCENARIO");
  if (!scenarios.length) {
    throw new Error(`${selected[1]} must have a // [SCENARIO] comment`);
  }

  const goal = scenarios.join(" ").trim();
  const expected = commentValues(comments, "THEN");
  const procedures = structure.procedures;
  const expanded = expandUiHelpers(sourceText, procedures);
  const testPages = collectTestPages(expanded.source);
  const guidance = deriveGuidance(expanded.source, testPages);
  const guideSections = whenBlocks(sourceText).map((section) => {
    const sectionExpansion = expandUiHelpers(section.source, procedures);
    // A page trapped in [GIVEN] (or an earlier phase) is opened by an action in this one.
    const before = deriveGuidance(expandUiHelpers(sourceText.slice(0, section.start), procedures).source, testPages);
    const derived = deriveGuidance(sectionExpansion.source, testPages, { trapped: before.trapped });
    return {
      title: section.title,
      steps: derived.steps,
      operations: derived.operations,
      results: section.results,
      expandedHelpers: sectionExpansion.expanded
    };
  });
  const handlers = handlerOperations(structure.attributes.get(selected[1].toLowerCase()) ?? [], structure);
  if (handlers.length) {
    placeHandlers(guideSections.filter(({ operations }) => operations.length), guidance.operations, handlers);
    for (const section of guideSections) section.steps = section.operations.map(legacyStep);
    guidance.steps = guidance.operations.map(legacyStep);
  }
  const prerequisites = commentValues(comments, "GIVEN");
  const permissions = [...new Set([
    ...commentValues(comments, "PERMISSIONS"),
    ...commentValues(comments, "PERMISSION")
  ])];
  const expectedResults = expected.length ? expected : [goal];
  const identity = documentIdentity(comments, selected[1], diagnostics);
  return {
    ...identity,
    title: guidance.title ?? goal.replace(/[.\s]+$/u, ""),
    goal,
    guideGoal: guidance.goal ?? goal,
    guideSteps: guidance.steps,
    guideOperations: guidance.operations,
    creationTarget: guidance.creationTarget,
    guideSections,
    expandedHelpers: expanded.expanded,
    hasExampleValues: guidance.hasExamples,
    permissions,
    prerequisites,
    typedPrerequisites: parsedPrerequisites(entries),
    guidePrerequisites: guidePrerequisites(prerequisites, guidance.creationTarget),
    actions: commentValues(comments, "WHEN"),
    expected: expectedResults,
    guideExpected: guideExpectedResults(expectedResults, guidance.creationTarget),
    features: uniqueValues(commentValues(comments, "FEATURE")),
    journeys: uniqueValues(commentValues(comments, "JOURNEY")),
    roles: uniqueValues(commentValues(comments, "ROLE")),
    runbook: Object.fromEntries(Object.entries(RUNBOOK_TAGS).map(([tag, key]) => [key, commentValues(comments, tag)])),
    references: uniqueValues(entries.map(({ reference }) => reference).filter(Boolean)),
    links: parsedLinks(comments),
    metadata: entries.map(({ tag, qualifier, text, reference }) => ({
      tag: canonicalTag(tag) ?? tag,
      qualifier,
      value: text,
      ...(reference ? { reference } : {})
    })),
    diagnostics,
    procedure: selected[1],
    sourceRange: { start: selected.index, end },
    sourceText,
    sourceHash: createHash("sha256").update(sourceText).digest("hex")
  };
}

export async function loadAlUiTest(reference, options = {}) {
  const selected = splitReference(reference, options.procedure);
  const absolutePath = path.resolve(selected.filename);
  if (path.extname(absolutePath).toLowerCase() !== ".al") {
    throw new Error(`documentation source must be an AL UI-test file: ${absolutePath}`);
  }

  let content;
  try {
    content = await fs.readFile(absolutePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`AL UI-test source not found: ${absolutePath}`);
    throw new Error(`cannot read AL UI-test source ${absolutePath}: ${error.message}`);
  }

  const value = await parseAlUiTest(content, absolutePath, selected.procedure);
  return {
    path: absolutePath,
    relativePath: portablePath(path.relative(process.cwd(), absolutePath)),
    reference: sourceReference(absolutePath, value.procedure),
    fileHash: createHash("sha256").update(content).digest("hex"),
    value
  };
}

function hasUiSteps(value) {
  return value.guideOperations.length > 0 || value.guideSections.some(({ operations }) => operations.length);
}

/** True when the test drives a page: a TestPage of the file or of its own var section. */
function drivesPage(body, testPages) {
  if (new RegExp(TEST_PAGE_PATTERN.source, "iu").test(body)) return true;
  return [...testPages.keys()].some((name) => new RegExp(`\\b${name}\\s*\\.`, "iu").test(body));
}

/**
 * The documented scenarios of one AL file. `skipped` collects [SCENARIO]
 * tests without any UI step; they stay out of the documentation.
 * `undocumented` collects UI tests without a [SCENARIO]: tests that drive a
 * page and have no documentation yet.
 */
export async function loadAlUiTests(filename, skipped = [], undocumented = []) {
  const absolutePath = path.resolve(filename);
  const content = await fs.readFile(absolutePath, "utf8");
  const testPages = collectTestPages(content);
  if (!testPages.size) return [];
  const tests = [...content.matchAll(AL_TEST_PATTERN)];
  const procedures = tests.map((match) => match[1]);
  const scenarios = [];
  for (const [index, procedure] of procedures.entries()) {
    try {
      const value = await parseAlUiTest(content, absolutePath, procedure);
      // A test without UI steps documents nothing a user does, unless its author gave it a [DOC-ID].
      if (!hasUiSteps(value) && value.idSource !== "explicit") {
        skipped.push({ path: absolutePath, procedure: value.procedure });
        continue;
      }
      scenarios.push({
        path: absolutePath,
        relativePath: portablePath(path.relative(process.cwd(), absolutePath)),
        reference: sourceReference(absolutePath, value.procedure),
        fileHash: createHash("sha256").update(content).digest("hex"),
        value
      });
    } catch (error) {
      if (!/must have a \/\/ \[SCENARIO\] comment/u.test(error.message)) throw error;
      const body = content.slice(tests[index].index, tests[index + 1]?.index ?? content.length);
      if (drivesPage(body, testPages)) undocumented.push({ path: absolutePath, procedure });
    }
  }
  return scenarios;
}

export function generatedDocumentationPath(value, outputDirectory = "docs/generated") {
  return path.resolve(outputDirectory, `${value.id}.md`);
}
