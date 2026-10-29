// Turns structured UI operations from an AL test into instruction tokens.
// Tokens are strings or { ui } / { input } objects, so every output format
// (Markdown, HTML, DITA, CSV) can mark up UI labels and example input itself.
import { singular } from "./al-ui-source.js";
import { lowerTokens, mergeText, phrase } from "./phrases.js";

export function humanizeIdentifier(value) {
  return String(value ?? "")
    .replace(/^"|"$/gu, "")
    .replaceAll("_", " ")
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/\s+/gu, " ")
    .trim();
}

function englishLike(language) {
  return String(language ?? "en").toLowerCase().startsWith("en");
}

/** Lowercases an instruction for use inside a sentence where the language does so. */
export function inline(language, tokens) {
  return englishLike(language) ? lowerTokens(tokens) : tokens;
}

function pageCaption(op, context) {
  return context.captions?.page(op.page.name)?.caption ?? op.page.label;
}

function memberInfo(op, context, kind) {
  const resolved = context.captions?.member(op.page.name, op.sections ?? [], op.member, kind) ?? {};
  return {
    caption: resolved.caption ?? humanizeIdentifier(op.member),
    tooltip: resolved.tooltip,
    sections: (op.sections ?? []).map((section, index) =>
      resolved.sectionCaptions?.[index] ?? humanizeIdentifier(section))
  };
}

function withSections(language, sections, tokens) {
  if (!sections.length) return tokens;
  return phrase(language, "section", {
    section: { ui: sections.join(" / ") },
    instruction: inline(language, tokens)
  });
}

/** Short label for diagrams: "Choose Release", "Components: Enter Qty.". */
function shortLabel(language, sections, key, values) {
  const tokens = phrase(language, key, values);
  return sections.length ? phrase(language, "short.section", { section: { ui: sections.join(" / ") }, instruction: tokens }) : tokens;
}

function single(op, context) {
  const { language } = context;
  // Confirmations have no page.
  const page = op.page ? { ui: pageCaption(op, context) } : undefined;
  switch (op.kind) {
    case "open": {
      const record = { ui: englishLike(language) ? singular(page.ui) : page.ui };
      return {
        cmd: phrase(language, `open.${op.mode}`, { page, new: { ui: phrase(language, "ui.new")[0] } }),
        short: phrase(language, op.mode === "new" ? "short.open.new" : "short.open", { page, record }),
        expected: phrase(language, op.mode === "new" ? "expect.new" : "expect.open", { page }),
        page: op.page.name
      };
    }
    case "close":
      return {
        cmd: phrase(language, "close", { page }),
        short: phrase(language, "short.close", { page }),
        expected: phrase(language, "expect.close"),
        page: op.page.name
      };
    case "go-to-record":
      return {
        cmd: phrase(language, "go-to-record"),
        short: phrase(language, "short.go-to-record"),
        expected: phrase(language, "expect.select"),
        page: op.page.name
      };
    case "new-line": {
      const sections = (op.sections ?? []).map((section, index) =>
        context.captions?.member(op.page.name, op.sections.slice(0, index + 1), "", "field")?.sectionCaptions?.[index] ??
        humanizeIdentifier(section));
      return {
        cmd: withSections(language, sections, phrase(language, "new-line")),
        short: shortLabel(language, sections, "short.new-line"),
        expected: phrase(language, "expect.new-line"),
        page: op.page.name
      };
    }
    case "invoke": {
      const member = memberInfo(op, context, "action");
      return {
        cmd: withSections(language, member.sections, phrase(language, "invoke", { action: { ui: member.caption } })),
        short: shortLabel(language, member.sections, "short.invoke", { action: { ui: member.caption } }),
        info: member.tooltip,
        expected: phrase(language, "expect.invoke"),
        page: op.page.name,
        action: op.member
      };
    }
    case "set": {
      const member = memberInfo(op, context, "field");
      const field = { ui: member.caption };
      const key = op.value.kind === "boolean"
        ? (op.value.value ? "set.on" : "set.off")
        : op.value.kind === "choice" ? "set.choice"
          : op.value.kind === "text" ? (op.value.value === "" ? "set.clear" : "set.text") : "set.variable";
      return {
        cmd: withSections(language, member.sections, phrase(language, key, { field, value: { input: String(op.value.value) } })),
        short: shortLabel(language, member.sections, op.value.kind === "boolean" || op.value.kind === "choice"
          ? `short.${key}` : "short.set", { field }),
        info: member.tooltip,
        expected: phrase(language, "expect.set"),
        page: op.page.name,
        example: ["text", "choice"].includes(op.value.kind) && op.value.value !== ""
      };
    }
    case "button": {
      const button = { ui: phrase(language, `ui.${op.button}`)[0] };
      return {
        cmd: phrase(language, "button", { button }),
        short: phrase(language, "short.button", { button }),
        expected: phrase(language, "expect.button"),
        page: op.page.name
      };
    }
    case "filter": {
      const member = memberInfo(op, context, "field");
      const field = { ui: member.caption };
      const key = ["text", "choice"].includes(op.value.kind) ? "filter" : "filter.variable";
      return {
        cmd: withSections(language, member.sections, phrase(language, key, { field, value: { input: String(op.value.value) } })),
        short: shortLabel(language, member.sections, "short.filter", { field }),
        info: member.tooltip,
        expected: phrase(language, "expect.filter"),
        page: op.page.name,
        example: ["text", "choice"].includes(op.value.kind)
      };
    }
    case "navigate":
      return {
        cmd: phrase(language, `navigate.${op.direction}`),
        short: phrase(language, "short.navigate"),
        expected: phrase(language, "expect.select"),
        page: op.page.name
      };
    case "lookup":
    case "drilldown":
    case "assist-edit": {
      const member = memberInfo(op, context, "field");
      const field = { ui: member.caption };
      return {
        cmd: withSections(language, member.sections, phrase(language, op.kind, { field })),
        short: shortLabel(language, member.sections, `short.${op.kind}`, { field }),
        info: member.tooltip,
        expected: phrase(language, op.kind === "drilldown" ? "expect.drilldown" : op.kind === "lookup" ? "expect.lookup" : "expect.set"),
        page: op.page.name
      };
    }
    case "opened":
      // A page that code (not a UI action) opens, such as Page.Run in a test helper.
      return {
        cmd: phrase(language, "expect.opens", { page }),
        short: phrase(language, "short.open", { page, record: page }),
        expected: phrase(language, "expect.opens", { page }),
        page: op.page.name
      };
    case "confirm": {
      const button = { ui: phrase(language, `ui.${op.answer === "no" ? "no" : "yes"}`)[0] };
      return {
        cmd: phrase(language, op.answer ? `confirm.${op.answer}` : "confirm.any", { button }),
        short: phrase(language, "short.confirm"),
        expected: phrase(language, "expect.confirm")
      };
    }
    default:
      throw new Error(`unsupported UI operation: ${op.kind}`);
  }
}

