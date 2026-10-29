// Documentation website (GitHub Pages). The Markdown in this repository is the
// only source: README.md becomes the home page, docs/ the guides, and
// examples/ the generated samples. Nothing is copied or duplicated.
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitepress";
import { PROJECT_PAGES, REPOSITORY, SECTIONS, WEBSITE } from "../../scripts/docs-structure.js";
import { ONTOLOGY_FILES } from "../../src/knowledge/ontology.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BASE = "/BC-Atlas/";

const EXCLUDE = [
  "**/node_modules/**", "src/**", "test/**", "vendor/**", "website/**", ".github/**",
  "AGENTS.md", "CONTEXT.md", "vscode/marketing/**"
];

// README.md files become the index page of their folder.
const REWRITES = {
  "README.md": "index.md",
  "examples/README.md": "examples/index.md",
  "examples/report/README.md": "examples/report/index.md",
  "examples/explorer/README.md": "examples/explorer/index.md",
  // The ontology's IRI is https://schulzoli.github.io/BC-Atlas/ontology.
  "docs/reference/ontology.md": "ontology.md"
};

const SOURCES = Object.fromEntries(Object.entries(REWRITES).map(([from, to]) => [to, from]));

function markdownPages(directory = ROOT, relative = "") {
  const pages = new Set();
  for (const name of readdirSync(directory)) {
    if (name.startsWith(".") || name === "node_modules") continue;
    const target = path.join(directory, name);
    const child = relative ? `${relative}/${name}` : name;
    if (statSync(target).isDirectory()) {
      if (["src", "test", "vendor", "website"].includes(child)) continue;
      for (const page of markdownPages(target, child)) pages.add(page);
    } else if (name.endsWith(".md") && !["AGENTS.md", "CONTEXT.md"].includes(child)) {
      pages.add(child);
    }
  }
  return pages;
}

const PAGES = markdownPages();

/** Site link for a repository Markdown page, e.g. docs/setup.md -> /docs/setup. */
function pageLink(file) {
  const rewritten = REWRITES[file] ?? file;
  return `/${rewritten.replace(/(^|\/)index\.md$/u, "$1").replace(/\.md$/u, "")}`;
}

/**
 * Makes repository-relative links work on the website: links to README.md
 * follow the index rewrite, and links to files that are not pages (JSON, AL
 * source, LICENSE, HTML samples) point to GitHub or to the published copy.
 */
function repositoryLinks(md) {
  md.core.ruler.after("inline", "bca-repository-links", (state) => {
    // A rewritten page may come with its new path; links are relative to the file in the repository.
    const rendered = path.relative(ROOT, state.env.path ?? "").replaceAll("\\", "/");
    const source = SOURCES[rendered] ?? rendered;
    const moved = path.posix.dirname(REWRITES[source] ?? source) !== path.posix.dirname(source);
    if (!source || source.startsWith("..")) return;
    for (const block of state.tokens) {
      for (const token of block.children ?? []) {
        if (token.type !== "link_open") continue;
        const href = token.attrGet("href");
        if (!href || /^(?:[a-z][a-z\d+.-]*:|#|\/)/iu.test(href)) continue;
        const [target, hash] = href.split("#");
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(source), decodeURI(target)));
        const suffix = hash ? `#${hash}` : "";
        if (PAGES.has(resolved)) {
          // Relative links resolve against the rewritten page, so a moved page links absolutely.
          if (REWRITES[resolved] || moved) token.attrSet("href", `${pageLink(resolved)}${suffix}`);
          continue;
        }
        if (resolved.startsWith("examples/") && resolved.endsWith(".html")) {
          // Published by scripts/site-assets.js under <folder>/html/.
          token.attrSet("href", `${WEBSITE}${path.posix.join(path.posix.dirname(resolved), "html", path.posix.basename(resolved))}`);
          token.attrSet("target", "_blank");
          continue;
        }
        if (existsSync(path.join(ROOT, resolved))) {
          const kind = statSync(path.join(ROOT, resolved)).isDirectory() ? "tree" : "blob";
          token.attrSet("href", `${REPOSITORY}/${kind}/main/${resolved}${suffix}`);
        }
      }
    }
  });
}

function sidebar() {
  const groups = SECTIONS.map(([text, entries]) => ({
    text,
    collapsed: false,
    items: entries.map(([label, file]) => {
      const resolved = path.posix.normalize(path.posix.join("docs", file));
      return PAGES.has(resolved)
        ? { text: label, link: pageLink(resolved) }
        : { text: label, link: `${REPOSITORY}/blob/main/${resolved}` };
    })
  }));
  groups.push({
    text: "Project",
    collapsed: true,
    items: PROJECT_PAGES.map(([text, file]) => ({ text, link: pageLink(file) }))
  });
  return groups;
}

// The BC Atlas mark: an "A" drawn as a dependency graph with an orbit.
const LOGO = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#2f6fe0"/><ellipse cx="16" cy="17.5" rx="13.2" ry="4.4" transform="rotate(-14 16 17.5)" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="1.3"/><path d="M16 7.2L8.4 24.6M16 7.2l7.6 17.4M11 18.2h10" stroke="#fff" stroke-width="2.6" stroke-linecap="round" fill="none"/><circle cx="16" cy="7" r="3.2" fill="#5eead4" stroke="#fff" stroke-width="1.3"/></svg>')}`;

export default defineConfig({
  title: "BC Atlas",
  description: "Architecture maps, health checks, and documentation for Microsoft Dynamics 365 Business Central AL projects.",
  lang: "en-US",
  base: BASE,
  srcDir: "..",
  srcExclude: EXCLUDE,
  rewrites: REWRITES,
  cleanUrls: true,
  lastUpdated: true,
  head: [["meta", { name: "theme-color", content: "#0b62d6" }], ["link", { rel: "icon", href: LOGO }]],
  // The ontology page points tools to its RDF files.
  transformHead: ({ pageData }) => pageData.filePath === "docs/reference/ontology.md"
    ? Object.entries(ONTOLOGY_FILES).map(([extension, [, type]]) => ["link", { rel: "alternate", type, href: `${BASE}ontology.${extension}` }])
    : [],
  markdown: {
    config: repositoryLinks,
    // AL is a Pascal-family language; this keeps code samples highlighted.
    languageAlias: { al: "pascal" }
  },
  themeConfig: {
    logo: LOGO,
    nav: [
      { text: "Guide", link: "/docs/getting-started" },
      { text: "Setup", link: "/docs/setup" },
      { text: "CLI reference", link: "/docs/cli-reference" },
      { text: "Examples", link: "/examples/" },
      { text: "Changelog", link: "/CHANGELOG" }
    ],
    sidebar: sidebar(),
    outline: { level: [2, 3] },
    search: { provider: "local" },
    socialLinks: [{ icon: "github", link: REPOSITORY }],
    editLink: { pattern: `${REPOSITORY}/edit/main/:path`, text: "Edit this page on GitHub" },
    footer: {
      message: "Released under the MIT License.",
      copyright: "BC Atlas contributors"
    }
  }
});
