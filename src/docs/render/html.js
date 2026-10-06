// Single self-contained HTML file: navigation, use cases, journey, indexes,
// coverage, and every scenario as a guide or test case. No external assets,
// prints cleanly, and works offline or as a pipeline artifact.
import { label, phrase } from "../phrases.js";
import { escapeXml, html } from "./format.js";
import { testCaseRows } from "./markdown.js";
import { humanizeFeature, sameAsTitle } from "../task.js";

const LINK_HEADINGS = { next: "heading.next", related: "heading.related", alternative: "heading.alternative" };

const STYLE = `
:root{--bg:#fff;--fg:#1b1f24;--muted:#5b6470;--line:#d9dee4;--accent:#0b62d6;--soft:#f3f6f9;--ui:#0b3d7a}
@media (prefers-color-scheme:dark){:root{--bg:#14171b;--fg:#e6e9ed;--muted:#9aa4b0;--line:#2c333b;--accent:#6aa7ff;--soft:#1c2127;--ui:#a9c8ff}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 "Segoe UI",system-ui,-apple-system,sans-serif}
header{padding:20px 24px;border-bottom:1px solid var(--line);display:flex;gap:16px;align-items:center;flex-wrap:wrap}
header h1{margin:0;font-size:22px;flex:1 1 auto}
header input{flex:0 1 280px;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--soft);color:var(--fg)}
.layout{display:grid;grid-template-columns:260px minmax(0,1fr)}
nav{border-right:1px solid var(--line);padding:16px;position:sticky;top:0;height:100vh;overflow:auto;font-size:14px}
nav h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:16px 0 6px}
nav ul{list-style:none;margin:0;padding:0}nav li{margin:2px 0}
nav a{color:var(--fg);text-decoration:none}nav a:hover{color:var(--accent)}
main{padding:24px;max-width:960px}
a{color:var(--accent)}
section,article{margin-bottom:40px}
article{border-top:1px solid var(--line);padding-top:24px}
h2{font-size:20px;margin:0 0 8px}h3{font-size:16px;margin:20px 0 6px}
.muted{color:var(--muted)}.short{font-size:16px}
.ui{color:var(--ui)}
kbd{font:inherit;background:var(--soft);border:1px solid var(--line);border-radius:4px;padding:0 4px}
.note{background:var(--soft);border-left:3px solid var(--accent);padding:8px 12px;margin:8px 0}
.info{display:block;color:var(--muted);font-size:14px}
.result{display:block;margin-top:4px}
ol.steps>li{margin:6px 0}
table{border-collapse:collapse;width:100%;margin:8px 0;font-size:14px}
th,td{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
th{background:var(--soft)}
.chips span{display:inline-block;background:var(--soft);border:1px solid var(--line);border-radius:12px;padding:0 8px;margin:0 4px 4px 0;font-size:12px}
details{margin-top:12px;font-size:13px;color:var(--muted)}
.journey svg,.diagram svg{max-width:100%;height:auto;border-radius:8px}
.diagram{overflow-x:auto;margin:8px 0 4px}
@media (max-width:760px){.layout{grid-template-columns:1fr}nav{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line)}}
@media print{nav,header input{display:none}.layout{display:block}article{break-before:page}main{max-width:none}}
`;

const SCRIPT = `
const input=document.getElementById("filter");
input&&input.addEventListener("input",()=>{const q=input.value.trim().toLowerCase();
for(const el of document.querySelectorAll("[data-search]")){el.hidden=q&&!el.dataset.search.includes(q);}});
`;

function link(target) {
  return target.exists ? `<a href="#${escapeXml(target.id)}">${escapeXml(target.title)}</a>` : `<b>${escapeXml(target.id)}</b>`;
}

function stepItem(step) {
  const info = step.info ? `<span class="info">${escapeXml(step.info)}</span>` : "";
  const nested = step.items?.length ? `<ol type="a">${step.items.map(stepItem).join("")}</ol>` : "";
  return `<li>${html(step.cmd)}${info}${nested}</li>`;
}

function prereqItem(item, language) {
  if (item.kind === "requires") return phrase(language, "label.requires", { guide: { raw: link(item.link) } });
  return item.tokens;
}

function tokensHtml(tokens) {
  return tokens.map((token) => (token?.raw !== undefined ? token.raw : html([token]))).join("");
}

