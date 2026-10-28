// BC Atlas for VS Code. Thin by design: the bc-atlas engine analyzes the
// project in a worker process and renders the pages; the extension shows
// them in a panel and connects them to the editor (Problems panel, CodeLens,
// status bar, side bar, commands, and the MCP server for AI agents).
"use strict";

const { existsSync } = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const vscode = require("vscode");
const { Engine, enginePath, runtime, runCli } = require("./engine");
const logic = require("./logic");

const SEVERITY = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information
};
const LOCAL_METHODS = new Set(["openFile", "saveFile"]);
const WATCHED = "**/{*.al,app.json,.bca.json,.bca-architecture-baseline.json}";

let output;
let engine;
let project;
let overview;
let objects = [];
let panel;
let diagnostics;
let status;
let tree;
let lenses;
let refreshTimer;

const config = () => vscode.workspace.getConfiguration("bcAtlas");
const log = (message) => output?.appendLine(message);

// ------------------------------------------------------------------ project

/** The folder to analyze: the setting, the remembered choice, or the first AL project found. */
async function findProject(context) {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (!folders.length) return undefined;
  const configured = config().get("project");
  if (configured) return path.resolve(folders[0].uri.fsPath, configured);
  const remembered = context.workspaceState.get("bcAtlas.project");
  if (remembered && existsSync(remembered)) return remembered;
  for (const folder of folders) {
    if (existsSync(path.join(folder.uri.fsPath, "app.json"))) return folder.uri.fsPath;
  }
  // A workspace of several apps: analyze them together from the first folder.
  const manifests = await vscode.workspace.findFiles("**/app.json", "**/{node_modules,.alpackages,.git}/**", 2);
  return manifests.length ? folders[0].uri.fsPath : undefined;
}

function startEngine() {
  engine?.stop();
  overview = undefined;
  objects = [];
  if (!project) return;
  const paths = config().get("paths") ?? [];
  engine = new Engine(project, paths.length ? { paths } : {}, { nodePath: config().get("nodePath") || undefined, log });
  log(`Analyzing ${project}`);
  refresh({ reanalyze: false });
}

// ----------------------------------------------------------------- results

async function refresh({ reanalyze = true } = {}) {
  if (!engine) return;
  updateStatus(undefined);
  try {
    if (reanalyze) await engine.request("refresh");
    overview = await engine.request("overview");
    objects = await engine.request("objects");
    updateStatus(overview);
    tree.refresh();
    lenses.fire();
    if (config().get("problems")) await updateProblems();
    else diagnostics.clear();
    panel?.post({ type: "changed" });
  } catch (error) {
    status.text = "$(error) BC Atlas";
    status.tooltip = error.message;
    log(`Analysis failed: ${error.message}`);
  }
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refresh(), 600);
}

async function updateProblems() {
  const health = await engine.request("health");
  const byFile = new Map();
  for (const problem of logic.findingsToProblems(health, overview.projectRoot)) {
    const range = new vscode.Range(problem.line, 0, problem.line, Number.MAX_SAFE_INTEGER);
    const diagnostic = new vscode.Diagnostic(range, problem.message, SEVERITY[problem.severity] ?? vscode.DiagnosticSeverity.Information);
    diagnostic.source = "BC Atlas";
    diagnostic.code = problem.code;
    const list = byFile.get(problem.file) ?? [];
    list.push(diagnostic);
    byFile.set(problem.file, list);
  }
  diagnostics.clear();
  for (const [file, list] of byFile) diagnostics.set(vscode.Uri.file(file), list);
  return health;
}

function updateStatus(current) {
  const { text, tooltip, tone } = logic.statusFor(current);
  status.command = { command: "bcAtlas.open", title: "Open BC Atlas", arguments: ["#/overview"] };
  status.text = text;
  status.tooltip = tooltip;
  status.backgroundColor = tone === "error" ? new vscode.ThemeColor("statusBarItem.errorBackground") : tone === "warning" ? new vscode.ThemeColor("statusBarItem.warningBackground") : undefined;
  status.show();
}

// -------------------------------------------------------------------- panel

class AtlasPanel {
  static async show(context, hash = "#/overview") {
    if (!engine) {
      vscode.window.showWarningMessage("BC Atlas found no AL project (app.json) in this workspace. Open an AL project or choose one with \"BC Atlas: Select Project\".");
      return;
    }
    if (panel) {
      panel.webview.reveal(vscode.ViewColumn.Active);
      panel.post({ type: "navigate", hash });
      return;
    }
    panel = new AtlasPanel(context);
    await panel.load(hash);
  }

