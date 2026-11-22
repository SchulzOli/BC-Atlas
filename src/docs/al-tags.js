// The documentation tags of AL test comments: "// [GIVEN] [SETUP] Text",
// read into entries, values, links, prerequisites, diagnostics, and the
// document ID.
import { canonicalTag, DOCUMENTATION_TAGS, isDocumentId, PREREQUISITE_TYPES, RELATION_TAGS } from "./tags.js";

function slug(value) {
  return value
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1-$2")
    .replace(/([a-z0-9])([A-Z])/gu, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
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

export function taggedEntries(source) {
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

export function taggedComments(entries) {
  const tags = new Map();
  for (const entry of entries) {
    const tag = canonicalTag(entry.tag) ?? entry.tag;
    const items = tags.get(tag) ?? [];
    items.push(entry.text);
    tags.set(tag, items);
  }
  return tags;
}

export function commentValues(comments, tag) {
  return (comments.get(tag) ?? []).map((item) => item.trim()).filter(Boolean);
}

export function uniqueValues(values) {
  return [...new Set(values)];
}

export function parsedLinks(comments) {
  return Object.fromEntries(
    Object.entries(RELATION_TAGS).map(([tag, relation]) => [
      relation,
      uniqueValues(commentValues(comments, tag))
    ])
  );
}

export function parsedPrerequisites(entries) {
  return entries
    .filter(({ tag }) => canonicalTag(tag) === "GIVEN")
    .map(({ qualifier, text }) => ({
      type: PREREQUISITE_TYPES[qualifier] ?? "general",
      text
    }))
    .filter(({ text }) => text);
}

export function tagDiagnostics(entries) {
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

export function documentIdentity(comments, procedure, diagnostics) {
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
