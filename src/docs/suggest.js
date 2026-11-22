// A first draft of the tags of AL UI tests that have none: a [SCENARIO] from
// what the test does (or its name), and a [WHEN] before its first step, so a
// team does not start documenting from an empty page. The draft is a
// proposal: `bca docs suggest` shows it, --write puts it into the source,
// and `bca docs set` refines it once the test is a scenario.
import fs from "node:fs/promises";
import path from "node:path";
import { parseAlUiTest } from "./al-ui-source.js";
import { loadCorpus } from "./model.js";
import { humanizeIdentifier } from "./steps.js";

const portable = (file) => file.replaceAll("\\", "/");

/** "NoSeriesPage_DrillDown" -> "no series page drill down". */
function words(name) {
  return name.split(/_+/u).map((part) => humanizeIdentifier(part).toLowerCase()).filter(Boolean).join(" ");
}

const first = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const listed = (items) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`);
const quoted = (text) => `"${text}"`;

/** What one operation does, as the end of "The user ...". */
function verb(operation) {
  const page = operation.page?.label ?? operation.page?.name;
  const member = operation.member && humanizeIdentifier(operation.member);
  switch (operation.kind) {
    case "open": return operation.mode === "new" ? `creates a new record on the ${page} page` : `opens the ${page} page`;
    case "go-to-record": return "selects a record";
    case "set": return `enters ${member}`;
    case "invoke": return `chooses ${quoted(member)}`;
    case "lookup": return `looks up ${member}`;
    case "drilldown": return `drills down on ${member}`;
    case "assist-edit": return `edits ${member}`;
    case "filter": return `filters by ${member}`;
    case "new-line": return "adds a line";
    case "button": return `chooses ${operation.button === "ok" ? "OK" : first(operation.button)}`;
    default: return undefined;
  }
}

/** The draft of one test: its [SCENARIO], and a [WHEN] with the line it goes before. */
export function draftTags(value, procedure) {
  const operations = value.guideOperations ?? [];
  const opener = operations.find(({ kind }) => kind === "open");
  const page = opener?.page?.label ?? opener?.page?.name;
  const scenario = value.creationTarget
    ? `Create a new ${value.creationTarget}.`
    : page ? `On the ${page} page: ${words(procedure)}.` : `${first(words(procedure))}.`;
  const actions = [...new Set(operations.map(verb).filter(Boolean))].slice(0, 5);
  return {
    scenario,
    when: actions.length ? `The user ${listed(actions)}.` : undefined
  };
}

/**
 * Puts a draft into the source of one test: [SCENARIO] after `begin`, [WHEN]
 * before the first line that drives a page.
 * @returns the new source
 */
function insertDraft(source, procedure, draft, testPages) {
  const start = source.search(new RegExp(`procedure\\s+${procedure}\\s*\\(`, "iu"));
  const lines = source.slice(start).split(/\r?\n/u);
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const begin = lines.findIndex((line) => /^\s*begin\s*$/iu.test(line));
  const end = lines.findIndex((line, index) => index > begin && /^\s{4}end;\s*$/u.test(line));
  const indentation = `${lines[begin].match(/^\s*/u)[0]}    `;
  const drives = new RegExp(`^\\s*(?:asserterror\\s+)?(?:${testPages.join("|")})\\s*\\.`, "iu");
  const step = testPages.length ? lines.findIndex((line, index) => index > begin && (end < 0 || index < end) && drives.test(line)) : -1;
  if (draft.when && step > 0) lines.splice(step, 0, `${indentation}// [WHEN] ${draft.when}`);
  lines.splice(begin + 1, 0, `${indentation}// [SCENARIO] ${draft.scenario}`);
  return `${source.slice(0, start)}${lines.join(eol)}`;
}

/**
 * Drafts the tags of the UI tests without documentation under a folder.
 * @param options { procedure, write }: one test by name; write puts the drafts into the files
 * @returns [{ file, procedure, line, scenario, when, written }]
 */
export async function suggestTags(input, { procedure, write = false } = {}) {
  const corpus = await loadCorpus(input);
  const tests = corpus.undocumented.filter((test) => !procedure || test.procedure.toLowerCase() === procedure.toLowerCase());
  if (procedure && !tests.length) throw new Error(`no UI test without documentation is called ${procedure}`);
  const byFile = new Map();
  for (const test of tests) (byFile.get(test.path) ?? byFile.set(test.path, []).get(test.path)).push(test);
  const drafts = [];
  for (const [file, inFile] of byFile) {
    let source = await fs.readFile(file, "utf8");
    // Later tests first, so the earlier ones keep their place.
    for (const test of [...inFile].sort((a, b) => b.line - a.line)) {
      // The test as if it had a [SCENARIO]: what BC Atlas would read from it.
      const probe = insertDraft(source, test.procedure, { scenario: "Draft." }, []);
      const value = await parseAlUiTest(probe, file, test.procedure).catch(() => undefined);
      if (!value) continue;
      const draft = draftTags(value, test.procedure);
      // The [WHEN] goes before the first line that uses a TestPage variable of the file.
      const pageVariables = [...new Set([...source.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*:\s*Test(?:Request)?Page\b/giu)].map((match) => match[1]))];
      source = insertDraft(source, test.procedure, draft, pageVariables);
      drafts.push({ file: portable(path.relative(process.cwd(), file)), procedure: test.procedure, line: test.line, ...draft, written: write });
    }
    if (write) await fs.writeFile(file, source);
  }
  return drafts.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}