  constructor(context) {
    this.webview = vscode.window.createWebviewPanel("bcAtlas", "BC Atlas", vscode.ViewColumn.Active, {
      enableScripts: true,
      // Keeps the 3D view and filters when the tab is in the background.
      retainContextWhenHidden: true,
      localResourceRoots: []
    });
    this.webview.iconPath = vscode.Uri.file(path.join(context.extensionPath, "media", "atlas.svg"));
    this.webview.onDidDispose(() => {
      panel = undefined;
    });
    this.webview.webview.onDidReceiveMessage((message) => this.receive(message));
  }

  async load(hash) {
    const { renderAppHtml } = await import(pathToFileURL(enginePath("src", "app", "page.js")).href);
    const csp = [
      "default-src 'none'",
      "img-src data: blob:",
      "font-src data:",
      "style-src 'unsafe-inline'",
      "script-src 'unsafe-inline'",
      "worker-src blob:",
      "frame-src data: blob:"
    ].join("; ");
    // The page starts on the requested page; later navigation goes through messages.
    const html = renderAppHtml({ mode: "vscode", csp, title: "BC Atlas" })
      .replace("</head>", () => `<script>history.replaceState(null, "", ${JSON.stringify(hash)});</script>\n</head>`);
    this.webview.webview.html = html;
  }

  post(message) {
    this.webview.webview.postMessage(message);
  }

  async receive(message) {
    if (message?.type !== "request") return;
    const { id, method, params } = message;
    try {
      const result = LOCAL_METHODS.has(method) ? await this[method](params) : await engine.request(method, params);
      if (method === "adoptArchitecture" || method === "updateBaseline") scheduleRefresh();
      this.post({ type: "response", id, result });
    } catch (error) {
      this.post({ type: "response", id, error: error.message });
    }
  }

  async openFile({ file, line }) {
    if (!file || !overview) throw new Error("no source file for this object");
    const document = await vscode.workspace.openTextDocument(path.join(overview.projectRoot, ...String(file).split("/")));
    const position = new vscode.Position(Math.max(0, (Number(line) || 1) - 1), 0);
    await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside, selection: new vscode.Range(position, position) });
    return true;
  }

  async saveFile({ name, content }) {
    const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(project, path.basename(String(name)))) });
    if (!target) return false;
    await vscode.workspace.fs.writeFile(target, Buffer.from(String(content), "utf8"));
    vscode.window.showInformationMessage(`Saved ${vscode.workspace.asRelativePath(target)}`);
    return true;
  }
}

// ----------------------------------------------------------- editor helpers

class PagesProvider {
  constructor() {
    this.changed = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.changed.event;
  }

  refresh() {
    this.changed.fire();
  }

  getTreeItem(item) {
    return item;
  }

  getChildren() {
    if (!engine) {
      const item = new vscode.TreeItem("No AL project found", vscode.TreeItemCollapsibleState.None);
      item.command = { command: "bcAtlas.selectProject", title: "Select Project" };
      return [item];
    }
    return logic.pages(overview).map((page) => {
      const item = new vscode.TreeItem(page.label, vscode.TreeItemCollapsibleState.None);
      item.description = page.description;
      item.iconPath = new vscode.ThemeIcon(page.icon);
      item.command = { command: "bcAtlas.open", title: "Open", arguments: [logic.pageHash(page.id)] };
      return item;
    });
  }
}

function currentObject() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !overview) return undefined;
  const relative = logic.projectPath(overview.projectRoot, editor.document.uri.fsPath);
  return relative ? logic.objectAt(objects, relative, editor.selection.active.line) : undefined;
}

function withCurrentObject(context, toHash) {
  const object = currentObject();
  if (!object) {
    vscode.window.showInformationMessage("Open an AL file of the analyzed project and place the cursor in an object.");
    return undefined;
  }
  return AtlasPanel.show(context, toHash(object));
}

// ------------------------------------------------------------- CLI commands

/** Runs a bca command in a terminal, for interactive commands such as setup. */
function runInTerminal(args) {
  const { command, env } = runtime(config().get("nodePath") || undefined);
  const terminal = vscode.window.createTerminal({
    name: "BC Atlas",
    cwd: project,
    shellPath: command,
    shellArgs: [enginePath("src", "cli.js"), ...args],
    env
  });
  terminal.show();
}

async function exportFiles() {
  const target = await vscode.window.showQuickPick(logic.EXPORTS.map((item) => ({ ...item, description: item.view })), { placeHolder: "What should BC Atlas write?" });
  if (!target) return;
  let destination;
  if (target.folder) {
    const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, defaultUri: vscode.Uri.file(project), openLabel: `Write ${target.folder.split("/").at(-1)} here` });
    if (!picked) return;
    destination = path.join(picked[0].fsPath, path.basename(target.folder));
  } else {
    const picked = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(project, target.file)), filters: target.filters });
    if (!picked) return;
    destination = picked.fsPath;
  }
  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `BC Atlas: writing ${target.label}…` }, () =>
      runCli(logic.exportArgs(target, project, destination), { cwd: project, nodePath: config().get("nodePath") || undefined, log }));
    const open = target.folder ? "Reveal" : "Open";
    const choice = await vscode.window.showInformationMessage(`BC Atlas wrote ${vscode.workspace.asRelativePath(destination)}.`, open);
    if (choice === "Reveal") vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(destination));
    if (choice === "Open") vscode.env.openExternal(vscode.Uri.file(destination));
  } catch (error) {
    vscode.window.showErrorMessage(`BC Atlas export failed: ${error.message}`, "Show Output").then((choice) => choice && output.show());
  }
}

