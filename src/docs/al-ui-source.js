// Parses AL UI-test procedures into deterministic documentation data.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Language, Parser } from "web-tree-sitter";
import {
  canonicalTag,
  DOCUMENTATION_TAGS,
  isDocumentId,
  PREREQUISITE_TYPES,
  RELATION_TAGS
} from "./tags.js";
import { humanizeIdentifier, inlineStep, operationStep } from "./steps.js";
import { markdown } from "./render/format.js";

const AL_TEST_PATTERN = /\[Test\](?:\s*\[[^\]]+\])*\s*procedure\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/giu;
const TEST_PAGE_PATTERN =
  /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*TestPage\s+(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))\s*;/gimu;
const UI_OPERATION_PATTERN =
  /^\s*([A-Za-z_][A-Za-z0-9_]*(?:\.(?:[A-Za-z_][A-Za-z0-9_]*|"[^"\n]+"))*)\.(OpenNew|OpenEdit|OpenView|Close|New|Invoke|SetValue|GoToRecord)\((.*?)\);\s*$/gimu;
const UI_OPERATION_DETECTOR =
  /\.(?:OpenNew|OpenEdit|OpenView|Close|New|Invoke|SetValue|GoToRecord)\s*\(/iu;
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

function slug(value) {
  return value
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1-$2")
    .replace(/([a-z0-9])([A-Z])/gu, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
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

function taggedEntries(source) {
  const entries = [];
  let current = [];
  for (const line of source.split(/\r?\n/u)) {
    const comment = line.match(/^\s*\/\/\s?(.*)$/u);
    if (!comment) {
      current = [];
      continue;
    }
    const tagged = comment[1].match(
      /^\[([A-Z-]+)\](?:\/\[([A-Z-]+)\])?(?:\s+\[([A-Z-]+)\])?\s*(.*)$/u
    );
    if (tagged) {
      current = [tagged[1], tagged[2]].filter(Boolean).map((tag) => {
        const entry = { tag, qualifier: tagged[3], text: tagged[4].trim() };
        entries.push(entry);
        return entry;
      });
      continue;
    }
    if (!current.length || !comment[1].trim()) continue;
    for (const entry of current) {
      entry.text = `${entry.text} ${comment[1].trim()}`;
    }
  }
  return entries;
}

function taggedComments(entries) {
  const tags = new Map();
  for (const entry of entries) {
    const tag = canonicalTag(entry.tag) ?? entry.tag;
    const items = tags.get(tag) ?? [];
    items.push(entry.text);
    tags.set(tag, items);
  }
  return tags;
}

function commentValues(comments, tag) {
  return (comments.get(tag) ?? []).map((item) => item.trim()).filter(Boolean);
}

function uniqueValues(values) {
  return [...new Set(values)];
}

function parsedLinks(comments) {
  return Object.fromEntries(
    Object.entries(RELATION_TAGS).map(([tag, relation]) => [
      relation,
      uniqueValues(commentValues(comments, tag))
    ])
  );
}

function parsedPrerequisites(entries) {
  return entries
    .filter(({ tag }) => canonicalTag(tag) === "GIVEN")
    .map(({ qualifier, text }) => ({
      type: PREREQUISITE_TYPES[qualifier] ?? "general",
      text
    }))
    .filter(({ text }) => text);
}

function tagDiagnostics(entries) {
  const diagnostics = [];
  for (const entry of entries) {
    const tag = canonicalTag(entry.tag);
    if (!tag && !PREREQUISITE_TYPES[entry.tag]) {
      diagnostics.push({
        severity: "warning",
        code: "unknown-documentation-tag",
        message: `Unknown documentation tag [${entry.tag}]`
      });
    } else if (
      entry.qualifier &&
      !DOCUMENTATION_TAGS[tag]?.qualifiers?.includes(entry.qualifier)
    ) {
      diagnostics.push({
        severity: "warning",
        code: "unknown-prerequisite-type",
        message: `Unsupported [${entry.qualifier}] qualifier for [${entry.tag}]`
      });
    }
  }
  return diagnostics;
}

function documentIdentity(comments, procedure, diagnostics) {
  const values = commentValues(comments, "DOC-ID");
  if (values.length > 1) {
    diagnostics.push({
      severity: "error",
      code: "duplicate-document-id-tag",
      message: `${procedure} has more than one [DOC-ID] tag`
    });
  }
  const explicit = values[0];
  if (explicit && !isDocumentId(explicit)) {
    diagnostics.push({
      severity: "error",
      code: "invalid-document-id",
      message: `Invalid document ID "${explicit}"; use lowercase kebab case`
    });
  }
  return {
    id: explicit || slug(procedure),
    idSource: explicit ? "explicit" : "procedure"
  };
}

export function singular(value) {
  if (/ies$/iu.test(value)) return value.replace(/ies$/iu, "y");
  if (/sses$/iu.test(value)) return value.replace(/es$/iu, "");
  if (/s$/iu.test(value) && !/ss$/iu.test(value)) return value.slice(0, -1);
  return value;
}

function exampleValue(argument) {
  const value = argument.trim();
  const alString = value.match(/^'(.*)'$/u);
  if (alString) return { kind: "text", value: alString[1].replaceAll("''", "'") };
  if (/^(true|false)$/iu.test(value)) {
    return { kind: "boolean", value: value.toLowerCase() === "true" };
  }
  const enumValue = value.match(/::("[^"]+"|[A-Za-z_][A-Za-z0-9_]*)$/u);
  if (enumValue) return { kind: "choice", value: humanizeIdentifier(enumValue[1]) };
  if (/^-?\d+(?:\.\d+)?$/u.test(value)) return { kind: "text", value };
  return { kind: "variable", value: humanizeIdentifier(value) };
}

function collectTestPages(source, initial = new Map()) {
  const testPages = new Map(initial);
  for (const match of source.matchAll(TEST_PAGE_PATTERN)) {
    testPages.set(match[1], {
      name: match[2] ?? match[3],
      label: match[2] ?? humanizeIdentifier(match[3])
    });
  }
  return testPages;
}

// Converts one TestPage call into a structured, language-neutral operation.
function operationFor(match, page) {
  // Quoted members such as "Sell-to Customer No." may contain dots.
  const parts = match[1].match(/"[^"]+"|[^.]+/gu).map((part) => part.replace(/^"|"$/gu, ""));
  parts.shift();
  const operation = match[2];
  const mode = { OpenNew: "new", OpenEdit: "edit", OpenView: "view" }[operation];
  if (mode) return { kind: "open", mode, page, creationTarget: mode === "new" ? singular(page.label) : undefined };
  if (operation === "GoToRecord") return { kind: "go-to-record", page, record: humanizeIdentifier(match[3]) };
  if (operation === "Close") return { kind: "close", page };
  if (operation === "New") return { kind: "new-line", page, sections: parts };
  const member = parts.pop();
  if (operation === "Invoke") return { kind: "invoke", page, sections: parts, member };
  if (operation === "SetValue") return { kind: "set", page, sections: parts, member, value: exampleValue(match[3]) };
  return undefined;
}

function repeatRanges(source) {
  return [...source.matchAll(/\brepeat\b[\s\S]*?\buntil\b[^;]*;/giu)]
    .map((match) => ({
      start: match.index,
      end: match.index + match[0].length
    }));
}

function isConditionalOperation(source, range, operationIndex) {
  const prefix = source.slice(range.start, operationIndex);
  const boundary = Math.max(prefix.lastIndexOf(";"), prefix.lastIndexOf("repeat"));
  return /\bif\b[\s\S]*\bthen\s*$/iu.test(prefix.slice(boundary + 1));
}

function repeatedOperation(source, range, operations) {
  const record = operations.find(({ op }) => op.record)?.op.record ?? "record";
  return {
    kind: "repeat",
    record,
    steps: operations.map(({ op, index }) => ({ ...op, conditional: isConditionalOperation(source, range, index) }))
  };
}

const ENGLISH = { language: "en-US" };

function legacyStep(op) {
  return markdown(inlineStep(operationStep(op, ENGLISH), ENGLISH.language));
}

function deriveGuidance(source, knownTestPages = new Map()) {
  const testPages = collectTestPages(source, knownTestPages);
  const creationTargets = new Set();
  const found = [];
  for (const match of source.matchAll(UI_OPERATION_PATTERN)) {
    const page = testPages.get(match[1].split(".")[0]);
    if (!page) continue;
    const op = operationFor(match, page);
    if (!op) continue;
    if (op.creationTarget) creationTargets.add(op.creationTarget);
    found.push({ index: match.index, op });
  }

  const operations = [];
  const ranges = repeatRanges(source);
  const emittedRanges = new Set();
  for (const item of found) {
    const range = ranges.find(({ start, end }) => item.index >= start && item.index < end);
    if (!range) {
      operations.push(item.op);
      continue;
    }
    if (emittedRanges.has(range)) continue;
    emittedRanges.add(range);
    operations.push(repeatedOperation(
      source,
      range,
      found.filter(({ index }) => index >= range.start && index < range.end)
    ));
  }

  const creationTarget = creationTargets.size === 1
    ? creationTargets.values().next().value
    : undefined;
  const hasExamples = found.some(({ op }) => op.kind === "set" && ["text", "choice"].includes(op.value.kind));
  return {
    operations,
    steps: operations.map(legacyStep),
    hasExamples,
    creationTarget,
    title: creationTarget ? `Create a new ${creationTarget}` : undefined,
    goal: creationTarget ? `Create a new ${creationTarget}.` : undefined
  };
}

async function procedureSources(source) {
  const language = await getLanguage();
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(source);
  const procedures = new Map();
  const visit = (node) => {
    if (node.type === "procedure") {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        const name = source.slice(nameNode.startIndex, nameNode.endIndex).toLowerCase();
        procedures.set(name, source.slice(node.startIndex, node.endIndex));
      }
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(tree.rootNode);
  return procedures;
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
      source: source.slice(afterMarker, end),
      results,
      index
    };
  });
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

  const remainder = source.slice(selected.index);
  const boundary = remainder.slice(selected[0].length)
    .search(/\n {4}(?=#(?:end)?region\b|\[[A-Za-z])/u);
  const end = boundary < 0
    ? source.length
    : selected.index + selected[0].length + boundary;
  const sourceText = source.slice(selected.index, end).trim().replace(/\n\s*\}\s*$/u, "");
  const entries = taggedEntries(sourceText);
  const comments = taggedComments(entries);
  const diagnostics = tagDiagnostics(entries);
  const scenarios = commentValues(comments, "SCENARIO");
  if (!scenarios.length) {
    throw new Error(`${selected[1]} must have a // [SCENARIO] comment`);
  }

  const goal = scenarios.join(" ").trim();
  const expected = commentValues(comments, "THEN");
  const procedures = await procedureSources(source);
  const expanded = expandUiHelpers(sourceText, procedures);
  const testPages = collectTestPages(expanded.source);
  const guidance = deriveGuidance(expanded.source, testPages);
  const guideSections = whenBlocks(sourceText).map((section) => {
    const sectionExpansion = expandUiHelpers(section.source, procedures);
    const derived = deriveGuidance(sectionExpansion.source, testPages);
    return {
      title: section.title,
      steps: derived.steps,
      operations: derived.operations,
      results: section.results,
      expandedHelpers: sectionExpansion.expanded
    };
  });
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
    features: commentValues(comments, "FEATURE"),
    links: parsedLinks(comments),
    metadata: entries.map(({ tag, qualifier, text }) => ({
      tag: canonicalTag(tag) ?? tag,
      qualifier,
      value: text
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

export async function loadAlUiTests(filename) {
  const absolutePath = path.resolve(filename);
  const content = await fs.readFile(absolutePath, "utf8");
  if (!collectTestPages(content).size) return [];
  const procedures = [...content.matchAll(AL_TEST_PATTERN)].map((match) => match[1]);
  const scenarios = [];
  for (const procedure of procedures) {
    try {
      const value = await parseAlUiTest(content, absolutePath, procedure);
      scenarios.push({
        path: absolutePath,
        relativePath: portablePath(path.relative(process.cwd(), absolutePath)),
        reference: sourceReference(absolutePath, value.procedure),
        fileHash: createHash("sha256").update(content).digest("hex"),
        value
      });
    } catch (error) {
      if (!/must have a \/\/ \[SCENARIO\] comment/u.test(error.message)) throw error;
    }
  }
  return scenarios;
}

export function generatedDocumentationPath(value, outputDirectory = "docs/generated") {
  return path.resolve(outputDirectory, `${value.id}.md`);
}
