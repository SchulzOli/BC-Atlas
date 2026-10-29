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
// TestPage variables in var sections and in parameters (handlers get the page as one).
const TEST_PAGE_PATTERN =
  /\b([A-Za-z_][A-Za-z0-9_]*)\s*:\s*Test(?:Request)?Page\s+(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/giu;
// A member in a chain: Field, "Sell-to Customer No.", or a call such as OK().
const MEMBER = String.raw`(?:[A-Za-z_][A-Za-z0-9_]*(?:\(\))?|"[^"\n]+")`;
const UI_METHODS = "OpenNew|OpenEdit|OpenView|Close|New|Invoke|SetValue|GoToRecord|GoToKey|Trap|First|Last|Next|Previous|Lookup|Drilldown|AssistEdit|SetFilter";
// One statement, possibly spread over lines, possibly expected to fail (asserterror).
const UI_OPERATION_PATTERN = new RegExp(
  String.raw`^[ \t]*(asserterror[ \t]+)?([A-Za-z_][A-Za-z0-9_]*(?:\.${MEMBER})*)\.(${UI_METHODS})[ \t]*\(([^;]*?)\)[ \t]*;`,
  "gimu"
);
// Page.Field.Value := 'x' sets a field like SetValue.
const VALUE_ASSIGNMENT_PATTERN = new RegExp(
  String.raw`^[ \t]*(asserterror[ \t]+)?([A-Za-z_][A-Za-z0-9_]*(?:\.${MEMBER})+)\.Value[ \t]*:=[ \t]*([^;]+?)[ \t]*;`,
  "gimu"
);
const UI_OPERATION_DETECTOR = new RegExp(String.raw`\.(?:${UI_METHODS})\s*\(|\.Value\s*:=`, "iu");
// Dialog buttons of a TestPage: Page.OK().Invoke().
const BUTTONS = { ok: "ok", cancel: "cancel", yes: "yes", no: "no", lookupok: "ok", lookupcancel: "cancel" };
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

// [UI] and [UT] in a [FEATURE] list (Microsoft's convention) say what kind
// of test it is, not which feature it documents.
const TEST_KINDS = new Set(["UI", "UT"]);

/**
 * One tag comment: "[SCENARIO 218101] Text" (Microsoft's work item number),
 * "[WHEN]/[THEN] Text", "[GIVEN] [SETUP] Text", "[FEATURE] [Sales] [Invoice]".
 */
export function tagLine(text) {
  const head = text.match(/^\[([A-Z][A-Z-]*)(?:\s+([^\]]*?))?\](?:\/\[([A-Z][A-Z-]*)\])?\s*(.*)$/u);
  if (!head) return undefined;
  let rest = head[4];
  const groups = [];
  for (let match = rest.match(/^\[([^\]]+)\]\s*/u); match; match = rest.match(/^\[([^\]]+)\]\s*/u)) {
    groups.push(match[1].trim());
    rest = rest.slice(match[0].length);
  }
  return { tags: [head[1], head[3]].filter(Boolean), reference: head[2]?.trim() || undefined, groups, text: rest.trim() };
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
    const tagged = tagLine(comment[1].trim());
    if (tagged) {
      current = [];
      for (const tag of tagged.tags) {
        const reference = tagged.reference ? { reference: tagged.reference } : {};
        if (canonicalTag(tag) === "FEATURE" && tagged.groups.length) {
          // Every bracketed name is a feature of its own.
          for (const group of tagged.groups.filter((name) => !TEST_KINDS.has(name.toUpperCase()))) entries.push({ tag, text: group, ...reference });
          if (tagged.text) {
            const entry = { tag, text: tagged.text, ...reference };
            entries.push(entry);
            current.push(entry);
          }
          continue;
        }
        // An uppercase bracket right after the tag qualifies it ([GIVEN] [SETUP]);
        // other brackets are part of the text.
        const qualified = /^[A-Z][A-Z-]*$/u.test(tagged.groups[0] ?? "");
        const prefix = tagged.groups.slice(qualified ? 1 : 0).map((group) => `[${group}]`).join(" ");
        const entry = { tag, qualifier: qualified ? tagged.groups[0] : undefined, text: [prefix, tagged.text].filter(Boolean).join(" "), ...reference };
        entries.push(entry);
        current.push(entry);
      }
      continue;
    }
    if (!current.length || !comment[1].trim()) continue;
    for (const entry of current) {
      entry.text = `${entry.text} ${comment[1].trim()}`.trim();
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

/** The first argument of a call: SetFilter("No.", X) -> "No.". */
function splitArguments(text) {
  const parts = [];
  let depth = 0;
  let quote = "";
  let current = "";
  for (const character of String(text)) {
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === "'" || character === '"') quote = character;
    else if (character === "(") depth++;
    else if (character === ")") depth--;
    else if (character === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

// Converts one TestPage statement into a structured, language-neutral operation.
function operationFor({ chain, method, args, attempt }, page) {
  // Quoted members such as "Sell-to Customer No." may contain dots.
  const parts = chain.match(/"[^"]+"|[^.]+/gu).map((part) => part.replace(/^"|"$/gu, "").replace(/\(\)$/u, ""));
  parts.shift();
  const operation = method.toLowerCase();
  const tried = attempt ? { attempt: true } : {};
  const mode = { opennew: "new", openedit: "edit", openview: "view" }[operation];
  if (mode) return { kind: "open", mode, page, creationTarget: mode === "new" ? singular(page.label) : undefined, ...tried };
  if (operation === "gotorecord" || operation === "gotokey") return { kind: "go-to-record", page, record: humanizeIdentifier(splitArguments(args)[0] ?? ""), ...tried };
  if (operation === "close") return { kind: "close", page, ...tried };
  if (operation === "trap") return { kind: "trap", page };
  if (["first", "last", "next", "previous"].includes(operation)) return parts.length ? undefined : { kind: "navigate", page, direction: operation };
  if (operation === "new") return { kind: "new-line", page, sections: parts, ...tried };
  if (operation === "setfilter") {
    if (parts.at(-1)?.toLowerCase() !== "filter") return undefined;
    const [field, value] = splitArguments(args);
    if (!field) return undefined;
    return { kind: "filter", page, sections: parts.slice(0, -1), member: field.replace(/^"|"$/gu, ""), value: exampleValue(value ?? ""), ...tried };
  }
  const member = parts.pop();
  if (!member) return undefined;
  if (operation === "invoke") {
    const button = BUTTONS[member.toLowerCase()];
    if (button && !parts.length) return { kind: "button", page, button, ...tried };
    return { kind: "invoke", page, sections: parts, member, ...tried };
  }
  if (operation === "setvalue") return { kind: "set", page, sections: parts, member, value: exampleValue(args), ...tried };
  if (["lookup", "drilldown", "assistedit"].includes(operation)) {
    return { kind: operation === "assistedit" ? "assist-edit" : operation, page, sections: parts, member, ...tried };
  }
  return undefined;
}

/** TestPage statements in source order. */
function uiStatements(source) {
  const statements = [];
  for (const match of source.matchAll(UI_OPERATION_PATTERN)) {
    statements.push({ index: match.index, chain: match[2], method: match[3], args: match[4], attempt: Boolean(match[1]) });
  }
  for (const match of source.matchAll(VALUE_ASSIGNMENT_PATTERN)) {
    statements.push({ index: match.index, chain: match[2], method: "SetValue", args: match[3], attempt: Boolean(match[1]) });
  }
  return statements.sort((a, b) => a.index - b.index);
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

function deriveGuidance(source, knownTestPages = new Map(), { trapped: initialTrap } = {}) {
  const testPages = collectTestPages(source, knownTestPages);
  const creationTargets = new Set();
  const found = [];
  let trapped = initialTrap;
  for (const statement of uiStatements(source)) {
    const page = testPages.get(statement.chain.split(".")[0]);
    if (!page) continue;
    const op = operationFor(statement, page);
    if (!op) continue;
    // Page.Trap() catches the page the next action opens; the action's result is that page.
    if (op.kind === "trap") {
      trapped = page;
      continue;
    }
    // An action on another page opens the trapped one; a statement on the
    // trapped page itself means something else opened it (Page.Run).
    // Other statements (opening the page to start from, entering values) leave the trap waiting.
    if (trapped && op.page.name !== trapped.name && ["invoke", "button", "lookup", "drilldown", "assist-edit"].includes(op.kind)) {
      op.opens = trapped;
      trapped = undefined;
    } else if (trapped && op.page.name === trapped.name) {
      found.push({ index: statement.index, op: { kind: "opened", page: trapped } });
      trapped = undefined;
    }
    if (op.creationTarget) creationTargets.add(op.creationTarget);
    found.push({ index: statement.index, op });
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
  const hasExamples = found.some(({ op }) => ["set", "filter"].includes(op.kind) && ["text", "choice"].includes(op.value.kind) && op.value.value !== "");
  return {
    operations,
    // A trap still waiting for its page, for the code that follows.
    trapped,
    steps: operations.map(legacyStep),
    hasExamples,
    creationTarget,
    title: creationTarget ? `Create a new ${creationTarget}` : undefined,
    goal: creationTarget ? `Create a new ${creationTarget}.` : undefined
  };
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
  const codeunitEntries = taggedEntries(structure.onRun).filter(({ tag }) => canonicalTag(tag) === "FEATURE");
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

/**
 * The documented scenarios of one AL file. `skipped` collects [SCENARIO]
 * tests without any UI step; they stay out of the documentation.
 */
export async function loadAlUiTests(filename, skipped = []) {
  const absolutePath = path.resolve(filename);
  const content = await fs.readFile(absolutePath, "utf8");
  if (!collectTestPages(content).size) return [];
  const procedures = [...content.matchAll(AL_TEST_PATTERN)].map((match) => match[1]);
  const scenarios = [];
  for (const procedure of procedures) {
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
    }
  }
  return scenarios;
}

export function generatedDocumentationPath(value, outputDirectory = "docs/generated") {
  return path.resolve(outputDirectory, `${value.id}.md`);
}
