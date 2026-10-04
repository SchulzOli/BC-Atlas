// Turns structured UI operations from an AL test into instruction tokens.
// Tokens are strings or { ui } / { input } objects, so every output format
// (Markdown, HTML, DITA, CSV) can mark up UI labels and example input itself.
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

function single(op, context) {
  const { language } = context;
  const page = { ui: pageCaption(op, context) };
  switch (op.kind) {
    case "open":
      return {
        cmd: phrase(language, `open.${op.mode}`, { page, new: { ui: phrase(language, "ui.new")[0] } }),
        expected: phrase(language, op.mode === "new" ? "expect.new" : "expect.open", { page }),
        page: op.page.name
      };
    case "close":
      return { cmd: phrase(language, "close", { page }), expected: phrase(language, "expect.close"), page: op.page.name };
    case "go-to-record":
      return { cmd: phrase(language, "go-to-record"), expected: phrase(language, "expect.select"), page: op.page.name };
    case "new-line": {
      const sections = (op.sections ?? []).map((section, index) =>
        context.captions?.member(op.page.name, op.sections.slice(0, index + 1), "", "field")?.sectionCaptions?.[index] ??
        humanizeIdentifier(section));
      return {
        cmd: withSections(language, sections, phrase(language, "new-line")),
        expected: phrase(language, "expect.new-line"),
        page: op.page.name
      };
    }
    case "invoke": {
      const member = memberInfo(op, context, "action");
      return {
        cmd: withSections(language, member.sections, phrase(language, "invoke", { action: { ui: member.caption } })),
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
          : op.value.kind === "text" ? "set.text" : "set.variable";
      return {
        cmd: withSections(language, member.sections, phrase(language, key, { field, value: { input: String(op.value.value) } })),
        info: member.tooltip,
        expected: phrase(language, "expect.set"),
        page: op.page.name,
        example: ["text", "choice"].includes(op.value.kind)
      };
    }
    default:
      throw new Error(`unsupported UI operation: ${op.kind}`);
  }
}

/**
 * Builds a step: { cmd, info?, expected, items?, pages, actions }.
 * A repeated block becomes one step whose items are the repeated operations.
 */
export function operationStep(op, context) {
  if (op.kind !== "repeat") {
    const step = single(op, context);
    return { ...step, pages: [step.page], actions: step.action ? [[step.page, step.action]] : [] };
  }
  const { language } = context;
  const items = op.steps.map((child) => {
    const step = single(child, context);
    return {
      ...step,
      cmd: child.conditional ? phrase(language, "conditional", { instruction: inline(language, step.cmd) }) : step.cmd
    };
  });
  return {
    cmd: phrase(language, "repeat", { record: { ui: op.record } }),
    expected: phrase(language, "expect.repeat"),
    items,
    pages: items.map(({ page }) => page),
    actions: items.filter(({ action }) => action).map(({ page, action }) => [page, action])
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
  return mergeText(phrase(language, "repeat.inline", { record, instructions: parts }));
}