async function generateDocs() {
  const tests = overview?.docs?.path;
  const folder = tests
    ? path.join(overview.projectRoot, tests)
    : (await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, defaultUri: vscode.Uri.file(project), openLabel: "Use these AL UI tests" }))?.[0]?.fsPath;
  if (!folder) return;
  const formats = await vscode.window.showQuickPick(["markdown", "html", "dita", "ado-csv", "bpmn"].map((label) => ({ label, picked: ["markdown", "html"].includes(label) })), { canPickMany: true, placeHolder: "Formats to write to docs/generated" });
  if (!formats?.length) return;
  const outputDir = path.join(project, "docs", "generated");
  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "BC Atlas: writing the guides…" }, () =>
      runCli(["docs", "generate", folder, "--app", project, "--export", formats.map(({ label }) => label).join(","), "--output-dir", outputDir], { cwd: project, nodePath: config().get("nodePath") || undefined, log }));
    vscode.window.showInformationMessage(`BC Atlas wrote the guides to ${vscode.workspace.asRelativePath(outputDir)}.`);
  } catch (error) {
    vscode.window.showErrorMessage(`BC Atlas could not write the guides: ${error.message}`, "Show Output").then((choice) => choice && output.show());
  }
}

async function runTasks() {
  const trigger = await vscode.window.showQuickPick([
    { label: "manual", detail: "The tasks configured for manual runs in .bca.json" },
    { label: "pre-commit", detail: "What the pre-commit hook runs" },
    { label: "pre-push", detail: "What the pre-push hook runs" },
    { label: "ci", detail: "What the pipeline runs" },
    { label: "schedule", detail: "What the scheduled run does" }
  ], { placeHolder: "Run the BC Atlas tasks of which trigger?" });
  if (trigger) runInTerminal(["run", project, "--trigger", trigger.label]);
}

async function selectProject(context) {
  const manifests = await vscode.workspace.findFiles("**/app.json", "**/{node_modules,.alpackages,.git}/**", 200);
  const folders = [...new Set([
    ...(vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath),
    ...manifests.map((uri) => path.dirname(uri.fsPath))
  ])];
  const picked = await vscode.window.showQuickPick(folders.map((folder) => ({ label: vscode.workspace.asRelativePath(folder, true) || folder, detail: folder, folder })), {
    placeHolder: "Which app or workspace should BC Atlas analyze? A folder above several apps analyzes them together."
  });
  if (!picked) return;
  await context.workspaceState.update("bcAtlas.project", picked.folder);
  project = picked.folder;
  startEngine();
  panel?.webview.dispose();
}

// ---------------------------------------------------------------- activate

