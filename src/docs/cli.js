import path from "node:path";
import { parseArgs } from "node:util";
import { loadAlUiTest } from "./al-ui-source.js";
import { writeCorpusDocumentation, writeDocumentation } from "./markdown.js";
import { loadCorpus, scenarioSummary } from "./model.js";
import { documentationGlossary } from "./tags.js";
import { planMetadataEdit, writeMetadataEdit } from "./al-ui-writer.js";
import { startDocsServer } from "./server.js";

const HELP = `BC Atlas docs - documentation from AL UI tests

Usage:
  bca docs list [options] <file-or-directory>
  bca docs show [options] <file-or-directory>
  bca docs validate [options] <file-or-directory>
  bca docs generate [options] <file-or-directory>
  bca docs set [options] <file-or-directory>
  bca docs unset [options] <file-or-directory>
  bca docs glossary [options]
  bca docs serve [options] <file-or-directory>

Options:
      --procedure <name>     [Test] procedure to document
      --id <document-id>     Select a scenario by stable document ID
      --output-dir <path>    Markdown output directory (default: docs/generated)
      --format <format>      text or json (default: text)
      --tag <tag>            Documentation tag to set or unset
      --value <value>        Tag value
      --qualifier <type>     GIVEN prerequisite type
      --expected-hash <hash> Reject writes if the AL file has changed
      --dry-run              Preview without writing the AL file
      --port <number>        Local server port (default: available port)
      --strict               Fail validation on warnings as well as errors
  -h, --help                 Show help
`;

const OPTIONS = {
  procedure: { type: "string" },
  id: { type: "string" },
  "output-dir": { type: "string" },
  format: { type: "string" },
  tag: { type: "string" },
  value: { type: "string" },
  qualifier: { type: "string" },
  "expected-hash": { type: "string" },
  "dry-run": { type: "boolean" },
  port: { type: "string" },
  strict: { type: "boolean" },
  help: { type: "boolean", short: "h" }
};

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function outputFormat(values) {
  const format = values.format ?? "text";
  if (!["text", "json"].includes(format)) throw new Error(`unsupported docs format: ${format}`);
  return format;
}

async function operation(action) {
  try {
    return await action();
  } catch (error) {
    error.exitCode ??= 1;
    throw error;
  }
}

function selectedScenario(corpus, id) {
  if (!id) throw new Error("--id is required");
  const scenario = corpus.byId.get(id);
  if (!scenario) throw new Error(`document ID "${id}" was not found`);
  return scenario;
}

function seriousDiagnostics(corpus, strict) {
  return corpus.diagnostics.filter(({ severity }) =>
    severity === "error" || (strict && severity === "warning")
  );
}

async function listCommand(input, values) {
  const corpus = await loadCorpus(input);
  const summaries = corpus.scenarios.map(scenarioSummary);
  if (outputFormat(values) === "json") return printJson(summaries);
  for (const item of summaries) {
    console.log(`${item.id}\t${item.title}\t${item.file}#${item.procedure}`);
  }
}

async function showCommand(input, values) {
  const corpus = await loadCorpus(input);
  const scenario = selectedScenario(corpus, values.id);
  if (outputFormat(values) === "json") return printJson({
    ...scenarioSummary(scenario),
    prerequisites: scenario.value.typedPrerequisites,
    permissions: scenario.value.permissions,
    diagnostics: corpus.diagnostics.filter(({ documentId }) => documentId === values.id)
  });
  console.log(`${scenario.value.title} (${scenario.value.id})`);
  console.log(`${scenario.relativePath}#${scenario.value.procedure}`);
}

async function validateCommand(input, values) {
  const corpus = await loadCorpus(input);
  if (outputFormat(values) === "json") printJson(corpus.diagnostics);
  else if (!corpus.diagnostics.length) console.log("Documentation corpus is valid.");
  else for (const item of corpus.diagnostics) {
    console.error(`${item.severity}: ${item.code}: ${item.message}`);
  }
  if (seriousDiagnostics(corpus, values.strict).length) process.exitCode = 1;
}

