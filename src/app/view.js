// The view without a window: what the toolbar of the app does, from a
// terminal or an agent. A state (lens, form, what is opened, found, hidden,
// the step of a story) gives the same scene the page draws (ui/scene.js) and
// the same picture (ui/graph.js), written as text, JSON, CSV, Markdown, SVG,
// or PNG. `bca view` and the MCP tool bc_atlas_view call it.
import { textWidth } from "../diagram/text.js";
import { UsageError } from "../cli/errors.js";
// Both register themselves, as they do in the page.
import "./ui/graph.js";
import "./ui/scene.js";

const S = globalThis.BCA_SCENE;
const GRAPH = globalThis.BCA_GRAPH;

export const VIEW_FORMATS = Object.freeze(["text", "json", "md", "csv", "svg", "png", "link"]);
export const VIEW_FORMS = S.FORMS;
export const VIEW_COLORS = S.COLORS;
export const VIEW_SIZES = S.SIZES;
export const VIEW_GROUPS = S.GROUPS;

// The colors of the page (ui/atlas.css), light and dark.
const LOOKS = {
  light: { background: "#ffffff", surface: "#ffffff", text: "#141414", muted: "#6b6b6b" },
  dark: { background: "#16171a", surface: "#16171a", text: "#ededed", muted: "#9a9a9a" }
};
const FONT = "Liberation Sans, Arial, Helvetica, sans-serif";

const plural = (count, word, many = `${word}s`) => `${Number(count).toLocaleString("en-US")} ${count === 1 ? word : many}`;
const normal = (value) => String(value ?? "").trim().toLowerCase().replaceAll('"', "");
const several = (value) => [value ?? []].flat().flatMap((item) => String(item).split(",")).map((item) => item.trim()).filter(Boolean);

/**
 * The node a selector names: an id, `codeunit:50100`, `table:Sales Header`,
 * `person:Anna`, or a name. Workspace objects come before those of other apps.
 */
function findNode(atlas, selector, what) {
  const exact = atlas.nodes.find(({ id }) => id === selector);
  if (exact) return exact;
  const [type, identity] = String(selector).includes(":") && !String(selector).includes("::") ? String(selector).split(/:(.*)/su, 2) : [undefined, selector];
  const wanted = normal(identity);
  const named = (node) => [node.label, node.objectId, String(node.label).replace(/ \(.*\)$/u, "")].some((value) => value !== undefined && normal(value) === wanted);
  const typed = (node) => !type || [node.type, node.kind].includes(type.toLowerCase());
  const matches = atlas.nodes.filter((node) => typed(node) && named(node));
  const own = matches.filter(({ external }) => !external);
  const found = own.length ? own : matches;
  if (!found.length) throw new UsageError(`${what} "${selector}" names no node; use a name, an ID, or a selector such as codeunit:50100`);
  if (found.length > 1) {
    throw new UsageError(`${what} "${selector}" names ${found.length} nodes: ${found.slice(0, 6).map((node) => `${S.kindOf(node)}:${node.objectId ?? node.label}`).join(", ")}; add the type, as in ${S.kindOf(found[0])}:${found[0].objectId ?? found[0].label}`);
  }
  return found[0];
}

const oneOf = (value, allowed, name) => {
  if (value !== undefined && value !== "" && !allowed.includes(value)) throw new UsageError(`${name} must be one of: ${allowed.join(", ")}`);
  return value ?? "";
};

/**
 * The state of the view a set of options asks for, as the page keeps it in its address.
 * @param options { lens, form, inside, focus, depth, select, find, check, story, step, color, size, group, hide, off }
 */
