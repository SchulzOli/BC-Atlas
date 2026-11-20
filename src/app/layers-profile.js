// The documentation profile: what of the layered documentation (src/app/layers.js)
// is written, and how. It is read from "layers" in .bca.json:
//
//   pages      which kinds of page, and which pages of a kind
//   scope      which objects get a page (app, namespace, type, exclude)
//   sections   the sections of each kind of page, in their order
//   titles     other headings
//   language   "de": the fixed headings and labels in German
//   names      the file name of each kind of page
//   templates  a folder with a Markdown template per kind of page
//   profiles   named sets of the same keys (bca layers --profile <name>)
//
// layersProfile() checks the settings and makes them one profile; nothing is
// written from settings that are not valid. buildLayers() asks the profile
// which pages to build (profileWants, profileInScope) and hands the built
// pages to applyProfile(), which names, cuts, titles, translates, and lays
// them out, and makes every link follow.
import fs from "node:fs/promises";
import path from "node:path";
import { UsageError } from "../cli/errors.js";

/** The kinds of page `pages` and `names` speak of. */
export const LAYERS_PAGE_KINDS = Object.freeze(["readme", "architecture", "findings", "apps", "namespaces", "objects", "lenses", "stories"]);
/** The kinds with one page: `pages` takes only true or false for them. */
const SINGLE = new Set(["readme", "architecture", "findings"]);
/** The kind of page `sections` and the templates speak of, by the kind of `pages`. */
const SECTION_KIND = Object.freeze({ readme: "readme", architecture: "architecture", findings: "findings", apps: "app", namespaces: "namespace", objects: "object", lenses: "lens", stories: "story" });
/**
 * The sections (H2) each kind of page can have, in the order they are written. A page has a
 * section only when there is something to say in it. The sections of a story are its steps,
 * so they have no fixed names.
 */
export const LAYERS_SECTIONS = Object.freeze({
  readme: Object.freeze(["Start here", "Layers", "Apps", "Namespaces", "Lenses", "Stories", "Findings", "Read from"]),
  architecture: Object.freeze(["Apps", "Namespaces"]),
  findings: Object.freeze(["Error", "Warning", "Info"]),
  app: Object.freeze(["Namespaces", "Depends on", "Used by", "Objects", "Findings"]),
  namespace: Object.freeze(["Depends on", "Used by", "Objects", "Findings"]),
  object: Object.freeze(["Inside", "Uses", "Used by", "Findings"]),
  lens: Object.freeze(["Findings"]),
  story: null
});
export const LAYERS_SECTION_KINDS = Object.freeze(Object.keys(LAYERS_SECTIONS));
export const LAYERS_LANGUAGES = Object.freeze(["en", "de"]);
export const LAYERS_SCOPE_KEYS = Object.freeze(["apps", "namespaces", "types", "exclude"]);
/** What a pattern of `names` can hold; a kind with one page has no placeholders. */
export const LAYERS_NAME_PLACEHOLDERS = Object.freeze({
  apps: Object.freeze(["name"]),
  namespaces: Object.freeze(["name", "app"]),
  objects: Object.freeze(["name", "type", "id", "app", "namespace"]),
  lenses: Object.freeze(["name", "id"]),
  stories: Object.freeze(["name", "id"])
});
/** What a template can hold: the parts of a page, and facts about what the page is of. */
export const LAYERS_TEMPLATE_PLACEHOLDERS = Object.freeze(["title", "summary", "picture", "sections", "footer", "section \"<name>\"", "body \"<name>\"", "name", "type", "id", "app", "namespace", "system"]);
const TEMPLATE_PARTS = new Set(["title", "summary", "picture", "sections", "footer", "name", "type", "id", "app", "namespace", "system"]);
const TEMPLATE_SECTION_PARTS = new Set(["section", "body"]);
/** The titles of the pages there is one of, as `titles` names them. The first page has the name of the system. */
const FIXED_TITLES = Object.freeze({ readme: "README", architecture: "How it is connected", findings: "Findings" });
const PROFILE_KEYS = ["outputDir", "pictures", "view", "pages", "scope", "sections", "titles", "language", "names", "templates"];
const DEFAULT_OUTPUT = "docs/layers";

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const oneOf = (names) => names.join(", ");
const slug = (text) => String(text).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
/** A pattern with * and ?, without regard to case. */
const glob = (pattern) => new RegExp(`^${String(pattern).replace(/[.+^${}()|[\]\\]/gu, "\\$&").replaceAll("*", ".*").replaceAll("?", ".")}$`, "iu");
const matches = (patterns, ...candidates) => patterns.some((pattern) => candidates.some((candidate) => candidate !== undefined && candidate !== "" && pattern.test(String(candidate))));
const folderKey = (folder) => path.posix.normalize(String(folder).replaceAll("\\", "/")).replace(/\/$/u, "").toLowerCase();

