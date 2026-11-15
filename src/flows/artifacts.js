// What a flow can make from the source: the artifacts of BC Atlas, each with
// where it is saved by default and the options a step may set. A step of a
// flow names one artifact (`what`), where to save it (`to`), and its options:
//
//   { "what": "layers", "to": "docs/system" }
//   { "what": "view", "lens": "data", "form": "diagram", "to": "docs/pictures/data.svg" }
//
// The view shows the same catalog in its Flow menu, and `bca flow --artifacts` prints it.
import fs from "node:fs/promises";
import path from "node:path";
import { KNOWLEDGE_FORMATS, VIEW_FORMS, VIEWS } from "../capabilities.js";

const DIAGRAM_VIEWS = VIEWS.map(([id]) => id);
const LANGUAGES = ["en", "de"];
const text = (title, hint) => ({ title, hint });
const choice = (title, values, hint) => ({ title, values, hint });

/**
 * The artifacts by id. `target` is what a step saves: a folder, one file, or
 * nothing ("gate": it only passes or fails). `extensions` are the kinds of file
 * a file target can be; the first is the default. `stable: false` marks an
 * artifact that differs on every run (it holds the time it was made), which
 * the sync mode verify would report every time.
 */
export const ARTIFACTS = Object.freeze({
  layers: {
    title: "Layered documentation",
    summary: "How it works, how it is connected, and what to change, from the whole down to each procedure: one page per app, component, namespace, and object",
    target: "folder",
    to: "docs/layers",
    options: { pictures: choice("Pictures of single objects", ["auto", "all", "none"]) }
  },
  report: {
    title: "Architecture report",
    summary: "One Markdown page with the health of the architecture and its diagrams",
    target: "folder",
    to: "docs/atlas",
    options: { views: text("Diagrams", "comma-separated: project, module, data, contracts, events, ui"), format: choice("Diagrams as", ["svg", "d2"]) }
  },
  handbook: {
    title: "System handbook",
    summary: "Events, data, permissions, interfaces, user interface, and code health across all objects",
    target: "folder",
    to: "docs/handbook",
    options: { language: choice("Language", LANGUAGES), title: text("Title"), catalog: text("Object catalog to link to", "a folder, such as docs/codegraph") }
  },
  catalog: {
    title: "Object catalog",
    summary: "One linked Markdown page per AL object",
    target: "folder",
    to: "docs/codegraph",
    options: {}
  },
  docs: {
    title: "User guides",
    summary: "User guides or test cases from the AL UI tests ([SCENARIO], [GIVEN], [WHEN], [THEN])",
    target: "folder",
    to: "docs/guides",
    options: {
      tests: text("Folder with the UI tests", "default: docs.tests in .bca.json"),
      as: choice("Written as", ["guide", "test-case"]),
      export: text("Formats", "comma-separated: markdown, html, dita, azure-devops"),
      language: text("Language", "a language of the app's translations, such as de-DE"),
      title: text("Title")
    }
  },
  simulate: {
    title: "Battle test",
    summary: "The people of the company perform the process tests; fails when a role is blocked or can do what it must not",
    target: "folder",
    to: "docs/simulation",
    gate: true,
    options: { tests: text("Folder with the process tests", "default: simulation.tests in .bca.json"), language: choice("Language", LANGUAGES) }
  },
  check: {
    title: "Health check",
    summary: "The gate: cycles, forbidden dependencies, architecture violations, diagnostics. Saves its report when it has a place",
    target: "file",
    optional: true,
    extensions: ["md", "json", "sarif", "txt"],
    gate: true,
    options: { failOn: choice("Fails on", ["error", "warning", "info", "never"]) }
  },
  view: {
    title: "A view of the graph",
    summary: "Any lens or story of the view as a picture, a page, or data: what you see in the app, as a file",
    target: "file",
    to: "docs/pictures/overview.svg",
    extensions: ["svg", "png", "md", "csv", "json", "txt"],
    options: {
      lens: text("Lens", "overview, system, components, data, events, ... (bca view lists them)"),
      story: text("Story, instead of a lens", "system, architecture, fix, ..."),
      form: choice("Form", VIEW_FORMS),
      step: text("Step of the story", "from 1"),
      focus: text("Only around this node", "a name or a selector, such as table:Customer"),
      depth: text("Steps from that node"),
      inside: text("Inside this node", "an object, an app, a component, or a namespace"),
      find: text("Only what matches"),
      hide: text("Kinds of node to leave out", "comma-separated"),
      off: text("Kinds of relation to leave out", "comma-separated"),
      check: choice("With the findings", ["true"]),
      theme: choice("Theme", ["light", "dark"]),
      color: choice("Color by", ["type", "component", "namespace", "app", "level", "findings"]),
      size: choice("Size by", ["relations", "usedBy", "uses", "lines", "complexity", "objects", "findings"]),
      group: choice("Group by", ["component", "namespace", "app", "kind", "none"]),
      rows: choice("Rows of a CSV", ["nodes", "relations"]),
      width: text("Width in pixels"),
      height: text("Height in pixels")
    }
  },
  diagram: {
    title: "A diagram",
    summary: "One of the eleven diagram views (project, module, data, call, events, ui, workflow, ...), with every option of bca export",
    target: "file",
    to: "docs/diagrams/project.svg",
    extensions: ["svg", "png", "pdf", "d2", "json"],
    // A diagram takes every option of the graph (bca export --help), as an entry of "diagrams" does.
    open: true,
    options: { view: choice("View", DIAGRAM_VIEWS), direction: choice("Direction", ["right", "down", "left", "up"]), title: text("Title"), focus: text("Only around"), entry: text("Entry point (workflow)"), object: text("Object (object view)") }
  },
  app: {
    title: "The view as one file",
    summary: "The BC Atlas view as one offline HTML file to share: every lens, finding, and story",
    target: "file",
    to: "docs/bc-atlas.html",
    extensions: ["html"],
    stable: false,
    options: { title: text("Title") }
  },
  "knowledge-graph": {
    title: "Knowledge graph",
    summary: "The project as RDF with the BC Atlas OWL ontology, for triple stores",
    target: "file",
    to: "docs/knowledge-graph.ttl",
    extensions: [...KNOWLEDGE_FORMATS],
    stable: false,
    options: { baseIri: text("Base IRI"), title: text("Title") }
  }
});

