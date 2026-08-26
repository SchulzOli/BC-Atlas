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

const AL_TEST_PATTERN = /\[Test\](?:\s*\[[^\]]+\])*\s*procedure\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/giu;
const TEST_PAGE_PATTERN =
  /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*TestPage\s+(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))\s*;/gimu;
const UI_OPERATION_PATTERN =
  /^\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\.(OpenNew|OpenEdit|OpenView|Close|New|Invoke|SetValue|GoToRecord)\((.*?)\);\s*$/gimu;
const UI_OPERATION_DETECTOR =
  /\.(?:OpenNew|OpenEdit|OpenView|Close|New|Invoke|SetValue|GoToRecord)\s*\(/iu;
const BC_ATLAS_ATTRIBUTES = new Set(["role", "process", "stage", "owner", "type"]);
const BC_ATLAS_VALUE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const BC_ATLAS_STAGES = new Set(["setup", "execute", "monitor", "recover"]);
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

function xmlDocumentationBefore(source, index) {
  const lines = source.slice(0, index).split(/\r?\n/u);
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  const documentation = [];
  while (lines.length) {
    const match = lines.at(-1).match(/^\s*\/\/\/\s?(.*)$/u);
    if (!match) break;
    documentation.push(match[1]);
    lines.pop();
  }
  return documentation.reverse().join("\n");
}

function parseBcAtlasXml(documentation, location) {
  const diagnostics = [];
  if (!documentation.includes("<bc-atlas")) {
    return { attributes: {}, requires: [], diagnostics };
  }
  const element = documentation.match(
    /<bc-atlas\b([^>]*?)(?:\/>|>([\s\S]*?)<\/bc-atlas\s*>)/iu
  );
  if (!element) {
    diagnostics.push({
      severity: "error",
      code: "invalid-bc-atlas-xml",
      message: `Malformed <bc-atlas> XML documentation on ${location}`
    });
    return { attributes: {}, requires: [], diagnostics };
  }

  const attributes = {};
  const seen = new Set();
  for (const match of element[1].matchAll(/([A-Za-z][A-Za-z0-9-]*)\s*=\s*"([^"]*)"/gu)) {
    const name = match[1].toLowerCase();
    const value = match[2].trim();
    if (seen.has(name)) {
      diagnostics.push({
        severity: "error",
        code: "duplicate-bc-atlas-attribute",
        message: `Duplicate ${name} attribute on ${location}`
      });
      continue;
    }
    seen.add(name);
    if (!BC_ATLAS_ATTRIBUTES.has(name)) {
      diagnostics.push({
        severity: "error",
        code: "unsupported-bc-atlas-attribute",
        message: `Unsupported <bc-atlas> attribute "${name}" on ${location}`
      });
      continue;
    }
    if (!BC_ATLAS_VALUE_PATTERN.test(value) || (name === "stage" && !BC_ATLAS_STAGES.has(value))) {
      diagnostics.push({
        severity: "error",
        code: `invalid-bc-atlas-${name}`,
        message: `Invalid ${name} value "${value}" on ${location}`
      });
      continue;
    }
    attributes[name] = value;
  }

  const requires = [];
  for (const match of (element[2] ?? "").matchAll(
    /<requires\s+document\s*=\s*"([^"]*)"\s*\/>/giu
  )) {
    const target = match[1].trim();
    if (!target) {
      diagnostics.push({
        severity: "error",
        code: "invalid-bc-atlas-requires",
        message: `Empty <requires> document reference on ${location}`
      });
    } else {
      requires.push(target);
    }
  }
  return { attributes, requires: uniqueValues(requires), diagnostics };
}

function xmlMetadata(source, selected) {
  const codeunit = source.match(/^\s*codeunit\s+\d+\s+(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)/imu);
  const inherited = parseBcAtlasXml(
    codeunit ? xmlDocumentationBefore(source, codeunit.index) : "",
    "test codeunit"
  );
  const procedure = parseBcAtlasXml(
    xmlDocumentationBefore(source, selected.index),
    `procedure ${selected[1]}`
  );
  return {
    attributes: { ...inherited.attributes, ...procedure.attributes },
    requires: procedure.requires,
    diagnostics: [...inherited.diagnostics, ...procedure.diagnostics]
  };
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

function humanizeIdentifier(value) {
  return value
    .replace(/^"|"$/gu, "")
    .replaceAll("_", " ")
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/\s+/gu, " ")
    .trim();
}