function guideBody(task) {
  const { language } = task;
  const parts = [];
  if (task.prereqs.length) {
    parts.push(`<h3>${label(language, "heading.prereq")}</h3><ul>${task.prereqs.map((item) =>
      `<li>${tokensHtml(prereqItem(item, language))}</li>`).join("")}</ul>`);
  }
  if (task.steps.length) {
    parts.push(`<h3>${label(language, "heading.steps")}</h3>`);
    if (task.examples) parts.push(`<p class="note">${escapeXml(label(language, "label.examples"))}</p>`);
    parts.push(`<ol class="steps">${task.steps.map((step) => {
      const result = step.result?.length
        ? `<span class="result">${html(phrase(language, "label.step-result", { result: step.result.join(" ") }))}</span>`
        : "";
      return stepItem(step).replace(/<\/li>$/u, `${result}</li>`);
    }).join("")}</ol>`);
  }
  parts.push(`<h3>${label(language, "heading.result")}</h3><ul>${task.result.map((item) => `<li>${escapeXml(item)}</li>`).join("")}</ul>`);
  for (const [kind, heading] of Object.entries(LINK_HEADINGS)) {
    if (task.links[kind].length) {
      parts.push(`<h3>${label(language, heading)}</h3><ul>${task.links[kind].map((target) => `<li>${link(target)}</li>`).join("")}</ul>`);
    }
  }
  return parts.join("\n");
}

function testCaseBody(task) {
  const { language } = task;
  const t = (key) => label(language, key);
  const preconditions = task.prereqs.filter(({ kind }) => kind !== "permission");
  return [
    `<table><tbody>
<tr><th>${t("testcase.id")}</th><td><code>${escapeXml(task.id)}</code></td></tr>
<tr><th>${t("testcase.objective")}</th><td>${escapeXml(task.goal)}</td></tr>
${task.permissions.length ? `<tr><th>${t("testcase.permissions")}</th><td>${escapeXml(task.permissions.join(", "))}</td></tr>` : ""}
</tbody></table>`,
    preconditions.length
      ? `<h3>${t("testcase.preconditions")}</h3><ul>${preconditions.map((item) => `<li>${tokensHtml(prereqItem(item, language))}</li>`).join("")}</ul>`
      : "",
    `<h3>${t("testcase.steps")}</h3>
<table><thead><tr><th>${t("testcase.step")}</th><th>${t("testcase.action")}</th><th>${t("testcase.expected")}</th><th>${t("testcase.pass")}</th><th>${t("testcase.actual")}</th></tr></thead><tbody>
${testCaseRows(task).map((row, index) => `<tr><td>${index + 1}</td><td>${html(row.action)}</td><td>${html(row.expected)}</td><td>☐</td><td></td></tr>`).join("\n")}
</tbody></table>`,
    `<h3>${t("testcase.signoff")}</h3>
<table><thead><tr><th>${t("testcase.tester")}</th><th>${t("testcase.date")}</th><th>${t("testcase.outcome")}</th></tr></thead><tbody><tr><td>&nbsp;</td><td></td><td>☐</td></tr></tbody></table>`
  ].filter(Boolean).join("\n");
}

function diagram(svg) {
  return svg ? `<div class="diagram">${svg}</div>` : "";
}

function article(task, mode, flow) {
  const { language } = task;
  const search = [task.id, task.title, task.goal, ...task.features, ...task.permissions].join(" ").toLowerCase();
  const chips = task.features.length ? `<p class="chips">${task.features.map((feature) => `<span>${escapeXml(humanizeFeature(feature))}</span>`).join("")}</p>` : "";
  return `<article id="${escapeXml(task.id)}" data-search="${escapeXml(search)}">
<h2>${mode === "testcase" ? `${escapeXml(label(language, "testcase.title", { id: task.id }))}: ` : ""}${escapeXml(task.title)}</h2>
${chips}${mode === "testcase" ? "" : `<p class="short">${html(task.shortdesc)}</p>`}
${diagram(flow)}
${mode === "testcase" ? testCaseBody(task) : guideBody(task)}
<details><summary>${label(language, "heading.source")}</summary>
${label(language, "label.file")}: <code>${escapeXml(task.source.file)}</code> · ${label(language, "label.function")}: <code>${escapeXml(task.source.procedure)}</code> · ${label(language, "label.hash")}: <code>${escapeXml(task.source.hash)}</code>
</details>
</article>`;
}

