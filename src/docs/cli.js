import { createAutomationPlan } from "./automation.js";
import { loadAlUiTest } from "./al-ui-source.js";
import { writeCorpusDocumentation, writeDocumentation } from "./markdown.js";
import { loadCorpus, scenarioSummary } from "./model.js";
import { documentationGlossary } from "./tags.js";
import { planMetadataEdit, writeMetadataEdit } from "./al-ui-writer.js";
import { CheckFailedError } from "../cli/errors.js";
import { displayPath } from "../output.js";

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

const display = displayPath;

function selectedScenario(corpus, id) {
  const scenario = corpus.byId.get(id);
  if (!scenario) {
    const known = corpus.scenarios.map(({ value }) => value.id).slice(0, 10);
    throw new Error(`document ID "${id}" was not found${known.length ? `; known IDs: ${known.join(", ")}` : ""}`);
  }
  return scenario;
}

async function list(input, values) {
  const corpus = await loadCorpus(input);
  const summaries = corpus.scenarios.map(scenarioSummary);
  if (values.format === "json") return printJson(summaries);
  if (!summaries.length) return console.log("No documented UI tests found.");
  for (const item of summaries) console.log(`${item.id}\t${item.title}\t${item.file}#${item.procedure}`);
}

async function show(input, values) {
  const corpus = await loadCorpus(input);
  const scenario = selectedScenario(corpus, values.id);
  const diagnostics = corpus.diagnostics.filter(({ documentId }) => documentId === values.id);
  if (values.format === "json") {
    return printJson({
      ...scenarioSummary(scenario),
      fileHash: scenario.fileHash,
      prerequisites: scenario.value.typedPrerequisites,
      permissions: scenario.value.permissions,
      diagnostics
    });
  }
  console.log(`${scenario.value.title} (${scenario.value.id})`);
  console.log(`${scenario.relativePath}#${scenario.value.procedure}`);
  for (const item of diagnostics) console.log(`${item.severity}: ${item.code}: ${item.message}`);
}

async function validate(input, values) {
  const corpus = await loadCorpus(input);
  if (values.format === "json") printJson(corpus.diagnostics);
  else if (!corpus.diagnostics.length) console.log(`Documentation corpus is valid (${corpus.scenarios.length} scenario(s)).`);
  else for (const item of corpus.diagnostics) console.error(`${item.severity}: ${item.code}: ${item.message}`);
  const serious = corpus.diagnostics.filter(({ severity }) =>
    severity === "error" || (values.strict && severity === "warning"));
  if (serious.length) throw new CheckFailedError(`${serious.length} documentation diagnostic(s)`);
}

async function generate(input, values) {
  if (values.procedure) {
    const source = await loadAlUiTest(input, { procedure: values.procedure });
    const filename = await writeDocumentation(source, values.outputDir);
    return values.format === "json" ? printJson([filename]) : console.log(`Wrote ${display(filename)}`);
  }
  const corpus = await loadCorpus(input);
  if (values.id) {
    const filename = await writeDocumentation(selectedScenario(corpus, values.id), values.outputDir, {
      catalog: corpus.byId
    });
    return values.format === "json" ? printJson([filename]) : console.log(`Wrote ${display(filename)}`);
  }
  const files = await writeCorpusDocumentation(corpus, values.outputDir);
  if (values.format === "json") return printJson(files);
  for (const filename of files) console.log(`Wrote ${display(filename)}`);
}

function glossary(_input, values) {
  const items = documentationGlossary();
  if (values.format === "json") return printJson(items);
  for (const item of items) console.log(`[${item.tag}]\t${item.value}\t${item.cardinality}\t${item.description}`);
}

async function automation(input, values) {
  const plan = await createAutomationPlan(await loadCorpus(input), {
    provider: values.provider,
    inputPath: input,
    outputDirectory: values.outputDir
  });
  if (values.format === "json") return printJson(plan);
  console.log(plan.pipeline.content);
}

async function mutate(input, values, remove) {
  const plan = await planMetadataEdit(input, values.id, {
    tag: values.tag,
    value: values.value,
    qualifier: values.qualifier?.toUpperCase(),
    expectedFileHash: values.expectedHash,
    remove
  });
  if (!values.dryRun) await writeMetadataEdit(plan);
  const result = {
    changed: plan.changed,
    written: plan.changed && !values.dryRun,
    file: plan.relativePath,
    procedure: plan.procedure,
    documentId: plan.documentId,
    fileHash: plan.fileHash
  };
  if (values.format === "json") return printJson(values.dryRun ? { ...result, preview: plan.preview } : result);
  if (values.dryRun) return console.log(plan.preview);
  console.log(`${plan.changed ? "Updated" : "Unchanged"} ${plan.relativePath}#${plan.procedure}`);
}

export const DOCS_COMMANDS = {
  "docs.list": list,
  "docs.show": show,
  "docs.validate": validate,
  "docs.generate": generate,
  "docs.set": (input, values) => mutate(input, values, false),
  "docs.unset": (input, values) => mutate(input, values, true),
  "docs.automation": automation,
  "docs.glossary": glossary
};
