#!/usr/bin/env node
// Renders the Marketplace images from their sources in this folder:
//   icon.svg           -> ../media/icon.png (256 x 256, the extension icon)
//   social-preview.html -> social-preview.jpg (1280 x 640 at 2x, README hero
//                          and the GitHub social preview)
// Needs Playwright with Chromium (npm install --no-save playwright && npx playwright install chromium).
"use strict";

const { chromium } = require("playwright");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const here = __dirname;

(async () => {
  const browser = await chromium.launch();
  const icon = await browser.newPage({ viewport: { width: 256, height: 256 } });
  const svg = readFileSync(path.join(here, "icon.svg"), "utf8").replace("<svg ", '<svg width="256" height="256" ');
  await icon.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await icon.screenshot({ path: path.join(here, "..", "media", "icon.png"), omitBackground: true });

  const preview = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 2 });
  await preview.goto(`file://${path.join(here, "social-preview.html")}`);
  await preview.waitForLoadState("networkidle");
  await preview.screenshot({ path: path.join(here, "social-preview.jpg"), type: "jpeg", quality: 88 });
  await browser.close();
  console.log("Rendered media/icon.png and marketing/social-preview.jpg");
})();