function strings(value, where) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) throw new UsageError(`${where} in .bca.json must be a list of names`);
  return value.map((item) => item.trim());
}

function keysOf(value, allowed, where) {
  if (!isObject(value)) throw new UsageError(`${where} in .bca.json must be an object with: ${oneOf(allowed)}`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new UsageError(`${where}.${key} in .bca.json is not known; ${where} has: ${oneOf(allowed)}`);
  return value;
}

/** A pattern of `names`: a path below the folder of the pages that ends with .md. */
function namePattern(kind, pattern, where) {
  if (typeof pattern !== "string" || !/^[A-Za-z0-9._{}/-]+\.md$/u.test(pattern)) throw new UsageError(`${where} in .bca.json must be a file name that ends with .md, of letters, digits, ".", "-", "_", "/", and placeholders such as {name}`);
  const parts = pattern.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) throw new UsageError(`${where} in .bca.json must be a path below the folder of the pages: "${pattern}"`);
  const allowed = LAYERS_NAME_PLACEHOLDERS[kind] ?? [];
  const used = [...pattern.matchAll(/\{([^{}]*)\}/gu)].map(([, name]) => name);
  for (const name of used) if (!allowed.includes(name)) throw new UsageError(`${where} in .bca.json: {${name}} is not known; ${allowed.length ? `${kind} has ${allowed.map((item) => `{${item}}`).join(", ")}` : `${kind} is one page and has no placeholders`}`);
  if (pattern.replace(/\{[^{}]*\}/gu, "").match(/[{}]/u)) throw new UsageError(`${where} in .bca.json: a placeholder is written {name}: "${pattern}"`);
  if (!SINGLE.has(kind) && !used.length) throw new UsageError(`${where} in .bca.json needs a placeholder such as {name}: every one of the ${kind} gets a page of its own`);
  return pattern;
}

/** The keys of one set of settings, checked and made uniform. */
function normalise(settings, where) {
  const profile = {};
  if (settings.pages !== undefined) {
    const pages = keysOf(settings.pages, LAYERS_PAGE_KINDS, `${where}.pages`);
    profile.pages = {};
    for (const [kind, value] of Object.entries(pages)) {
      if (typeof value === "boolean") profile.pages[kind] = value;
      else if (SINGLE.has(kind)) throw new UsageError(`${where}.pages.${kind} in .bca.json must be true or false: there is one such page`);
      else profile.pages[kind] = strings(value, `${where}.pages.${kind}`).map(glob);
    }
  }
  if (settings.scope !== undefined) {
    const scope = keysOf(settings.scope, LAYERS_SCOPE_KEYS, `${where}.scope`);
    const lists = Object.fromEntries(LAYERS_SCOPE_KEYS.map((key) => [key, scope[key] === undefined ? [] : strings(scope[key], `${where}.scope.${key}`)]));
    if (Object.values(lists).some((list) => list.length)) profile.scope = { ...Object.fromEntries(Object.entries(lists).map(([key, list]) => [key, list.map(glob)])), text: LAYERS_SCOPE_KEYS.filter((key) => lists[key].length).map((key) => `${key === "exclude" ? "without" : `${key}:`} ${lists[key].join(", ")}`).join("; ") };
  }
  if (settings.sections !== undefined) {
    const sections = keysOf(settings.sections, LAYERS_SECTION_KINDS, `${where}.sections`);
    profile.sections = {};
    for (const [kind, value] of Object.entries(sections)) {
      const list = strings(value, `${where}.sections.${kind}`);
      const known = LAYERS_SECTIONS[kind];
      for (const name of list) if (known && !known.includes(name)) throw new UsageError(`${where}.sections.${kind} in .bca.json: "${name}" is not a section of the page of ${kind === "object" || kind === "app" ? "an" : "a"} ${kind}; it has: ${oneOf(known)}`);
      if (new Set(list).size !== list.length) throw new UsageError(`${where}.sections.${kind} in .bca.json names a section twice`);
      profile.sections[kind] = list;
    }
  }
  if (settings.titles !== undefined) {
    if (!isObject(settings.titles) || Object.values(settings.titles).some((title) => typeof title !== "string" || !title.trim() || /[\n\r]/u.test(title))) throw new UsageError(`${where}.titles in .bca.json must be an object of headings and what to call them, such as { "Used by": "Who uses it" }`);
    profile.titles = Object.fromEntries(Object.entries(settings.titles).map(([from, to]) => [from, to.trim()]));
  }
  if (settings.language !== undefined) {
    if (!LAYERS_LANGUAGES.includes(settings.language)) throw new UsageError(`${where}.language in .bca.json must be one of: ${oneOf(LAYERS_LANGUAGES)}`);
    profile.language = settings.language;
  }
  if (settings.names !== undefined) {
    const names = keysOf(settings.names, LAYERS_PAGE_KINDS, `${where}.names`);
    profile.names = Object.fromEntries(Object.entries(names).map(([kind, pattern]) => [kind, namePattern(kind, pattern, `${where}.names.${kind}`)]));
  }
  if (settings.templates !== undefined) {
    if (typeof settings.templates !== "string" || !settings.templates.trim()) throw new UsageError(`${where}.templates in .bca.json must be a folder, relative to the project`);
    profile.templatesDir = settings.templates.trim();
  }
  for (const key of ["outputDir", "pictures", "view"]) if (settings[key] !== undefined) profile[key] = settings[key];
  if (profile.outputDir !== undefined && (typeof profile.outputDir !== "string" || !profile.outputDir.trim())) throw new UsageError(`${where}.outputDir in .bca.json must be a folder`);
  return profile;
}

