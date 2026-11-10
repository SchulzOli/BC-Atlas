"use strict";

// Activates the extension against a small stand-in for the VS Code API and
// the real BC Atlas engine (a worker process) on the multi-app example.
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const { readFileSync } = require("node:fs");

const project = path.resolve(__dirname, "..", "..", "examples", "multi-app");
// Like the engine tests: results do not depend on an installed AL toolchain.
process.env.BCA_AL_COMPILER ??= "off";
const manifest = JSON.parse(readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));

function fakeVscode() {
  const registered = { commands: new Map(), lenses: [], trees: [], treeViews: [], webviews: [], editorListeners: [], diagnostics: new Map(), status: undefined, messages: [], mcp: [] };
  class EventEmitter {
    constructor() {
      this.listeners = [];
      this.event = (listener) => {
        this.listeners.push(listener);
        return { dispose() {} };
      };
    }
    fire(value) {
      for (const listener of this.listeners) listener(value);
    }
    dispose() {}
  }
  class Position {
    constructor(line, character) {
      Object.assign(this, { line, character });
    }
  }
  class Range {
    constructor(startLine, startCharacter, endLine, endCharacter) {
      this.start = startLine instanceof Position ? startLine : new Position(startLine, startCharacter);
      this.end = startLine instanceof Position ? startCharacter : new Position(endLine, endCharacter);
    }
  }
  const Uri = { file: (fsPath) => ({ fsPath, toString: () => `file://${fsPath}` }), parse: (value) => ({ toString: () => value }) };
  const disposable = { dispose() {} };
  const vscode = {
    EventEmitter,
    Position,
    Range,
    Uri,
    Diagnostic: class { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    ThemeColor: class { constructor(id) { this.id = id; } },
    ThemeIcon: class { constructor(id) { this.id = id; } },
    TreeItem: class { constructor(label, state) { Object.assign(this, { label, state }); } },
    TreeItemCollapsibleState: { None: 0 },
    CodeLens: class { constructor(range, command) { Object.assign(this, { range, command }); } },
    ViewColumn: { Active: -1, Beside: -2 },
    StatusBarAlignment: { Left: 1 },
    ProgressLocation: { Notification: 15 },
    McpStdioServerDefinition: class { constructor(label, command, args, env) { Object.assign(this, { label, command, args, env }); } },
    window: {
      activeTextEditor: undefined,
      onDidChangeActiveTextEditor: (listener) => {
        registered.editorListeners.push(listener);
        return disposable;
      },
      createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }),
      createStatusBarItem: () => {
        registered.status = { show() {}, dispose() {} };
        return registered.status;
      },
      createWebviewPanel: (viewType, title) => {
        const listeners = [];
        const webview = {
          viewType,
          title,
          posted: [],
          html: "",
          webview: {
            html: "",
            postMessage(message) { webview.posted.push(message); return Promise.resolve(true); },
            onDidReceiveMessage(listener) { listeners.push(listener); return disposable; }
          },
          receive: (message) => Promise.all(listeners.map((listener) => listener(message))),
          reveal() {},
          onDidDispose() { return disposable; },
          dispose() {}
        };
        registered.webviews.push(webview);
        return webview;
      },
      createTreeView: (id, { treeDataProvider }) => {
        registered.trees.push(treeDataProvider);
        const view = { visible: true, message: undefined, revealed: [], onDidChangeVisibility: () => disposable, dispose() {} };
        view.reveal = async (item, options) => { view.revealed.push({ item, options }); };
        registered.treeViews.push(view);
        return view;
      },
      showWarningMessage: async (message) => { registered.messages.push(message); },
      showInformationMessage: async (message) => { registered.messages.push(message); },
      showErrorMessage: async (message) => { registered.messages.push(message); },
      showQuickPick: async () => undefined,
      createTerminal: () => ({ show() {} })
    },
    workspace: {
      workspaceFolders: [{ uri: Uri.file(project) }],
      getWorkspaceFolder: () => ({ uri: Uri.file(project) }),
      getConfiguration: () => ({
        get: (key) => ({ project: "", paths: [], problems: true, codeLens: true, followEditor: true, nodePath: "" })[key],
        inspect: () => undefined
      }),
      findFiles: async () => ["core", "sales", "integration"].map((app) => Uri.file(path.join(project, app, "app.json"))),
      createFileSystemWatcher: () => ({ onDidChange() {}, onDidCreate() {}, onDidDelete() {}, dispose() {} }),
      onDidChangeConfiguration: () => disposable,
      asRelativePath: (file) => path.relative(project, file.fsPath ?? file)
    },
    languages: {
      createDiagnosticCollection: () => ({
        clear: () => registered.diagnostics.clear(),
        set: (uri, list) => registered.diagnostics.set(uri.fsPath, list),
        dispose() {}
      }),
      registerCodeLensProvider: (selector, provider) => {
        registered.lenses.push(provider);
        return disposable;
      }
    },
    commands: {
      registerCommand: (id, handler) => {
        registered.commands.set(id, handler);
        return disposable;
      },
      executeCommand: async () => {}
    },
    env: { openExternal: async () => true },
    extensions: { getExtension: () => undefined },
    lm: {
      registerMcpServerDefinitionProvider: (id, provider) => {
        registered.mcp.push({ id, provider });
        return disposable;
      }
    }
  };
  return { vscode, registered };
}

