// BC Atlas AI, a built-in BC Atlas plugin (plugin API 1): narrative
// documentation written by a language model from the facts BC Atlas reads
// from the source. plugin.json declares what it contributes:
//
//   commands   bca ai status | context | write
//   tasks.ai   the "ai" task of bca run (after layers), with its outputs
//   mcpTools   bc_atlas_ai_context, bc_atlas_ai_write
//
// BC Atlas itself stays as it is: it reads the source and calls no model.
// This plugin is the one place a model is called, through one
// OpenAI-compatible endpoint (src/model.js), and only for text. What it
// writes from is the grounding (src/grounding.js), kept next to each page.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { groundingOf, subjectsOf } from "./grounding.js";
import { DEFAULTS, missingOf, resolveSettings, SYSTEM_PROMPT, writeWithModel } from "./model.js";

const several = (value) => [value ?? []].flat().flatMap((item) => String(item).split(",")).map((item) => item.trim()).filter(Boolean);
const digest = (text) => createHash("sha256").update(text).digest("hex");
const MARK = /^<!-- bc-atlas-ai grounding:([0-9a-f]{64}) model:(.*?) -->/u;

/** The subjects that are asked for, or all. */
function pick(atlas, wanted) {
  const all = subjectsOf(atlas);
  if (!wanted.length) return all;
  return wanted.map((id) => {
    const found = all.find((subject) => subject.id.toLowerCase() === id.toLowerCase());
    if (!found) throw new Error(`there is no subject "${id}"; the subjects are: ${all.map((subject) => subject.id).join(", ")}`);
    return found;
  });
}

