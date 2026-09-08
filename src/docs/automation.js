import fs from "node:fs/promises";
import path from "node:path";

const PROVIDERS = {
  github: {
    label: "GitHub Actions",
    filename: ".github/workflows/bc-atlas-docs.yml"
  },
  "azure-devops": {
    label: "Azure Pipelines",
    filename: "azure-pipelines-docs.yml"
  }
};

function shellArgument(value) {
  const text = String(value);
  if (/\r|\n/u.test(text)) throw new Error("automation paths cannot contain line breaks");
  return `'${text.replaceAll("'", "'\\''")}'`;
}

async function packageVersion() {
  const packageJson = JSON.parse(await fs.readFile(new URL("../../package.json", import.meta.url)));
  return packageJson.version;
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function checkoutPath(value, name, checkoutRoot) {
  const absolute = path.resolve(checkoutRoot, value);
  const relative = path.relative(checkoutRoot, absolute).replaceAll("\\", "/") || ".";
  if (relative === ".." || relative.startsWith("../")) {
    throw new Error(`${name} must be inside the checkout: ${value}`);
  }
  return relative;
}

function localCommands(inputPath, outputDirectory) {
  return [
    `bca docs package ${shellArgument(inputPath)} --output-dir ${shellArgument(outputDirectory)} --strict`
  ];
}

function pipelineCommands(inputPath, outputDirectory) {
  return [
    `bca docs package ${shellArgument(inputPath)} --output-dir ${shellArgument(outputDirectory)} --check --strict`
  ];
}

function githubPipeline(commands, version) {
  return `name: BC Atlas documentation

on:
  push:
  pull_request:

permissions:
  contents: read

jobs:
  documentation:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install --global bc-atlas@${version}
${commands.map((command) => `      - run: ${command}`).join("\n")}
`;
}

function azurePipeline(commands, version) {
  return `trigger:
  - main

pr:
  - main

pool:
  vmImage: ubuntu-latest

steps:
  - checkout: self
  - task: NodeTool@0
    inputs:
      versionSpec: 20.x
  - script: npm install --global bc-atlas@${version}
    displayName: Install BC Atlas
${commands.map((command) => `  - script: ${command}\n    displayName: Verify documentation package`).join("\n")}
`;
}

export async function createAutomationPlan(corpus, options = {}) {
  const provider = options.provider ?? "github";
  const definition = PROVIDERS[provider];
  if (!definition) throw new Error(`unsupported automation provider: ${provider}`);

  const requestedInput = options.inputPath ?? ".";
  const absoluteInput = path.resolve(requestedInput);
  const inputRoot = path.extname(absoluteInput).toLowerCase() === ".al"
    ? path.dirname(absoluteInput)
    : absoluteInput;
  const checkoutRoot = isWithin(process.cwd(), absoluteInput) ? process.cwd() : inputRoot;
  const inputPath = checkoutPath(absoluteInput, "automation input path", checkoutRoot);
  const outputDirectory = checkoutPath(
    options.outputDirectory ?? "docs/generated",
    "automation output directory",
    checkoutRoot
  );
  const commands = localCommands(inputPath, outputDirectory);
  const ciCommands = pipelineCommands(inputPath, outputDirectory);
  const stableIds = corpus.scenarios.filter(({ value }) => value.idSource === "explicit").length;
  const checks = {
    scenarios: corpus.scenarios.length,
    stableIds,
    issues: corpus.diagnostics.length
  };
  const version = await packageVersion();

  return {
    provider,
    providerLabel: definition.label,
    inputPath,
    outputDirectory,
    ready: checks.scenarios > 0 && checks.issues === 0,
    checks,
    commands,
    pipeline: {
      filename: definition.filename,
      content: provider === "github"
        ? githubPipeline(ciCommands, version)
        : azurePipeline(ciCommands, version)
    }
  };
}