function overview(catalog, journeySvg, processes) {
  const { language } = catalog;
  const t = (key, values) => label(language, key, values);
  const parts = [`<section id="overview">`];
  const named = catalog.useCases.filter(({ feature }) => feature);
  if (named.length) {
    parts.push(`<h2>${t("heading.use-cases")}</h2>`);
    for (const useCase of catalog.useCases) {
      parts.push(`<h3 id="${escapeXml(useCase.id)}">${escapeXml(useCase.title)}</h3>${diagram(processes?.get(useCase.id))}<ol>${useCase.main.map((task) =>
        `<li>${link({ ...task, exists: true })}${sameAsTitle(task) ? "" : ` <span class="muted">${escapeXml(task.goal)}</span>`}</li>`).join("")}</ol>`);
      if (useCase.alternatives.length) {
        parts.push(`<p class="muted">${t("heading.alternatives")}</p><ul>${useCase.alternatives.map((task) =>
          `<li>${link({ ...task, exists: true })}</li>`).join("")}</ul>`);
      }
    }
  }
  if (journeySvg) parts.push(`<h2>${t("heading.journey")}</h2><div class="journey">${journeySvg}</div>`);
  const table = (heading, rows) => rows.length
    ? `<h2>${heading}</h2><table><tbody>${rows.map(({ name, tasks }) =>
      `<tr><th>${escapeXml(name)}</th><td>${tasks.map((task) => link({ ...task, exists: true })).join(", ")}</td></tr>`).join("")}</tbody></table>`
    : "";
  parts.push(table(t("heading.by-page"), catalog.byPage), table(t("heading.by-permission"), catalog.byPermission));
  if (catalog.coverage) {
    const { coverage } = catalog;
    parts.push(`<h2>${t("heading.coverage")}</h2><p>${escapeXml(t("label.coverage", { covered: String(coverage.covered), total: String(coverage.total) }))}</p>`);
    if (coverage.untouchedPages.length) {
      parts.push(`<h3>${t("heading.untouched-pages")}</h3><ul>${coverage.untouchedPages.map(({ caption, id }) =>
        `<li>${escapeXml(caption)}${id ? ` <span class="muted">(${escapeXml(id)})</span>` : ""}</li>`).join("")}</ul>`);
    }
    if (coverage.unusedActions.length) {
      parts.push(`<h3>${t("heading.unused-actions")}</h3><ul>${coverage.unusedActions.map(({ page, action }) =>
        `<li>${escapeXml(page)}: ${escapeXml(action)}</li>`).join("")}</ul>`);
    }
  }
  parts.push("</section>");
  return parts.join("\n");
}

export function renderHtml(catalog, { mode = "guide", journeySvg, flows, processes } = {}) {
  const { language } = catalog;
  const t = (key) => label(language, key);
  const title = catalog.title ?? t("heading.documentation");
  const navUseCases = catalog.useCases.filter(({ feature }) => feature);
  const svg = journeySvg?.replace(/^<\?xml[^>]*>\s*/u, "");
  return `<!doctype html>
<html lang="${escapeXml(language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="BC Atlas">
<title>${escapeXml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<header><h1>${escapeXml(title)}</h1><input id="filter" type="search" placeholder="${escapeXml(t("label.search"))}" aria-label="${escapeXml(t("label.search"))}"></header>
<div class="layout">
<nav aria-label="${escapeXml(t("label.contents"))}">
${navUseCases.length ? `<h2>${t("heading.use-cases")}</h2><ul>${catalog.useCases.map((useCase) =>
    `<li><a href="#${escapeXml(useCase.id)}">${escapeXml(useCase.title)}</a></li>`).join("")}</ul>` : ""}
<h2>${t("heading.scenarios")}</h2><ul>${catalog.tasks.map((task) =>
    `<li data-search="${escapeXml([task.id, task.title, ...task.features].join(" ").toLowerCase())}"><a href="#${escapeXml(task.id)}">${escapeXml(task.title)}</a></li>`).join("")}</ul>
</nav>
<main>
<p class="muted">${escapeXml(t("label.generated"))}</p>
${overview(catalog, svg, processes)}
${catalog.tasks.map((task) => article(task, mode, flows?.get(task.id))).join("\n")}
</main>
</div>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
