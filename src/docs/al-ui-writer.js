import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parseAlUiTest } from "./al-ui-source.js";
import { loadCorpus, validateCorpus } from "./model.js";
import { canonicalTag, DOCUMENTATION_TAGS, PREREQUISITE_TYPES } from "./tags.js";

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parsedTagLine(line) {
  const match = line.match(
    /^(\s*)\/\/\s*\[([A-Z-]+)\](?:\/\[([A-Z-]+)\])?(?:\s+\[([A-Z-]+)\])?\s*(.*)$/u
  );
  if (!match) return undefined;
  return {
    indentation: match[1],
    rawTag: match[2],
    tag: canonicalTag(match[2]) ?? match[2],
    qualifier: match[4],
    value: match[5].trim()
  };
}

function metadataLine(indentation, tag, value, qualifier) {
  const type = qualifier ? ` [${qualifier}]` : "";
  return `${indentation}// [${tag}]${type} ${value}`;
}

function insertionIndex(lines, tag) {
  if (["REQUIRES", "NEXT", "RELATED", "ALTERNATIVE"].includes(tag)) {
    const end = lines.findLastIndex((line) => /^\s*end;\s*$/u.test(line));
    return end < 0 ? lines.length : end;
  }
  if (tag === "GIVEN") {
    const when = lines.findIndex((line) => parsedTagLine(line)?.tag === "WHEN");
    return when < 0 ? lines.length : when;
  }
  const firstTag = lines.findIndex((line) => parsedTagLine(line));
  return firstTag < 0 ? lines.findIndex((line) => /^\s*begin\s*$/iu.test(line)) + 1 : firstTag;
}

function editProcedure(segment, options) {
  const eol = segment.includes("\r\n") ? "\r\n" : "\n";
  const lines = segment.split(/\r?\n/u);
  const canonical = canonicalTag(options.tag);
  if (!canonical) throw new Error(`unsupported documentation tag: ${options.tag}`);
  if (options.qualifier && !DOCUMENTATION_TAGS[canonical].qualifiers?.includes(options.qualifier)) {
    throw new Error(`unsupported [${options.qualifier}] qualifier for [${canonical}]`);
  }
  if (options.qualifier && !PREREQUISITE_TYPES[options.qualifier]) {
    throw new Error(`unknown prerequisite type: ${options.qualifier}`);
  }

  const matches = lines
    .map((line, index) => ({ index, parsed: parsedTagLine(line) }))
    .filter(({ parsed }) =>
      parsed?.tag === canonical &&
      (!options.value || parsed.value === options.value) &&
      (!options.qualifier || parsed.qualifier === options.qualifier)
    );

  if (options.remove) {
    if (!matches.length) throw new Error(`[${canonical}] value was not found`);
    for (const { index } of matches.reverse()) lines.splice(index, 1);
    return lines.join(eol);
  }

  if (!options.value?.trim()) throw new Error(`--value is required for [${canonical}]`);
  const singleton = DOCUMENTATION_TAGS[canonical].cardinality === "one";
  if (singleton && matches.length) {
    const current = matches[0];
    lines[current.index] = metadataLine(
      current.parsed.indentation,
      canonical,
      options.value.trim(),
      options.qualifier
    );
    return lines.join(eol);
  }
  if (matches.length) return segment;

  const existing = lines.map(parsedTagLine).find(Boolean);
  const begin = lines.find((line) => /^\s*begin\s*$/iu.test(line));
  const indentation = existing?.indentation ?? `${begin?.match(/^\s*/u)?.[0] ?? ""}    `;
  lines.splice(
    insertionIndex(lines, canonical),
    0,
    metadataLine(indentation, canonical, options.value.trim(), options.qualifier)
  );
  return lines.join(eol);
}

function preview(before, after) {
  return ["--- before", "+++ after", ...before.split(/\r?\n/u).map((line) => `- ${line}`),
    ...after.split(/\r?\n/u).map((line) => `+ ${line}`)].join("\n");
}

export async function planMetadataEdit(root, documentId, options) {
  const corpus = await loadCorpus(root);
  const scenario = corpus.byId.get(documentId);
  if (!scenario) throw new Error(`document ID "${documentId}" was not found`);
  const original = await fs.readFile(scenario.path, "utf8");
  if (options.expectedFileHash && hash(original) !== options.expectedFileHash) {
    throw new Error(`source changed since ${documentId} was loaded`);
  }
  const { start, end } = scenario.value.sourceRange;
  const before = original.slice(start, end);
  const after = editProcedure(before, options);
  const content = `${original.slice(0, start)}${after}${original.slice(end)}`;
  const value = await parseAlUiTest(content, scenario.path, scenario.value.procedure);
  const replacement = { ...scenario, fileHash: hash(content), value };
  const scenarios = corpus.scenarios.map((item) => item === scenario ? replacement : item);
  const validation = validateCorpus(scenarios);
  const errors = validation.diagnostics.filter(({ severity }) => severity === "error");
  if (errors.length) throw new Error(errors.map(({ message }) => message).join("; "));
  return {
    changed: content !== original,
    file: scenario.path,
    relativePath: scenario.relativePath,
    procedure: scenario.value.procedure,
    documentId: value.id,
    before,
    after,
    content,
    fileHash: hash(content),
    preview: preview(before, after)
  };
}

export async function writeMetadataEdit(plan) {
  if (!plan.changed) return plan;
  const temporary = path.join(
    path.dirname(plan.file),
    `.${path.basename(plan.file)}.${process.pid}.tmp`
  );
  await fs.writeFile(temporary, plan.content);
  await fs.rename(temporary, plan.file);
  return plan;
}