async function generateCommand(input, values) {
  if (values.procedure) {
    const source = await loadAlUiTest(input, { procedure: values.procedure });
    const filename = await writeDocumentation(source, values["output-dir"]);
    return console.log(`wrote ${path.relative(process.cwd(), filename).replaceAll("\\", "/")}`);
  }
  const corpus = await loadCorpus(input);
  if (values.id) {
    const scenario = selectedScenario(corpus, values.id);
    const filename = await writeDocumentation(scenario, values["output-dir"], {
      catalog: corpus.byId
    });
    return console.log(`wrote ${path.relative(process.cwd(), filename).replaceAll("\\", "/")}`);
  }
  const files = await writeCorpusDocumentation(corpus, values["output-dir"]);
  if (outputFormat(values) === "json") return printJson(files);
  for (const filename of files) {
    console.log(`wrote ${path.relative(process.cwd(), filename).replaceAll("\\", "/")}`);
  }
}

function glossaryCommand(values) {
  const glossary = documentationGlossary();
  if (outputFormat(values) === "json") return printJson(glossary);
  for (const item of glossary) {
    console.log(`[${item.tag}]\t${item.value}\t${item.cardinality}\t${item.description}`);
  }
}

async function mutationCommand(input, values, remove) {
  if (!values.id) throw new Error("--id is required");
  if (!values.tag) throw new Error("--tag is required");
  const plan = await planMetadataEdit(input, values.id, {
    tag: values.tag,
    value: values.value,
    qualifier: values.qualifier?.toUpperCase(),
    expectedFileHash: values["expected-hash"],
    remove
  });
  if (!values["dry-run"]) await writeMetadataEdit(plan);
  const result = {
    changed: plan.changed,
    written: plan.changed && !values["dry-run"],
    file: plan.relativePath,
    procedure: plan.procedure,
    documentId: plan.documentId,
    fileHash: plan.fileHash
  };
  if (outputFormat(values) === "json") return printJson(result);
  if (values["dry-run"]) return console.log(plan.preview);
  console.log(`${plan.changed ? "updated" : "unchanged"} ${plan.relativePath}#${plan.procedure}`);
}

async function serveCommand(input, values) {
  const port = values.port === undefined ? 0 : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("--port must be an integer from 0 to 65535");
  }
  const { url } = await startDocsServer(input, { port });
  console.log(url);
}

export async function docsMain(args) {
  if (args[0] === "--help" || args[0] === "-h") return console.log(HELP);
  const command = args[0];
  const { values, positionals } = parseArgs({
    args: args.slice(1),
    allowPositionals: true,
    strict: true,
    options: OPTIONS
  });
  if (values.help || !command) return console.log(HELP);
  if (command === "glossary") {
    if (positionals.length) throw new Error("docs glossary does not accept an input path");
    return glossaryCommand(values);
  }
  if (positionals.length !== 1) throw new Error(`docs ${command} expects one AL file or directory`);
  if (command === "show" && !values.id) throw new Error("--id is required");
  if (["set", "unset"].includes(command) && (!values.id || !values.tag)) {
    throw new Error("--id and --tag are required");
  }
  if (command === "list") return operation(() => listCommand(positionals[0], values));
  if (command === "show") return operation(() => showCommand(positionals[0], values));
  if (command === "validate") return operation(() => validateCommand(positionals[0], values));
  if (command === "generate") return operation(() => generateCommand(positionals[0], values));
  if (command === "set") return operation(() => mutationCommand(positionals[0], values, false));
  if (command === "unset") return operation(() => mutationCommand(positionals[0], values, true));
  if (command === "serve") return operation(() => serveCommand(positionals[0], values));
  throw new Error(`unknown docs command: ${command}`);
}

export { HELP as DOCS_HELP };