/**
 * The profile the settings of "layers" in .bca.json give: checked, and with every key in one form.
 * @param layers the "layers" section, or undefined
 * @param name a profile of layers.profiles; without it, the keys of the section itself
 * @returns { name?, outputDir, pictures?, view?, pages, scope?, sections, titles, language, names, templatesDir?, templates, plain }
 *   plain says that nothing is set that changes the pages. Throws a UsageError that says what is wrong.
 */
export function layersProfile(layers = {}, name) {
  if (!isObject(layers)) throw new UsageError("layers in .bca.json must be an object");
  const profiles = layers.profiles ?? {};
  if (!isObject(profiles)) throw new UsageError("layers.profiles in .bca.json must be an object of named profiles");
  const top = normalise(layers, "layers");
  const named = {};
  for (const [key, settings] of Object.entries(profiles)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(key)) throw new UsageError(`layers.profiles in .bca.json: "${key}" is not a name of letters, digits, ".", "-", and "_"`);
    named[key] = normalise(keysOf(settings, PROFILE_KEYS, `layers.profiles.${key}`), `layers.profiles.${key}`);
  }
  // A folder holds the pages of one profile: a run removes what it wrote before and no longer writes.
  const folders = new Map([[folderKey(top.outputDir ?? DEFAULT_OUTPUT), "the settings of layers itself"]]);
  for (const [key, settings] of Object.entries(named)) {
    settings.outputDir ??= `${top.outputDir ?? DEFAULT_OUTPUT}-${key}`;
    const folder = folderKey(settings.outputDir);
    if (folders.has(folder)) throw new UsageError(`layers.profiles.${key} in .bca.json writes to ${settings.outputDir}, as ${folders.get(folder)} ${folders.get(folder).startsWith("the settings") ? "do" : "does"}; each profile needs a folder (outputDir) of its own, or a run of the one removes the pages of the other`);
    folders.set(folder, `the profile ${key}`);
  }
  if (name !== undefined && name !== "" && !Object.hasOwn(named, name)) throw new UsageError(`"${name}" is not a profile of layers.profiles in .bca.json${Object.keys(named).length ? `; there ${Object.keys(named).length === 1 ? "is" : "are"}: ${oneOf(Object.keys(named))}` : "; it has none"}`);
  // A profile's keys go over the ones of the section, each as a whole.
  const picked = name ? { ...top, ...named[name] } : top;
  const profile = { ...(name ? { name } : {}), pages: {}, sections: {}, titles: {}, language: "en", names: {}, templates: {}, ...picked };
  profile.outputDir ??= DEFAULT_OUTPUT;
  // A title for a heading of one kind of page is written "object.Used by".
  for (const key of Object.keys(profile.titles)) {
    const [kind] = key.split(".");
    if (key.includes(".") && !LAYERS_SECTION_KINDS.includes(kind) && !key.includes(". ")) throw new UsageError(`layers.titles in .bca.json: "${key}" names no kind of page before the "."; the kinds are: ${oneOf(LAYERS_SECTION_KINDS)}`);
  }
  profile.plain = !Object.keys(profile.pages).length && !profile.scope && !Object.keys(profile.sections).length && !Object.keys(profile.titles).length && profile.language === "en" && !Object.keys(profile.names).length && !profile.templatesDir;
  return profile;
}

