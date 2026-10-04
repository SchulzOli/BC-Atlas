#!/usr/bin/env node

// Copies standalone HTML samples into the built website. Markdown pages are
// rendered by VitePress; self-contained HTML files are published as they are,
// under <folder>/html/<name>.html so they never collide with index.md pages.
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "website", ".vitepress", "dist");
if (!existsSync(dist)) {
  console.error("Build the website first: npm run site:build");
  process.exit(1);
}

export function publishedHtmlPath(file) {
  return path.posix.join(path.posix.dirname(file), "html", path.posix.basename(file));
}

let copied = 0;
for (const folder of ["examples/docs"]) {
  for (const name of readdirSync(path.join(root, folder)).filter((entry) => entry.endsWith(".html"))) {
    const target = path.join(dist, publishedHtmlPath(`${folder}/${name}`));
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(path.join(root, folder, name), target);
    copied++;
  }
}
console.log(`Copied ${copied} standalone HTML file(s) into the website.`);