function singular(value) {
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

function contextPrefix(parts) {
  if (!parts.length) return "";
  return `In the **${parts.map(humanizeIdentifier).join(" / ")}** section, `;
}

function contextual(parts, instruction) {
  const prefix = contextPrefix(parts);
  if (prefix) return `${prefix}${instruction}`;
  return instruction.replace(/^[a-z]/u, (letter) => letter.toUpperCase());
}

function collectTestPages(source, initial = new Map()) {
  const testPages = new Map(initial);
  for (const match of source.matchAll(TEST_PAGE_PATTERN)) {
    testPages.set(match[1], match[2] ?? humanizeIdentifier(match[3]));
  }
  return testPages;
}

function operationGuidance(match, page) {
  const parts = match[1].split(".");
  parts.shift();
  const operation = match[2];
  if (operation === "OpenNew") {
    return {
      instruction: `Open **${page}** and create a new record.`,
      creationTarget: singular(page)
    };
  }
  if (operation === "OpenEdit") {
    return { instruction: `Open **${page}** in edit mode.` };
  }
  if (operation === "OpenView") return { instruction: `Open **${page}**.` };
  if (operation === "GoToRecord") {
    return {
      instruction: "Open the record you want to work with.",
      record: humanizeIdentifier(match[3])
    };
  }
  if (operation === "Close") {
    return {
      instruction: `Finish the entry and close **${page}**. Business Central saves the changes.`
    };
  }
  if (operation === "New") {
    return { instruction: contextual(parts, "add a new line.") };
  }
  if (operation === "Invoke") {
    const action = parts.pop();
    return { instruction: contextual(parts, `choose **${humanizeIdentifier(action)}**.`) };
  }
  if (operation === "SetValue") {
    const field = humanizeIdentifier(parts.pop());
    const example = exampleValue(match[3]);
    if (example.kind === "boolean") {
      return {
        instruction: contextual(parts, `turn **${field}** ${example.value ? "on" : "off"}.`)
      };
    }
    if (example.kind === "choice") {
      return {
        instruction: contextual(parts, `in **${field}**, select **${example.value}**.`),
        hasExample: true
      };
    }
    if (example.kind === "text") {
      return {
        instruction: contextual(
          parts,
          `in **${field}**, enter a suitable value (for example, **${example.value}**).`
        ),
        hasExample: true
      };
    }
    return {
      instruction: contextual(parts, `enter the required value in **${field}**.`)
    };
  }
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

function lowerInstruction(value) {
  return value
    .replace(/\.$/u, "")
    .replace(/^[A-Z]/u, (letter) => letter.toLowerCase());
}

function repeatedGuidance(source, range, operations) {
  const record = operations.find(({ detail }) => detail.record)?.detail.record ?? "record";
  const instructions = operations.map(({ detail, index }, itemIndex) => {
    let instruction = lowerInstruction(detail.instruction);
    if (isConditionalOperation(source, range, index)) {
      instruction = `when applicable, ${instruction}`;
    } else if (itemIndex === operations.length - 1 && operations.length > 1) {
      instruction = `then ${instruction}`;
    }
    return instruction;
  });
  return `For each **${record}** record, ${instructions.join("; ")}.`;
}

function deriveGuidance(source, knownTestPages = new Map()) {
  const testPages = collectTestPages(source, knownTestPages);

  const steps = [];
  const creationTargets = new Set();
  let hasExamples = false;
  const operations = [];
  for (const match of source.matchAll(UI_OPERATION_PATTERN)) {
    const root = match[1].split(".")[0];
    const page = testPages.get(root);
    if (!page) continue;
    const detail = operationGuidance(match, page);
    if (!detail) continue;
    if (detail.creationTarget) creationTargets.add(detail.creationTarget);
    if (detail.hasExample) hasExamples = true;
    operations.push({ index: match.index, detail });
  }

  const ranges = repeatRanges(source);
  const emittedRanges = new Set();
  for (const operation of operations) {
    const range = ranges.find(
      ({ start, end }) => operation.index >= start && operation.index < end
    );
    if (!range) {
      steps.push(operation.detail.instruction);
      continue;
    }
    if (emittedRanges.has(range)) continue;
    emittedRanges.add(range);
    steps.push(repeatedGuidance(
      source,
      range,
      operations.filter(({ index }) => index >= range.start && index < range.end)
    ));
  }

  const creationTarget = creationTargets.size === 1
    ? creationTargets.values().next().value
    : undefined;
  return {
    steps,
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
    return {
      title: marker[1].trim(),
      source: source.slice(afterMarker, end),
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
  const xml = xmlMetadata(source, selected);
  diagnostics.push(...xml.diagnostics);
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
    return {
      title: section.title,
      steps: deriveGuidance(sectionExpansion.source, testPages).steps,
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
  const links = parsedLinks(comments);
  links.requires = uniqueValues([...links.requires, ...xml.requires]);
  return {
    ...identity,
    title: guidance.title ?? goal.replace(/[.\s]+$/u, ""),
    goal,
    guideGoal: guidance.goal ?? goal,
    guideSteps: guidance.steps,
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
    links,
    ...xml.attributes,
    xmlRequires: xml.requires,
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