/** The names of the profiles of the "layers" section. */
export const layersProfiles = (layers = {}) => Object.keys(isObject(layers?.profiles) ? layers.profiles : {});

/**
 * A template as the parts it is made of.
 * @param file what to call the template in an error
 * @param kind the kind of page it is for (LAYERS_SECTION_KINDS)
 * @returns { file, lines: [[text | { part, section? }]] }
 */
export function parseTemplate(file, text, kind) {
  const known = LAYERS_SECTIONS[kind];
  const lines = String(text).replaceAll("\r\n", "\n").split("\n").map((line) => {
    const parts = [];
    let from = 0;
    for (const match of line.matchAll(/\{\{(.*?)\}\}/gu)) {
      if (match.index > from) parts.push(line.slice(from, match.index));
      from = match.index + match[0].length;
      const inner = /^\s*([A-Za-z]+)(?:\s+"([^"]*)")?\s*$/u.exec(match[1]);
      const [part, section] = inner ? [inner[1], inner[2]] : [];
      const valid = inner && (section === undefined ? TEMPLATE_PARTS.has(part) : TEMPLATE_SECTION_PARTS.has(part));
      if (!valid) throw new UsageError(`The template ${file} holds the placeholder ${match[0]}, which is not known. A template has: ${LAYERS_TEMPLATE_PLACEHOLDERS.map((name) => `{{${name}}}`).join(", ")}`);
      if (section !== undefined && known && !known.includes(section)) throw new UsageError(`The template ${file} asks for the section "${section}" (${match[0]}), which the page of ${kind === "object" || kind === "app" ? "an" : "a"} ${kind} does not have; it has: ${oneOf(known)}`);
      parts.push(section === undefined ? { part } : { part, section });
    }
    if (from < line.length) parts.push(line.slice(from));
    return parts;
  });
  return { file, lines };
}

/**
 * The profile of a project, with its templates read.
 * @param root the project
 * @param layers the "layers" section of its .bca.json
 */
export async function loadLayersProfile(root, layers, name) {
  const profile = layersProfile(layers, name);
  if (!profile.templatesDir) return profile;
  const folder = path.resolve(root, profile.templatesDir);
  const entries = await fs.readdir(folder).catch(() => undefined);
  if (!entries) throw new UsageError(`layers.templates in .bca.json: the folder ${profile.templatesDir} is not found in the project`);
  profile.templates = {};
  for (const kind of LAYERS_SECTION_KINDS) {
    if (!entries.includes(`${kind}.md`)) continue;
    const file = `${profile.templatesDir.replace(/[\\/]+$/u, "")}/${kind}.md`;
    profile.templates[kind] = parseTemplate(file, await fs.readFile(path.join(folder, `${kind}.md`), "utf8"), kind);
  }
  return profile;
}

/**
 * Whether a page is wanted (`pages`).
 * @param kind a kind of LAYERS_PAGE_KINDS
 * @param candidates what the page can be named by in a list: its name, id, or file name
 */
export function profileWants(profile, kind, ...candidates) {
  const wanted = profile?.pages?.[kind];
  if (wanted === undefined || wanted === true) return true;
  if (wanted === false) return false;
  return matches(wanted, ...candidates.flatMap((candidate) => (candidate === undefined || candidate === "" ? [] : [candidate, slug(candidate)])));
}

