import fs from "node:fs/promises";

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

function pipelineCommands(inputPath, outputDirectory) {
  return [
    `bca docs validate ${shellArgument(inputPath)} --strict`,
    `bca docs generate ${shellArgument(inputPath)} --output-dir ${shellArgument(outputDirectory)}`,
    `git diff --exit-code -- ${shellArgument(outputDirectory)}`
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
${commands.map((command, index) => `  - script: ${command}\n    displayName: ${["Validate documentation", "Generate Markdown", "Verify generated files"][index]}`).join("\n")}
`;
}

export async function createAutomationPlan(corpus, options = {}) {
  const provider = options.provider ?? "github";
  const definition = PROVIDERS[provider];
  if (!definition) throw new Error(`unsupported automation provider: ${provider}`);

  const inputPath = options.inputPath ?? ".";
  const outputDirectory = options.outputDirectory ?? "docs/generated";
  const commands = pipelineCommands(inputPath, outputDirectory);
  const ciCommands = pipelineCommands(".", outputDirectory);
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
    ready: checks.scenarios > 0 && checks.stableIds === checks.scenarios && checks.issues === 0,
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