// Writes the documentation catalog in one or more formats.
import fs from "node:fs/promises";
import path from "node:path";
import { loadCaptionIndex } from "./captions.js";
import { SUPPORTED_PHRASE_LANGUAGES } from "./phrases.js";
import { layoutProcess, scenarioProcess, useCaseProcess } from "./process.js";
import { renderBpmn } from "./render/bpmn.js";
import { renderAzureDevOpsCsv } from "./render/csv.js";
import { renderDitaMap, renderDitaTask } from "./render/dita.js";
import { renderHtml } from "./render/html.js";
import { renderGuide, renderIndex, renderTestCase, renderUseCase } from "./render/markdown.js";
import { renderProcessSvg } from "./render/process-svg.js";
import { buildCatalog, journeyD2 } from "./task.js";

export const EXPORT_FORMATS = Object.freeze(["markdown", "html", "dita", "ado-csv", "bpmn"]);
export const DOCUMENT_MODES = Object.freeze(["guide", "testcase"]);

export function parseFormats(value) {
  const formats = (Array.isArray(value) ? value : [value ?? "markdown"])
    .flatMap((item) => String(item).split(","))
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const invalid = formats.filter((format) => !EXPORT_FORMATS.includes(format));
  if (invalid.length) throw new Error(`unsupported export format: ${invalid.join(", ")} (use ${EXPORT_FORMATS.join(", ")})`);
  return [...new Set(formats.length ? formats : ["markdown"])];
}

async function renderJourneySvg(source) {
  try {
    const { renderSvg } = await import("../svg.js");
    return await renderSvg(source, { pad: 16 });
  } catch {
    return undefined;
  }
}

/**
 * @param options { outputDirectory, formats, mode, language, appRoot, title, version }
 * @returns { files, catalog, warnings }
 */
export async function exportDocumentation(corpus, options = {}) {
  if (corpus.diagnostics.some(({ severity }) => severity === "error")) {
    throw new Error("documentation corpus has errors; run docs validate for details");
  }
  const formats = parseFormats(options.formats);
  const mode = options.mode ?? "guide";
  if (!DOCUMENT_MODES.includes(mode)) throw new Error(`--as must be one of: ${DOCUMENT_MODES.join(", ")}`);
  const language = options.language ?? "en-US";
  const warnings = [];
  const base = language.toLowerCase().split(/[-_]/u)[0];
  if (!SUPPORTED_PHRASE_LANGUAGES.includes(base)) {
    warnings.push(`no built-in wording for ${language}; instructions use English, captions use the ${language} translation when available`);
  }

  let captions;
  if (options.appRoot) {
    captions = await loadCaptionIndex(options.appRoot, { language: options.language });
    // English is the usual source language of AL captions; it needs no XLIFF.
    if (options.language && !captions.translationFile && !/^en\b/iu.test(options.language)) {
      warnings.push(`no ${options.language} XLIFF file found under ${options.appRoot}; using the captions from the AL source`);
    }
  }
  const catalog = buildCatalog(corpus, {
    language,
    captions,
    title: options.title ?? (captions?.appName ? `${captions.appName}` : undefined)
  });

  const directory = path.resolve(options.outputDirectory ?? process.env.BC_DOCS_OUTPUT ?? "docs/generated");
  await fs.mkdir(directory, { recursive: true });
  const files = [];
  const write = async (name, content) => {
    const file = path.join(directory, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
    files.push(file);
  };

  const visual = formats.includes("markdown") || formats.includes("html");
  const journey = journeyD2(catalog);
  let journeySvg;
  if (journey && visual) {
    journeySvg = await renderJourneySvg(journey);
  }
  // Every scenario gets a BPMN-style flow of its clicks; every use case a
  // process with one lane per permission set.
  const named = catalog.useCases.filter(({ feature }) => feature);
  const processes = new Map(named.map((useCase) => [useCase.id, useCaseProcess(useCase, catalog)]));
  const flows = new Map();
  if (visual) {
    for (const task of catalog.tasks) flows.set(task.id, renderProcessSvg(layoutProcess(scenarioProcess(task))));
  }

  if (formats.includes("markdown")) {
    for (const task of catalog.tasks) {
      await write(`diagrams/${task.id}.svg`, flows.get(task.id));
      const flowImage = `diagrams/${task.id}.svg`;
      await write(`${task.id}.md`, mode === "testcase" ? renderTestCase(task, { flowImage }) : renderGuide(task, { flowImage }));
    }
    for (const useCase of named) {
      await write(`diagrams/${useCase.id}.svg`, renderProcessSvg(layoutProcess(processes.get(useCase.id))));
      await write(`${useCase.id}.md`, renderUseCase(useCase, catalog, {
        processImage: `diagrams/${useCase.id}.svg`,
        bpmnFile: formats.includes("bpmn") ? `${useCase.id}.bpmn` : undefined
      }));
    }
    if (journey) {
      await write("journey.d2", journey);
      if (journeySvg) await write("journey.svg", journeySvg);
    }
    await write("index.md", renderIndex(catalog, { journeyImage: journeySvg ? "journey.svg" : undefined }));
  }
  if (formats.includes("html")) {
    const processSvgs = new Map([...processes].map(([id, process]) => [id, renderProcessSvg(layoutProcess(process), {
      linkFor: (node) => (node.task ? `#${node.task.id}` : undefined)
    })]));
    await write("index.html", renderHtml(catalog, { mode, journeySvg, flows, processes: processSvgs }));
  }
  if (formats.includes("dita")) {
    for (const task of catalog.tasks) await write(`${task.id}.dita`, renderDitaTask(task));
    await write("documentation.ditamap", renderDitaMap(catalog));
  }
  if (formats.includes("ado-csv")) {
    await write("test-cases.csv", renderAzureDevOpsCsv(catalog));
  }
  if (formats.includes("bpmn")) {
    for (const [id, process] of processes) await write(`${id}.bpmn`, renderBpmn(process, { version: options.version }));
  }
  return { files, catalog, warnings };
}
