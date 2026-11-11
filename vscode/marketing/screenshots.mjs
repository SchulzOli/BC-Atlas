#!/usr/bin/env node
// Takes the screenshots of the BC Atlas view from the example apps of this
// repository, so they can be retaken whenever the view changes:
//
//   node vscode/marketing/screenshots.mjs
//
//   screenshots/*.png                      Marketplace, 1440 x 900 at 1.5x, dark
//   ../../docs/generated/images/view.png   README of the repository, light
//
// Needs Playwright with Chromium (npm install --no-save playwright && npx playwright install chromium).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderSnapshotHtml } from "../../src/app/snapshot.js";
import { Workspace } from "../../src/app/workspace.js";

const { chromium } = createRequire(import.meta.url)("playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const temporary = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-screenshots-"));

async function exported(example) {
  const { html, snapshot } = await renderSnapshotHtml(new Workspace(path.join(root, "examples", example), {}, { live: false }));
  const file = path.join(temporary, `${example}.html`);
  writeFileSync(file, html);
  const id = (label, kind = "object") => snapshot.atlas.nodes.find((node) => node.label === label && node.kind === kind).id;
  return { file, id };
}

const browser = await chromium.launch();
async function shot(target, file, state, { scheme = "dark", after } = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, colorScheme: scheme });
  await page.goto(`file://${file}#${new URLSearchParams(state)}`);
  // The layout settles, and the camera arrives.
  await page.waitForTimeout(3500);
  await after?.(page);
  await page.screenshot({ path: target });
  await page.close();
  console.log(`Wrote ${path.relative(root, target)}`);
}

try {
  const purchasing = await exported("purchasing-app");
  const multi = await exported("multi-app");
  const screenshots = path.join(here, "screenshots");
  const system = { check: "1", sel: purchasing.id("Purchase Request Mgt.") };
  await shot(path.join(screenshots, "view.png"), purchasing.file, system);
  await shot(path.join(root, "docs", "generated", "images", "view.png"), purchasing.file, system, { scheme: "light" });
  await shot(path.join(screenshots, "diagram.png"), purchasing.file, { lens: "data", form: "diagram" });
  await shot(path.join(screenshots, "space.png"), purchasing.file, { form: "3d", check: "1" });
  await shot(path.join(screenshots, "story.png"), purchasing.file, { story: "process:use-case-purchase-requests", step: "11", form: "diagram" });
  await shot(path.join(screenshots, "people.png"), purchasing.file, { lens: "people", form: "diagram", sel: purchasing.id("Ben (Team lead)", "person") });
  await shot(path.join(screenshots, "components.png"), multi.file, { lens: "components", form: "diagram", sel: multi.id("Integration", "component") });
  await shot(path.join(screenshots, "inside.png"), purchasing.file, { inside: purchasing.id("Purchase Request Mgt."), form: "diagram" });
  await shot(path.join(screenshots, "recordings.png"), purchasing.file, { lens: "sync", form: "diagram", sel: purchasing.id("Approve a released purchase request", "recording") });
} finally {
  await browser.close();
  rmSync(temporary, { recursive: true, force: true });
}