export function viewState(atlas, options = {}) {
  const state = { ...S.DEFAULTS };
  const story = options.story ? atlas.stories.find(({ id, title }) => id === options.story || normal(title) === normal(options.story)) : undefined;
  if (options.story && !story) throw new UsageError(`unknown story "${options.story}"; this project has: ${atlas.stories.map(({ id }) => id).join(", ")}`);
  if (story) {
    const step = Number(options.step ?? 1);
    if (!Number.isInteger(step) || step < 1 || step > story.steps.length) throw new UsageError(`--step must be a number from 1 to ${story.steps.length} for the story "${story.id}"`);
    Object.assign(state, { story: story.id, step: String(step - 1), lens: story.steps[step - 1].lens });
  } else {
    if (options.step !== undefined) throw new UsageError("--step needs --story");
    if (options.lens && !atlas.lenses.some(({ id }) => id === options.lens)) {
      throw new UsageError(`unknown lens "${options.lens}"; this project has: ${atlas.lenses.map(({ id }) => id).join(", ")}`);
    }
    state.lens = options.lens ?? atlas.lenses[0].id;
    if (options.inside) {
      const node = findNode(atlas, options.inside, "--inside");
      if (node.kind !== "object" || node.external) throw new UsageError(`--inside needs an object of the workspace; "${options.inside}" is ${node.external ? "in another app" : `a ${node.kind}`}`);
      state.inside = node.id;
    }
    if (options.focus) state.focus = findNode(atlas, options.focus, "--focus").id;
    if (options.depth !== undefined) {
      if (!/^[1-9]\d*$/u.test(String(options.depth))) throw new UsageError("--depth must be a positive integer");
      state.depth = String(options.depth);
    }
  }
  if (options.select) state.sel = findNode(atlas, options.select, "--select").id;
  state.form = oneOf(options.form, S.FORMS, "--form") || "2d";
  state.color = oneOf(options.color, S.COLORS, "--color");
  state.size = oneOf(options.size, S.SIZES, "--size");
  state.group = oneOf(options.group, S.GROUPS, "--group");
  state.q = options.find ?? "";
  state.check = options.check ? "1" : "";
  state.hide = several(options.hide).join("|");
  state.off = several(options.off).join("|");
  return state;
}

/** What there is to see, as data: the lenses and stories of the project with their sizes, and what they are read from. */
export function viewOverview(atlas) {
  const found = S.index(atlas);
  return {
    project: atlas.title,
    summary: atlas.summary,
    lenses: atlas.lenses.map((lens) => {
      const scene = S.scene(atlas, found, { ...S.DEFAULTS, lens: lens.id });
      return { id: lens.id, title: lens.title, summary: lens.summary, reads: lens.reads, nodes: scene.entries.length, relations: scene.edges.length };
    }),
    stories: atlas.stories.map(({ id, title, summary, kind, steps }) => ({ id, title, summary, kind, steps: steps.length })),
    findings: atlas.findings.length,
    sources: Object.fromEntries(atlas.sources)
  };
}

/** The overview: what there is to see, as the toolbar offers it. */
function overviewText(atlas, found) {
  const { summary } = atlas;
  const width = (items) => Math.max(...items.map((item) => item.length), 0);
  const scenes = atlas.lenses.map((lens) => S.scene(atlas, found, { ...S.DEFAULTS, lens: lens.id }));
  const lensWidth = width(atlas.lenses.map(({ id }) => id));
  const storyWidth = width(atlas.stories.map(({ id }) => id));
  return [
    `${atlas.title}: ${plural(summary.objects, "object")} in ${plural(summary.apps, "app")}, ${plural(summary.relations, "relation")}.`,
    `Health ${summary.health.passed ? "passed" : "failed"}: ${plural(summary.health.error, "error")}, ${plural(summary.health.warning, "warning")}, ${summary.health.info} info. Architecture (${summary.architecture.mode}): ${plural(summary.architecture.components, "component")}, ${plural(summary.architecture.violations, "dependency", "dependencies")} the wrong way.`,
    "",
    "Lenses (bca view --lens <id>)",
    ...atlas.lenses.map((lens, at) => `  ${lens.id.padEnd(lensWidth)}  ${`${plural(scenes[at].entries.length, "node")}, ${plural(scenes[at].edges.length, "relation")}`.padEnd(28)}  ${lens.summary}`),
    "",
    "Stories (bca view --story <id>)",
    ...atlas.stories.map((story) => `  ${story.id.padEnd(storyWidth)}  ${plural(story.steps.length, "step").padEnd(9)}  ${story.title}: ${story.summary}`),
    "",
    "Read from",
    ...atlas.sources.map(([name, value]) => `  ${name}: ${value}`),
    ""
  ].join("\n");
}