async function activate(context) {
  output = vscode.window.createOutputChannel("BC Atlas");
  diagnostics = vscode.languages.createDiagnosticCollection("bc-atlas");
  status = vscode.window.createStatusBarItem("bcAtlas.status", vscode.StatusBarAlignment.Left, 50);
  status.name = "BC Atlas";
  tree = new PagesProvider();
  const lensChanged = new vscode.EventEmitter();
  lenses = lensChanged;

  if (!config().get("nodePath") && Number(process.versions.node.split(".")[0]) < 22) {
    vscode.window.showWarningMessage(`BC Atlas needs Node.js 22 or later; this editor runs ${process.versions.node}. Update VS Code, or set "bcAtlas.nodePath" to a Node.js 22 executable.`);
  }

  const command = (id, handler) => context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  command("bcAtlas.open", (hash) => AtlasPanel.show(context, typeof hash === "string" ? hash : "#/overview"));
  command("bcAtlas.openPage", async () => {
    const page = await vscode.window.showQuickPick(logic.pages(overview).map((item) => ({ label: item.label, description: item.description, id: item.id })), { placeHolder: "Open which BC Atlas page?" });
    if (page) AtlasPanel.show(context, logic.pageHash(page.id));
  });
  command("bcAtlas.openObject", (id) => AtlasPanel.show(context, `#/object/${encodeURIComponent(id)}`));
  command("bcAtlas.showObject", () => withCurrentObject(context, (object) => `#/object/${encodeURIComponent(object.id)}`));
  command("bcAtlas.showObjectIn3D", () => withCurrentObject(context, (object) => logic.pageHash("dependencies", { select: object.id })));
  command("bcAtlas.objectDiagram", () => withCurrentObject(context, (object) => logic.pageHash("diagrams", { view: "object", object: `${object.type}:${object.objectId ?? object.label}` })));
  command("bcAtlas.proposeArchitecture", () => AtlasPanel.show(context, logic.pageHash("architecture", { propose: 1 })));
  command("bcAtlas.acceptViolations", async () => {
    const choice = await vscode.window.showWarningMessage("Accept today's wrong-way dependencies in the baseline? bca check then fails only on new ones.", { modal: true }, "Accept");
    if (choice !== "Accept") return;
    try {
      const result = await engine.request("updateBaseline");
      vscode.window.showInformationMessage(`BC Atlas accepted ${result.accepted.toLocaleString("en-US")} violation(s) in ${vscode.workspace.asRelativePath(result.file)}.`);
      scheduleRefresh();
    } catch (error) {
      vscode.window.showErrorMessage(`BC Atlas: ${error.message}`);
    }
  });
  command("bcAtlas.check", async () => {
    if (!engine) return;
    await refresh();
    const health = await updateProblems();
    vscode.commands.executeCommand("workbench.actions.view.problems");
    vscode.window.showInformationMessage(`BC Atlas health check ${health.passed ? "passed" : "failed"}: ${health.counts.error} error(s), ${health.counts.warning} warning(s), ${health.counts.info} info.`);
  });
  command("bcAtlas.refresh", () => refresh());
  command("bcAtlas.export", () => (engine ? exportFiles() : undefined));
  command("bcAtlas.generateDocs", () => (engine ? generateDocs() : undefined));
  command("bcAtlas.setup", () => (project ? runInTerminal(["setup", project]) : undefined));
  command("bcAtlas.runTasks", () => (project ? runTasks() : undefined));
  command("bcAtlas.selectProject", () => selectProject(context));
  command("bcAtlas.showOutput", () => output.show());

  context.subscriptions.push(
    output,
    diagnostics,
    status,
    lensChanged,
    vscode.window.registerTreeDataProvider("bcAtlas.pages", tree),
    vscode.languages.registerCodeLensProvider([{ language: "al" }, { pattern: "**/*.al" }], {
      onDidChangeCodeLenses: lensChanged.event,
      provideCodeLenses(document) {
        if (!config().get("codeLens") || !overview) return [];
        const relative = logic.projectPath(overview.projectRoot, document.uri.fsPath);
        if (!relative) return [];
        return logic.lensesForFile(objects, relative).map((lens) => new vscode.CodeLens(new vscode.Range(lens.line, 0, lens.line, 0), {
          title: `${lens.warning ? "$(warning) " : ""}${lens.title}`,
          tooltip: "Open this object in BC Atlas",
          command: "bcAtlas.openObject",
          arguments: [lens.id]
        }));
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (["bcAtlas.project", "bcAtlas.paths", "bcAtlas.nodePath"].some((key) => event.affectsConfiguration(key))) {
        findProject(context).then((found) => {
          project = found;
          startEngine();
        });
      } else if (event.affectsConfiguration("bcAtlas")) {
        lensChanged.fire();
        if (overview) (config().get("problems") ? updateProblems() : Promise.resolve(diagnostics.clear())).catch(() => {});
      }
    }),
    { dispose: () => engine?.stop() }
  );

  const watcher = vscode.workspace.createFileSystemWatcher(WATCHED);
  watcher.onDidChange(scheduleRefresh);
  watcher.onDidCreate(scheduleRefresh);
  watcher.onDidDelete(scheduleRefresh);
  context.subscriptions.push(watcher);

  // The BC Atlas MCP server, offered to agents in the editor (GitHub Copilot and others).
  if (vscode.lm?.registerMcpServerDefinitionProvider && vscode.McpStdioServerDefinition) {
    context.subscriptions.push(vscode.lm.registerMcpServerDefinitionProvider("bcAtlas.mcp", {
      provideMcpServerDefinitions() {
        const { command: node, env } = runtime(config().get("nodePath") || undefined);
        const definition = new vscode.McpStdioServerDefinition("BC Atlas", node, [enginePath("src", "mcp.js")], env);
        if (project) definition.cwd = vscode.Uri.file(project);
        return [definition];
      }
    }));
  }

  project = await findProject(context);
  if (!project) {
    status.text = "$(circle-slash) BC Atlas";
    status.tooltip = "No AL project (app.json) in this workspace";
    status.command = "bcAtlas.selectProject";
    status.show();
    tree.refresh();
    return;
  }
  startEngine();
}

function deactivate() {
  engine?.stop();
}

module.exports = { activate, deactivate };