const several = (value) => [value ?? []].flat().flatMap((item) => String(item).split(",")).map((item) => item.trim()).filter(Boolean);

/** What a step saves, relative to the project: the folder or file, and what is written next to it. */
export function stepOutputs(step) {
  if (!step.to) return [];
  // A diagram that is not D2 or JSON keeps its D2 source next to it.
  if (step.what === "diagram" && !/\.(?:d2|json)$/iu.test(step.to)) return [...new Set([step.to, step.to.replace(/\.[^./]+$/u, ".d2")])];
  return [step.to];
}

/**
 * Makes one artifact.
 * @param step a normalized step: { what, to?, options }
 * @param context { root, config, values, log, flow, appPath, steps }
 * @returns { ok, summary }
 */
export async function makeArtifact(step, context) {
  const { root, config, values = {} } = context;
  const { options = {} } = step;
  const at = step.to ? path.resolve(root, step.to) : undefined;
  if (step.what === "layers") {
    const { syncLayers } = await import("../commands/layers.js");
    const result = await syncLayers(root, { ...values, ...options, output: at });
    return { ok: true, summary: `${result.current.written.length} written, ${result.current.removed.length} removed, ${result.current.unchanged.length} unchanged` };
  }
  if (step.what === "report") {
    const { generateReport } = await import("../commands/report.js");
    const result = await generateReport(root, {
      ...values,
      ...(options.views ? { views: several(options.views) } : {}),
      ...(options.format ? { format: options.format } : {}),
      outputDir: at,
      // Independent of the working directory, so verify gives the same result everywhere.
      regenerate: `bca run ${context.appPath ?? "."} --flow ${context.flow}`
    });
    return { ok: true, summary: `${result.diagrams.filter(({ skipped }) => !skipped).length} diagram(s)` };
  }
  if (step.what === "handbook") {
    const { generateHandbook } = await import("../handbook.js");
    // Object names link to a catalog: the one the step names, else the one this flow writes too.
    const catalog = options.catalog ?? context.steps?.find(({ what }) => what === "catalog")?.to;
    const result = await generateHandbook(root, { ...values, outputDir: at, title: options.title, language: options.language, catalog: catalog ? path.resolve(root, catalog) : undefined });
    return { ok: true, summary: `${result.pages.length} page(s)` };
  }
  if (step.what === "catalog") {
    const { generateCodeGraph } = await import("../codegraph.js");
    const result = await generateCodeGraph(root, { outputDir: at });
    return { ok: true, summary: `${result.objects} page(s)` };
  }
  if (step.what === "docs") {
    const { exportDocumentation } = await import("../docs/export.js");
    const { loadCorpus } = await import("../docs/model.js");
    const settings = { export: ["markdown", "html"], as: "guide", ...(config.docs ?? {}), ...options };
    if (!settings.tests) throw new Error("user guides need the folder with the AL UI tests: \"tests\" on the step, or \"docs.tests\" in .bca.json");
    const result = await exportDocumentation(await loadCorpus(path.resolve(root, settings.tests)), {
      formats: several(settings.export),
      mode: settings.as,
      language: settings.language,
      title: settings.title,
      appRoot: path.resolve(root, settings.app ?? "."),
      outputDirectory: at
    });
    for (const warning of result.warnings) context.log?.(`  warning: ${warning}`);
    return { ok: true, summary: `${result.catalog.tasks.length} scenario(s)` };
  }
  if (step.what === "simulate") {
    const { writeSimulation } = await import("../commands/simulate.js");
    const { simulationResultLine } = await import("../simulation/report.js");
    const { report } = await writeSimulation(root, {
      ...values,
      ...(options.tests ? { tests: path.resolve(root, options.tests) } : {}),
      ...(options.language ? { language: options.language } : {}),
      format: "markdown",
      output: path.join(at, "README.md")
    });
    return { ok: report.passed, summary: simulationResultLine(report) };
  }
  if (step.what === "check") {
    const { renderHealth, runHealthCheck } = await import("../commands/check.js");
    const { healthResultLine } = await import("../health.js");
    const { report, architecture } = await runHealthCheck(root, { ...values, ...options });
    if (at) {
      const format = { md: "markdown", json: "json", sarif: "sarif" }[path.extname(at).slice(1).toLowerCase()] ?? "text";
      await fs.mkdir(path.dirname(at), { recursive: true });
      await fs.writeFile(at, renderHealth(report, format, { root: architecture.options.projectRoot, fallbackFile: architecture.model.apps?.[0]?.path ?? "app.json" }));
    }
    return { ok: report.passed, summary: healthResultLine(report) };
  }
  if (step.what === "view") {
    const { writeView } = await import("../commands/view.js");
    const { scene, counts, atlas } = await writeView(root, { ...values, ...options, ...(options.check ? { check: true } : {}), output: at });
    return { ok: true, summary: scene ? `${scene.title}: ${counts?.nodes ?? scene.entries.length} node(s)` : atlas.title };
  }
  if (step.what === "diagram") {
    const { createArchitectureModel } = await import("../architecture.js");
    const { resolveOutput, writeArchitecture } = await import("../output.js");
    const architecture = await createArchitectureModel(root, { ...values, ...options, output: at });
    await writeArchitecture(architecture, resolveOutput({ output: at, format: options.format }));
    return { ok: true, summary: `${architecture.view}: ${architecture.model.objects.length} node(s)` };
  }
  if (step.what === "app" || step.what === "knowledge-graph") {
    const { runExport } = await import("../commands/export.js");
    await runExport(root, { ...values, ...options, view: step.what, output: at });
    return { ok: true, summary: ARTIFACTS[step.what].title };
  }
  throw new Error(`unknown artifact "${step.what}"`);
}