/** A scene as lines: its nodes by group, each with its findings and what it does. */
function sceneText(atlas, found, scene, flags, state) {
  const lit = S.highlight(atlas, scene, state);
  const rows = scene.entries.map((entry, at) => ({ ...entry, at: entry.at, place: at })).filter(({ place }) => flags.nodes[place] && (!lit || lit.has(place)));
  const out = new Map();
  for (const [from, to, kind] of scene.edges) {
    if (!flags.nodes[from] || !flags.nodes[to] || !flags.kinds[kind]) continue;
    const kinds = out.get(from) ?? out.set(from, new Map()).get(from);
    (kinds.get(kind) ?? kinds.set(kind, []).get(kind)).push(scene.entries[to].node.label);
  }
  const lines = [
    `${atlas.title}: ${scene.title}`,
    `${plural(rows.length, "node")}, ${plural(scene.edges.filter(([from, to, kind]) => flags.nodes[from] && flags.nodes[to] && flags.kinds[kind]).length, "relation")}. ${scene.summary}`,
    ""
  ];
  const groups = new Map();
  for (const row of rows) {
    const group = scene.groups[scene.nodes[row.place].group] || "";
    (groups.get(group) ?? groups.set(group, []).get(group)).push(row);
  }
  for (const [group, members] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    if (groups.size > 1 || group) lines.push(group || "(no group)");
    for (const { node, at, place } of members) {
      const findings = at >= 0 ? found.findingsOf.get(at) ?? [] : [];
      const facts = [
        node.objectId,
        node.external ? "other app" : undefined,
        node.level && scene.lens.color === "level" ? `${node.level}${node.canBe ? `, can be ${node.canBe}` : ""}` : undefined,
        node.status,
        findings.length ? `${plural(findings.length, "finding")}, worst ${found.worst(at)}` : undefined
      ].filter(Boolean);
      lines.push(`  ${S.kindOf(node)} ${node.label}${facts.length ? ` (${facts.join("; ")})` : ""}`);
      for (const [kind, targets] of out.get(place) ?? []) {
        lines.push(`    -> ${scene.kinds[kind].kind} ${targets.slice(0, 8).join(", ")}${targets.length > 8 ? `, and ${targets.length - 8} more` : ""}`);
      }
      if (state.check) for (const finding of findings) lines.push(`    ! ${finding.severity} ${finding.rule}: ${finding.message}${finding.fix ? ` Fix: ${finding.fix}` : ""}`);
    }
  }
  if (!rows.length) lines.push("Nothing to show here.");
  lines.push("");
  return lines.join("\n");
}

function storyText(atlas, story) {
  return [
    `${atlas.title}: ${story.title}`,
    story.summary,
    "",
    ...story.steps.flatMap((step, at) => [
      `${at + 1}. ${step.title}${step.status ? ` [${step.status}]` : ""}`,
      `   ${step.text}`,
      ...(step.nodes.length ? [`   On: ${step.nodes.slice(0, 8).map((node) => atlas.nodes[node].label).join(", ")}${step.nodes.length > 8 ? `, and ${step.nodes.length - 8} more` : ""}`] : []),
      ""
    ])
  ].join("\n");
}

/**
 * What the view shows for a set of options, in a format.
 * @param workspace the analyzed project (workspace.js)
 * @param options the state (see viewState), and: format (VIEW_FORMATS), rows ("nodes" | "relations", for csv),
 *   stories (true: every story as one document), width, height, theme ("light" | "dark")
 * @returns { content: string | Buffer, format, state, scene?, atlas }
 */