test("the extension analyzes the workspace and fills the editor and the panel", async (t) => {
  const { vscode, registered } = fakeVscode();
  const load = Module._load;
  Module._load = function (request, ...rest) {
    return request === "vscode" ? vscode : load.call(this, request, ...rest);
  };
  t.after(() => {
    Module._load = load;
  });
  // BCA_EXTENSION_MAIN runs the same test against a packaged extension (dist/extension.js of an unpacked .vsix).
  const extension = require(process.env.BCA_EXTENSION_MAIN ? path.resolve(process.env.BCA_EXTENSION_MAIN) : "../src/extension");
  const context = { subscriptions: [], extensionPath: path.join(__dirname, ".."), workspaceState: { get: () => undefined, update: async () => {} } };
  t.after(() => extension.deactivate());
  await extension.activate(context);

  // Every command of the manifest is registered.
  for (const { command } of manifest.contributes.commands) assert.ok(registered.commands.has(command), `${command} is not registered`);

  // The first analysis fills the status bar, Problems, CodeLens, and the side bar.
  // The status bar comes first; Problems follow after one more request.
  const deadline = Date.now() + 60_000;
  const filled = () => registered.status.text?.includes("error") && [...registered.diagnostics.keys()].some((name) => name.endsWith("ItemSync.al"));
  while (!filled() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(registered.status.text, "$(error) BC Atlas: 1 error");
  const [file, problems] = [...registered.diagnostics].find(([name]) => name.endsWith("ItemSync.al"));
  assert.equal(path.dirname(file), path.join(project, "integration"));
  assert.match(problems[0].message, /depends on 1 object\(s\) in Core/u);

  const lenses = registered.lenses[0].provideCodeLenses({ uri: { fsPath: path.join(project, "integration", "ItemSync.al") } });
  assert.ok(lenses.length > 0);
  assert.match(lenses.find(({ command }) => command.title.includes("against the architecture")).command.title, /\$\(warning\) used by \d+ · uses 1 · component Integration · 1 dependency against the architecture/u);
  // The side bar holds no list of pages: the panel is one view.
  assert.deepEqual(registered.trees[0].getChildren(), []);

  // The MCP server for agents runs the bundled engine.
  const [definition] = registered.mcp[0].provider.provideMcpServerDefinitions();
  assert.match(definition.args[0], /src[\\/]mcp\.js$/u);

  // The panel shows the one view with a strict policy and answers its requests.
  await registered.commands.get("bcAtlas.open")("#lens=components");
  const panel = registered.webviews[0];
  assert.match(panel.webview.html, /Content-Security-Policy" content="default-src 'none'/u);
  assert.match(panel.webview.html, /"mode":"vscode"/u);
  assert.match(panel.webview.html, /history\.replaceState\(null, "", "#lens=components"\)/u);
  await panel.receive({ type: "request", id: 7, method: "atlas", params: {} });
  const response = panel.posted.find(({ id }) => id === 7);
  assert.deepEqual(response.result.lenses.slice(0, 3).map(({ id }) => id), ["system", "components", "apps"]);
  assert.ok(response.result.stories.length > 0);
  await panel.receive({ type: "request", id: 8, method: "nope", params: {} });
  assert.match(panel.posted.find(({ id }) => id === 8).error, /unknown method/u);
  // What the view tells about its state needs no answer.
  await panel.receive({ type: "state", lens: "components" });

  // Commands about the object at the cursor navigate the panel.
  vscode.window.activeTextEditor = {
    document: { uri: { fsPath: path.join(project, "integration", "ItemSync.al") } },
    selection: { active: { line: 8 } }
  };
  await registered.commands.get("bcAtlas.showObjectIn3D")();
  assert.match(panel.posted.at(-1).hash, /^#form=3d&focus=.+&sel=/u);
  await registered.commands.get("bcAtlas.objectDiagram")();
  assert.match(panel.posted.at(-1).hash, /^#form=diagram&inside=.+codeunit.+50201&sel=/u);

  // The graph follows the editor: the object of the file that comes to the front is selected.
  registered.editorListeners[0]();
  assert.deepEqual(Object.keys(panel.posted.at(-1)), ["type", "id"]);
  assert.equal(panel.posted.at(-1).type, "reveal");
  assert.match(panel.posted.at(-1).id, /codeunit::50201$/u);
});
