import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parseAlUiTest, tagLine } from "./al-ui-source.js";
import { loadCorpus, validateCorpus } from "./model.js";
import { canonicalTag, DOCUMENTATION_TAGS, PREREQUISITE_TYPES } from "./tags.js";

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

// Tag comments are read exactly as the documentation reads them, including
// Microsoft's "[SCENARIO 218101] Text" and "[FEATURE] [Sales] [Invoice]".
function parsedTagLine(line) {
  const comment = line.match(/^(\s*)\/\/\s?(.*)$/u);
  const tagged = comment && tagLine(comment[2].trim());
  if (!tagged) return undefined;
  const tag = canonicalTag(tagged.tags[0]) ?? tagged.tags[0];
  const qualified = tag !== "FEATURE" && /^[A-Z][A-Z-]*$/u.test(tagged.groups[0] ?? "");
  const rest = tag === "FEATURE" ? [] : tagged.groups.slice(qualified ? 1 : 0).map((group) => `[${group}]`);
  return {
    indentation: comment[1],
    rawTag: tagged.tags[0],
    tag,
    reference: tagged.reference,
    qualifier: qualified ? tagged.groups[0] : undefined,
    // [FEATURE] [A] [B] lists several values on one line.
    values: tag === "FEATURE" ? [...tagged.groups, ...(tagged.text ? [tagged.text] : [])] : [[...rest, tagged.text].filter(Boolean).join(" ")],
    groups: tag === "FEATURE" ? tagged.groups : []
  };
}

function metadataLine(indentation, tag, value, qualifier, reference) {
  const type = qualifier ? ` [${qualifier}]` : "";
  return `${indentation}// [${tag}${reference ? ` ${reference}` : ""}]${type} ${value}`;
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

  // A value is one comment line; a line break would turn the rest into AL code.
  if (/[\r\n]/u.test(options.value ?? "")) throw new Error(`the value of [${canonical}] must be a single line`);

  const sameTag = lines
    .map((line, index) => ({ index, parsed: parsedTagLine(line) }))
    .filter(({ parsed }) => parsed?.tag === canonical && (!options.qualifier || parsed.qualifier === options.qualifier));
  const matches = sameTag.filter(({ parsed }) => !options.value || parsed.values.includes(options.value));

  if (options.remove) {
    if (!matches.length) {
      const where = options.codeunitTags?.some(({ tag, text }) => canonicalTag(tag) === canonical && (!options.value || text === options.value));
      throw new Error(where
        ? `[${canonical}] ${options.value ?? ""} is set for the whole codeunit in its OnRun trigger; change it there`
        : `[${canonical}] value was not found`);
    }
    for (const { index, parsed } of matches.reverse()) {
      // From a [FEATURE] [A] [B] list, only the named feature goes.
      const others = options.value && parsed.groups.length ? parsed.groups.filter((group) => group !== options.value) : [];
      if (others.length) lines[index] = `${parsed.indentation}// [${parsed.rawTag}] ${others.map((group) => `[${group}]`).join(" ")}`;
      else lines.splice(index, 1);
    }
    return lines.join(eol);
  }

  if (!options.value?.trim()) throw new Error(`--value is required for [${canonical}]`);
  const singleton = DOCUMENTATION_TAGS[canonical].cardinality === "one";
  // A tag that exists once is replaced, whatever its value was.
  if (singleton && sameTag.length) {
    const [current, ...continued] = sameTag;
    // "[SCENARIO 396854] ..." over several lines becomes the one new sentence.
    for (const { index } of [...continued].reverse()) lines.splice(index, 1);
    // A work item number ([SCENARIO 218101]) stays with the tag.
    lines[current.index] = metadataLine(
      current.parsed.indentation,
      canonical,
      options.value.trim(),
      options.qualifier,
      current.parsed.reference
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
  // Tags the test has without having them itself come from the codeunit's OnRun trigger.
  const codeunitTags = scenario.value.metadata.map(({ tag, value }) => ({ tag, text: value }));
  const after = editProcedure(before, { ...options, codeunitTags });
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