export async function renderView(workspace, options = {}) {
  const format = options.format ?? "text";
  if (!VIEW_FORMATS.includes(format)) throw new UsageError(`--format must be one of: ${VIEW_FORMATS.join(", ")}`);
  const atlas = await workspace.atlas();
  const found = S.index(atlas);
  const state = viewState(atlas, options);
  const asked = ["lens", "inside", "focus", "story", "find", "select", "hide", "off"].some((name) => options[name] !== undefined && options[name] !== "" && options[name] !== false);

  // Every story as one document.
  if (options.stories) {
    if (format === "json") return { content: `${JSON.stringify(atlas.stories, null, 2)}\n`, format, state, atlas };
    if (format === "md") return { content: `${S.documentation(atlas)}\n`, format, state, atlas };
    if (format === "text") return { content: atlas.stories.map((story) => storyText(atlas, story)).join("\n"), format, state, atlas };
    throw new UsageError(`--stories writes text, md, or json, not ${format}`);
  }
  // The toolbar itself: what there is to see.
  if (!asked && format === "text") return { content: overviewText(atlas, found), format, state, atlas };
  if (!asked && format === "json") return { content: `${JSON.stringify(atlas, null, 2)}\n`, format, state, atlas };
  if (format === "link") return { content: `${S.stateHash(state)}\n`, format, state, atlas };

  const story = atlas.stories.find(({ id }) => id === state.story);
  const pictures = format === "svg" || format === "png";
  // A story as a whole is text; one step of it (--step) is a view like any other.
  if (story && options.step === undefined && !pictures) {
    if (format === "text") return { content: storyText(atlas, story), format, state, atlas };
    if (format === "md") return { content: `${S.storyMarkdown(atlas, story)}\n`, format, state, atlas };
    if (format === "json") return { content: `${JSON.stringify(story, null, 2)}\n`, format, state, atlas };
    throw new UsageError("a story writes text, md, or json; add --step for the nodes of one step");
  }

  const within = state.inside ? await workspace.inside(state.inside) : undefined;
  const scene = S.scene(atlas, found, state, within);
  const flags = S.shown(scene, state);
  // In a list, what a search or a step lights up is what is listed.
  const lit = S.highlight(atlas, scene, state);
  if (lit && !pictures) flags.nodes.forEach((visible, at) => { if (visible && !lit.has(at)) flags.nodes[at] = 0; });
  const result = (content) => ({ content, format, state, scene, atlas });

  if (format === "text") return result(sceneText(atlas, found, scene, S.shown(scene, state), state));
  if (format === "json") return result(`${JSON.stringify(S.sceneData(atlas, found, scene, flags), null, 2)}\n`);
  if (format === "md") return result(`${S.lensMarkdown(atlas, found, scene, flags)}\n`);
  if (format === "csv") {
    const rows = options.rows ?? "nodes";
    if (!["nodes", "relations"].includes(rows)) throw new UsageError("--rows must be nodes or relations");
    return result(`${rows === "nodes" ? S.nodesCsv(found, scene, flags) : S.relationsCsv(scene, flags)}\n`);
  }

  // The picture, as the page draws it.
  const size = (value, name, fallback) => {
    if (value === undefined) return fallback;
    if (!/^[1-9]\d*$/u.test(String(value)) || Number(value) < 200 || Number(value) > 8000) throw new UsageError(`--${name} must be a number of pixels from 200 to 8000`);
    return Number(value);
  };
  const theme = options.theme ?? "light";
  if (!LOOKS[theme]) throw new UsageError("--theme must be light or dark");
  const svg = GRAPH.drawing(scene, {
    form: state.form,
    width: size(options.width, "width", 1440),
    height: size(options.height, "height", 900),
    visible: flags.nodes,
    shown: flags.kinds,
    highlight: lit,
    rings: state.check ? S.rings(scene, found) : undefined,
    sizes: S.sizeValues(scene, found, state.size, flags.degree),
    selected: state.sel && scene.place.has(state.sel) ? scene.place.get(state.sel) : -1,
    look: { ...LOOKS[theme], font: FONT },
    measure: (text) => textWidth(text, 12)
  });
  if (format === "svg") return result(`${svg}\n`);
  const { svgToPng } = await import("../diagram/png.js");
  return result(await svgToPng(svg));
}
