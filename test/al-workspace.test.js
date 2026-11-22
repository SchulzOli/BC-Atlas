import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import { packageCacheFolders, readAlWorkspace } from "../src/al-workspace.js";
import { analyze } from "../src/analyzer.js";
import { resolveModel } from "../src/resolver.js";
import { loadSymbolPackages } from "../src/symbols.js";


function temp(prefix) {
  return mkdtempSync(path.join(os.tmpdir(), `bc-atlas-al-${prefix}-`));
}

function write(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/** A symbol package as the AL compiler writes it: a 40-byte NAVX header, then a ZIP. */
function symbolPackage(file, app) {
  const zip = zipSync({ "SymbolReference.json": strToU8(JSON.stringify({ AppId: app.id, Name: app.name, Publisher: "Microsoft", Version: app.version, Tables: [{ Id: 18, Name: "Customer" }] })) });
  const header = new Uint8Array(40);
  header.set(strToU8("NAVX"));
  write(file, Buffer.concat([header, zip]));
}

test("reads AL settings like the AL Language extension: folder over workspace, paths per project", async () => {
  const workspace = temp("settings");
  try {
    write(path.join(workspace, "core", "app.json"), JSON.stringify({ id: "c", name: "Core", dependencies: [] }));
    write(path.join(workspace, "sales", "app.json"), JSON.stringify({ id: "s", name: "Sales", dependencies: [{ id: "c", name: "Core" }] }));
    write(path.join(workspace, "sales", "src", "nested", "app.json"), JSON.stringify({ id: "m", name: "Module" }));
    write(path.join(workspace, "contoso.code-workspace"), `{
      // AL multi-root workspace
      "folders": [{ "path": "sales" }, { "path": "core" }],
      "settings": { "al.packageCachePath": ["../symbols", ".alpackages"], },
    }`);
    write(path.join(workspace, "sales", ".vscode", "settings.json"), `{
      "al.packageCachePath": [".alpackages", "own"] // folder settings win
    }`);
    mkdirSync(path.join(workspace, "symbols"));
    mkdirSync(path.join(workspace, "sales", ".alpackages"));

    const al = await readAlWorkspace(workspace);
    assert.equal(path.basename(al.workspaceFile), "contoso.code-workspace");
    assert.deepEqual(al.apps.map(({ relative }) => relative), ["core", "sales"], "nested app.json is a module, not a project");
    const [core, sales] = al.apps;
    assert.deepEqual(core.settings.packageCachePaths, [path.join(workspace, "symbols"), path.join(workspace, "core", ".alpackages")]);
    assert.deepEqual(sales.settings.packageCachePaths, [path.join(workspace, "sales", ".alpackages"), path.join(workspace, "sales", "own")], "folder settings win");
    assert.deepEqual(await packageCacheFolders(al), [path.join(workspace, "symbols"), path.join(workspace, "sales", ".alpackages")],
      "only folders that exist");

    const editor = await readAlWorkspace(workspace, { settings: { packageCachePath: "./cache" } });
    assert.deepEqual(editor.apps[1].settings.packageCachePaths, [path.join(workspace, "sales", "cache")], "explicit settings override every layer");

    // Editor settings rank below a project's own .vscode/settings.json, as in VS Code.
    const layered = await readAlWorkspace(workspace, { editorSettings: {
      user: { packageCachePath: "./user-cache" },
      workspaceFolder: { packageCachePath: "./editor-cache" }
    } });
    const [layeredCore, layeredSales] = layered.apps;
    assert.deepEqual(layeredCore.settings.packageCachePaths, [path.join(workspace, "core", "editor-cache")], "the editor's folder settings win over the workspace file and the user's");
    assert.deepEqual(layeredSales.settings.packageCachePaths, sales.settings.packageCachePaths, "a project's own settings win over the editor");
    const user = await readAlWorkspace(workspace, { editorSettings: { user: { packageCachePath: "./user-cache" } } });
    assert.deepEqual(user.apps[0].settings.packageCachePaths, core.settings.packageCachePaths, "the workspace file wins over user settings");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("loads symbols from configured package caches and each app version once", async () => {
  const workspace = temp("symbols");
  try {
    write(path.join(workspace, "app", "app.json"), JSON.stringify({ id: "a", name: "App" }));
    write(path.join(workspace, "app", ".vscode", "settings.json"), JSON.stringify({ "al.packageCachePath": "../shared" }));
    const base = { id: "437dbf0e-84ff-417a-965d-ed2bb9650972", name: "Base Application", version: "27.0.0.0" };
    symbolPackage(path.join(workspace, "shared", "Microsoft_Base Application_27.0.0.0.app"), base);
    symbolPackage(path.join(workspace, "app", ".alpackages", "Microsoft_Base Application_27.0.0.0.app"), base);

    const plain = await loadSymbolPackages(path.join(workspace, "app"));
    assert.equal(plain.packages.length, 1);
    const model = await analyze(path.join(workspace, "app"));
    assert.equal(model.symbolPackages.length, 1, "the same app version from two caches loads once");
    assert.ok(model.objects.some(({ name, externalSymbol }) => name === "Customer" && externalSymbol));
    rmSync(path.join(workspace, "app", ".alpackages"), { recursive: true });
    const configured = await analyze(path.join(workspace, "app"));
    assert.equal(configured.symbolPackages.length, 1, "al.packageCachePath outside the project");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("several versions of an app load only the newest, and workspace source wins over its own .app", async () => {
  const workspace = temp("symbol-versions");
  try {
    const base = { id: "437dbf0e-84ff-417a-965d-ed2bb9650972", name: "Base Application" };
    write(path.join(workspace, "app", "app.json"), JSON.stringify({ id: "a", name: "App", dependencies: [{ id: base.id, name: base.name }] }));
    write(path.join(workspace, "app", "src", "Use.Codeunit.al"), [
      "codeunit 50100 \"Use Customer\"",
      "{",
      "    var Customer: Record Customer;",
      "    Mine: Record \"My Table\";",
      "}"
    ].join("\n"));
    write(path.join(workspace, "app", "src", "My.Table.al"), "table 50100 \"My Table\"\n{\n    fields { field(1; \"No.\"; Code[20]) { } }\n}\n");
    symbolPackage(path.join(workspace, "app", ".alpackages", "Microsoft_Base Application_9.0.0.0.app"), { ...base, version: "9.0.0.0" });
    symbolPackage(path.join(workspace, "app", ".alpackages", "Microsoft_Base Application_27.0.0.0.app"), { ...base, version: "27.0.0.0" });
    symbolPackage(path.join(workspace, "app", ".alpackages", "Microsoft_Base Application_26.5.0.0.app"), { ...base, version: "26.5.0.0" });
    // The app's own compiled package, as it lands in the cache of a dependent app.
    const own = zipSync({ "SymbolReference.json": strToU8(JSON.stringify({ AppId: "a", Name: "App", Version: "1.0.0.0", Tables: [{ Id: 50100, Name: "My Table" }] })) });
    write(path.join(workspace, "app", ".alpackages", "Me_App_1.0.0.0.app"), Buffer.concat([new Uint8Array(40), own]));

    const loaded = await loadSymbolPackages(path.join(workspace, "app"));
    assert.deepEqual(loaded.packages.map(({ name, version }) => `${name} ${version}`).sort(), ["App 1.0.0.0", "Base Application 27.0.0.0"],
      "27.0 is newer than 26.5 and 9.0 (numeric, not text, order)");
    assert.equal(loaded.diagnostics.filter(({ code }) => code === "symbol-package-superseded").length, 2);

    const model = resolveModel(await analyze(path.join(workspace, "app")));
    assert.deepEqual(model.diagnostics.filter(({ code }) => code === "ambiguous-reference"), []);
    assert.equal(model.objects.filter(({ name }) => name === "My Table").length, 1, "the source of the app, not its .app as well");
    assert.equal(model.objects.find(({ name }) => name === "My Table").externalSymbol, undefined);
    assert.ok(model.diagnostics.some(({ code }) => code === "symbol-package-shadowed"));
    assert.equal(model.apps.find(({ id }) => id === "a").external, undefined, "the app stays the workspace app");
    const customer = model.objects.find(({ name }) => name === "Customer");
    assert.equal(customer.app.version, "27.0.0.0");
    const use = model.objects.find(({ name }) => name === "Use Customer");
    assert.ok(model.edges.some(({ from, to }) => from === use.key && to === customer.key));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("an ambiguous reference names the objects it matches", () => {
  const app = (id, version) => ({ id, name: `App ${id}`, version });
  const table = (owner, namespace) => ({ type: "table", id: 18, name: "Customer", namespace, app: owner, externalSymbol: true, relations: [] });
  const model = resolveModel({
    objects: [
      { type: "codeunit", id: 50100, name: "Use", app: app("me"), relations: [{ kind: "uses", target: "Customer", targetType: "table" }] },
      table(app("x", "1.0"), "X.Sales"),
      table(app("y", "2.0"), "Y.Sales")
    ],
    diagnostics: []
  });
  const [warning] = model.diagnostics.filter(({ code }) => code === "ambiguous-reference");
  assert.match(warning.message, /matches table 18 "Customer", namespace X\.Sales, app App x 1\.0; and table 18 "Customer", namespace Y\.Sales, app App y 2\.0/u);
});

test("symbol packages are parsed once and handed out as independent copies", async () => {
  const workspace = temp("symbol-cache");
  try {
    write(path.join(workspace, "app", "app.json"), JSON.stringify({ id: "a", name: "App" }));
    const file = path.join(workspace, "app", ".alpackages", "Microsoft_Base Application_27.0.0.0.app");
    symbolPackage(file, { id: "437dbf0e-84ff-417a-965d-ed2bb9650972", name: "Base Application", version: "27.0.0.0" });
    const first = await loadSymbolPackages(path.join(workspace, "app"));
    first.objects[0].name = "Changed";
    first.objects[0].relations.push({ kind: "uses" });
    first.packages[0].name = "Changed";
    const second = await loadSymbolPackages(path.join(workspace, "app"));
    assert.equal(second.objects[0].name, "Customer", "a caller's change does not reach the cache");
    assert.deepEqual(second.objects[0].relations, []);
    assert.equal(second.packages[0].name, "Base Application");
    assert.equal(second.objects[0].app, second.packages[0], "objects point to their package's app");
    assert.notEqual(second.objects[0], first.objects[0]);

    // A new download (other size or time) is parsed again.
    symbolPackage(file, { id: "437dbf0e-84ff-417a-965d-ed2bb9650972", name: "Base Application", version: "28.0.0.0" });
    utimesSync(file, new Date(), new Date(Date.now() + 5000));
    assert.equal((await loadSymbolPackages(path.join(workspace, "app"))).packages[0].version, "28.0.0.0");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("VS Code variables in al.* settings resolve against the folder that sets them", async () => {
  const folder = temp("variables");
  const root = path.join(folder, "repo");
  const app = path.join(root, "app");
  mkdirSync(path.join(root, ".vscode"), { recursive: true });
  mkdirSync(path.join(app, ".vscode"), { recursive: true });
  writeFileSync(path.join(app, "app.json"), JSON.stringify({ id: "1", name: "App", publisher: "Me", version: "1.0.0.0" }));
  writeFileSync(path.join(root, ".vscode", "settings.json"), JSON.stringify({ "al.packageCachePath": "${workspaceFolder}/symbols" }));
  let workspace = await readAlWorkspace(root);
  assert.deepEqual(workspace.apps[0].settings.packageCachePaths, [path.join(root, "symbols")]);
  process.env.BCA_TEST_PROBE = path.join(folder, "probe");
  try {
    workspace = await readAlWorkspace(root, { settings: { packageCachePath: ["~/probe", "${env:BCA_TEST_PROBE}/x"] } });
  } finally {
    delete process.env.BCA_TEST_PROBE;
  }
  assert.deepEqual(workspace.apps[0].settings.packageCachePaths, [path.join(os.homedir(), "probe"), path.join(folder, "probe", "x")]);
});
