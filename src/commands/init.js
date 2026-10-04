import fs from "node:fs/promises";
import path from "node:path";
import { REPORT_VIEWS } from "../capabilities.js";
import { displayPath } from "../output.js";

const IGNORED_DIRECTORIES = new Set([".git", ".alpackages", ".vscode", "node_modules", ".snapshots", "docs"]);
const TEST_DIRECTORY = /^(test|tests|testapp|test-app|uitest|uitests)$/iu;

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw new Error(`cannot read ${file}: ${error.message}`);
  }
}

async function findTestDirectories(root, relative = "", depth = 0) {
  if (depth > 3) return [];
  const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true }).catch(() => []);
  const found = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || IGNORED_DIRECTORIES.has(entry.name)) continue;
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (TEST_DIRECTORY.test(entry.name)) found.push(child);
    else found.push(...await findTestDirectories(root, child, depth + 1));
  }
  return found;
}

async function gitRepository(start) {
  let directory = start;
  for (;;) {
    const config = path.join(directory, ".git", "config");
    const text = await fs.readFile(config, "utf8").catch(() => undefined);
    if (text) {
      const url = /\[remote "origin"\][^[]*?url\s*=\s*(\S+)/u.exec(text)?.[1];
      return { root: directory, url };
    }
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function sourceUrlTemplate(remote) {
  const match = /^(?:https:\/\/|git@)(github\.com|gitlab\.com)[/:]([^/]+)\/(.+?)(?:\.git)?\/?$/u.exec(remote ?? "");
  if (match) {
    const [, host, owner, repo] = match;
    return host === "github.com"
      ? `https://github.com/${owner}/${repo}/blob/{ref}/{file}#L{line}`
      : `https://gitlab.com/${owner}/${repo}/-/blob/{ref}/{file}#L{line}`;
  }
  const azure = /^https:\/\/(?:[^@/]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+?)\/?$/u.exec(remote ?? "");
  if (azure) {
    const [, organization, project, repo] = azure;
    return `https://dev.azure.com/${organization}/${project}/_git/${repo}?path=/{file}&version=GB{ref}&line={line}`;
  }
  return undefined;
}

/** Builds a starter configuration from what can be detected in the project. */
export async function createStarterConfig(root) {
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new Error(`init expects a directory: ${root}`);
  const app = await readJson(path.join(root, "app.json"));
  const testDirectories = await findTestDirectories(root);
  const repository = await gitRepository(root);

  const config = {
    title: `${app?.name ?? path.basename(root)} architecture`,
    view: "project",
    groupBy: "role",
    direction: "right",
    maxEdges: 500
  };
  if (testDirectories.length) config.exclude = testDirectories.map((directory) => `${directory}/**`);
  const sourceUrl = sourceUrlTemplate(repository?.url);
  if (sourceUrl) {
    config.sourceUrl = sourceUrl;
    config.sourceRef = "main";
    const prefix = path.relative(repository.root, root).replaceAll("\\", "/");
    if (prefix) config.sourcePathPrefix = prefix;
  }
  config.check = { failOn: "error", cycles: "warning", maxFanIn: 25, maxFanOut: 25 };
  config.report = { outputDir: "docs/atlas", views: [...REPORT_VIEWS], codegraph: false };
  config.forbiddenDependencies = [];
  return { config, app, testDirectories, repository };
}

export async function initCommand(input, values) {
  const root = path.resolve(input);
  const { config, app, testDirectories } = await createStarterConfig(root);
  const content = `${JSON.stringify(config, null, 2)}\n`;
  if (values.print) return process.stdout.write(content);

  const target = path.join(root, ".bca.json");
  if (!values.force) {
    const exists = await fs.stat(target).then(() => true, () => false);
    if (exists) throw new Error(`${target} already exists; use --force to overwrite or --print to preview`);
  }
  await fs.writeFile(target, content);
  console.log(`Created ${displayPath(target)}${app ? ` for ${app.name}` : ""}.`);
  if (!app) console.log("No app.json found here; point init at the folder that contains app.json for best results.");
  if (testDirectories.length) console.log(`Excluded test folders: ${testDirectories.join(", ")}`);
  const where = displayPath(root);
  console.log([
    "",
    "Next steps",
    `  bca setup ${where}      automate it: Git hooks, pipelines, schedules`,
    `  bca report ${where}     overview, health summary, and diagrams in docs/atlas`,
    `  bca check ${where}      architecture health gate for CI`,
    `  bca graph ${where} -o architecture.svg`
  ].join("\n"));
}
