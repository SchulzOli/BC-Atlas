// Parses AL UI-test procedures into deterministic documentation data.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const AL_TEST_PATTERN = /\[Test\](?:\s*\[[^\]]+\])*\s*procedure\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/giu;

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

function taggedComments(source) {
  const tags = new Map();
  let current = [];
  for (const line of source.split(/\r?\n/u)) {
    const comment = line.match(/^\s*\/\/\s?(.*)$/u);
    if (!comment) {
      current = [];
      continue;
    }
    const tagged = comment[1].match(/^\[([A-Z]+)\](?:\/\[([A-Z]+)\])?\s*(.*)$/u);
    if (tagged) {
      current = [tagged[1], tagged[2]].filter(Boolean);
      for (const tag of current) {
        const items = tags.get(tag) ?? [];
        items.push(tagged[3].trim());
        tags.set(tag, items);
      }
      continue;
    }
    if (!current.length || !comment[1].trim()) continue;
    for (const tag of current) {
      const items = tags.get(tag);
      items[items.length - 1] = `${items.at(-1)} ${comment[1].trim()}`;
    }
  }
  return tags;
}

function commentValues(comments, tag) {
  return (comments.get(tag) ?? []).map((item) => item.trim()).filter(Boolean);
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

function deriveGuidance(source) {
  const testPages = new Map();
  for (const match of source.matchAll(
    /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*TestPage\s+(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))\s*;/gimu
  )) {
    testPages.set(match[1], match[2] ?? humanizeIdentifier(match[3]));
  }

  const steps = [];
  let creationTarget;
  let hasExamples = false;
  const operationPattern =
    /^\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\.(OpenNew|OpenEdit|OpenView|Close|New|Invoke|SetValue|GoToRecord)\((.*?)\);\s*$/gimu;
  for (const match of source.matchAll(operationPattern)) {
    const parts = match[1].split(".");
    const root = parts.shift();
    const page = testPages.get(root);
    if (!page) continue;

    const operation = match[2];
    if (operation === "OpenNew") {
      creationTarget = singular(page);
      steps.push(`Open **${page}** and create a new record.`);
    } else if (operation === "OpenEdit") {
      steps.push(`Open **${page}** in edit mode.`);
    } else if (operation === "OpenView") {
      steps.push(`Open **${page}**.`);
    } else if (operation === "GoToRecord") {
      steps.push("Open the record you want to work with.");
    } else if (operation === "Close") {
      steps.push(`Finish the entry and close **${page}**. Business Central saves the changes.`);
    } else if (operation === "New") {
      steps.push(contextual(parts, "add a new line."));
    } else if (operation === "Invoke") {
      const action = parts.pop();
      steps.push(contextual(parts, `choose **${humanizeIdentifier(action)}**.`));
    } else if (operation === "SetValue") {
      const field = humanizeIdentifier(parts.pop());
      const example = exampleValue(match[3]);
      if (example.kind === "boolean") {
        steps.push(contextual(parts, `turn **${field}** ${example.value ? "on" : "off"}.`));
      } else if (example.kind === "choice") {
        steps.push(contextual(parts, `in **${field}**, select **${example.value}**.`));
        hasExamples = true;
      } else if (example.kind === "text") {
        steps.push(
          contextual(
            parts,
            `in **${field}**, enter a suitable value (for example, **${example.value}**).`
          )
        );
        hasExamples = true;
      } else {
        steps.push(contextual(parts, `enter the required value in **${field}**.`));
      }
    }
  }

  return {
    steps,
    hasExamples,
    creationTarget,
    title: creationTarget ? `Create a new ${creationTarget}` : undefined,
    goal: creationTarget ? `Create a new ${creationTarget}.` : undefined
  };
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

function parseAlUiTest(source, filename, requestedProcedure) {
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
  const comments = taggedComments(sourceText);
  const scenarios = commentValues(comments, "SCENARIO");
  if (!scenarios.length) {
    throw new Error(`${selected[1]} must have a // [SCENARIO] comment`);
  }

  const goal = scenarios.join(" ").trim();
  const expected = commentValues(comments, "THEN");
  const guidance = deriveGuidance(sourceText);
  const prerequisites = commentValues(comments, "GIVEN");
  const permissions = [...new Set([
    ...commentValues(comments, "PERMISSIONS"),
    ...commentValues(comments, "PERMISSION")
  ])];
  const expectedResults = expected.length ? expected : [goal];
  return {
    id: slug(selected[1]),
    title: guidance.title ?? goal.replace(/[.\s]+$/u, ""),
    goal,
    guideGoal: guidance.goal ?? goal,
    guideSteps: guidance.steps,
    hasExampleValues: guidance.hasExamples,
    permissions,
    prerequisites,
    guidePrerequisites: guidePrerequisites(prerequisites, guidance.creationTarget),
    actions: commentValues(comments, "WHEN"),
    expected: expectedResults,
    guideExpected: guideExpectedResults(expectedResults, guidance.creationTarget),
    features: commentValues(comments, "FEATURE"),
    procedure: selected[1],
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

  const value = parseAlUiTest(content, absolutePath, selected.procedure);
  return {
    path: absolutePath,
    relativePath: portablePath(path.relative(process.cwd(), absolutePath)),
    reference: sourceReference(absolutePath, value.procedure),
    value
  };
}

export function generatedDocumentationPath(value, outputDirectory = "docs/generated") {
  return path.resolve(outputDirectory, `${value.id}.md`);
}