/** Whether an object of the atlas is in the scope: only then it is documented. */
export function profileInScope(profile, node) {
  const scope = profile?.scope;
  if (!scope) return true;
  const name = `${node.type} ${node.objectId ? `${node.objectId} ` : ""}${node.label}`;
  if (scope.apps.length && !matches(scope.apps, node.app)) return false;
  if (scope.namespaces.length && !matches(scope.namespaces, node.namespace)) return false;
  if (scope.types.length && !matches(scope.types, node.type)) return false;
  return !matches(scope.exclude, node.label, name);
}

// ------------------------------------------------------------------ German
// The headings and labels buildLayers() writes itself. What it makes from the
// source (the sentence about a part, the
// message of a finding, the pages of the lenses and stories) stays as it is.
const DE_HEADINGS = {
  "Start here": "Einstieg", Layers: "Ebenen", Apps: "Apps", Namespaces: "Namespaces", Lenses: "Sichten", Stories: "Rundgänge", Findings: "Befunde",
  "Read from": "Gelesen aus",
  "Depends on": "Hängt ab von", "Used by": "Verwendet von", Uses: "Verwendet", Inside: "Innenleben", Objects: "Objekte", Error: "Fehler", Warning: "Warnungen", Info: "Hinweise",
  "How it is connected": "Wie es zusammenhängt"
};
const DE_HOLDERS = { App: "App", Namespace: "Namespace" };
const DE_COLUMNS = {
  Fact: "Merkmal", Value: "Wert", Member: "Element", Kind: "Art", Lines: "Zeilen", Complexity: "Komplexität", Does: "Tut", Object: "Objekt", Type: "Typ", Layer: "Ebene",
  Objects: "Objekte", What: "Was", Count: "Anzahl", Where: "Wo",
  Lens: "Sicht", Nodes: "Knoten", Node: "Knoten", Group: "Gruppe", Relations: "Beziehungen", Shows: "Zeigt", Source: "Quelle",
  "Depends on": "Hängt ab von", "Used by": "Verwendet von", Uses: "Verwendet", Findings: "Befunde"
};
/** The cells below these columns that are words of BC Atlas, not of the source. */
const DE_CELLS = {
  "Fact|Value": { Type: "Typ", Visibility: "Sichtbarkeit", Lines: "Zeilen", Procedures: "Prozeduren", Complexity: "Komplexität", Uses: "Verwendet", "Used by": "Verwendet von", Source: "Quelle", Publisher: "Herausgeber", Objects: "Objekte" },
  "Layer|What|Count|Where": { Objects: "Objekte", "Procedures, triggers, and events": "Prozeduren, Trigger und Ereignisse", "this page": "diese Seite", "[below](#apps)": "[unten](#apps)", "[below](#namespaces)": "[unten](#namespaces)",
    "none: the objects have no namespace": "keine: die Objekte haben keinen Namespace", "from the pages of layers 1 and 2": "über die Seiten der Ebenen 1 und 2", "inside the page of each object": "auf der Seite jedes Objekts" }
};
const DE_CRUMBS = { Lenses: "Sichten", Stories: "Rundgänge", Findings: "Befunde", "How it is connected": "Wie es zusammenhängt" };
const DE_LINES = {
  "Layer 4: its procedures, triggers, and events, and what each of them does.": "Ebene 4: seine Prozeduren, Trigger und Ereignisse, und was jedes davon tut.",
  "The system from the whole down to each procedure. Every page links one layer up and one layer down.": "Das System vom Ganzen bis zur einzelnen Prozedur. Jede Seite verweist eine Ebene nach oben und eine nach unten.",
  "The other sides of the same system: each lens is a part of the one graph.": "Die anderen Seiten desselben Systems: jede Sicht ist ein Teil des einen Graphen.",
  "Walks through the system, step by step.": "Rundgänge durch das System, Schritt für Schritt.",
  "The checks found nothing.": "Die Prüfungen haben nichts gefunden.",
  "An app is what is built and installed as one. A line is what one app uses of another: declared in app.json, undeclared (used, but not named there), or unresolved (not found anywhere).": "Eine App ist, was als Ganzes gebaut und installiert wird. Eine Linie ist, was eine App von einer anderen verwendet: deklariert in app.json, nicht deklariert (verwendet, aber dort nicht genannt) oder nicht aufgelöst (nirgends gefunden).",
  "A namespace is how the source itself groups its objects. A line is what the objects of one namespace use of another.": "Ein Namespace ist, wie der Quelltext selbst seine Objekte gruppiert. Eine Linie ist, was die Objekte eines Namespace von einem anderen verwenden.",
  "_Generated by BC Atlas from the AL source. Do not edit; run `bca layers` again._": "_Von BC Atlas aus dem AL-Quelltext erzeugt. Nicht bearbeiten; `bca layers` erneut ausführen._"
};
/** Lines of which a part comes from the source. */
const DE_PATTERNS = [
  [/^The graph itself is in (\[atlas\.json\]\([^)]*\)), and (\[view\.html\]\([^)]*\)) is the BC Atlas view of it: every lens, finding, and story, to look at and to click through; (\[layers\.json\]\([^)]*\)) lists what this folder holds\.$/u, "Der Graph selbst steht in $1, und $2 ist die BC-Atlas-Ansicht davon: jede Sicht, jeder Befund und jeder Rundgang, zum Ansehen und Durchklicken; $3 listet auf, was dieser Ordner enthält."],
  [/^The graph itself is in (\[atlas\.json\]\([^)]*\)); (\[layers\.json\]\([^)]*\)) lists what this folder holds\.$/u, "Der Graph selbst steht in $1; $2 listet auf, was dieser Ordner enthält."],
  [/^ {2}- Fix: /u, "  - Lösung: "],
  [/^ {2}- On: /u, "  - Betrifft: "],
  [/^ {2}- Source: /u, "  - Quelle: "]
];
const LANGUAGES = { de: { headings: DE_HEADINGS, holders: DE_HOLDERS, columns: DE_COLUMNS, cells: DE_CELLS, crumbs: DE_CRUMBS, lines: DE_LINES, patterns: DE_PATTERNS, layer: "Ebene", layers: { apps: "Apps", namespaces: "Namespaces" } } };