/**
 * An operation as the user experiences it: an attempt that the test expects
 * to fail (asserterror) says so, and an action that opens a page the test
 * traps names that page as its result.
 */
function experienced(op, context) {
  const { language } = context;
  const step = single(op, context);
  if (op.opens) {
    // Shown after the instruction in guides, and as the expected result in test cases.
    step.outcome = phrase(language, "expect.opens", { page: { ui: context.captions?.page(op.opens.name)?.caption ?? op.opens.label } });
    step.expected = step.outcome;
  }
  if (op.attempt) {
    step.cmd = phrase(language, "attempt", { instruction: step.cmd });
    step.short = phrase(language, "short.attempt", { instruction: step.short });
    step.expected = phrase(language, "expect.error");
  }
  return step;
}

/**
 * Builds a step: { cmd, info?, expected, items?, pages, actions }.
 * A repeated block becomes one step whose items are the repeated operations.
 */
export function operationStep(op, context) {
  if (op.kind !== "repeat" && op.kind !== "dialog") {
    const step = experienced(op, context);
    return { ...step, pages: step.page ? [step.page] : [], actions: step.action ? [[step.page, step.action]] : [] };
  }
  const { language } = context;
  const items = op.steps.map((child) => {
    // A loop inside a dialog (or a dialog inside a loop) reads as one line.
    if (child.kind === "repeat" || child.kind === "dialog") {
      const nested = operationStep(child, context);
      return { ...nested, cmd: inlineStep(nested, language), items: undefined };
    }
    const step = experienced(child, context);
    return {
      ...step,
      cmd: child.conditional ? phrase(language, "conditional", { instruction: inline(language, step.cmd) }) : step.cmd
    };
  });
  const pages = items.map(({ page }) => page).filter(Boolean);
  const actions = items.filter(({ action }) => action).map(({ page, action }) => [page, action]);
  if (op.kind === "dialog") {
    // A page the test answers in a handler: "When the X page opens, do the following:".
    const page = { ui: context.captions?.page(op.page.name)?.caption ?? op.page.label };
    return {
      cmd: phrase(language, "dialog", { page }),
      short: phrase(language, "short.dialog", { page }),
      expected: phrase(language, "expect.dialog"),
      items,
      dialog: true,
      pages: [op.page.name, ...pages],
      actions
    };
  }
  return {
    cmd: phrase(language, "repeat", { record: { ui: op.record } }),
    short: phrase(language, "short.repeat", { record: { ui: op.record } }),
    expected: phrase(language, "expect.repeat"),
    items,
    pages,
    actions
  };
}

/** One-line form of a step, used for compact lists and legacy string fields. */
export function inlineStep(step, language) {
  if (!step.items?.length) return step.cmd;
  const parts = [];
  for (const [index, item] of step.items.entries()) {
    if (index) parts.push("; ");
    let tokens = inline(language, item.cmd);
    if (index === step.items.length - 1 && step.items.length > 1 && !/^(if|falls)\b/iu.test(String(tokens[0]))) {
      tokens = phrase(language, "then", { instruction: tokens });
    }
    parts.push(...tokens.map((token) => (typeof token === "string" ? token.replace(/\.$/u, "") : token)));
  }
  const record = step.cmd.find((token) => typeof token === "object");
  return mergeText(phrase(language, step.dialog ? "dialog.inline" : "repeat.inline", { record, page: record, instructions: parts }));
}
