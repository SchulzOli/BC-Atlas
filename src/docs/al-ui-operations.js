// The TestPage statements of an AL UI test, read into structured,
// language-neutral operations and the steps a user follows.
import { humanizeIdentifier, inlineStep, operationStep } from "./steps.js";
import { markdown } from "./render/format.js";

// TestPage variables in var sections and in parameters (handlers get the page as one).
export const TEST_PAGE_PATTERN =
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
export const UI_OPERATION_DETECTOR = new RegExp(String.raw`\.(?:${UI_METHODS})\s*\(|\.Value\s*:=`, "iu");
// Dialog buttons of a TestPage: Page.OK().Invoke().
const BUTTONS = { ok: "ok", cancel: "cancel", yes: "yes", no: "no", lookupok: "ok", lookupcancel: "cancel" };

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

export function collectTestPages(source, initial = new Map()) {
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

export function legacyStep(op) {
  return markdown(inlineStep(operationStep(op, ENGLISH), ENGLISH.language));
}

export function deriveGuidance(source, knownTestPages = new Map(), { trapped: initialTrap } = {}) {
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
