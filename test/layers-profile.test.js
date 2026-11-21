// The documentation profile (src/app/layers-profile.js): which pages and
// sections of the layered documentation are written, for which part of the
// system, under which names, in which language, and from which templates.
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildLayers } from "../src/app/layers.js";
import { LAYERS_PAGE_KINDS, LAYERS_SECTIONS, layersProfile, layersProfiles, parsePage, parseTemplate } from "../src/app/layers-profile.js";
import { Workspace } from "../src/app/workspace.js";
import { syncLayers } from "../src/commands/layers.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const multi = path.join(root, "examples", "multi-app");
const purchasing = path.join(root, "examples", "purchasing-app");

const build = (layers, options = {}, project = multi) => buildLayers(new Workspace(project, {}, { live: false }), { pictures: "none", ...options, profile: layersProfile(layers) });
/** Every relative link and picture of a Markdown page that leads to a file. */
const links = (text) => [...text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/gu)].map(([, target]) => target).filter((target) => !/^[a-z]+:/iu.test(target));
const assertLinks = (files, { but = [] } = {}) => {
  for (const [file, text] of files) {
    if (!file.endsWith(".md")) continue;
    for (const target of links(text)) {
      const to = path.posix.normalize(path.posix.join(path.posix.dirname(file), target));
      assert.ok(files.has(to) || but.includes(to), `${file} links to ${target}`);
    }
  }
};
const headings = (text) => [...text.matchAll(/^## (.+)$/gmu)].map(([, title]) => title);
/** A copy of the example with three apps, with these settings of layers and these other files. */
const project = (layers, extra = {}) => {
  const folder = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-layers-profile-"));
  cpSync(multi, folder, { recursive: true });
  writeFileSync(path.join(folder, ".bca.json"), JSON.stringify({ layers }));
  for (const [file, text] of Object.entries(extra)) {
    mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
    writeFileSync(path.join(folder, file), text);
  }
  return folder;
};

test("without settings the pages are the ones of today, byte for byte", async () => {
  const plain = await buildLayers(new Workspace(multi, {}, { live: false }), { pictures: "none" });
  for (const layers of [undefined, {}, { outputDir: "docs/system", pictures: "none", pages: {}, scope: { apps: [], exclude: [] }, sections: {}, titles: {}, names: {}, language: "en", profiles: { other: { language: "de" } } }]) {
    const profile = layersProfile(layers);
    assert.equal(profile.plain, true);
    const built = await buildLayers(new Workspace(multi, {}, { live: false }), { pictures: "none", profile });
    assert.deepEqual([...built.files], [...plain.files]);
  }
  // The example in the repository is what a run without settings writes.
  for (const file of ["README.md", "architecture.md", "objects/table-50000-con-item.md", "lenses/data.md"]) {
    const committed = readFileSync(path.join(root, "examples", "layers", file), "utf8");
    assert.deepEqual(headings(plain.files.get(file)), headings(committed), file);
  }
  assert.deepEqual(plain.fixed, { readme: "README.md", architecture: "architecture.md", findings: "findings.md" });
  assert.equal(plain.manifest.start, undefined);
  assert.equal(plain.manifest.profile, undefined);
});

test("pages: a kind of page is left out, or only the named ones are written, and no link leads nowhere", async () => {
  const { files, fixed } = await build({ pages: { objects: false, lenses: ["data", "Ev*"], stories: false, findings: false, namespaces: ["Contoso.Core.*"] } });
  const written = [...files.keys()];
  assert.ok(!written.some((file) => file.startsWith("objects/") || file.startsWith("stories/")));
  assert.deepEqual(written.filter((file) => file.startsWith("lenses/")), ["lenses/data.md", "lenses/events.md"]);
  assert.deepEqual(written.filter((file) => file.startsWith("namespaces/")), ["namespaces/contoso-core-items.md", "namespaces/contoso-core-pricing.md"]);
  assert.ok(!files.has("findings.md") && files.has("architecture.md") && files.has("apps/contoso-core.md"));
  assert.equal(fixed.findings, undefined);
  assertLinks(files);

  // What has no page is still named, as text.
  const readme = files.get("README.md");
  assert.deepEqual(headings(readme), ["Start here", "Layers", "Apps", "Namespaces", "Lenses", "Findings", "Read from"]);
  assert.match(readme, /\n## Findings\n\n0 errors, 1 warning, 7 info\.\n/u);
  assert.match(readme, /\| Contoso\.Sales\.Quotes \| Contoso Sales \| 4 \|/u);
  assert.match(readme, /\| \[Data\]\(lenses\/data\.md\) \|/u);
  assert.doesNotMatch(readme, /lenses\/calls\.md/u);
  assert.match(files.get("namespaces/contoso-core-items.md"), /\| CON Item \| table \| 50000 \|/u);
  assert.deepEqual(JSON.parse(files.get("layers.json")).files, written.slice().sort());

  // Without the first page, the others name the system without a link.
  const headless = await build({ pages: { readme: false } });
  assert.ok(!headless.files.has("README.md") && !headless.files.has("system.svg"));
  assert.equal(headless.manifest.start, null);
  assert.match(headless.files.get("findings.md"), /^# Findings\n\nSystem › Findings\n/u);
  assertLinks(headless.files);

  assert.throws(() => layersProfile({ pages: { object: false } }), /layers\.pages\.object in \.bca\.json is not known; layers\.pages has: readme, architecture, findings, apps, namespaces, objects, lenses, stories/u);
  assert.throws(() => layersProfile({ pages: { readme: ["a"] } }), /layers\.pages\.readme in \.bca\.json must be true or false/u);
  assert.deepEqual(LAYERS_PAGE_KINDS, ["readme", "architecture", "findings", "apps", "namespaces", "objects", "lenses", "stories"]);
});

test("scope: only the objects of the scope are documented, and the holders that have one", async () => {
  const { files, manifest } = await build({ scope: { apps: ["Contoso Core", "Contoso Sales"], types: ["table", "codeunit", "page"], exclude: ["*Price Group*"] } });
  const objects = [...files.keys()].filter((file) => file.startsWith("objects/"));
  assert.deepEqual(objects.slice().sort(), ["objects/codeunit-50010-con-standard-pricing.md", "objects/codeunit-50011-con-pricing-mgt.md", "objects/codeunit-50100-con-quote-mgt.md", "objects/page-50000-con-item-card.md",
    "objects/page-50100-con-sales-quote.md", "objects/table-50000-con-item.md", "objects/table-50100-con-sales-quote.md"]);
  assert.ok(!files.has("apps/contoso-integration.md") && !files.has("namespaces/contoso-integration.md"));
  assert.ok(files.has("apps/contoso-core.md") && files.has("namespaces/contoso-sales-quotes.md"));
  assert.equal(manifest.counts.objects, 7);
  assert.equal(manifest.counts.apps, 2);
  assertLinks(files);

  // The first page says that it is a part, and of what.
  const readme = files.get("README.md");
  assert.match(readme, /\n7 objects in 2 apps, 26 relations\./u);
  assert.match(readme, /\nThese pages are about a part of the system: 7 objects of 12 \(apps: Contoso Core, Contoso Sales; types: table, codeunit, page; without \*Price Group\*\)\. The relations, the health, the lenses, and the stories are the ones of the whole system\.\n/u);
  // A page lists what is in the scope, and names the rest without a link.
  const core = files.get("apps/contoso-core.md");
  assert.match(core, /The app Contoso Core holds 4 objects/u);
  assert.doesNotMatch(core, /CON Price Group\]|CON Price Calculation\]/u);
  assert.match(files.get("objects/table-50000-con-item.md"), /- \*\*relates\*\* table 50001 CON Price Group\n/u);
  assert.match(files.get("objects/table-50000-con-item.md"), /- \*\*writes\*\* codeunit 50201 CON Item Sync\n/u);
  assert.match(files.get("architecture.md"), /\| \[Contoso Sales\]\(apps\/contoso-sales\.md\) \| 3 \| \[Contoso Core\]\(apps\/contoso-core\.md\) \(declared, 5 relations\) \| Contoso Integration \(declared, 4 relations\) \|/u);

  const byNamespace = await build({ scope: { namespaces: ["Contoso.Integration"] } });
  assert.deepEqual([...byNamespace.files.keys()].filter((file) => /^(?:apps|namespaces|objects)\//u.test(file)).sort(), ["apps/contoso-integration.md", "namespaces/contoso-integration.md", "objects/codeunit-50200-con-quote-export.md", "objects/codeunit-50201-con-item-sync.md"]);
  assertLinks(byNamespace.files);

  assert.throws(() => layersProfile({ scope: { app: ["x"] } }), /layers\.scope\.app in \.bca\.json is not known; layers\.scope has: apps, namespaces, types, exclude/u);
  assert.throws(() => layersProfile({ scope: { apps: "x" } }), /layers\.scope\.apps in \.bca\.json must be a list of names/u);
});

test("sections: the named sections, in the named order, and a name that is not a section is an error", async () => {
  const plain = await build({});
  const { files } = await build({ sections: { object: ["Used by", "Findings", "Uses", "Inside"], app: ["Objects", "Depends on"], readme: ["Layers", "Start here", "Apps"], findings: ["Info", "Error"] } });
  const item = files.get("objects/table-50000-con-item.md");
  assert.deepEqual(headings(plain.files.get("objects/table-50000-con-item.md")), ["Uses", "Used by"]);
  // A section the page does not have (Inside: a table without procedures) is skipped.
  assert.deepEqual(headings(item), ["Used by", "Uses"]);
  assert.deepEqual(headings(files.get("objects/codeunit-50201-con-item-sync.md")), ["Findings", "Uses", "Inside"]);
  assert.deepEqual(headings(files.get("apps/contoso-sales.md")), ["Objects", "Depends on"]);
  assert.deepEqual(headings(files.get("findings.md")), ["Info"]);
  // The body of a section moves with it, and what stands above the sections and the footer stay.
  const before = parsePage(plain.files.get("objects/table-50000-con-item.md"), "object");
  const after = parsePage(item, "object");
  assert.equal(after.summary, before.summary);
  assert.equal(after.footer, before.footer);
  assert.equal(after.sections.find(({ title }) => title === "Uses").body, before.sections.find(({ title }) => title === "Uses").body);
  // A page whose kind has no setting is as it was.
  assert.equal(files.get("namespaces/contoso-core-items.md"), plain.files.get("namespaces/contoso-core-items.md"));
  // The first page: a link to a section that is gone is text, and where the graph is stays at the end.
  const readme = files.get("README.md");
  assert.deepEqual(headings(readme), ["Layers", "Start here", "Apps"]);
  assert.match(readme, /\| 1 \| Apps \| 3 \| \[below\]\(#apps\) \|\n\| 2 \| Namespaces \| 4 \| below \|/u);
  assert.match(readme, /\n\nThe graph itself is in \[atlas\.json\]\(atlas\.json\); \[layers\.json\]\(layers\.json\) lists what this folder holds\.\n\n_Generated by BC Atlas/u);
  assertLinks(files);

  assert.throws(() => layersProfile({ sections: { object: ["Inside", "Usage"] } }),
    /layers\.sections\.object in \.bca\.json: "Usage" is not a section of the page of an object; it has: Inside, Uses, Used by, Findings/u);
  assert.throws(() => layersProfile({ sections: { objects: ["Inside"] } }), /layers\.sections\.objects in \.bca\.json is not known; layers\.sections has: readme, architecture, findings, app, namespace, object, lens, story/u);
  // The catalog names every section the pages have.
  for (const [file, text] of plain.files) {
    if (!file.endsWith(".md") || file.startsWith("stories/")) continue;
    const kind = { apps: "app", namespaces: "namespace", objects: "object", lenses: "lens" }[file.split("/")[0]] ?? file.replace(".md", "").replace("README", "readme");
    for (const title of headings(text)) assert.ok(LAYERS_SECTIONS[kind].includes(title), `${file}: ${title}`);
  }
  assert.equal(LAYERS_SECTIONS.story, null);
});

test("titles and language: other headings, and the fixed headings and labels in German", async () => {
  const titled = await build({ titles: { "Used by": "Who uses it", "object.Uses": "Needs", README: "Our system", "How it is connected": "Architecture", Apps: "Applications" } });
  assert.match(titled.files.get("README.md"), /^# Our system\n/u);
  assert.deepEqual(headings(titled.files.get("objects/table-50000-con-item.md")), ["Needs", "Who uses it"]);
  assert.ok(headings(titled.files.get("apps/contoso-core.md")).includes("Who uses it"));
  // The links that name a page or a section follow.
  assert.match(titled.files.get("architecture.md"), /^# Architecture\n\n\[System\]\(README\.md\) › How it is connected\n/u);
  assert.match(titled.files.get("README.md"), /\n2\. \*\*\[Architecture\]\(architecture\.md\)\*\*: 3 apps/u);
  assert.match(titled.files.get("README.md"), /\| 1 \| Apps \| 3 \| \[below\]\(#applications\) \|/u);
  assert.match(titled.files.get("README.md"), /\n## Applications\n/u);
  assertLinks(titled.files);

  const { files } = await build({ language: "de", titles: { Findings: "Auffälligkeiten" } });
  const readme = files.get("README.md");
  assert.match(readme, /^# multi-app\n\n12 objects in 3 apps/u);
  assert.deepEqual(headings(readme), ["Einstieg", "Ebenen", "Apps", "Namespaces", "Sichten", "Rundgänge", "Auffälligkeiten", "Gelesen aus"]);
  assert.match(readme, /\| Ebene \| Was \| Anzahl \| Wo \|\n\| --- \| --- \| ---: \| --- \|\n\| 0 \| System \| 1 \| diese Seite \|\n\| 1 \| Apps \| 3 \| \[unten\]\(#apps\) \|\n\| 2 \| Namespaces \| 4 \| \[unten\]\(#namespaces\) \|\n\| 3 \| Objekte \| 12 \| über die Seiten der Ebenen 1 und 2 \|/u);
  assert.match(readme, /\n2\. \*\*\[Wie es zusammenhängt\]\(architecture\.md\)\*\*: /u);
  assert.match(readme, /\nDer Graph selbst steht in \[atlas\.json\]\(atlas\.json\); \[layers\.json\]\(layers\.json\) listet auf, was dieser Ordner enthält\.\n\n_Von BC Atlas aus dem AL-Quelltext erzeugt\. Nicht bearbeiten; `bca layers` erneut ausführen\._\n$/u);
  const object = files.get("objects/codeunit-50201-con-item-sync.md");
  assert.deepEqual(headings(object), ["Innenleben", "Verwendet", "Auffälligkeiten"]);
  assert.match(object, /\| Merkmal \| Wert \|\n\| --- \| --- \|\n\| Typ \| codeunit \|\n\| ID \| 50201 \|\n\| App \| Contoso Integration \|\n\| Namespace \| Contoso\.Integration \|\n\| Sichtbarkeit \| /u);
  assert.match(object, /\| Element \| Art \| Zeilen \| Komplexität \| Tut \|\n\| --- \| --- \| ---: \| ---: \| --- \|/u);
  assert.match(object, /\n {2}- Betrifft: \[CON Item Sync\]/u);
  assert.match(files.get("namespaces/contoso-core-items.md"), /^# Namespace Contoso\.Core\.Items\n\n\[System\]\(\.\.\/README\.md\) › Ebene 2: Namespaces\n/u);
  assert.match(files.get("objects/codeunit-50201-con-item-sync.md"), /\nEbene 4: seine Prozeduren, Trigger und Ereignisse, und was jedes davon tut\.\n/u);
  assert.match(files.get("architecture.md"), /\nEin Namespace ist, wie der Quelltext selbst seine Objekte gruppiert\./u);
  assert.match(files.get("lenses/data.md"), /\| Knoten \| Art \| Gruppe \| Beziehungen \|/u);
  // What is made from the source stays as it is: the sentence about a part, and the names of the source.
  assert.match(object, /\nThe codeunit CON Item Sync of the app Contoso Integration has 1 member in 10 lines\./u);
  assertLinks(files);

  assert.throws(() => layersProfile({ language: "fr" }), /layers\.language in \.bca\.json must be one of: en, de/u);
  assert.throws(() => layersProfile({ titles: { Uses: "" } }), /layers\.titles in \.bca\.json must be an object of headings/u);
});

test("names: the files have the names of the patterns, and every link and picture follows", async () => {
  const layers = { names: { objects: "objekte/{type}/{id}-{name}.md", apps: "apps/{name}/index.md", namespaces: "ns/{app}/{name}.md", lenses: "sichten/{id}.md", stories: "{name}.story.md", readme: "start/index.md", architecture: "architektur.md" } };
  const { files, manifest, fixed } = await build(layers, { pictures: "auto", view: true });
  const written = [...files.keys()];
  for (const file of ["start/index.md", "start/system.svg", "architektur.md", "architektur-apps.svg", "architektur-namespaces.svg", "objekte/table/50000-con-item.md", "objekte/table/50000-con-item.svg",
    "objekte/interface/con-price-calculation.md", "apps/contoso-core/index.md", "apps/contoso-core/index.svg", "ns/contoso-core/contoso-core-items.md", "sichten/data.md", "sichten/data.svg", "what-to-fix.story.md", "atlas.json", "view.html", "layers.json"]) assert.ok(files.has(file), file);
  assert.ok(!written.some((file) => /^(?:objects|lenses|stories|namespaces)\/|^README|^architecture/u.test(file)), "nothing is left under its old name");
  assert.deepEqual(manifest.files, written.slice().sort());
  assert.equal(manifest.start, "start/index.md");
  assert.deepEqual(fixed, { readme: "start/index.md", architecture: "architektur.md", findings: "findings.md" });
  // Every link and every picture leads to a file that is written.
  assertLinks(files);
  assert.match(files.get("start/index.md"), /!\[Overview\]\(system\.svg\)/u);
  assert.match(files.get("start/index.md"), /\[atlas\.json\]\(\.\.\/atlas\.json\), and \[view\.html\]\(\.\.\/view\.html\)/u);
  assert.match(files.get("architektur.md"), /!\[Apps\]\(architektur-apps\.svg\)/u);
  assert.match(files.get("objekte/table/50000-con-item.md"), /^# table 50000 CON Item\n\n\[System\]\(\.\.\/\.\.\/start\/index\.md\) › \[Contoso Core\]\(\.\.\/\.\.\/apps\/contoso-core\/index\.md\) › \[Contoso\.Core\.Items\]\(\.\.\/\.\.\/ns\/contoso-core\/contoso-core-items\.md\)/u);
  assert.match(files.get("objekte/table/50000-con-item.md"), /!\[[^\]]+\]\(50000-con-item\.svg\)/u);
  assert.match(files.get("objekte/table/50000-con-item.md"), /\[codeunit 50010 CON Standard Pricing\]\(\.\.\/codeunit\/50010-con-standard-pricing\.md\)/u);

  // Two pages that would be one file are an error that names both.
  await assert.rejects(build({ names: { objects: "objects/{type}.md" } }), /layers\.names in \.bca\.json gives two pages one file: object "table 50000 CON Item" and object "table 50001 CON Price Group" would both be objects\/table\.md/u);
  await assert.rejects(build({ names: { readme: "findings.md" } }), /gives two pages one file: readme "multi-app" and findings "multi-app" would both be findings\.md/u);
  assert.throws(() => layersProfile({ names: { objects: "objects/{object}.md" } }), /layers\.names\.objects in \.bca\.json: \{object\} is not known; objects has \{name\}, \{type\}, \{id\}, \{app\}, \{namespace\}/u);
  assert.throws(() => layersProfile({ names: { objects: "objects/all.md" } }), /layers\.names\.objects in \.bca\.json needs a placeholder such as \{name\}/u);
  assert.throws(() => layersProfile({ names: { readme: "../index.md" } }), /must be a path below the folder of the pages/u);
  assert.throws(() => layersProfile({ names: { readme: "index.html" } }), /must be a file name that ends with \.md/u);
});

test("templates: a page is laid out by the template of its kind, and a template is part of the sync", async () => {
  const template = ["# {{title}}", "", "> {{type}} {{id}} of {{app}} ({{namespace}}) in {{system}}", "", "{{picture}}", "", "{{summary}}", "", "{{section \"Used by\"}}", "", "### Needs", "", "{{body \"Uses\"}}", "", "{{section \"Inside\"}}", "", "{{sections}}", "", "Ask the team before you change it.", "", "{{footer}}", ""].join("\n");
  const folder = project({ outputDir: "pages", sections: { object: ["Inside", "Uses", "Used by", "Findings"] }, templates: "docs/templates" }, { "docs/templates/object.md": template, "docs/templates/readme.md": "# {{title}}\n\n{{section \"Apps\"}}\n\n{{footer}}\n", "docs/templates/notes.txt": "not a template" });
  try {
    const first = await syncLayers(folder, {});
    assert.equal(first.inSync, true);
    const item = readFileSync(path.join(folder, "pages", "objects", "table-50000-con-item.md"), "utf8");
    assert.match(item, /^# table 50000 CON Item\n\n> table 50000 of Contoso Core \(Contoso\.Core\.Items\) in bc-atlas-layers-profile-\w+\n\n!\[Inside CON Item\]\(table-50000-con-item\.svg\)\n\n\[System\]\(\.\.\/README\.md\) › /u);
    // The picture is where the template puts it, and only there.
    assert.equal(item.match(/!\[/gu).length, 1);
    // Sections that are placed stay out of {{sections}}; one the page does not have leaves no line.
    assert.deepEqual([...item.matchAll(/^#{2,3} (.+)$/gmu)].map(([, title]) => title), ["Used by", "Needs"]);
    assert.match(item, /\n### Needs\n\n- \*\*relates\*\* \[table 50001 CON Price Group\]\(table-50001-con-price-group\.md\)\n\nAsk the team/u);
    assert.match(item, /\nAsk the team before you change it\.\n\n_Generated by BC Atlas from the AL source\. Do not edit; run `bca layers` again\._\n$/u);
    assert.doesNotMatch(item, /\{\{|\n{3}/u);
    const readme = readFileSync(path.join(folder, "pages", "README.md"), "utf8");
    assert.match(readme, /^# bc-atlas-layers-profile-\w+\n\n## Apps\n\n\| App \| Version \|/u);
    assert.match(readme, /\nThe graph itself is in \[atlas\.json\]\(atlas\.json\); .+\n\n_Generated by BC Atlas/u);
    assert.doesNotMatch(readme, /## Layers/u);
    // A kind without a template is written as always.
    assert.match(readFileSync(path.join(folder, "pages", "namespaces", "contoso-core-items.md"), "utf8"), /^# Namespace Contoso\.Core\.Items\n\n\[System\]\(\.\.\/README\.md\) › Layer 2: namespaces\n/u);

    // In sync until the template changes: then the pages of its kind are written again.
    const check = await syncLayers(folder, { check: true });
    assert.equal(check.inSync, true);
    writeFileSync(path.join(folder, "docs", "templates", "object.md"), template.replace("Ask the team", "Ask the owner"));
    const changed = await syncLayers(folder, { check: true });
    assert.equal(changed.inSync, false);
    assert.ok(changed.current.written.length === 12 && changed.current.written.every((file) => file.startsWith("objects/")));
    const second = await syncLayers(folder, {});
    assert.equal(second.current.written.length, 12);
    assert.match(readFileSync(path.join(folder, "pages", "objects", "table-50000-con-item.md"), "utf8"), /Ask the owner before you change it\./u);

    // A placeholder that is not known is an error that names the template and the placeholder, and writes nothing.
    writeFileSync(path.join(folder, "docs", "templates", "app.md"), "# {{title}}\n\n{{owner}}\n");
    await assert.rejects(syncLayers(folder, {}), /The template docs\/templates\/app\.md holds the placeholder \{\{owner\}\}, which is not known\. A template has: \{\{title\}\}, \{\{summary\}\}, \{\{picture\}\}, \{\{sections\}\}, \{\{footer\}\}, \{\{section "<name>"\}\}, \{\{body "<name>"\}\}, \{\{name\}\}/u);
    writeFileSync(path.join(folder, "docs", "templates", "app.md"), "# {{title}}\n\n{{section \"Inside\"}}\n");
    await assert.rejects(syncLayers(folder, {}), /The template docs\/templates\/app\.md asks for the section "Inside" \(\{\{section "Inside"\}\}\), which the page of an app does not have; it has: Namespaces, Depends on/u);
    assert.match(readFileSync(path.join(folder, "pages", "apps", "contoso-core.md"), "utf8"), /^# App Contoso Core\n/u);
    writeFileSync(path.join(folder, ".bca.json"), JSON.stringify({ layers: { templates: "docs/none" } }));
    await assert.rejects(syncLayers(folder, {}), /layers\.templates in \.bca\.json: the folder docs\/none is not found in the project/u);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
  assert.deepEqual(parseTemplate("t.md", "a {{ name }} b", "object").lines, [["a ", { part: "name" }, " b"]]);
  assert.throws(() => parseTemplate("t.md", "{{section}}", "object"), /The template t\.md holds the placeholder \{\{section\}\}/u);
});

test("profiles: a named set of settings over the ones of layers, each in a folder of its own", async () => {
  const layers = {
    outputDir: "docs/system", pictures: "none", language: "de", pages: { stories: false },
    profiles: {
      management: { outputDir: "docs/overview", pages: { objects: false, namespaces: false, lenses: ["overview"] }, names: { readme: "index.md" } },
      sales: { scope: { apps: ["Contoso Sales"] }, language: "en" }
    }
  };
  assert.deepEqual(layersProfiles(layers), ["management", "sales"]);
  const management = layersProfile(layers, "management");
  assert.equal(management.name, "management");
  assert.equal(management.outputDir, "docs/overview");
  assert.equal(management.language, "de", "a key the profile does not set is the one of layers");
  assert.equal(management.pages.stories, undefined, "a key the profile sets replaces the one of layers as a whole");
  assert.equal(layersProfile(layers, "sales").outputDir, "docs/system-sales", "without a folder of its own, a profile gets one next to the pages of layers");
  assert.equal(layersProfile(layers).name, undefined);
  assert.throws(() => layersProfile(layers, "board"), /"board" is not a profile of layers\.profiles in \.bca\.json; there are: management, sales/u);
  assert.throws(() => layersProfile({}, "board"), /"board" is not a profile of layers\.profiles in \.bca\.json; it has none/u);
  assert.throws(() => layersProfile({ profiles: { a: { sections: { object: ["Nothing"] } } } }), /layers\.profiles\.a\.sections\.object in \.bca\.json: "Nothing" is not a section/u);
  assert.throws(() => layersProfile({ profiles: { a: { profiles: {} } } }), /layers\.profiles\.a\.profiles in \.bca\.json is not known/u);
  // Two profiles in one folder would remove the pages of each other.
  assert.throws(() => layersProfile({ profiles: { a: { outputDir: "docs/layers" } } }), /layers\.profiles\.a in \.bca\.json writes to docs\/layers, as the settings of layers itself do; each profile needs a folder \(outputDir\) of its own/u);
  assert.throws(() => layersProfile({ profiles: { a: { outputDir: "docs/x" }, b: { outputDir: "./docs/x/" } } }), /layers\.profiles\.b in \.bca\.json writes to \.\/docs\/x\/, as the profile a does/u);

  const folder = project(layers);
  try {
    const all = await syncLayers(folder, {});
    const overview = await syncLayers(folder, { profile: "management" });
    assert.equal(overview.profile, "management");
    assert.equal(overview.output, path.join(folder, "docs", "overview"));
    assert.equal(overview.current.fixed.readme, "index.md");
    assert.ok(existsSync(path.join(folder, "docs", "overview", "index.md")) && !existsSync(path.join(folder, "docs", "overview", "objects")) && !existsSync(path.join(folder, "docs", "overview", "README.md")));
    assert.ok(existsSync(path.join(folder, "docs", "overview", "stories", "fix.md")), "the profile has its own pages setting");
    assert.match(readFileSync(path.join(folder, "docs", "overview", "index.md"), "utf8"), /\n## Einstieg\n/u);
    assert.equal(JSON.parse(readFileSync(path.join(folder, "docs", "overview", "layers.json"), "utf8")).profile, "management");
    // The pages of the settings of layers are untouched, and both are in sync.
    assert.ok(existsSync(path.join(folder, "docs", "system", "objects", "table-50000-con-item.md")) && !existsSync(path.join(folder, "docs", "system", "stories")));
    assert.equal((await syncLayers(folder, { check: true })).inSync, true);
    assert.equal((await syncLayers(folder, { check: true, profile: "management" })).inSync, true);
    assert.equal(all.current.files > overview.current.files, true);
    // A folder that holds the pages of another profile is not taken over without a word.
    await assert.rejects(syncLayers(folder, { profile: "management", output: path.join(folder, "docs", "system") }), /holds the pages of the settings without a profile; a run with the profile management would replace them\. Give each profile a folder of its own \(outputDir\), or delete .+layers\.json/u);
    await assert.rejects(syncLayers(folder, { output: path.join(folder, "docs", "overview") }), /holds the pages of the profile management; a run with the settings without a profile would replace them/u);
    await assert.rejects(syncLayers(folder, { profile: "board" }), /"board" is not a profile/u);
    assert.ok(existsSync(path.join(folder, "docs", "system", "objects", "table-50000-con-item.md")));

    // A setting that changes takes the pages it no longer wants away.
    writeFileSync(path.join(folder, ".bca.json"), JSON.stringify({ layers: { ...layers, pages: { stories: false, objects: ["CON Item*"] }, names: { objects: "objects/{name}.md" } } }));
    const narrowed = await syncLayers(folder, {});
    assert.ok(narrowed.current.removed.includes("objects/table-50000-con-item.md") && narrowed.current.written.includes("objects/con-item.md"));
    assert.ok(!existsSync(path.join(folder, "docs", "system", "objects", "table-50000-con-item.md")));
    assert.deepEqual(narrowed.current.manifest.files.filter((file) => file.startsWith("objects/")), ["objects/con-item-card.md", "objects/con-item-sync.md", "objects/con-item.md"]);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("a profile narrows the pages, the scope, the language, and the names of another project", async () => {
  const { files, manifest } = await build({
    pages: { lenses: ["data", "security"], stories: ["system"] },
    scope: { types: ["table"], exclude: ["*Test*"] },
    sections: { object: ["Inside", "Uses", "Used by"], story: [] },
    language: "de",
    names: { objects: "objekte/{type}/{type}-{name}.md", stories: "rundgaenge/{id}.md" }
  }, {}, purchasing);
  assert.deepEqual([...files.keys()].filter((file) => file.startsWith("lenses/")), ["lenses/data.md", "lenses/security.md"]);
  assert.ok(files.has("rundgaenge/system.md") && !files.has("rundgaenge/fix.md"));
  assert.ok(manifest.counts.objects > 0 && manifest.counts.objects < 16);
  assert.ok([...files.keys()].filter((file) => file.startsWith("objekte/")).every((file) => file.startsWith("objekte/table/")));
  // A story without sections is its title and what stands above its steps.
  assert.deepEqual(headings(files.get("rundgaenge/system.md")), []);
  assertLinks(files);
});

test("the schema of .bca.json knows the settings of the profile", () => {
  const layers = JSON.parse(readFileSync(path.join(root, "schemas", "bca.schema.json"), "utf8")).properties.layers.properties;
  assert.deepEqual(Object.keys(layers.pages.properties), LAYERS_PAGE_KINDS);
  assert.deepEqual(Object.keys(layers.names.properties), LAYERS_PAGE_KINDS);
  assert.deepEqual(Object.keys(layers.sections.properties), Object.keys(LAYERS_SECTIONS));
  for (const [kind, sections] of Object.entries(LAYERS_SECTIONS)) if (sections) assert.deepEqual(layers.sections.properties[kind].items.enum, sections, kind);
  // A profile has the keys of layers, but no profiles of its own.
  const profile = layers.profiles.additionalProperties.properties;
  assert.deepEqual(Object.keys(profile), Object.keys(layers).filter((key) => key !== "profiles"));
  assert.deepEqual(profile.sections, layers.sections);
});