const cellsOf = (line) => line.replace(/^\|\s?/u, "").replace(/\s?\|$/u, "").split(" | ");
const isRule = (line) => /^\|(?: -{3}:? \|)+$/u.test(line ?? "");

/** A block of a page with the fixed lines and labels in another language. */
function translate(text, words) {
  const lines = text.split("\n");
  let columns;
  let fenced = false;
  return lines.map((line, at) => {
    if (line.startsWith("```")) fenced = !fenced;
    if (fenced) return line;
    if (line.startsWith("|")) {
      if (isRule(lines[at + 1])) {
        const head = cellsOf(line);
        columns = words.cells[head.join("|")];
        return `| ${head.map((name) => words.columns[name] ?? name).join(" | ")} |`;
      }
      if (isRule(line) || !columns) return line;
      return `| ${cellsOf(line).map((value) => columns[value] ?? value).join(" | ")} |`;
    }
    columns = undefined;
    if (words.lines[line]) return words.lines[line];
    if (line.startsWith("[System](") && line.includes(" › ")) {
      return line.split(" › ").map((part) => words.crumbs[part] ?? part.replace(/^Layer (\d): (apps|namespaces)$/u, (_, layer, kind) => `${words.layer} ${layer}: ${words.layers[kind]}`)).join(" › ");
    }
    let said = line;
    for (const [pattern, to] of words.patterns) said = said.replace(pattern, to);
    return said;
  }).join("\n");
}

// ------------------------------------------------------------------ pages
/** A path from one page of the folder to another. */
function relative(from, to) {
  const here = from.split("/").slice(0, -1);
  const there = to.split("/");
  let shared = 0;
  while (shared < here.length && shared < there.length - 1 && here[shared] === there[shared]) shared++;
  return [...new Array(here.length - shared).fill(".."), ...there.slice(shared)].join("/") || ".";
}

/** The anchor of a heading in a Markdown page, as GitHub and Azure DevOps make it. */
const anchor = (title) => String(title).trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/gu, "-");
const PICTURE = /^!\[[^\]]*\]\([^)\s]+\.svg\)$/u;
const FOOTER = /^_Generated by BC Atlas/u;

/**
 * A page of the layers as its parts.
 * @returns { title, summary, picture, sections: [{ title, body }], footer }: each a block of Markdown without the empty lines around it
 */
