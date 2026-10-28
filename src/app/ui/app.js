// BC Atlas pages: one page per question (overview, health, architecture,
// dependencies, diagrams, objects, docs). In VS Code the extension answers
// the page's requests (LIVE); exported pages read the same data from an
// embedded snapshot.
(async () => {
  "use strict";

  const BOOT = window.BCA_APP ?? { mode: "static" };
  // VS Code: data can change, and the page can open files and change the architecture.
  const LIVE = BOOT.mode === "vscode";
  const vscode = LIVE ? acquireVsCodeApi() : undefined;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) => String(value ?? "").replace(/[&<>"']/gu, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const fmt = (value) => Number(value ?? 0).toLocaleString("en-US");
  const plural = (count, word, many = `${word}s`) => `${fmt(count)} ${count === 1 ? word : many}`;
  const kindsText = (kinds) => Object.entries(kinds ?? {}).sort((a, b) => b[1] - a[1]).map(([kind, count]) => count > 1 ? `${kind} ×${count}` : kind).join(", ");

  async function inflate(base64) {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).text();
  }

  // ------------------------------------------------------------------ data
  const SNAPSHOT = LIVE ? undefined : JSON.parse(await inflate(window.BCA_SNAPSHOT_GZIP));
  const SNAPSHOT_OBJECTS = LIVE ? undefined : new Map(SNAPSHOT.objects.map((object) => [object.id, object]));

  // Expands an object page of the snapshot (see compactDetails in snapshot.js).
  function snapshotObject(id) {
    const compact = SNAPSHOT.details[id];
    if (!compact) throw new Error("This object is not part of the export.");
    const node = (index) => {
      const [nodeId, label, type, component, app] = SNAPSHOT.nodes[index];
      return { id: nodeId, label, type, component: component ?? undefined, app: app ?? undefined };
    };
    const link = ([index, dependency, kinds]) => ({ ...node(index), dependency, kinds });
    const [fields, procedures, actions, parts] = compact.members;
    return {
      ...SNAPSHOT_OBJECTS.get(id),
      source: compact.source,
      properties: compact.properties.map(([name, value]) => ({ name, value })),
      uses: compact.uses.map(link),
      usedBy: compact.usedBy.map(link),
      violations: compact.violations.map((violation) => ({ ...violation, target: node(violation.target) })),
      members: {
        fields: fields.map(([number, name, type]) => ({ number, name, type })),
        procedures: procedures.map(([signature, visibility, kind, event]) => ({ signature, visibility, kind, event: Boolean(event) })),
        actions: actions.map(([name, container]) => ({ name, container })),
        parts: parts.map(([name, target]) => ({ name, target }))
      }
    };
  }
  // Requests to the extension: { type: "request", id, method, params } is
  // answered with { type: "response", id, result } or { id, error }.
  let cache = new Map();
  let nextRequest = 0;
  const pending = new Map();
  addEventListener("message", (event) => {
    const message = event.data;
    if (message?.type !== "response" || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error));
    else resolve(message.result);
  });

  function call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++nextRequest;
      pending.set(id, { resolve, reject });
      vscode.postMessage({ type: "request", id, method, params });
    });
  }

  // Read requests are cached until the source changes.
  function read(method, params = {}) {
    const clean = Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== "" && value !== false));
    const key = `${method}:${JSON.stringify(clean)}`;
    if (!cache.has(key)) {
      const promise = call(method, clean);
      cache.set(key, promise);
      promise.catch(() => cache.delete(key));
    }
    return cache.get(key);
  }

  const api = {
    overview: () => LIVE ? read("overview") : SNAPSHOT.overview,
    health: () => LIVE ? read("health") : SNAPSHOT.health,
    architecture: (settings = {}) => LIVE ? read("architecture", settings) : SNAPSHOT.architecture,
    objects: () => LIVE ? read("objects") : SNAPSHOT.objects,
    object: async (id) => (LIVE ? read("object", { id }) : snapshotObject(id)),
    views: () => LIVE ? read("views") : SNAPSHOT.views,
    diagram: async (settings) => {
      if (LIVE) return read("diagram", settings);
      const diagram = SNAPSHOT.diagrams[settings.view];
      if (!diagram) throw new Error("This view is not part of the export; open the project in VS Code with the BC Atlas extension to render it.");
      return diagram;
    },
    explorer: (settings) => LIVE ? read("explorer", settings) : embeddedPage("explorer", window.BCA_EXPLORER_GZIP),
    docsHtml: () => LIVE ? read("docsHtml") : embeddedPage("docs", window.BCA_DOCS_GZIP),
    // Only in VS Code: the extension opens files and saves downloads.
    openFile: (file, line) => call("openFile", { file, line }),
    saveFile: (name, content) => call("saveFile", { name, content })
  };

  // Embedded pages of an exported app load through srcdoc: hosts such as
  // claude.ai artifacts do not allow frames from blob: URLs.
  const embedded = new Map();
  async function embeddedPage(name, base64) {
    if (!embedded.has(name)) embedded.set(name, await inflate(base64));
    return embedded.get(name);
  }

  // ----------------------------------------------------------------- theme
  const THEME_KEY = "bca-theme";
  const storedTheme = (() => { try { return localStorage.getItem(THEME_KEY); } catch { return undefined; } })();
  // In VS Code the page follows the editor's color theme.
  const editorTheme = () => document.body.classList.contains("vscode-light") || document.body.classList.contains("vscode-high-contrast-light") ? "light" : "dark";
  let theme = LIVE ? editorTheme() : storedTheme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  // The design tokens as the editor's theme resolves them (src/ui/theme.css).
  // Embedded pages (explorer, docs) are documents of their own without the
  // --vscode-* variables, so they get the resolved values.
  const TOKENS = ["bg", "surface", "surface-2", "panel", "panel-solid", "border", "border-strong", "text", "muted", "accent", "accent-text",
    "accent-soft", "hover", "input", "label", "label-shadow", "shadow", "ok", "warn", "error", "info", "font", "font-size", "mono", "link", "focus",
    "selected", "selected-text"];
  const themeTokens = () => {
    if (!LIVE) return undefined;
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(TOKENS.map((name) => [`--${name}`, style.getPropertyValue(`--${name}`).trim()]).filter(([, value]) => value));
  };
  const applyTheme = () => {
    document.documentElement.dataset.theme = theme;
    const tokens = themeTokens();
    for (const frame of $$("iframe[data-theme-sync]")) frame.contentWindow?.postMessage({ type: "bca-theme", theme, tokens }, "*");
    for (const frame of $$("iframe[data-theme-document]")) {
      try {
        const root = frame.contentDocument.documentElement;
        root.dataset.theme = theme;
        for (const [name, value] of Object.entries(tokens ?? {})) root.style.setProperty(name, value);
      } catch { /* another origin */ }
    }
  };
  applyTheme();
  if (LIVE) {
    $("#theme-toggle").hidden = true;
    // VS Code changes the body class for light, dark, and high contrast, and
    // the --vscode-* variables on <html> for every theme switch.
    let applied = JSON.stringify(themeTokens());
    new MutationObserver(() => {
      const tokens = JSON.stringify(themeTokens());
      if (editorTheme() === theme && tokens === applied) return;
      theme = editorTheme();
      applied = tokens;
      applyTheme();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"], subtree: false });
    new MutationObserver(() => {
      if (editorTheme() === theme) return;
      theme = editorTheme();
      applyTheme();
    }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }
  $("#theme-toggle").addEventListener("click", () => {
    theme = theme === "dark" ? "light" : "dark";
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* optional */ }
    applyTheme();
  });

  // ------------------------------------------------------------ ui helpers
  let toastTimer;
  function toast(message) {
    const element = $("#toast");
    element.textContent = message;
    element.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove("show"), 3200);
  }

  function confirmDialog(title, text, ok = "Continue") {
    const dialog = $("#confirm");
    $("#confirm-title").textContent = title;
    $("#confirm-text").textContent = text;
    $("#confirm-ok").textContent = ok;
    return new Promise((resolve) => {
      dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
      dialog.showModal();
    });
  }

  const loading = (text = "Analyzing the AL source…") => `<div class="loading"><div class="bar-anim"></div><div>${esc(text)}</div></div>`;
  const severityPill = (severity) => `<span class="pill ${esc(severity)}">${esc(severity)}</span>`;
  const objectLink = (object, text) => object?.id
    ? `<a href="#/object/${encodeURIComponent(object.id)}">${esc(text ?? object.label)}</a>`
    : esc(text ?? object?.label ?? "");
  const stat = ({ label, value, sub, tone, href, text }) => {
    const tag = href ? "a" : "div";
    return `<${tag} class="stat${tone ? ` ${tone}` : ""}${text ? " text" : ""}"${href ? ` href="${esc(href)}"` : ""}><div class="label">${esc(label)}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</${tag}>`;
  };
  const EFFORT = { S: "small", M: "medium", L: "large" };

  function setHeader(title, subtitle = "", actions = "") {
    $("#page-title").textContent = title;
    $("#page-subtitle").innerHTML = subtitle;
    $("#page-actions").innerHTML = actions;
    document.title = `${title} · BC Atlas`;
  }

  // Sortable, filterable table that renders a page of rows at a time.
  function dataTable(container, { columns, rows, empty = "Nothing to show.", pageSize = 300, onRow, sort }) {
    let limit = pageSize;
    let sortBy = sort?.key;
    let direction = sort?.direction ?? "descending";
    const render = () => {
      const column = columns.find(({ key }) => key === sortBy);
      const sorted = column ? [...rows].sort((a, b) => {
        const left = column.value ? column.value(a) : a[column.key];
        const right = column.value ? column.value(b) : b[column.key];
        const order = typeof left === "number" && typeof right === "number" ? left - right : String(left ?? "").localeCompare(String(right ?? ""), "en", { numeric: true });
        return direction === "ascending" ? order : -order;
      }) : rows;
      const visible = sorted.slice(0, limit);
      container.innerHTML = rows.length ? `
        <div class="table-scroll"><table class="data">
          <thead><tr>${columns.map(({ key, label, numeric }) => `<th data-sort="${esc(key)}"${key === sortBy ? ` aria-sort="${direction}"` : ""}${numeric ? ' class="num"' : ""}>${esc(label)}</th>`).join("")}</tr></thead>
          <tbody>${visible.map((row, index) => `<tr${onRow ? ` class="link" data-index="${index}"` : ""}>${columns.map(({ render: cell, key, numeric }) => `<td${numeric ? ' class="num"' : ""}>${cell ? cell(row) : esc(row[key])}</td>`).join("")}</tr>`).join("")}</tbody>
        </table></div>
        ${sorted.length > limit ? `<div class="more">Showing ${fmt(limit)} of ${fmt(sorted.length)}<button class="btn" data-more>Show ${fmt(Math.min(pageSize * 4, sorted.length - limit))} more</button></div>` : ""}`
        : `<div class="empty">${esc(empty)}</div>`;
      container.onclick = (event) => {
        const header = event.target.closest("th[data-sort]");
        if (header) {
          if (sortBy === header.dataset.sort) direction = direction === "ascending" ? "descending" : "ascending";
          else { sortBy = header.dataset.sort; direction = columns.find(({ key }) => key === sortBy)?.numeric ? "descending" : "ascending"; }
          return render();
        }
        if (event.target.closest("[data-more]")) { limit += pageSize * 4; return render(); }
        if (event.target.closest("a, button, summary")) return;
        const row = event.target.closest("tr[data-index]");
        if (row && onRow) onRow(visible[Number(row.dataset.index)]);
      };
    };
    render();
  }

  // ------------------------------------------------------------- navigation
  const ICONS = {
    overview: '<path d="M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z"/>',
    health: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
    architecture: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
    dependencies: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="7" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8 7.2l7.6 0.4M7.3 8.2l3.6 7.7M16.8 9.2l-3.6 6.8"/>',
    diagrams: '<rect x="3" y="4" width="7" height="5" rx="1"/><rect x="14" y="4" width="7" height="5" rx="1"/><rect x="8.5" y="15" width="7" height="5" rx="1"/><path d="M6.5 9v3h11V9M12 12v3"/>',
    objects: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
    docs: '<path d="M5 4h10l4 4v12H5z"/><path d="M15 4v4h4M8 12h8M8 16h6"/>'
  };
  const PAGES = [
    ["overview", "Overview"],
    ["health", "Health"],
    ["architecture", "Architecture"],
    ["dependencies", "Dependencies"],
    ["diagrams", "Diagrams"],
    ["objects", "Objects"],
    ["docs", "Docs"]
  ];

  function renderNav(overview) {
    const counts = {
      health: overview ? [overview.health.counts.error + overview.health.counts.warning, overview.health.counts.error > 0] : undefined,
      architecture: overview ? [overview.architecture.violations, overview.architecture.mode === "configured" && overview.architecture.baseline.new > 0] : undefined,
      objects: overview ? [overview.summary.objects, false] : undefined,
      docs: overview?.docs.scenarios ? [overview.docs.scenarios, false] : undefined
    };
    $("#nav").innerHTML = PAGES
      .filter(([id]) => id !== "docs" || !overview || overview.docs.scenarios)
      .map(([id, label]) => `<a href="#/${id}" data-page="${id}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[id]}</svg>${label}${counts[id] && counts[id][0] ? `<span class="count${counts[id][1] ? " bad" : ""}">${fmt(counts[id][0])}</span>` : ""}</a>`)
      .join("");
    markNav();
  }

  let shownPage;
  function markNav() {
    const page = route().page === "object" ? "objects" : route().page;
    for (const link of $$("#nav a")) {
      if (link.dataset.page === page) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    // In VS Code the side bar of the extension is the navigation; it marks this page.
    if (LIVE && page !== shownPage) vscode.postMessage({ type: "page", page });
    shownPage = page;
  }

  function route() {
    const [path, query = ""] = location.hash.replace(/^#\/?/u, "").split("?");
    const [page = "overview", ...rest] = path.split("/");
    return { page: page || "overview", arg: rest.length ? decodeURIComponent(rest.join("/")) : undefined, params: new URLSearchParams(query) };
  }

  const go = (page, params) => {
    const query = params ? new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== "" && value !== false)).toString() : "";
    location.hash = `#/${page}${query ? `?${query}` : ""}`;
  };

  // ------------------------------------------------------------------ pages
  async function overviewPage(page) {
    const data = await api.overview();
    const { summary, health, architecture } = data;
    const apps = summary.apps.length;
    setHeader(data.title,
      `${plural(apps, "app")} · ${plural(summary.files, "AL file")} · ${LIVE ? `analyzed ${new Date(data.updatedAt).toLocaleTimeString()}` : `exported ${new Date(SNAPSHOT.generatedAt).toLocaleString()}`}`);
    const types = Object.entries(summary.objectsByType);
    const maxType = Math.max(1, ...types.map(([, count]) => count));
    const issues = health.counts.error + health.counts.warning;
    const objects = await api.objects();
    const byLabel = new Map(objects.map((object) => [`${object.type} ${object.objectId ?? ""} ${object.label}`.replace("  ", " "), object]));
    page.innerHTML = `
      <div class="stats">
        ${stat({ label: "Objects", value: fmt(summary.objects), sub: `${plural(summary.relationships, "relationship")}`, href: "#/objects" })}
        ${stat({ label: "Health", value: health.passed ? "Passed" : "Failed", tone: health.passed ? "good" : "bad", sub: `${plural(health.counts.error, "error")}, ${plural(health.counts.warning, "warning")}`, href: "#/health" })}
        ${stat({ label: architecture.mode === "proposal" ? "Proposed architecture" : "Architecture", value: `${fmt(architecture.components)}`, sub: `components in ${plural(architecture.layers, "layer")}`, href: "#/architecture" })}
        ${stat({ label: "Wrong-way dependencies", value: fmt(architecture.violations), tone: architecture.violations ? (architecture.mode === "configured" && architecture.baseline.new ? "bad" : "warn") : "good", sub: `${plural(architecture.workItems, "work item")} to resolve`, href: "#/architecture" })}
        ${stat({ label: "Can become apps today", value: fmt(architecture.extractable), sub: `of ${plural(architecture.components, "component")}`, href: "#/architecture" })}
        ${stat({ label: "Cycles", value: fmt(summary.cycles), tone: summary.cycles ? "warn" : "good", sub: `${plural(summary.unresolved, "unresolved reference")}` })}
      </div>
      <div class="grid">
        <section class="card"><h2>Objects by type</h2>
          <div class="bars">${types.map(([type, count]) => `<div class="bar"><span>${esc(type)}</span><span class="track"><span class="fill" style="width:${(count / maxType * 100).toFixed(1)}%"></span></span><span class="num">${fmt(count)}</span></div>`).join("")}</div>
        </section>
        <section class="card"><h2>Apps <span class="muted">${fmt(apps)}</span></h2>
          <ul class="list">${summary.apps.map((app) => `<li><span class="grow"><b>${esc(app.name)}</b></span><span class="muted nowrap">${esc(app.version ?? "")}</span><span class="muted small nowrap">${esc(app.publisher ?? "")}</span></li>`).join("")}</ul>
        </section>
      </div>
      <div class="grid">
        <section class="card"><h2>Findings <span class="muted">${issues ? plural(issues, "error or warning", "errors and warnings") : "no errors or warnings"}</span><span class="actions"><a class="btn" href="#/health">All findings</a></span></h2>
          ${health.findings.length ? `<ul class="list">${health.findings.map((finding) => `<li>${severityPill(finding.severity)}<span class="grow">${esc(finding.message)}</span></li>`).join("")}</ul>` : '<p class="muted">No findings.</p>'}
        </section>
        <section class="card"><h2>Most connected objects</h2>
          <ul class="list">${health.hubs.map((hub) => `<li><span class="grow">${objectLink(byLabel.get(hub.object), hub.object)}</span><span class="muted nowrap small">${fmt(hub.incoming)} in · ${fmt(hub.outgoing)} out</span></li>`).join("")}</ul>
        </section>
      </div>
      <section class="card"><h2>Next steps</h2>
        <ul class="list">${nextSteps(data).map(([text, href, label]) => `<li><span class="grow">${text}</span>${href ? `<a class="btn" href="${esc(href)}">${esc(label)}</a>` : ""}</li>`).join("")}</ul>
      </section>`;
  }

  function nextSteps({ architecture, health, docs }) {
    const steps = [];
    if (architecture.mode === "proposal") {
      steps.push(["No target architecture is configured yet. Review the proposal (components, layers, and allowed dependencies) and adopt it, so <code>bca check</code> keeps it in place.", "#/architecture", "Review the proposal"]);
    } else if (architecture.baseline.new) {
      steps.push([`${plural(architecture.baseline.new, "new dependency", "new dependencies")} point the wrong way. Resolve them or accept them in the baseline.`, "#/architecture", "Resolve"]);
    } else if (architecture.baseline.fixed) {
      steps.push([`${plural(architecture.baseline.fixed, "accepted violation")} are fixed. Update the baseline to lock in the progress.`, "#/architecture", "Update baseline"]);
    }
    if (!health.passed) steps.push(["The health check fails; CI would stop here.", "#/health", "See why"]);
    steps.push(["See how the apps and objects depend on each other in 3D, and replay how it grew.", "#/dependencies", "Open explorer"]);
    if (!docs.scenarios) steps.push(["Write user guides from AL UI tests: tag a test with <code>// [FEATURE]</code> comments and run <code>bca docs generate</code>.", undefined]);
    steps.push(["Share this view: <code>bca export --view app -o atlas.html</code> writes it as one offline HTML file.", undefined]);
    return steps;
  }

  async function healthPage(page, { params }) {
    const report = await api.health();
    const counts = report.counts;
    setHeader("Health", `${report.passed ? "Passed" : "Failed"}: fails on ${esc(report.failOn)} and above · ${plural(report.summary.cycles, "cycle")} · fan-in/out limit ${report.thresholds.maxFanIn}/${report.thresholds.maxFanOut}`);
    const active = new Set((params.get("severity") ?? "error,warning,info").split(","));
    page.innerHTML = `
      <div class="toolbar">
        ${["error", "warning", "info"].map((severity) => `<button class="chip" data-severity="${severity}" aria-pressed="${active.has(severity)}">${severityPill(severity)}<span class="count">${fmt(counts[severity])}</span></button>`).join("")}
        <input type="search" id="health-search" placeholder="Filter findings" value="${esc(params.get("q") ?? "")}">
        <span class="spacer"></span>
        <span class="muted small">Same rules as <code>bca check</code></span>
      </div>
      <section class="card flush" id="findings"></section>`;
    const render = () => {
      const query = $("#health-search").value.trim().toLowerCase();
      const rows = report.findings.filter((finding) => active.has(finding.severity) && (!query || `${finding.rule} ${finding.message} ${finding.file ?? ""}`.toLowerCase().includes(query)));
      dataTable($("#findings"), {
        rows,
        empty: "No findings match.",
        columns: [
          { key: "severity", label: "Severity", value: (row) => ({ error: 3, warning: 2, info: 1 })[row.severity], render: (row) => severityPill(row.severity) },
          { key: "rule", label: "Rule", render: (row) => `<span class="mono">${esc(row.rule)}</span>` },
          { key: "message", label: "Finding", render: (row) => esc(row.message) },
          { key: "file", label: "Where", render: (row) => row.object ? `<a href="#/object/${encodeURIComponent(row.object)}" class="mono">${esc(row.file)}${row.line ? `:${row.line}` : ""}</a>` : `<span class="mono">${esc(row.file ?? "")}${row.line ? `:${row.line}` : ""}</span>` }
        ],
        sort: { key: "severity", direction: "descending" }
      });
    };
    page.querySelector(".toolbar").addEventListener("click", (event) => {
      const chip = event.target.closest("[data-severity]");
      if (!chip) return;
      const severity = chip.dataset.severity;
      if (active.has(severity)) active.delete(severity); else active.add(severity);
      chip.setAttribute("aria-pressed", String(active.has(severity)));
      render();
    });
    $("#health-search").addEventListener("input", render);
    render();
  }

  /** The plan for extracting one component as an app, with a picker for the component. */
  function extractionCard(data, name) {
    const names = Object.keys(data.extractions ?? {});
    if (!names.length) return "";
    const plan = data.extractions[name];
    const picker = `<label class="field"><span>Plan extracting</span><select id="extract-component"><option value="">a component as an app…</option>${names.map((option) => `<option${option === name ? " selected" : ""}>${esc(option)}</option>`).join("")}</select></label>`;
    if (!plan) return `<section class="card"><h2>Extract a component <span class="muted">what moves, what blocks it, the app.json, and the steps</span></h2><div class="controls">${picker}</div></section>`;
    const list = (items) => items.map(({ component, objects }) => `${esc(component)} <span class="muted">${fmt(objects)}</span>`).join(", ") || "nothing";
    return `<section class="card"><h2>Extract ${esc(plan.component)} as an app <span class="muted">${plan.ready ? "ready" : `${plural(plan.blockers.length, "blocker")}`} · effort ${esc(plan.effort)}</span></h2>
      <div class="controls">${picker}<span class="muted small" style="margin-left:auto">CLI: <code>bca architecture --extract "${esc(plan.component)}"</code></span></div>
      <dl class="facts">
        <dt>Objects</dt><dd>${plural(plan.objects.total, "object")} in ${plural(plan.objects.files, "file")}, today in ${esc(plan.sourceApp?.name ?? "?")}${plan.alreadyAnApp ? " (already its own app)" : ""}</dd>
        <dt>Uses</dt><dd>${list(plan.uses)}</dd>
        <dt>Used by</dt><dd>${list(plan.usedBy)}</dd>
        ${plan.tables.length ? `<dt>Data to move</dt><dd>${plural(plan.tables.length, "table")}: ${plan.tables.slice(0, 8).map(({ object }) => esc(object)).join(", ")}${plan.tables.length > 8 ? ", …" : ""}</dd>` : ""}
      </dl>
      ${plan.blockers.length ? `<h3 class="small muted">Blockers</h3><ul class="list">${plan.blockers.map((blocker) => `<li>${severityPill("error")}<span class="grow">${esc(blocker.message)}${(blocker.workItems ?? []).slice(0, 5).map((item) => `<div class="small muted">[${esc(item.effort)}] ${esc(item.title)}: ${esc(item.source)} → ${esc(item.targetComponent)}${item.command ? ` · <code>${esc(item.command)}</code>` : ""}</div>`).join("")}</span></li>`).join("")}</ul>` : ""}
      <h3 class="small muted">Steps</h3><ol>${plan.steps.map((step) => `<li>${esc(step)}</li>`).join("")}</ol>
      <details><summary>app.json</summary><pre class="code">${esc(JSON.stringify(plan.appJson, null, 2))}</pre></details>
    </section>`;
  }

  async function architecturePage(page, { params }) {
    const settings = {
      propose: params.get("propose") === "1" || undefined,
      groupBy: params.get("groupBy") ?? undefined,
      depth: params.get("depth") ?? undefined,
      minObjects: params.get("minObjects") ?? undefined
    };
    const data = await api.architecture(settings);
    const proposal = data.mode === "proposal";
    const summary = data.summary;
    const layers = [...new Set(data.components.map(({ layer }) => layer))].sort((a, b) => (b ?? -1) - (a ?? -1));
    let selected = params.get("component") ?? undefined;
    setHeader(proposal ? "Proposed architecture" : "Architecture",
      proposal
        ? `Derived from today's dependencies (${esc(data.proposal.groupBy)} grouping). Nothing is enforced until you adopt it.`
        : `Configured in .bca.json and enforced by <code>bca check</code>${data.baseline.used ? " with a baseline" : ""}.`,
      LIVE ? [
        proposal ? '<button class="btn primary" data-action="adopt">Adopt this architecture</button>' : "",
        !proposal && data.violationCount ? '<button class="btn" data-action="baseline">Accept current violations</button>' : ""
      ].join("") : "");
    const controls = LIVE ? `
      <section class="card"><div class="controls">
        ${data.configured ? `<div class="field"><span>Show</span><div class="segmented"><button data-mode="configured" aria-pressed="${!proposal}">Configured</button><button data-mode="proposal" aria-pressed="${proposal}">New proposal</button></div></div>` : ""}
        ${proposal ? `
          <label class="field"><span>Group objects by</span><select id="group-by">${["auto", "coupling", "module", "app", "namespace", "folder"].map((value) => `<option${value === (data.proposal.groupBy ?? "auto") ? " selected" : ""}>${value}</option>`).join("")}</select></label>
          <label class="field"><span>Namespace depth</span><input type="number" id="depth" min="1" placeholder="auto" value="${esc(settings.depth ?? "")}"></label>
          <label class="field"><span>Merge groups below</span><input type="number" id="min-objects" min="1" placeholder="1" value="${esc(settings.minObjects ?? "")}"></label>
          <button class="btn" data-action="apply">Propose again</button>` : ""}
        <span class="muted small" style="margin-left:auto">CLI: <code>bca architecture${proposal ? " --propose" : ""}</code></span>
      </div></section>` : "";
    const baseline = data.baseline.used ? `${fmt(data.baseline.new.length)} new · ${fmt(data.baseline.known)} accepted · ${fmt(data.baseline.fixed.length)} fixed` : "no baseline yet";
    page.innerHTML = `
      ${controls}
      <div class="stats">
        ${stat({ label: "Components", value: fmt(summary.components), sub: `${plural(layers.filter((layer) => layer !== undefined).length, "layer")}, ${plural(summary.assigned, "object")}` })}
        ${stat({ label: "Violations", value: fmt(summary.violations), tone: summary.violations ? (!proposal && data.baseline.new.length ? "bad" : "warn") : "good", sub: `of ${plural(summary.dependencies, "dependency", "dependencies")} across components` })}
        ${stat({ label: "Work items", value: fmt(summary.workItems), sub: Object.entries(summary.byStrategy).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([strategy, count]) => `${fmt(count)} ${esc(strategy)}`).join(", ") || "nothing to resolve" })}
        ${summary.coupling ? stat({ label: "Coupling inside components", value: `${Math.round(summary.coupling.share * 100)}%`, tone: summary.coupling.share >= 0.7 ? "good" : undefined, sub: `modularity ${summary.coupling.modularity.toFixed(2)}${proposal ? " · compare groupings below" : ""}` }) : ""}
        ${stat({ label: "Can become apps today", value: fmt(summary.extractable), tone: summary.extractable === summary.components ? "good" : undefined, sub: `of ${plural(summary.components, "component")}` })}
        ${proposal ? stat({ label: "Objects that belong elsewhere", value: fmt(data.proposal.moves.length), sub: "move them to shrink the work" }) : stat({ label: "Baseline", value: fmt(data.baseline.new.length), tone: data.baseline.new.length ? "bad" : "good", sub: baseline })}
      </div>
      <div class="grid wide">
        <section class="card"><h2>Layers <span class="muted">inner components at the bottom; dependencies may only point down</span></h2>
          <div class="layers">${layers.map((layer) => `
            <div class="layer">
              <div class="layer-label">${layer === undefined ? "<b>No layer</b>" : `<b>Layer ${layer}</b>${layer === 0 ? "core" : ""}`}</div>
              <div class="layer-items">${data.components.filter((component) => component.layer === layer).map((component) => `
                <button class="component ${component.extractable ? "extractable" : component.violations ? "blocked" : ""}" data-component="${esc(component.name)}" aria-pressed="${component.name === selected}" title="${esc(`${component.name}: ${component.metrics.objects} objects, ${component.violations} wrong-way dependencies${component.extractable ? ", can become an app" : ""}`)}">
                  ${esc(component.name)} <small>${fmt(component.metrics.objects)}</small>${component.violations ? ` <span class="bad">${fmt(component.violations)}</span>` : ""}
                </button>`).join("")}</div>
            </div>`).join("")}</div>
          <div class="legend"><span class="ok">can become an app today</span><span class="bad">has wrong-way dependencies (count in red)</span><span>blocked only by dependencies on it</span></div>
        </section>
        <section class="card"><h2>${proposal ? "How it was derived" : "How it is enforced"}</h2>
          ${proposal ? `<p class="muted">${data.proposal.groupBy === "coupling" ? "Namespaces that are tightly coupled to each other form a component (communities of the coupling, inside each module or app)." : "Each module or app is a component; one that holds more than 15% of the objects (at least 40) is split by namespace."} Components are ordered so that as little coupling as possible points the wrong way, and each one sits one layer above the deepest component it uses. Try another grouping and compare the coupling inside components.</p>
            ${data.proposal.feedback.length ? `<h3 class="small muted">Dependencies against the order</h3><ul class="list">${data.proposal.feedback.slice(0, 8).map((edge) => `<li><span class="grow">${esc(edge.source)} → ${esc(edge.target)}</span><span class="muted small nowrap">${plural(edge.objectEdges, "object link")}</span></li>`).join("")}</ul>` : ""}`
            : `<dl class="facts">
                <dt>Cohesion</dt><dd>${summary.coupling ? `${Math.round(summary.coupling.share * 100)}% of the coupling stays inside components (modularity ${summary.coupling.modularity.toFixed(2)}); weights per relation kind in architecture.couplingWeights` : "–"}</dd>
                <dt>Rules</dt><dd>dependsOn first; otherwise only to ${data.settings.strictLayers ? "the layer directly below" : "lower layers"}${data.settings.allowSameLayer ? " or the same layer" : ""}; only public objects of other components${data.architecture.rules?.length ? `; ${plural(data.architecture.rules.length, "rule")} of .bca.json` : ""}</dd>
                <dt>Baseline</dt><dd>${baseline}</dd>
                <dt>Cycles</dt><dd>${data.cycles.length ? data.cycles.map((cycle) => esc(cycle.join(" → "))).join("<br>") : "none"}</dd>
                <dt>Unassigned</dt><dd>${data.unassigned.length ? plural(summary.unassigned, "object") : "none"}</dd>
              </dl>`}
        </section>
      </div>
      <section class="card flush"><h2>Work items <span class="muted" id="work-scope"></span></h2><div id="work-items"></div></section>
      ${!proposal && data.checks?.length ? `<section class="card"><h2>Architecture checks <span class="muted">components, declared dependencies, and selectors</span></h2>
        <ul class="list">${data.checks.map((check) => `<li>${severityPill(check.severity)}<span class="grow">${esc(check.message)}</span><code class="muted small nowrap">${esc(check.rule)}</code></li>`).join("")}</ul></section>` : ""}
      ${extractionCard(data, params.get("extract"))}
      ${data.surface?.some(({ api, candidates }) => api.length || candidates.length) ? `<section class="card flush"><h2>Public surface <span class="muted">what other components use of each component, and what could be Access = Internal</span></h2>
        ${data.surfaceChanges?.length ? `<ul class="list">${data.surfaceChanges.map((change) => `<li>${severityPill("warning")}<span class="grow">${esc(change.message)}</span></li>`).join("")}</ul>` : ""}
        <div id="surface"></div></section>` : ""}
      ${data.dataOwnership?.length ? `<section class="card flush"><h2>Data ownership <span class="muted">tables other components write, read, relate to, or extend</span></h2><div id="ownership"></div></section>` : ""}
      ${proposal && data.proposal.moves.length ? '<section class="card flush"><h2>Objects that belong elsewhere <span class="muted">more closely tied to another component than to their own</span></h2><div id="moves"></div></section>' : ""}
      <section class="card flush"><h2>Components <span class="muted">instability I, abstractness A, distance D after Robert C. Martin</span></h2><div id="components"></div></section>`;

    const renderScoped = () => {
      const items = data.workItems.filter((item) => !selected || item.sourceComponent === selected || item.targetComponent === selected);
      $("#work-scope").textContent = selected ? `involving ${selected} · ${plural(items.length, "item")}` : `${plural(data.workItems.length, "item")}, largest first`;
      dataTable($("#work-items"), {
        rows: items,
        empty: proposal ? "Nothing points the wrong way." : "No violations. The architecture holds.",
        sort: { key: "violations", direction: "descending" },
        columns: [
          { key: "effort", label: "Effort", value: (row) => ({ S: 1, M: 2, L: 3 })[row.effort], render: (row) => `<span class="pill ${row.effort === "S" ? "ok" : row.effort === "M" ? "warning" : "error"}" title="${esc(EFFORT[row.effort])} effort">${esc(row.effort)}</span>` },
          { key: "title", label: "What to do", render: (row) => `<b>${esc(row.title)}</b> <span class="mono muted">${esc(row.strategy)}</span>
              <details class="steps"><summary>Steps and evidence</summary><ol>${row.steps.map((step) => `<li>${esc(step)}</li>`).join("")}</ol>
              ${row.alternatives?.length ? `<div class="small muted">Alternatives: ${row.alternatives.map((alternative) => esc(alternative.title)).join("; ")}</div>` : ""}
              <ul class="small muted">${row.evidence.map((item) => `<li>${esc(item.kind)}${item.member ? ` in ${esc(item.member)}` : ""} · <span class="mono">${esc(item.file)}:${item.line}</span></li>`).join("")}</ul>
              ${row.command ? `<div class="small">Do it: <code>${esc(row.command)}</code></div>` : ""}</details>` },
          { key: "source", label: "Object", value: (row) => row.source.label, render: (row) => `${objectLink(row.source)}<div class="type">${esc(row.source.type)}</div>` },
          { key: "from", label: "From → to", value: (row) => `${row.sourceComponent} ${row.targetComponent}`, render: (row) => `${esc(row.sourceComponent)} → ${esc(row.targetComponent)}<div class="small muted">${row.targets.slice(0, 3).map((target) => esc(target.label)).join(", ")}${row.targets.length > 3 ? ", …" : ""}</div>` },
          { key: "violations", label: "Dependencies", numeric: true, render: (row) => fmt(row.violations) }
        ]
      });
      for (const button of $$(".component", page)) button.setAttribute("aria-pressed", String(button.dataset.component === selected));
    };
    renderScoped();
    if ($("#ownership")) {
      const users = (list) => list.map(({ component, objects }) => `<span title="${esc(objects.join(", "))}">${esc(component)} <span class="muted">${fmt(objects.length)}</span></span>`).join(", ") || '<span class="muted">–</span>';
      dataTable($("#ownership"), {
        rows: data.dataOwnership,
        sort: { key: "writers", direction: "descending" },
        columns: [
          { key: "table", label: "Table", render: (row) => `<b>${esc(row.table)}</b>${row.status === "shared-writes" ? ' <span class="pill warning">written by others</span>' : ""}` },
          { key: "component", label: "Owner" },
          { key: "writers", label: "Written by", value: (row) => row.writers.length, render: (row) => users(row.writers) },
          { key: "readers", label: "Read by", value: (row) => row.readers.length, render: (row) => users(row.readers) },
          { key: "relations", label: "Related from", value: (row) => row.relations.length, render: (row) => users(row.relations) },
          { key: "extenders", label: "Extended by", value: (row) => row.extenders.length, render: (row) => users(row.extenders) }
        ]
      });
    }
    if ($("#surface")) {
      dataTable($("#surface"), {
        rows: data.surface.filter(({ api, candidates }) => api.length || candidates.length),
        sort: { key: "api", direction: "descending" },
        columns: [
          { key: "component", label: "Component", render: (row) => `<b>${esc(row.component)}</b>` },
          { key: "api", label: "Used by others", numeric: true, value: (row) => row.api.length, render: (row) => `${fmt(row.api.length)} <span class="muted">of ${fmt(row.objects)}</span>` },
          { key: "objects", label: "Objects others use", value: (row) => row.api.length, render: (row) => `<details class="steps"><summary>${row.api.slice(0, 3).map(({ name }) => esc(name)).join(", ")}${row.api.length > 3 ? ", …" : ""}</summary><ul class="small">${row.api.map((item) => `<li>${esc(item.object)}${item.internal ? ' <span class="pill error">internal</span>' : ""} <span class="muted">← ${item.usedBy.map(({ component, objects }) => `${esc(component)} ${fmt(objects)}`).join(", ")} · ${esc(item.kinds.join(", "))}</span></li>`).join("")}</ul></details>` },
          { key: "candidates", label: "Could be internal", value: (row) => row.candidates.length, render: (row) => row.candidates.length ? `<span title="${esc(row.candidates.map(({ object }) => object).join(", "))}">${fmt(row.candidates.length)}</span> <code class="small">bca refactor surface --component "${esc(row.component)}"</code>` : '<span class="muted">–</span>' }
        ]
      });
    }
    $("#extract-component")?.addEventListener("change", (event) => {
      go("architecture", { propose: settings.propose ? 1 : undefined, groupBy: settings.groupBy, depth: settings.depth, minObjects: settings.minObjects, extract: event.target.value || undefined });
    });
    if ($("#moves")) {
      dataTable($("#moves"), {
        rows: data.proposal.moves,
        sort: { key: "gain", direction: "descending" },
        columns: [
          { key: "object", label: "Object", value: (row) => row.object.label, render: (row) => `${objectLink(row.object)}<div class="type">${esc(row.object.type)}</div>` },
          { key: "from", label: "Now in" },
          { key: "to", label: "Belongs to" },
          { key: "gain", label: "Fewer cross links", numeric: true }
        ]
      });
    }
    dataTable($("#components"), {
      rows: data.components,
      sort: { key: "layer", direction: "ascending" },
      onRow: (row) => { selected = selected === row.name ? undefined : row.name; renderScoped(); $("#work-items").scrollIntoView({ behavior: "smooth", block: "start" }); },
      columns: [
        { key: "name", label: "Component", render: (row) => `<b>${esc(row.name)}</b><div class="small muted mono">${esc((row.match ?? []).join(" | "))}</div>` },
        { key: "layer", label: "Layer", numeric: true, value: (row) => row.layer ?? -1, render: (row) => row.layer ?? "–" },
        { key: "objects", label: "Objects", numeric: true, value: (row) => row.metrics.objects, render: (row) => fmt(row.metrics.objects) },
        { key: "dependsOn", label: "May use", value: (row) => (row.dependsOn ?? []).length, render: (row) => `<span class="small">${esc((row.dependsOn ?? []).join(", ") || "–")}</span>` },
        { key: "cohesion", label: "Cohesion", numeric: true, value: (row) => row.metrics.cohesion ?? -1, render: (row) => row.metrics.cohesion === undefined ? "–" : `${Math.round(row.metrics.cohesion * 100)}%` },
        { key: "instability", label: "I", numeric: true, value: (row) => row.metrics.instability, render: (row) => row.metrics.instability.toFixed(2) },
        { key: "abstractness", label: "A", numeric: true, value: (row) => row.metrics.abstractness, render: (row) => row.metrics.abstractness.toFixed(2) },
        { key: "distance", label: "D", numeric: true, value: (row) => row.metrics.distance, render: (row) => row.metrics.distance.toFixed(2) },
        { key: "violations", label: "Wrong way", numeric: true, render: (row) => row.violations ? `<span class="pill error">${fmt(row.violations)}</span>` : "0" },
        { key: "extractable", label: "App today", value: (row) => row.extractable ? 1 : 0, render: (row) => row.extractable ? '<span class="pill ok">yes</span>' : '<span class="muted">no</span>' }
      ]
    });

    page.addEventListener("click", async (event) => {
      const component = event.target.closest("[data-component]");
      if (component) {
        selected = selected === component.dataset.component ? undefined : component.dataset.component;
        renderScoped();
        return;
      }
      const mode = event.target.closest("[data-mode]")?.dataset.mode;
      if (mode) return go("architecture", { propose: mode === "proposal" ? 1 : undefined });
      if (event.target.closest('[data-action="apply"]')) {
        return go("architecture", { propose: data.configured ? 1 : undefined, groupBy: $("#group-by").value === "auto" ? undefined : $("#group-by").value, depth: $("#depth").value, minObjects: $("#min-objects").value });
      }
    });
    $("#page-actions").onclick = async (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (action === "adopt") {
        const ok = await confirmDialog("Adopt this architecture?",
          `This saves ${plural(summary.components, "component")} with their layers and allowed dependencies to .bca.json and accepts today's ${plural(summary.violations, "wrong-way dependency", "wrong-way dependencies")} in the baseline. From then on, bca check fails on new ones.`, "Adopt");
        if (!ok) return;
        const result = await call("adoptArchitecture", { ...settings, propose: true, updateBaseline: true }).catch((error) => toast(error.message));
        if (result) { toast(`Saved to ${result.file}; accepted ${fmt(result.accepted)} violation(s)`); refresh(); go("architecture"); }
      }
      if (action === "baseline") {
        const ok = await confirmDialog("Accept the current violations?",
          `The baseline then holds ${plural(data.violationCount, "violation")}; bca check only fails on new ones. Fixed violations leave the baseline the next time you accept.`, "Accept");
        if (!ok) return;
        const result = await call("updateBaseline").catch((error) => toast(error.message));
        if (result) { toast(`Accepted ${fmt(result.accepted)} violation(s)`); refresh(); render(); }
      }
    };
  }

  async function dependenciesPage(page, { params }) {
    $("#main").classList.add("full");
    const propose = params.get("propose") === "1";
    const history = ["commits", "prs", "releases"].includes(params.get("history")) ? params.get("history") : undefined;
    const last = /^[1-9]\d*$/u.test(params.get("last") ?? "") ? params.get("last") : undefined;
    const STEPS = { commits: "commits", prs: "pull requests", releases: "releases" };
    setHeader("Dependencies", "Objects, modules, apps, and components in 3D: inside one app vs. across apps. Click a node for its links; drag to rotate.",
      LIVE ? `<label class="check"><input type="checkbox" id="propose"${propose ? " checked" : ""}> Proposed architecture</label>
        <label class="field inline" title="Replay how the dependencies grew: one frame per commit, merged pull request, or release tag. Analyzing many steps takes a while."><span>Timeline</span>
          <select id="history"><option value="">Build order</option>${Object.entries({ commits: "Commits", prs: "Pull requests", releases: "Releases" }).map(([value, label]) => `<option value="${value}"${value === history ? " selected" : ""}>${label}</option>`).join("")}</select></label>
        <label class="field inline"${history ? "" : " hidden"}><span>Last</span><input type="number" id="last" min="1" placeholder="all" value="${esc(last ?? "")}"></label>` : "");
    page.innerHTML = `<div class="muted small">Levels: 1 objects · 2 modules · 3 apps · 4 components. <kbd>/</kbd> searches, <kbd>Space</kbd> plays the timeline.</div>
      <div class="frame-wrap"><iframe title="3D dependency explorer" data-theme-sync></iframe>${loading(history ? `Replaying ${last ? `the last ${last} ` : "the "}${STEPS[history]}…` : "Building the 3D graph…")}</div>`;
    const frame = $("iframe", page);
    if (params.get("select")) frame.dataset.select = params.get("select");
    frame.addEventListener("load", () => $(".frame-wrap .loading", page)?.remove());
    try {
      frame.srcdoc = await api.explorer({ propose: propose ? 1 : undefined, history, last: history ? last : undefined });
    } catch (error) {
      $(".frame-wrap", page).innerHTML = `<div class="error-box">${esc(error.message)}</div>`;
    }
    $("#page-actions").onchange = () => go("dependencies", {
      propose: $("#propose")?.checked ? 1 : undefined,
      history: $("#history")?.value || undefined,
      last: $("#history")?.value ? $("#last")?.value : undefined
    });
  }

  // Inserts a rendered SVG without anything that could run script.
  function safeSvg(markup) {
    const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
    const svg = parsed.documentElement;
    if (svg.nodeName !== "svg") throw new Error("the diagram could not be read");
    for (const element of parsed.querySelectorAll("script, foreignObject, iframe, object, embed")) element.remove();
    for (const element of parsed.querySelectorAll("*")) {
      for (const attribute of [...element.attributes]) {
        const name = attribute.name.toLowerCase();
        if (name.startsWith("on")) element.removeAttribute(attribute.name);
        if ((name === "href" || name === "xlink:href") && !/^(https?:|#)/iu.test(attribute.value.trim())) element.removeAttribute(attribute.name);
      }
    }
    for (const link of parsed.querySelectorAll("a")) link.setAttribute("target", "_blank");
    return document.importNode(svg, true);
  }

  function panZoom(canvas, svg) {
    const stage = $(".stage", canvas);
    stage.replaceChildren(svg);
    const width = svg.viewBox.baseVal?.width || svg.width.baseVal.value || 800;
    const height = svg.viewBox.baseVal?.height || svg.height.baseVal.value || 600;
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    let scale = 1;
    let x = 0;
    let y = 0;
    const apply = () => { stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`; };
    const fit = () => {
      const box = canvas.getBoundingClientRect();
      scale = Math.min(box.width / width, box.height / height, 1.5) * 0.95;
      x = (box.width - width * scale) / 2;
      y = (box.height - height * scale) / 2;
      apply();
    };
    const zoom = (factor, cx, cy) => {
      const next = Math.min(8, Math.max(0.05, scale * factor));
      x = cx - (cx - x) * (next / scale);
      y = cy - (cy - y) * (next / scale);
      scale = next;
      apply();
    };
    canvas.onwheel = (event) => {
      event.preventDefault();
      const box = canvas.getBoundingClientRect();
      zoom(event.deltaY < 0 ? 1.15 : 1 / 1.15, event.clientX - box.left, event.clientY - box.top);
    };
    let drag;
    canvas.onpointerdown = (event) => {
      if (event.target.closest(".canvas-tools, a")) return;
      drag = { x: event.clientX - x, y: event.clientY - y };
      canvas.classList.add("dragging");
      canvas.setPointerCapture(event.pointerId);
    };
    canvas.onpointermove = (event) => { if (drag) { x = event.clientX - drag.x; y = event.clientY - drag.y; apply(); } };
    canvas.onpointerup = () => { drag = undefined; canvas.classList.remove("dragging"); };
    fit();
    return { fit, zoom: (factor) => { const box = canvas.getBoundingClientRect(); zoom(factor, box.width / 2, box.height / 2); } };
  }

  const VIEW_INPUTS = {
    object: [["object", "Object", "codeunit:50100 or a name", true]],
    boundary: [["scope", "Scope", "namespace:Contoso.Sales", true]],
    workflow: [["entry", "Entry", "procedure, trigger, action, or event", true]],
    contracts: [["focus", "Focus", "name fragment (optional)"]],
    events: [["focus", "Focus", "name fragment (optional)"]],
    ui: [["focus", "Focus", "name fragment (optional)"]]
  };

  async function diagramsPage(page, { params }) {
    const views = await api.views();
    const view = params.get("view") ?? views[0]?.id ?? "project";
    const describe = (id) => views.find((item) => item.id === id)?.summary ?? "";
    setHeader("Diagrams", "Focused architecture views of the AL source. The same views as <code>bca export --view &lt;view&gt;</code>.");
    const inputs = VIEW_INPUTS[view] ?? [];
    const objects = LIVE && view === "object" ? await api.objects() : [];
    page.innerHTML = `
      <div class="diagram-layout">
        <form class="card diagram-form" id="diagram-form">
          <label class="field"><span>View</span><select name="view">${views.map((item) => `<option value="${esc(item.id)}"${item.id === view ? " selected" : ""}>${esc(item.id)}</option>`).join("")}</select></label>
          <div class="view-hint">${esc(describe(view))}</div>
          ${LIVE ? inputs.map(([name, label, placeholder, required]) => `<label class="field"><span>${esc(label)}${required ? "" : ""}</span><input type="text" name="${name}" placeholder="${esc(placeholder)}" value="${esc(params.get(name) ?? "")}"${name === "object" ? ' list="object-options"' : ""}${required ? " required" : ""}></label>`).join("") : ""}
          ${objects.length ? `<datalist id="object-options">${objects.slice(0, 2000).map((object) => `<option value="${esc(`${object.type}:${object.objectId ?? object.label}`)}">${esc(object.label)}</option>`).join("")}</datalist>` : ""}
          ${LIVE ? `
            <label class="field"><span>Namespace filter</span><input type="text" name="namespace" placeholder="Microsoft.Sales.**" value="${esc(params.get("namespace") ?? "")}"></label>
            ${["project", "module"].includes(view) ? `<label class="field"><span>Group by</span><select name="groupBy"><option value="">default</option>${(view === "module" ? ["namespace", "folder"] : ["role", "namespace", "folder", "type"]).map((value) => `<option${params.get("groupBy") === value ? " selected" : ""}>${value}</option>`).join("")}</select></label>` : ""}
            <label class="field"><span>Direction</span><select name="direction">${["right", "down", "left", "up"].map((value) => `<option${(params.get("direction") ?? "right") === value ? " selected" : ""}>${value}</option>`).join("")}</select></label>
            <label class="check"><input type="checkbox" name="details" value="1"${params.get("details") ? " checked" : ""}> Member counts</label>
            <label class="check"><input type="checkbox" name="noExternal" value="1"${params.get("noExternal") ? " checked" : ""}> Hide external objects</label>
            <button class="btn primary">Render</button>` : '<p class="muted small">Exported views use their default settings. Open the project in VS Code with the BC Atlas extension to change them.</p>'}
        </form>
        <div id="diagram-area">${loading("Rendering the diagram…")}</div>
      </div>`;
    const form = $("#diagram-form");
    form.view.addEventListener("change", () => go("diagrams", { view: form.view.value }));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form));
      go("diagrams", values);
    });
    const missing = inputs.find(([name, , , required]) => required && !params.get(name));
    const area = $("#diagram-area");
    if (missing && LIVE) {
      area.innerHTML = `<div class="card empty"><h2>${esc(missing[1])} needed</h2><p>The ${esc(view)} view needs ${esc(missing[1].toLowerCase())}: ${esc(missing[2])}.</p></div>`;
      return;
    }
    const settings = Object.fromEntries([...params].filter(([name]) => name !== "view"));
    try {
      const diagram = await api.diagram({ view, ...settings });
      if (!diagram.svg) {
        area.innerHTML = `<div class="card empty"><h2>Nothing to draw</h2><p>${esc(diagram.empty ?? "No matching objects.")}</p></div>`;
        return;
      }
      area.innerHTML = `<div class="canvas"><div class="canvas-tools">
          <button class="icon-button" data-zoom="in" title="Zoom in">+</button><button class="icon-button" data-zoom="out" title="Zoom out">−</button>
          <button class="icon-button" data-zoom="fit">Fit</button><button class="icon-button" data-download="svg">SVG</button>${diagram.d2 ? '<button class="icon-button" data-download="d2">D2</button>' : ""}
        </div><div class="stage"></div><div class="canvas-info">${plural(diagram.nodes, "node")} · ${plural(diagram.edges, "edge")} · scroll to zoom, drag to pan</div></div>`;
      const controls = panZoom($(".canvas", area), safeSvg(diagram.svg));
      $(".canvas-tools", area).onclick = (event) => {
        const zoom = event.target.closest("[data-zoom]")?.dataset.zoom;
        if (zoom === "fit") controls.fit();
        else if (zoom) controls.zoom(zoom === "in" ? 1.25 : 0.8);
        const format = event.target.closest("[data-download]")?.dataset.download;
        if (format && LIVE) {
          api.saveFile(`${view}.${format}`, format === "svg" ? diagram.svg : diagram.d2).catch((error) => toast(error.message));
        } else if (format) {
          const link = document.createElement("a");
          link.href = URL.createObjectURL(new Blob([format === "svg" ? diagram.svg : diagram.d2], { type: format === "svg" ? "image/svg+xml" : "text/plain" }));
          link.download = `${view}.${format}`;
          link.click();
        }
      };
    } catch (error) {
      area.innerHTML = `<div class="error-box">${esc(error.message)}</div>`;
    }
  }

  async function objectsPage(page, { params }) {
    const objects = await api.objects();
    const types = [...new Set(objects.map(({ type }) => type))].sort();
    const apps = [...new Set(objects.map(({ app }) => app).filter(Boolean))].sort();
    const components = [...new Set(objects.map(({ component }) => component).filter(Boolean))].sort();
    setHeader("Objects", `${plural(objects.length, "AL object")} in the analyzed source. Click one for its dependencies, members, and violations.`);
    const option = (value, current) => `<option${value === current ? " selected" : ""}>${esc(value)}</option>`;
    page.innerHTML = `
      <div class="toolbar">
        <input type="search" id="object-search" placeholder="Search name, ID, namespace, file (/)" value="${esc(params.get("q") ?? "")}">
        <select id="object-type"><option value="">All types</option>${types.map((type) => option(type, params.get("type"))).join("")}</select>
        ${apps.length > 1 ? `<select id="object-app"><option value="">All apps</option>${apps.map((app) => option(app, params.get("app"))).join("")}</select>` : ""}
        ${components.length ? `<select id="object-component"><option value="">All components</option>${components.map((component) => option(component, params.get("component"))).join("")}</select>` : ""}
        <label class="check"><input type="checkbox" id="object-violations"${params.get("violations") ? " checked" : ""}> With wrong-way dependencies</label>
        <span class="spacer"></span><span class="muted small" id="object-count"></span>
      </div>
      <section class="card flush" id="object-table"></section>`;
    const render = () => {
      const query = $("#object-search").value.trim().toLowerCase();
      const type = $("#object-type").value;
      const app = $("#object-app")?.value;
      const component = $("#object-component")?.value;
      const violations = $("#object-violations").checked;
      const rows = objects.filter((object) =>
        (!type || object.type === type) && (!app || object.app === app) && (!component || object.component === component) &&
        (!violations || object.violations) &&
        (!query || `${object.label} ${object.objectId ?? ""} ${object.namespace ?? ""} ${object.file ?? ""}`.toLowerCase().includes(query)));
      $("#object-count").textContent = `${fmt(rows.length)} shown`;
      dataTable($("#object-table"), {
        rows,
        empty: "No objects match.",
        sort: { key: "usedBy", direction: "descending" },
        onRow: (row) => { location.hash = `#/object/${encodeURIComponent(row.id)}`; },
        columns: [
          { key: "type", label: "Type", render: (row) => `<span class="type">${esc(row.type)}</span>` },
          { key: "objectId", label: "ID", numeric: true, value: (row) => Number(row.objectId) || 0, render: (row) => esc(row.objectId ?? "") },
          { key: "label", label: "Name", render: (row) => objectLink(row) },
          { key: "namespace", label: "Namespace", render: (row) => `<span class="small muted">${esc(row.namespace ?? "")}</span>` },
          ...(apps.length > 1 ? [{ key: "app", label: "App" }] : []),
          ...(components.length ? [{ key: "component", label: "Component" }] : []),
          { key: "uses", label: "Uses", numeric: true, render: (row) => fmt(row.uses) },
          { key: "usedBy", label: "Used by", numeric: true, render: (row) => fmt(row.usedBy) },
          { key: "violations", label: "Wrong way", numeric: true, render: (row) => row.violations ? `<span class="pill error">${fmt(row.violations)}</span>` : "" }
        ]
      });
    };
    let timer;
    page.querySelector(".toolbar").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(render, 120); });
    render();
    $("#object-search").focus();
  }

  function linkRows(links, empty) {
    if (!links.length) return `<p class="muted">${esc(empty)}</p>`;
    const shown = links.slice(0, 200);
    return `<div class="links">${shown.map((link) => `
      <a class="row" href="#/object/${encodeURIComponent(link.id)}"><span class="name"><span class="type">${esc(link.type)}</span> ${esc(link.label)}</span>
      <span class="pill${link.dependency === "intra-app" ? "" : link.dependency === "undeclared" ? " error" : " accent"}">${esc(link.dependency)}</span>
      <span class="kinds">${esc([kindsText(link.kinds), link.component, link.app !== link.component ? link.app : undefined].filter(Boolean).join(" · "))}</span></a>`).join("")}</div>
      ${links.length > shown.length ? `<p class="muted small">and ${fmt(links.length - shown.length)} more</p>` : ""}`;
  }

  async function objectPage(page, { arg }) {
    const object = await api.object(arg);
    const actions = [
      LIVE && object.source.file ? '<button class="btn primary" data-action="open-source">Open source</button>' : "",
      object.source.url && /^https?:/iu.test(object.source.url) ? `<a class="btn" href="${esc(object.source.url)}" target="_blank" rel="noopener">View source</a>` : "",
      `<a class="btn" href="#/dependencies?${new URLSearchParams({ select: object.id })}">Show in 3D</a>`,
      LIVE ? `<a class="btn" href="#/diagrams?${new URLSearchParams({ view: "object", object: `${object.type}:${object.objectId ?? object.label}` })}">Object diagram</a>` : ""
    ].join("");
    setHeader(object.label,
      `<span class="type">${esc(object.type)}</span>${object.objectId ? ` ${esc(object.objectId)}` : ""} · ${esc(object.namespace ?? "no namespace")}${object.app ? ` · ${esc(object.app)}` : ""} · <span class="mono">${esc(object.source.file ?? "")}${object.source.line ? `:${object.source.line}` : ""}</span>`,
      actions);
    $("#page-actions").onclick = (event) => {
      if (event.target.closest('[data-action="open-source"]')) api.openFile(object.source.file, object.source.line).catch((error) => toast(error.message));
    };
    const members = object.members ?? {};
    const memberCards = [
      members.fields?.length ? `<section class="card"><h2>Fields <span class="muted">${fmt(members.fields.length)}</span></h2><div class="table-scroll"><table class="data"><thead><tr><th class="num">No.</th><th>Name</th><th>Type</th></tr></thead><tbody>${members.fields.map((field) => `<tr><td class="num">${esc(field.number ?? "")}</td><td>${esc(field.name)}</td><td class="mono">${esc(field.type ?? field.kind ?? "")}</td></tr>`).join("")}</tbody></table></div></section>` : "",
      members.procedures?.length ? `<section class="card"><h2>Procedures and triggers <span class="muted">${fmt(members.procedures.length)}</span></h2><ul class="list">${members.procedures.map((procedure) => `<li><span class="grow mono">${LIVE && procedure.line ? `<button class="link mono" data-open-line="${esc(procedure.line)}" title="Open in the editor">${esc(procedure.signature ?? procedure.name)}</button>` : esc(procedure.signature ?? procedure.name)}</span>${procedure.event ? '<span class="pill accent">event</span>' : ""}<span class="muted small nowrap">${esc([procedure.visibility, procedure.kind].filter(Boolean).join(" "))}</span></li>`).join("")}</ul></section>` : "",
      members.actions?.length ? `<section class="card"><h2>Actions <span class="muted">${fmt(members.actions.length)}</span></h2><ul class="list">${members.actions.map((action) => `<li><span class="grow">${esc(action.name)}</span><span class="muted small">${esc(action.container ?? "")}</span></li>`).join("")}</ul></section>` : "",
      members.parts?.length ? `<section class="card"><h2>Parts <span class="muted">${fmt(members.parts.length)}</span></h2><ul class="list">${members.parts.map((part) => `<li><span class="grow">${esc(part.name)}</span><span class="muted small">${esc(part.target ?? "")}</span></li>`).join("")}</ul></section>` : "",
      object.properties.length ? `<section class="card"><h2>Properties</h2><dl class="facts">${object.properties.map((property) => `<dt>${esc(property.name)}</dt><dd class="mono">${esc(property.value)}</dd>`).join("")}</dl></section>` : ""
    ].filter(Boolean);
    page.innerHTML = `
      <div class="stats">
        ${stat({ label: "Uses", value: fmt(object.uses.length), sub: `${fmt(object.uses.filter(({ dependency }) => dependency !== "intra-app").length)} across apps` })}
        ${stat({ label: "Used by", value: fmt(object.usedBy.length), sub: `${fmt(object.usedBy.filter(({ dependency }) => dependency !== "intra-app").length)} across apps` })}
        ${stat({ label: "Component", text: true, value: esc(object.component ?? "–"), sub: object.component ? `<a href="#/architecture?component=${encodeURIComponent(object.component)}">see architecture</a>` : "no component" })}
        ${stat({ label: "Wrong-way dependencies", value: fmt(object.violations.length), tone: object.violations.length ? "bad" : "good", sub: object.violations.length ? "see below how to resolve them" : "follows the architecture" })}
      </div>
      ${object.violations.length ? `<section class="card"><h2>Against the architecture</h2>${object.violations.map((violation) => `
        <div class="violation"><h3>${esc(violation.resolution.title)} <span class="pill ${violation.resolution.effort === "S" ? "ok" : violation.resolution.effort === "M" ? "warning" : "error"}">${esc(violation.resolution.effort)}</span></h3>
          <div class="small muted">${objectLink(violation.target)} in ${esc(violation.targetComponent)} · ${esc(kindsText(violation.kinds))} · <span class="mono">${esc(violation.rule)}</span></div>
          <ol class="small">${violation.resolution.steps.map((step) => `<li>${esc(step)}</li>`).join("")}</ol></div>`).join("")}</section>` : ""}
      <div class="grid">
        <section class="card"><h2>Uses <span class="muted">${fmt(object.uses.length)}</span></h2>${linkRows(object.uses, "Uses no other object.")}</section>
        <section class="card"><h2>Used by <span class="muted">${fmt(object.usedBy.length)}</span></h2>${linkRows(object.usedBy, "No other object uses it.")}</section>
      </div>
      ${memberCards.length ? `<div class="grid">${memberCards.join("")}</div>` : ""}`;
    page.addEventListener("click", (event) => {
      const line = event.target.closest("[data-open-line]")?.dataset.openLine;
      if (!line) return;
      event.preventDefault();
      api.openFile(object.source.file, Number(line)).catch((error) => toast(error.message));
    });
  }

  async function docsPage(page) {
    const overview = await api.overview();
    $("#main").classList.add("full");
    const where = overview.docs.path === "." ? "the app folder" : `<span class="mono">${esc(overview.docs.path)}</span>`;
    setHeader("Docs", overview.docs.scenarios ? `${plural(overview.docs.scenarios, "scenario")} from the AL UI tests in ${where}. Write them as files with <code>bca docs generate</code>.` : "User guides and test cases from AL UI tests.");
    if (!overview.docs.scenarios) {
      page.innerHTML = `<div class="card empty"><h2>No documented UI tests found</h2><p>Add <code>// [FEATURE]</code> and <code>// [SCENARIO]</code> comments to your AL UI tests, or point <code>docs.tests</code> in .bca.json at their folder.</p><pre class="code">bca docs list ./test\nbca docs generate ./test --app . --export markdown,html</pre></div>`;
      return;
    }
    page.innerHTML = `<div></div><div class="frame-wrap"><iframe title="Documentation" sandbox="allow-scripts allow-same-origin allow-popups" data-theme-document></iframe>${loading("Writing the guides…")}</div>`;
    const frame = $("iframe", page);
    frame.addEventListener("load", () => {
      $(".frame-wrap .loading", page)?.remove();
      applyTheme();
    });
    try {
      frame.srcdoc = await api.docsHtml();
    } catch (error) {
      $(".frame-wrap", page).innerHTML = `<div class="error-box">${esc(error.message)}</div>`;
    }
  }

  const RENDERERS = {
    overview: overviewPage,
    health: healthPage,
    architecture: architecturePage,
    dependencies: dependenciesPage,
    diagrams: diagramsPage,
    objects: objectsPage,
    object: objectPage,
    docs: docsPage
  };

  let renderId = 0;
  async function render() {
    const current = route();
    const id = ++renderId;
    const page = $("#page");
    const renderer = RENDERERS[current.page] ?? overviewPage;
    $("#main").classList.remove("full");
    $("#page-actions").innerHTML = "";
    $("#page-actions").onclick = null;
    $("#page-actions").onchange = null;
    markNav();
    // A fresh element drops the listeners of the previous page.
    const fresh = page.cloneNode(false);
    page.replaceWith(fresh);
    fresh.innerHTML = loading();
    try {
      await renderer(fresh, current);
    } catch (error) {
      if (id !== renderId) return;
      fresh.innerHTML = `<div class="error-box"><b>Could not load this page.</b><br>${esc(error.message)}</div>`;
    }
    if (id === renderId && current.page !== "objects") $("#main").scrollTop = 0;
  }

  // ---------------------------------------------------------- live updates
  function setStatus(text, state) {
    const element = $("#status");
    element.textContent = text;
    element.className = `status ${state ?? ""}`;
  }

  function refresh() {
    cache = new Map();
    api.overview().then((overview) => {
      renderNav(overview);
      $("#project-name").textContent = overview.title;
    }).catch(() => {});
  }

  if (LIVE) {
    // Messages from the extension: the source changed, or show a page.
    addEventListener("message", (event) => {
      const message = event.data;
      if (message?.type === "changed") {
        cache = new Map();
        setStatus("Updated", "live");
        toast("The source changed; the page shows the new analysis.");
        refresh();
        // The explorer and docs reload on their own when opened again.
        if (!["dependencies", "docs"].includes(route().page)) render();
      }
      if (message?.type === "navigate" && typeof message.hash === "string" && message.hash.startsWith("#/")) {
        if (location.hash === message.hash) render();
        else location.hash = message.hash;
      }
    });
  } else {
    setStatus(`Exported ${new Date(SNAPSHOT.generatedAt).toLocaleDateString()}`, "");
  }

  addEventListener("message", (event) => {
    const frame = $("iframe[data-theme-sync]");
    if (!frame || event.source !== frame.contentWindow) return;
    // The explorer unpacks its graph first, then asks for the theme and the selection.
    if (event.data?.type === "bca-ready") {
      frame.contentWindow.postMessage({ type: "bca-theme", theme, tokens: themeTokens() }, "*");
      if (frame.dataset.select) frame.contentWindow.postMessage({ type: "bca-select", id: frame.dataset.select }, "*");
    }
    if (event.data?.type === "bca-open-object" && typeof event.data.id === "string") location.hash = `#/object/${encodeURIComponent(event.data.id)}`;
  });

  addEventListener("keydown", (event) => {
    if (event.key === "/" && !event.target.closest("input, textarea, select") && route().page === "objects") {
      event.preventDefault();
      $("#object-search")?.focus();
    }
  });

  // VS Code webviews treat "#..." links as in-page anchors, so the page
  // follows its own "#/page" links before the webview sees the click.
  if (LIVE) {
    addEventListener("click", (event) => {
      const link = event.target.closest?.('a[href^="#/"]');
      if (!link || event.button !== 0 || event.metaKey || event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      if (location.hash === link.getAttribute("href")) render();
      else location.hash = link.getAttribute("href");
    }, true);
  }

  addEventListener("hashchange", render);
  renderNav();
  if (LIVE) setStatus("Analyzing…", "busy");
  render();
  try {
    const overview = await api.overview();
    renderNav(overview);
    $("#project-name").textContent = overview.title;
    if (LIVE) setStatus("Up to date", "live");
  } catch (error) {
    setStatus("Analysis failed", "");
  }
})();