/** @param context the BC Atlas plugin context */
export function activate(context, { fetchImpl } = {}) {
  /** The project a command or an MCP tool is about: its graph and its ai settings. */
  async function project(root = context.root) {
    const here = path.resolve(root) === path.resolve(context.root);
    const config = here ? context.config : JSON.parse(await fs.readFile(path.join(root, ".bca.json"), "utf8").catch(() => "{}"));
    return { root: path.resolve(root), atlas: await context.services.atlas(here ? undefined : path.resolve(root)), settings: resolveSettings(config.ai ?? {}) };
  }

  async function status(root) {
    const { atlas, settings } = await project(root);
    const subjects = subjectsOf(atlas).map(({ id, title }) => ({ id, title }));
    const missing = [...settings.problems, ...missingOf(settings)];
    return {
      ready: !missing.length,
      endpoint: settings.endpoint || undefined,
      model: settings.model || undefined,
      key: settings.apiKey ? `set (${settings.keyVariable})` : `not set (${settings.keyVariable}); fine for an endpoint that needs none`,
      outputDir: settings.outputDir,
      language: settings.language,
      missing,
      subjects
    };
  }

  async function grounding(root, wanted) {
    const { atlas } = await project(root);
    return pick(atlas, wanted).map((subject) => ({ id: subject.id, title: subject.title, grounding: groundingOf(atlas, subject) }));
  }

  /**
   * Writes the pages of the asked subjects.
   * @returns { passed, outputDir, pages: [{ id, file, status }], written, lines } status: written, unchanged, or "would write"
   */
  async function write(root, { subjects: wanted = [], output, force = false, dryRun = false } = {}) {
    const { root: base, atlas, settings } = await project(root);
    if (settings.problems.length) throw new Error(settings.problems.join("; "));
    const outputDir = output ? path.resolve(output) : path.resolve(base, settings.outputDir);
    const pages = [];
    for (const subject of pick(atlas, wanted)) {
      const facts = groundingOf(atlas, subject);
      // What a page stands on: its facts, what the model is told, and the language. The model is in the mark too.
      const stamp = digest(`${SYSTEM_PROMPT}\n${settings.language}\n${facts}`);
      const file = path.join(outputDir, `${subject.file}.md`);
      const existing = await fs.readFile(file, "utf8").catch(() => undefined);
      const [, was, by] = existing?.match(MARK) ?? [];
      const page = { id: subject.id, title: subject.title, file: path.relative(base, file).replaceAll("\\", "/") };
      pages.push(page);
      if (!force && was === stamp && by === settings.model) {
        page.status = "unchanged";
        continue;
      }
      if (dryRun) {
        page.status = "would write";
        continue;
      }
      const answer = await writeWithModel(settings, facts, { fetchImpl });
      const factsFile = path.join(outputDir, "grounding", `${subject.file}.md`);
      await fs.mkdir(path.dirname(factsFile), { recursive: true });
      await fs.writeFile(factsFile, facts);
      await fs.writeFile(file, [
        `<!-- bc-atlas-ai grounding:${stamp} model:${settings.model} -->`,
        answer.text, "",
        "---", "",
        `_Written by a language model (${settings.model}) from facts BC Atlas read from the source. The facts are in [grounding/${subject.file}.md](grounding/${subject.file}.md); check what matters against them._`, ""
      ].join("\n"));
      page.status = "written";
      context.log(`ai: wrote ${page.file}`);
    }
    const written = pages.filter(({ status }) => status === "written").length;
    const pending = pages.filter(({ status }) => status === "would write").length;
    return {
      passed: true,
      dryRun,
      model: settings.model || undefined,
      outputDir: path.relative(base, outputDir).replaceAll("\\", "/") || ".",
      pages,
      written,
      lines: [
        ...pages.map(({ id, file, status }) => `${status.padEnd(11)} ${file}  (${id})`),
        dryRun ? `${pending} page(s) would be written, ${pages.length - pending} unchanged; no model was called` : `${written} page(s) written with ${settings.model}, ${pages.length - written} unchanged`
      ]
    };
  }

  return {
    commands: {
      status: async ({ root }) => {
        const result = await status(root);
        return { ...result, lines: [
          result.ready ? "Ready to write." : "Not ready to write:",
          ...result.missing.map((item) => `  missing: ${item}`),
          `Endpoint  ${result.endpoint ?? "(none)"}`,
          `Model     ${result.model ?? "(none)"}`,
          `Key       ${result.key}`,
          `Pages     ${result.outputDir}, in "${result.language}"`,
          "Subjects (bca ai context --subject <id>, bca ai write --subject <id>):",
          ...result.subjects.map(({ id, title }) => `  ${id}  ${title}`)
        ] };
      },
      context: async ({ root, values }) => {
        const subjects = await grounding(root, several(values.subject));
        return { subjects, lines: subjects.map(({ grounding: text }) => text.trimEnd()).join("\n\n---\n\n").split("\n") };
      },
      write: async ({ root, values }) => write(root, { subjects: several(values.subject), output: values.output, force: Boolean(values.force), dryRun: Boolean(values.dryRun) })
    },
    tasks: {
      ai: {
        async run() {
          const result = await write(context.root);
          return { ok: true, summary: `${result.written} page(s) written, ${result.pages.length - result.written} unchanged`, result };
        },
        outputs: (config) => [config.ai?.outputDir ?? DEFAULTS.outputDir]
      }
    },
    mcpTools: {
      async bc_atlas_ai_context({ path: root, subject }) {
        if (!subject) return { subjects: (await status(root)).subjects };
        return (await grounding(root, [subject]))[0];
      },
      async bc_atlas_ai_write({ path: root, subject, force, dryRun }) {
        const { lines: _lines, ...result } = await write(root, { subjects: subject ? [subject] : [], force: Boolean(force), dryRun: Boolean(dryRun) });
        return result;
      }
    },
    /** For bca plugins doctor: what is wrong with the ai section. */
    validateConfig: (settings) => resolveSettings(settings ?? {}).problems
  };
}

export { groundingOf, subjectsOf } from "./grounding.js";
export { resolveSettings, writeWithModel } from "./model.js";