export function parsePage(text, kind) {
  const lines = text.replace(/\n+$/u, "").split("\n");
  const block = (part) => part.join("\n").replace(/^\n+|\n+$/gu, "");
  let end = lines.length;
  let footer = "";
  if (FOOTER.test(lines.at(-1))) {
    end -= 1;
    // The first page ends with where the graph itself is: that goes with the footer, whatever the sections are.
    let from = end;
    if (kind === "readme") {
      const closing = lines.findLastIndex((line, at) => at < end && line.startsWith("The graph itself is in "));
      if (closing > 0) from = closing;
    }
    footer = block(lines.slice(from));
    end = from;
  }
  const heads = [];
  let fenced = false;
  for (let at = 1; at < end; at++) {
    if (lines[at].startsWith("```")) fenced = !fenced;
    if (!fenced && lines[at].startsWith("## ")) heads.push(at);
  }
  const lead = lines.slice(1, heads[0] ?? end);
  const pictures = lead.filter((line) => PICTURE.test(line));
  return {
    title: lines[0].replace(/^# /u, ""),
    summary: block(lead),
    plain: block(lead.filter((line) => !PICTURE.test(line))).replace(/\n{3,}/gu, "\n\n"),
    picture: pictures.join("\n\n"),
    sections: heads.map((at, position) => ({ title: lines[at].slice(3).trim(), body: block(lines.slice(at + 1, heads[position + 1] ?? end)) })),
    footer
  };
}

/** The file of a page from a pattern of `names`. */
function fileOf(pattern, facts) {
  return pattern.replace(/\{([^{}]*)\}/gu, (_, key) => slug(facts[key] ?? "")).split("/")
    .map((part) => part.replace(/-{2,}/gu, "-").replace(/^-+|-+(?=\.md$)|-+$/gu, "").replace(/^\.md$/u, "unnamed.md") || "unnamed").join("/");
}

/**
 * Makes the built pages the pages of the profile: leaves out, names, cuts, titles, translates, and
 * lays out, and lets every link and picture follow. A link to a page that is not written becomes its text.
 * @param files Map<path, text> as buildLayers() made it
 * @param pages Map<path, { kind, name, type?, id?, app?, namespace? }>: what each Markdown page is of; kind is a kind of LAYERS_PAGE_KINDS
 * @param pictures Map<path of a picture, { page, suffix }>: the page each picture belongs to
 * @param options { system }: the name of the system
 * @returns { files: Map<path, text>, fixed: { readme?, architecture?, findings? } } the paths of the pages there is one of
 */
export function applyProfile(files, pages, pictures, profile, { system = "" } = {}) {
  const fixedOf = (to) => Object.fromEntries([...pages].filter(([file, page]) => SINGLE.has(page.kind) && to.has(file)).map(([file, page]) => [page.kind, to.get(file)]));
  if (!profile || profile.plain) return { files, fixed: fixedOf(new Map([...files.keys()].map((file) => [file, file]))) };
  const words = LANGUAGES[profile.language];

  // Where each file goes, and which are left out.
  const to = new Map();
  const taken = new Map();
  const claim = (target, source, what) => {
    const key = target.toLowerCase();
    if (taken.has(key)) throw new UsageError(`layers.names in .bca.json gives two pages one file: ${taken.get(key)} and ${what} would both be ${target}. Add a placeholder that tells them apart, such as {id} or {type}`);
    taken.set(key, what);
    to.set(source, target);
  };
  const said = (page) => `${SECTION_KIND[page.kind]} "${page.type ? `${page.type} ${page.id ? `${page.id} ` : ""}` : ""}${page.name}"`;
  for (const [file, page] of pages) {
    if (!files.has(file) || (SINGLE.has(page.kind) && profile.pages[page.kind] === false)) continue;
    claim(profile.names[page.kind] ? fileOf(profile.names[page.kind], page) : file, file, said(page));
  }
  for (const file of files.keys()) {
    if (pages.has(file)) continue;
    const picture = pictures.get(file);
    if (!picture) claim(file, file, file);
    else if (to.has(picture.page)) {
      const target = to.get(picture.page);
      // The picture of the first page is system.svg next to it; the others have the name of their page.
      claim(target === picture.page ? file : picture.page === "README.md" ? path.posix.join(path.posix.dirname(target), "system.svg") : target.replace(/\.md$/u, `${picture.suffix}.svg`), file, `the picture of ${said(pages.get(picture.page))}`);
    }
  }

  const title = (kind, name) => profile.titles[`${kind}.${name}`] ?? profile.titles[name] ?? words?.headings[name] ?? name;
  // What the pages there is one of are called now, for the links that name them.
  const called = new Map([...pages].filter(([, page]) => page.kind !== "readme" && FIXED_TITLES[page.kind]).map(([file, page]) => [file, [FIXED_TITLES[page.kind], title(page.kind, FIXED_TITLES[page.kind])]]));

  const result = new Map();
  for (const [file, text] of files) {
    if (!to.has(file)) continue;
    const target = to.get(file);
    const page = pages.get(file);
    if (!page) {
      result.set(target, text);
      continue;
    }
    const kind = SECTION_KIND[page.kind];
    const parsed = parsePage(text, kind);
    const order = profile.sections[kind];
    const kept = order ? order.map((name) => parsed.sections.find((section) => section.title === name)).filter(Boolean) : parsed.sections;
    const sections = kept.map((section) => ({ ...section, heading: title(kind, section.title) }));
    // The anchors of this page: a link to a section that has another title follows, one to a section that is gone becomes text.
    const anchors = new Map(parsed.sections.map((section) => [anchor(section.title), sections.find((candidate) => candidate.title === section.title)]));
    const relink = (block) => block.replace(/(!?)\[((?:[^\]\\]|\\.)*)\]\(([^)\s]+)\)/gu, (whole, image, label, href) => {
      if (/^[a-z][a-z0-9+.-]*:/iu.test(href)) return whole;
      const [where, hash] = href.split("#");
      if (!where) {
        if (!anchors.has(hash)) return whole;
        return anchors.get(hash) ? `[${label}](#${anchor(anchors.get(hash).heading)})` : label;
      }
      const source = path.posix.normalize(path.posix.join(path.posix.dirname(file), where));
      // What is not a file of the layers stays where it is.
      const outside = source.startsWith("../") || !files.has(source);
      if (!outside && !to.has(source)) return image ? "" : label;
      const text = !image && called.get(source)?.[0] === label ? called.get(source)[1] : label;
      return `${image}[${text}](${relative(target, outside ? source : to.get(source))}${hash === undefined ? "" : `#${hash}`})`;
    });
    const made = (block) => relink(words ? translate(block, words) : block).replace(/\n{3,}/gu, "\n\n").replace(/^\n+|\n+$/gu, "");
    const heading = page.kind === "readme" ? profile.titles.README ?? parsed.title
      : FIXED_TITLES[page.kind] ? title(kind, parsed.title)
        : words && ["app", "namespace"].includes(kind) ? parsed.title.replace(/^(App|Namespace) /u, (_, holder) => `${words.holders[holder]} `) : parsed.title;
    const parts = { title: heading, summary: made(parsed.summary), plain: made(parsed.plain), picture: made(parsed.picture), footer: made(parsed.footer) };
    const bodies = new Map(sections.map((section) => [section.title, made(section.body)]));
    const whole = (section) => `## ${section.heading}${bodies.get(section.title) ? `\n\n${bodies.get(section.title)}` : ""}`;
    const template = profile.templates[kind];
    if (!template) {
      result.set(target, `${[`# ${heading}`, parts.summary, ...sections.map(whole), parts.footer].filter(Boolean).join("\n\n")}\n`);
      continue;
    }
    const placed = new Set(template.lines.flat().filter((part) => part.section !== undefined).map((part) => part.section));
    const ownPicture = template.lines.flat().some((part) => part.part === "picture");
    const facts = { name: page.name, type: page.type, id: page.id, app: page.app, namespace: page.namespace, system };
    const value = ({ part, section }) => {
      if (part === "section" || part === "body") {
        const found = sections.find((candidate) => candidate.title === section);
        return found ? (part === "section" ? whole(found) : bodies.get(found.title)) : "";
      }
      if (part === "sections") return sections.filter((section) => !placed.has(section.title)).map(whole).join("\n\n");
      if (part === "summary") return ownPicture ? parts.plain : parts.summary;
      return parts[part] ?? String(facts[part] ?? "");
    };
    const lines = [];
    for (const line of template.lines) {
      const written = line.map((part) => (typeof part === "string" ? part : value(part))).join("");
      // A line of placeholders with nothing to say is no line.
      if (!written.trim() && line.some((part) => typeof part !== "string")) continue;
      lines.push(written);
    }
    result.set(target, `${lines.join("\n").replace(/\n{3,}/gu, "\n\n").replace(/^\n+|\s+$/gu, "")}\n`);
  }
  return { files: result, fixed: fixedOf(to) };
}
