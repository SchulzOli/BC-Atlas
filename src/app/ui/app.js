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
    component: async (name, settings = {}) => {
      if (LIVE) return read("component", { name, ...settings });
      const component = SNAPSHOT.components?.[name];
      if (!component) throw new Error("This component is not part of the export.");
      return component;
    },
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
    const page = ({ object: "objects", component: "architecture" })[route().page] ?? route().page;
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

  /** What each proposed component could become, grouped by app candidate, with its namespace. */
  function appCandidatesCard(recommendations) {
    const apps = new Map();
    for (const recommendation of recommendations) {
      const key = recommendation.app ?? (recommendation.role === "shared" ? "Shared core" : "No relations");
      if (!apps.has(key)) apps.set(key, []);
      apps.get(key).push(recommendation);
    }
    const role = { app: '<span class="pill ok">app of its own</span>', component: '<span class="pill">component</span>', shared: '<span class="pill warning">shared core</span>', review: '<span class="pill error">place by hand</span>' };
    return `<section class="card"><h2>App candidates and namespaces <span class="muted">components coupled more to each other than to the rest could become one app</span></h2>
      <ul class="list">${[...apps].map(([app, list]) => `<li><span class="grow"><b>${esc(app)}</b>${list.length > 1 && list[0].existingApp ? ' <span class="muted small">stays one app</span>' : ""}
        <ul class="small">${list.map((item) => `<li>${esc(item.component)} ${role[item.role]} <code>${esc(item.namespace)}</code>${item.keepsNamespace ? ' <span class="muted">kept</span>' : ""}</li>`).join("")}</ul></span></li>`).join("")}</ul></section>`;
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

  // ------------------------------------------- dependencies: should vs. is
  // Green: the rules allow the dependency (where dependencies should be).
  // Red: it exists today but points against the architecture.

  /** Components in their layers, top layer first, with an arrow per component dependency. */
  function dependencyMapHtml(data) {
    const layers = [...new Set(data.components.map(({ layer }) => layer))].sort((a, b) => (b ?? -1) - (a ?? -1));
    const ROW = 110;
    const HEIGHT = 34;
    const GAP = 18;
    const LEFT = 92;
    const COLUMN = 66;
    // Every component gets a column of its own, ordered so that components
    // that depend on each other sit close (barycenters); boxes only have to
    // stay apart within their layer.
    const neighbors = new Map(data.components.map(({ name }) => [name, []]));
    for (const edge of data.edges) {
      const weight = Math.log2(1 + edge.objectEdges);
      neighbors.get(edge.source)?.push([edge.target, weight]);
      neighbors.get(edge.target)?.push([edge.source, weight]);
    }
    let order = [...data.components].sort((a, b) => (b.layer ?? -1) - (a.layer ?? -1) || a.name.localeCompare(b.name)).map(({ name }) => name);
    for (let pass = 0; pass < 24; pass++) {
      const rank = new Map(order.map((name, index) => [name, index]));
      const wanted = new Map(order.map((name) => {
        const list = neighbors.get(name).filter(([other]) => rank.has(other));
        const total = list.reduce((sum, [, weight]) => sum + weight, 0);
        const bary = total ? list.reduce((sum, [other, weight]) => sum + rank.get(other) * weight, 0) / total : rank.get(name);
        return [name, rank.get(name) * 0.5 + bary * 0.5];
      }));
      order = [...order].sort((a, b) => wanted.get(a) - wanted.get(b) || a.localeCompare(b));
    }
    const column = new Map(order.map((name, index) => [name, LEFT + 60 + index * COLUMN]));
    const box = new Map();
    let right = 0;
    layers.forEach((layer, index) => {
      const row = data.components.filter((component) => component.layer === layer)
        .map((component) => ({ component, width: Math.max(96, component.name.length * 7.4 + 52) }))
        .sort((a, b) => column.get(a.component.name) - column.get(b.component.name));
      let cursor = LEFT;
      for (const { component, width: boxWidth } of row) {
        const x = Math.max(cursor, column.get(component.name) - boxWidth / 2);
        box.set(component.name, { x, y: 40 + index * ROW, width: boxWidth, component });
        cursor = x + boxWidth + GAP;
      }
      right = Math.max(right, cursor);
    });
    const width = right + 30;
    const height = 40 + (layers.length - 1) * ROW + HEIGHT + 40;
    const edges = data.edges.filter(({ source, target }) => box.has(source) && box.has(target));
    const paths = edges.map((edge) => {
      const from = box.get(edge.source);
      const to = box.get(edge.target);
      const wrong = edge.violations > 0;
      let start;
      let end;
      const anchor = (own, other) => {
        const centre = own.x + own.width / 2;
        const shift = Math.max(-own.width / 2 + 10, Math.min(own.width / 2 - 10, (other.x + other.width / 2 - centre) * 0.3));
        return centre + shift;
      };
      if (from.y === to.y) {
        start = [anchor(from, to), from.y];
        end = [anchor(to, from), to.y];
      } else {
        const down = to.y > from.y;
        start = [anchor(from, to), down ? from.y + HEIGHT : from.y];
        end = [anchor(to, from), down ? to.y : to.y + HEIGHT];
      }
      // A and B depending on each other get two curves, one on each side.
      const side = edge.source < edge.target ? 1 : -1;
      const [mx, my] = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
      const length = Math.hypot(end[0] - start[0], end[1] - start[1]) || 1;
      const bend = from.y === to.y ? Math.min(90, 30 + length / 6) : 22;
      const [cx, cy] = from.y === to.y
        ? [mx, my - bend * side]
        : [mx + (-(end[1] - start[1]) / length) * bend * side, my + ((end[0] - start[0]) / length) * bend * side];
      const strokeWidth = (1 + Math.log2(1 + edge.objectEdges) * 0.8).toFixed(1);
      const tip = `${edge.source} → ${edge.target}: ${plural(edge.objectEdges, "object link")}${wrong ? `, ${fmt(edge.violations)} against the architecture` : ", allowed"}`;
      return `<path class="dep ${wrong ? "wrong" : "allowed"}" data-source="${esc(edge.source)}" data-target="${esc(edge.target)}" d="M${start[0].toFixed(1)},${start[1].toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${end[0].toFixed(1)},${end[1].toFixed(1)}" stroke-width="${strokeWidth}" marker-end="url(#arrow-${wrong ? "wrong" : "allowed"})"><title>${esc(tip)}</title></path>`;
    }).join("");
    const nodes = [...box.values()].map(({ x, y, width: boxWidth, component }) => `
      <g class="dep-node${component.violations ? " blocked" : component.extractable ? " extractable" : ""}" data-component="${esc(component.name)}" transform="translate(${x.toFixed(1)},${y})">
        <rect width="${boxWidth.toFixed(1)}" height="${HEIGHT}" rx="7"/>
        <text x="${(boxWidth / 2).toFixed(1)}" y="21" text-anchor="middle">${esc(component.name)} <tspan class="count">${fmt(component.metrics.objects)}</tspan></text>
        <title>${esc(`${component.name}: ${component.metrics.objects} objects, layer ${component.layer ?? "–"}. Click to open.`)}</title>
      </g>`).join("");
    const labels = layers.map((layer, index) => `<text class="layer-name" x="12" y="${40 + index * ROW + 21}">${layer === undefined ? "No layer" : `Layer ${layer}`}</text>`).join("");
    const marker = (id) => `<marker id="arrow-${id}" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" orient="auto-start-reverse"><path class="tip ${id}" d="M0,0 L10,5 L0,10 z"/></marker>`;
    const allowed = edges.filter(({ violations }) => !violations);
    const wrong = edges.filter(({ violations }) => violations);
    return `<div class="legend">
        <label class="check"><input type="checkbox" data-show="allowed" checked><span class="ok">allowed: ${plural(allowed.length, "dependency", "dependencies")} as they should be</span></label>
        <label class="check"><input type="checkbox" data-show="wrong" checked><span class="bad">against the architecture: ${plural(wrong.length, "dependency", "dependencies")} as they are but should not be</span></label>
      </div>
      <div class="muted small">Arrows point from the user to what it uses; thicker means more object links. Dependencies may only point down. Hover a component to see only its arrows; click it to open it.</div>
      <div class="dependency-map"><svg viewBox="0 0 ${width.toFixed(0)} ${height}" style="max-width:${width.toFixed(0)}px"><defs>${marker("allowed")}${marker("wrong")}</defs>${labels}${paths}${nodes}</svg></div>`;
  }

  /** Every pair of components: the rules tint the cell, the number counts today's object links. */
  function dependencyMatrixHtml(data) {
    const { order, cells } = data.matrix;
    const layerOf = new Map(data.components.map(({ name, layer }) => [name, layer]));
    return `<p class="muted small matrix-legend">The row uses the column. <span class="swatch allowed"></span>allowed by the rules: dependencies should be here · <span class="swatch forbidden"></span>not allowed · <span class="swatch wrong"></span>object links that point against the architecture today. Numbers count object links.</p>
      <div class="table-scroll"><table class="matrix">
        <thead><tr><th></th>${order.map((name, index) => `<th title="${esc(name)}">${index + 1}</th>`).join("")}</tr></thead>
        <tbody>${order.map((name, row) => `<tr><th class="row-head"><span class="muted">${row + 1}</span> <button class="link" data-component="${esc(name)}">${esc(name)}</button> <span class="muted small">L${esc(layerOf.get(name) ?? "–")}</span></th>${cells[row].map((cell, column) => cell === null
          ? '<td class="self"></td>'
          : `<td class="${cell.wrong ? "wrong" : cell.allowed ? "allowed" : "forbidden"}" title="${esc(`${name} → ${order[column]}: ${cell.allowed ? "allowed" : "not allowed"}; ${plural(cell.links, "object link")}${cell.wrong ? `, ${fmt(cell.wrong)} against the architecture` : ""}`)}">${cell.links ? fmt(cell.links) : ""}</td>`).join("")}</tr>`).join("")}</tbody>
      </table></div>`;
  }

  // ------------------------------------------------------- component page
  // Group colors stay clear of the green and red of allowed and wrong-way links.
  const GROUP_COLORS = ["#4e79a7", "#f28e2b", "#b07aa1", "#76b7b2", "#edc948", "#ff9da7", "#9c755f", "#6f6fd8", "#17becf", "#bcbd22", "#d37295", "#a0cbe8", "#ffbe7d", "#86bcb6", "#c49c94"];
  const LOOSE_COLOR = "#94a3b8";
  const ROLES = {
    app: ['<span class="pill ok">app of its own</span>', "Coupled more to itself than to the rest: it could become an app of its own."],
    component: ['<span class="pill">component</span>', "Part of a larger app candidate together with the components it is most coupled to."],
    shared: ['<span class="pill warning">shared core</span>', "Objects that many components use but none owns (setup, master data, helpers)."],
    review: ['<span class="pill error">place by hand</span>', "Its relations do not say where it belongs; place it by hand."]
  };

  /**
   * Force-directed layout of one group around (0, 0): Fruchterman-Reingold
   * with a grid for the repulsion and a pull to the middle, so objects
   * without links stay close. Deterministic: a component always looks the same.
   */
  function forceLayout(count, links) {
    const k = 26;
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const x = new Float64Array(count);
    const y = new Float64Array(count);
    const spread = Math.sqrt(count) * k;
    for (let index = 0; index < count; index++) {
      x[index] = (random() - 0.5) * spread;
      y[index] = (random() - 0.5) * spread;
    }
    const dx = new Float64Array(count);
    const dy = new Float64Array(count);
    const cell = k * 3;
    let temperature = spread / 4 + k;
    for (let step = 0; step < (count > 1 ? 220 : 0); step++) {
      dx.fill(0);
      dy.fill(0);
      const grid = new Map();
      for (let index = 0; index < count; index++) {
        const key = `${Math.floor(x[index] / cell)},${Math.floor(y[index] / cell)}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(index);
      }
      for (let a = 0; a < count; a++) {
        const gx = Math.floor(x[a] / cell);
        const gy = Math.floor(y[a] / cell);
        for (let ox = -1; ox <= 1; ox++) {
          for (let oy = -1; oy <= 1; oy++) {
            for (const b of grid.get(`${gx + ox},${gy + oy}`) ?? []) {
              if (b <= a) continue;
              const ddx = x[a] - x[b];
              const ddy = y[a] - y[b];
              const force = (k * k) / (ddx * ddx + ddy * ddy || 0.01);
              dx[a] += ddx * force; dy[a] += ddy * force;
              dx[b] -= ddx * force; dy[b] -= ddy * force;
            }
          }
        }
      }
      for (const [a, b, weight] of links) {
        const ddx = x[a] - x[b];
        const ddy = y[a] - y[b];
        const force = (Math.sqrt(ddx * ddx + ddy * ddy) / k) * (0.3 + Math.min(weight, 8) / 10);
        dx[a] -= ddx * force; dy[a] -= ddy * force;
        dx[b] += ddx * force; dy[b] += ddy * force;
      }
      for (let index = 0; index < count; index++) {
        dx[index] -= x[index] * 0.25;
        dy[index] -= y[index] * 0.25;
        const length = Math.sqrt(dx[index] * dx[index] + dy[index] * dy[index]);
        if (!length) continue;
        const move = Math.min(length, temperature);
        x[index] += (dx[index] / length) * move;
        y[index] += (dy[index] / length) * move;
      }
      temperature = Math.max(0.5, temperature * 0.975);
    }
    let radius = 0;
    for (let index = 0; index < count; index++) radius = Math.max(radius, Math.hypot(x[index], y[index]));
    return { x, y, radius: radius + 18 };
  }

  /**
   * Each group laid out on its own, then the groups packed as islands
   * around the largest one, so the sub-domains stay apart.
   * @returns { x, y, width, height, islands: Map of group key to { x, y, radius } }
   */
  function groupedLayout(objects, links, keys) {
    const members = new Map(keys.map((key) => [key, []]));
    objects.forEach(({ group }, index) => members.get(group)?.push(index));
    const position = new Map();
    for (const [key, list] of members) list.forEach((index, local) => position.set(index, [key, local]));
    const blobs = [...members].filter(([, list]) => list.length).map(([key, list]) => {
      const local = links.filter(([a, b]) => position.get(a)[0] === key && position.get(b)[0] === key)
        .map(([a, b, weight]) => [position.get(a)[1], position.get(b)[1], weight]);
      return { key, list, ...forceLayout(list.length, local) };
    }).sort((a, b) => b.radius - a.radius);
    const placed = [];
    const MARGIN = 46;
    for (const blob of blobs) {
      let spot = [0, 0];
      for (let step = 0; placed.length; step++) {
        const angle = step * 0.4;
        const distance = step * 5;
        const candidate = [Math.cos(angle) * distance * 1.25, Math.sin(angle) * distance];
        if (placed.every((other) => Math.hypot(candidate[0] - other.cx, candidate[1] - other.cy) >= blob.radius + other.radius + MARGIN)) {
          spot = candidate;
          break;
        }
      }
      placed.push({ ...blob, cx: spot[0], cy: spot[1] });
    }
    const x = new Float64Array(objects.length);
    const y = new Float64Array(objects.length);
    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const blob of placed) {
      minX = Math.min(minX, blob.cx - blob.radius); maxX = Math.max(maxX, blob.cx + blob.radius);
      minY = Math.min(minY, blob.cy - blob.radius); maxY = Math.max(maxY, blob.cy + blob.radius);
    }
    const pad = 50;
    const islands = new Map();
    for (const blob of placed) {
      const cx = blob.cx - minX + pad;
      const cy = blob.cy - minY + pad;
      islands.set(blob.key, { x: cx, y: cy, radius: blob.radius });
      blob.list.forEach((index, local) => { x[index] = blob.x[local] + cx; y[index] = blob.y[local] + cy; });
    }
    return { x, y, islands, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
  }

  /** The objects of a component as SVG; with `dependencies`, the other components around them. */
  function componentGraphSvg(detail, layout, groups, { dependencies, componentHref }) {
    const { x, y } = layout;
    let width = layout.width;
    let height = layout.height;
    let offset = 0;
    const others = new Map();
    if (dependencies) {
      // Other components on a ring around the objects, top layer first, clockwise from the top.
      const listed = detail.components.filter(({ out, in: incoming }) => out.links || incoming.links);
      const radius = Math.max(width, height) / 2 + 100 * Math.max(1, Math.max(width, height) / 900);
      offset = radius - Math.min(width, height) / 2 + 40;
      const cx = width / 2 + offset;
      const cy = height / 2 + offset;
      listed.forEach((component, index) => {
        const angle = (2 * Math.PI * index) / Math.max(listed.length, 1) - Math.PI / 2;
        others.set(component.name, { ...component, x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
      });
      width += offset * 2;
      height += offset * 2;
    }
    // Labels and the components on the ring grow with the graph, so they stay readable when it is fitted.
    const unit = Math.max(1, Math.max(layout.width, layout.height) / 900);
    const px = (index) => (x[index] + offset).toFixed(1);
    const py = (index) => (y[index] + offset).toFixed(1);
    const degree = detail.objects.map((object) => object.inside + (dependencies ? object.out.links + object.in.links : 0));
    const inside = detail.links.map(([a, b]) => `<line class="link" data-groups="${esc(detail.objects[a].group)} ${esc(detail.objects[b].group)}" x1="${px(a)}" y1="${py(a)}" x2="${px(b)}" y2="${py(b)}"/>`).join("");
    const outside = dependencies ? detail.external.map(([index, name, direction, links, wrong]) => {
      const other = others.get(name);
      if (!other) return "";
      return `<line class="ext ${wrong ? "wrong" : "allowed"} ${direction}" data-groups="${esc(detail.objects[index].group)}" x1="${px(index)}" y1="${py(index)}" x2="${other.x.toFixed(1)}" y2="${other.y.toFixed(1)}" stroke-width="${(0.8 + Math.log2(1 + links) * 0.7).toFixed(1)}"><title>${esc(`${direction === "out" ? `${detail.objects[index].label} uses ${name}` : `${name} uses ${detail.objects[index].label}`}: ${plural(links, "link")}${wrong ? `, ${fmt(wrong)} against the architecture` : ", allowed"}`)}</title></line>`;
    }).join("") : "";
    const showNames = detail.objects.length <= 80;
    const nodes = detail.objects.map((object, index) => {
      const group = groups.get(object.group);
      const radius = (3.5 + Math.sqrt(degree[index]) * 1.3).toFixed(1);
      const flagged = dependencies && (object.out.wrong || object.in.wrong);
      return `<a href="#/object/${encodeURIComponent(object.id)}" class="obj" data-group="${esc(object.group)}">
        <circle cx="${px(index)}" cy="${py(index)}" r="${radius}" fill="${group?.color ?? LOOSE_COLOR}"${flagged ? ' class="flagged"' : ""}/>
        ${showNames ? `<text x="${px(index)}" y="${(y[index] + offset + Number(radius) + 11).toFixed(1)}" text-anchor="middle">${esc(object.label)}</text>` : ""}
        <title>${esc(`${object.type} ${object.objectId ?? ""} ${object.label} · ${group?.label ?? ""}\n${object.inside} links inside · uses others ${object.out.links} (${object.out.wrong} wrong way) · used by others ${object.in.links} (${object.in.wrong} wrong way)${object.belongsTo ? `\nbelongs to ${object.belongsTo}` : ""}`)}</title></a>`;
    }).join("");
    // Each group as an island with its name on top.
    const islands = [...layout.islands].map(([key, island]) => {
      const color = groups.get(key)?.color ?? LOOSE_COLOR;
      return `<circle class="island" data-group="${esc(key)}" cx="${(island.x + offset).toFixed(1)}" cy="${(island.y + offset).toFixed(1)}" r="${island.radius.toFixed(1)}" fill="${color}" stroke="${color}"/>`;
    }).join("");
    const groupLabels = [...layout.islands].map(([key, island]) => {
      const group = groups.get(key);
      return `<text class="group-name" data-group="${esc(key)}" x="${(island.x + offset).toFixed(1)}" y="${(island.y - island.radius + offset - 8 * unit).toFixed(1)}" style="font-size:${(15 * unit).toFixed(1)}px" text-anchor="middle" fill="${group?.color ?? LOOSE_COLOR}">${esc(group?.label ?? key)} <tspan class="count">${fmt(group?.objects ?? 0)}</tspan></text>`;
    }).join("");
    const otherNodes = [...others.values()].map((other) => {
      const tone = other.out.wrong || other.in.wrong ? "wrong" : "allowed";
      return `<a href="${esc(componentHref(other.name))}" class="other ${tone}"><g transform="translate(${other.x.toFixed(1)},${other.y.toFixed(1)})"><circle r="${((14 + Math.sqrt(other.out.links + other.in.links)) * unit).toFixed(1)}" style="stroke-width:${(2.5 * unit).toFixed(1)}px"/><text y="${(4 * unit).toFixed(1)}" style="font-size:${(13 * unit).toFixed(1)}px" text-anchor="middle">${esc(other.name)}</text>
        <title>${esc(`${other.name} (layer ${other.layer ?? "–"}): ${detail.name} uses it ${plural(other.out.links, "time")}${other.out.wrong ? `, ${fmt(other.out.wrong)} wrong way` : ""}; it uses ${detail.name} ${plural(other.in.links, "time")}${other.in.wrong ? `, ${fmt(other.in.wrong)} wrong way` : ""}. ${other.mayUse ? `${detail.name} may use it.` : `${detail.name} may not use it.`}`)}</title></g></a>`;
    }).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" class="component-graph" viewBox="0 0 ${width.toFixed(0)} ${height.toFixed(0)}" width="${width.toFixed(0)}" height="${height.toFixed(0)}">${islands}${outside}${inside}${nodes}${groupLabels}${otherNodes}</svg>`;
  }

  async function componentPage(page, { arg, params }) {
    $("#main").classList.remove("full");
    const settings = {
      propose: params.get("propose") === "1" || undefined,
      groupBy: params.get("groupBy") ?? undefined,
      depth: params.get("depth") ?? undefined,
      minObjects: params.get("minObjects") ?? undefined
    };
    const query = new URLSearchParams(Object.entries({ propose: settings.propose ? 1 : undefined, groupBy: settings.groupBy, depth: settings.depth, minObjects: settings.minObjects }).filter(([, value]) => value !== undefined && value !== "")).toString();
    const componentHref = (name) => `#/component/${encodeURIComponent(name)}${query ? `?${query}` : ""}`;
    const [detail, architecture] = await Promise.all([api.component(arg, settings), api.architecture(settings)]);
    const groups = new Map(detail.groups.map((group, index) => [group.key, { ...group, color: group.key === "loose" ? LOOSE_COLOR : GROUP_COLORS[index % GROUP_COLORS.length] }]));
    const [rolePill, roleText] = ROLES[detail.role] ?? ["", ""];
    const uses = detail.components.reduce((sum, { out }) => ({ links: sum.links + out.links, wrong: sum.wrong + out.wrong }), { links: 0, wrong: 0 });
    const usedBy = detail.components.reduce((sum, { in: incoming }) => ({ links: sum.links + incoming.links, wrong: sum.wrong + incoming.wrong }), { links: 0, wrong: 0 });
    const mayUse = detail.components.filter(({ mayUse: allowed }) => allowed).map(({ name }) => name);
    const selectors = (list) => !list.length ? "–" : list.length <= 6 ? list.map(esc).join("<br>")
      : `${list.slice(0, 4).map(esc).join("<br>")}<details class="steps"><summary>and ${fmt(list.length - 4)} more</summary>${list.slice(4).map(esc).join("<br>")}</details>`;
    const workItems = architecture.workItems.filter((item) => item.sourceComponent === detail.name || item.targetComponent === detail.name);
    setHeader(detail.name,
      `${rolePill} Layer ${esc(detail.layer ?? "–")} · ${plural(detail.objects.length, "object")} in ${plural(detail.groups.length, "group")}${detail.namespace ? ` · namespace <code>${esc(detail.namespace)}</code>` : ""}${detail.app ? ` · app candidate ${esc(detail.app)}` : ""}`,
      `<a class="btn" href="#/architecture${query ? `?${query}` : ""}">All components</a>${query ? "" : `<a class="btn" href="#/objects?${new URLSearchParams({ component: detail.name })}">In the object list</a>`}`);
    page.innerHTML = `
      <div class="stats">
        ${stat({ label: "Objects", value: fmt(detail.objects.length), sub: `${plural(detail.groups.length, "group")} inside` })}
        ${stat({ label: "Cohesion", value: detail.metrics.cohesion === undefined ? "–" : `${Math.round(detail.metrics.cohesion * 100)}%`, tone: detail.metrics.cohesion >= 0.7 ? "good" : undefined, sub: "of its coupling stays inside" })}
        ${stat({ label: "Uses other components", value: fmt(uses.links), tone: uses.wrong ? "bad" : "good", sub: uses.wrong ? `<span class="bad">${fmt(uses.wrong)} against the architecture</span>` : "all allowed" })}
        ${stat({ label: "Used by other components", value: fmt(usedBy.links), tone: usedBy.wrong ? "warn" : undefined, sub: usedBy.wrong ? `${fmt(usedBy.wrong)} of them point the wrong way` : "all allowed" })}
        ${stat({ label: "Can become an app today", value: detail.extractable ? "yes" : "no", tone: detail.extractable ? "good" : undefined, sub: detail.inCycle ? "in a dependency cycle" : `${plural(workItems.length, "work item")}` })}
      </div>
      <section class="card"><h2>Objects and how they hang together <span class="actions"><span class="segmented" id="graph-mode"><button data-graph="inside" aria-pressed="true">Inside</button><button data-graph="dependencies" aria-pressed="false">With dependencies</button></span></span></h2>
          <div class="group-chips">${detail.groups.map((group) => `<button class="chip" data-group-chip="${esc(group.key)}" aria-pressed="false"><span class="swatch" style="background:${groups.get(group.key).color}"></span>${esc(group.label)} <span class="count">${fmt(group.objects)}</span></button>`).join("")}</div>
          <div class="legend" id="graph-legend" hidden><span class="ok">uses or is used as allowed</span><span class="bad">against the architecture</span><span class="muted">objects with a red ring have wrong-way links; click a component on the ring to open it</span></div>
          <div class="canvas component-canvas"><div class="canvas-tools"><button class="icon-button" data-zoom="in" title="Zoom in">+</button><button class="icon-button" data-zoom="out" title="Zoom out">−</button><button class="icon-button" data-zoom="fit" title="Fit">Fit</button></div><div class="stage"></div>
            <div class="canvas-info">${plural(detail.objects.length, "object")} · ${plural(detail.links.length, "link")} inside · click an object to open it · scroll to zoom, drag to pan</div></div>
      </section>
      <div class="grid">
        <section class="card"><h2>What it is</h2>
          ${roleText ? `<p>${roleText}</p>` : ""}
          <dl class="facts">
            ${detail.description ? `<dt>Description</dt><dd>${esc(detail.description)}</dd>` : ""}
            <dt>Layer</dt><dd>${esc(detail.layer ?? "none")}${detail.dependsOn ? ` · may use only ${esc(detail.dependsOn.join(", ") || "nothing")}` : ""}</dd>
            <dt>May use</dt><dd>${mayUse.length ? mayUse.map((name) => `<a href="${esc(componentHref(name))}">${esc(name)}</a>`).join(", ") : "no other component"}</dd>
            ${detail.namespace ? `<dt>Namespace</dt><dd><code>${esc(detail.namespace)}</code> <span class="muted small">suggested</span></dd>` : ""}
            ${detail.app ? `<dt>App candidate</dt><dd>${esc(detail.app)}</dd>` : ""}
            <dt>Selected by</dt><dd class="mono small">${selectors(detail.match ?? [])}</dd>
            <dt>Groups</dt><dd>${detail.mode === "proposal" ? "Found the same way as the components: objects coupled more to each other than to the rest of the component, named after their namespace, folder, or the words their names share." : "Objects coupled more to each other than to the rest of the component, named after their namespace, folder, or the words their names share."}</dd>
          </dl>
        </section>
        <section class="card flush"><h2>Dependencies <span class="muted">should vs. is, per component</span></h2><div id="component-dependencies"></div></section>
      </div>
      <section class="card flush"><h2>Groups inside <span class="muted">sub-domains by coupling</span></h2><div id="group-table"></div></section>
      <section class="card flush"><h2>Objects <span class="muted" id="component-object-count"></span></h2>
        <div class="toolbar padded"><input type="search" id="component-search" placeholder="Search name, ID, file"><select id="component-group"><option value="">All groups</option>${detail.groups.map((group) => `<option value="${esc(group.key)}">${esc(group.label)}</option>`).join("")}</select>
          <label class="check"><input type="checkbox" id="component-wrong"> With wrong-way links</label></div>
        <div id="component-objects"></div></section>
      ${workItems.length ? `<section class="card flush"><h2>Work items <span class="muted">${plural(workItems.length, "item")} where ${esc(detail.name)} uses or is used against the architecture</span></h2><div id="component-work"></div></section>` : ""}`;

    // Graph: laid out once, drawn per mode.
    const layout = groupedLayout(detail.objects, detail.links, detail.groups.map(({ key }) => key));
    const canvas = $(".component-canvas", page);
    let controls;
    let focus;
    const applyFocus = () => {
      const svg = $("svg", canvas);
      svg.classList.toggle("focused", Boolean(focus));
      for (const element of $$("[data-group]", svg)) element.classList.toggle("on", focus !== undefined && element.dataset.group === focus);
      for (const element of $$("[data-groups]", svg)) element.classList.toggle("on", focus !== undefined && element.dataset.groups.split(" ").includes(focus));
      for (const chip of $$("[data-group-chip]", page)) chip.setAttribute("aria-pressed", String(chip.dataset.groupChip === focus));
    };
    const draw = (mode) => {
      const markup = componentGraphSvg(detail, layout, groups, { dependencies: mode === "dependencies", componentHref });
      const svg = new DOMParser().parseFromString(markup, "image/svg+xml").documentElement;
      controls = panZoom(canvas, document.importNode(svg, true));
      $("#graph-legend").hidden = mode !== "dependencies";
      for (const button of $$("[data-graph]", page)) button.setAttribute("aria-pressed", String(button.dataset.graph === mode));
      applyFocus();
    };
    draw("inside");
    $("#graph-mode").onclick = (event) => {
      const mode = event.target.closest("[data-graph]")?.dataset.graph;
      if (mode) draw(mode);
    };
    $(".canvas-tools", canvas).onclick = (event) => {
      const zoom = event.target.closest("[data-zoom]")?.dataset.zoom;
      if (zoom === "fit") controls.fit();
      else if (zoom) controls.zoom(zoom === "in" ? 1.25 : 0.8);
    };
    const setFocus = (key) => {
      focus = focus === key ? undefined : key;
      applyFocus();
      $("#component-group").value = focus ?? "";
      renderObjects();
    };
    page.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-group-chip]");
      if (chip) setFocus(chip.dataset.groupChip);
    });

    dataTable($("#group-table"), {
      rows: detail.groups,
      sort: { key: "objects", direction: "descending" },
      onRow: (row) => setFocus(row.key),
      columns: [
        { key: "label", label: "Group", render: (row) => `<span class="swatch" style="background:${groups.get(row.key).color}"></span><b>${esc(row.label)}</b>${row.fullName && row.fullName !== row.label ? `<div class="small muted mono">${esc(row.fullName)}</div>` : ""}` },
        { key: "basis", label: "Named after", render: (row) => `<span class="small muted">${esc(row.basis ?? (row.key === "loose" ? "no links inside" : "shared words"))}</span>` },
        { key: "objects", label: "Objects", numeric: true, render: (row) => fmt(row.objects) },
        { key: "types", label: "Types", value: (row) => Object.keys(row.types).length, render: (row) => `<span class="small">${Object.entries(row.types).sort((a, b) => b[1] - a[1]).map(([type, count]) => `${esc(type)} ${fmt(count)}`).join(", ")}</span>` },
        { key: "inside", label: "Links inside", numeric: true, value: (row) => row.inside ?? 0, render: (row) => fmt(row.inside ?? 0) }
      ]
    });

    const linkCell = ({ links, wrong }) => links ? `${fmt(links)}${wrong ? ` <span class="pill error">${fmt(wrong)} wrong</span>` : ""}` : '<span class="muted">–</span>';
    dataTable($("#component-dependencies"), {
      rows: detail.components,
      sort: { key: "out", direction: "descending" },
      onRow: (row) => { location.hash = componentHref(row.name); },
      columns: [
        { key: "name", label: "Component", render: (row) => `<b>${esc(row.name)}</b> <span class="muted small">L${esc(row.layer ?? "–")}</span>` },
        { key: "mayUse", label: "Should", value: (row) => (row.mayUse ? 2 : 0) + (row.mayBeUsedBy ? 1 : 0), render: (row) => `${row.mayUse ? '<span class="pill ok">may use it</span>' : ""}${row.mayBeUsedBy ? ' <span class="pill ok">may be used by it</span>' : ""}${!row.mayUse && !row.mayBeUsedBy ? '<span class="pill">no dependency</span>' : ""}` },
        { key: "out", label: "Uses it (is)", numeric: true, value: (row) => row.out.links, render: (row) => linkCell(row.out) },
        { key: "in", label: "Used by it (is)", numeric: true, value: (row) => row.in.links, render: (row) => linkCell(row.in) }
      ]
    });

    const renderObjects = () => {
      const text = $("#component-search").value.trim().toLowerCase();
      const group = $("#component-group").value;
      const wrongOnly = $("#component-wrong").checked;
      const rows = detail.objects.filter((object) => (!group || object.group === group) && (!wrongOnly || object.out.wrong || object.in.wrong) &&
        (!text || `${object.label} ${object.objectId ?? ""} ${object.file ?? ""}`.toLowerCase().includes(text)));
      $("#component-object-count").textContent = `${fmt(rows.length)} of ${fmt(detail.objects.length)}`;
      dataTable($("#component-objects"), {
        rows,
        empty: "No objects match.",
        sort: { key: "inside", direction: "descending" },
        onRow: (row) => { location.hash = `#/object/${encodeURIComponent(row.id)}`; },
        columns: [
          { key: "type", label: "Type", render: (row) => `<span class="type">${esc(row.type)}</span>` },
          { key: "objectId", label: "ID", numeric: true, value: (row) => Number(row.objectId) || 0, render: (row) => esc(row.objectId ?? "") },
          { key: "label", label: "Name", render: (row) => `${objectLink(row)}${row.file ? `<div class="small muted mono">${esc(row.file)}</div>` : ""}` },
          { key: "group", label: "Group", value: (row) => groups.get(row.group)?.label, render: (row) => `<span class="swatch" style="background:${groups.get(row.group)?.color ?? LOOSE_COLOR}"></span>${esc(groups.get(row.group)?.label ?? "")}` },
          { key: "inside", label: "Links inside", numeric: true },
          { key: "out", label: "Uses others", numeric: true, value: (row) => row.out.links, render: (row) => linkCell(row.out) },
          { key: "in", label: "Used by others", numeric: true, value: (row) => row.in.links, render: (row) => linkCell(row.in) },
          ...(detail.objects.some(({ belongsTo }) => belongsTo) ? [{ key: "belongsTo", label: "Belongs to", render: (row) => row.belongsTo ? `<span class="pill warning">${esc(row.belongsTo)}</span>` : "" }] : [])
        ]
      });
    };
    let timer;
    $("#component-search").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(renderObjects, 120); });
    $("#component-group").addEventListener("change", (event) => { focus = event.target.value || undefined; applyFocus(); renderObjects(); });
    $("#component-wrong").addEventListener("change", renderObjects);
    renderObjects();

    if ($("#component-work")) {
      dataTable($("#component-work"), {
        rows: workItems,
        sort: { key: "violations", direction: "descending" },
        columns: [
          { key: "effort", label: "Effort", value: (row) => ({ S: 1, M: 2, L: 3 })[row.effort], render: (row) => `<span class="pill ${row.effort === "S" ? "ok" : row.effort === "M" ? "warning" : "error"}" title="${esc(EFFORT[row.effort])} effort">${esc(row.effort)}</span>` },
          { key: "title", label: "What to do", render: (row) => `<b>${esc(row.title)}</b> <span class="mono muted">${esc(row.strategy)}</span><details class="steps"><summary>Steps</summary><ol>${row.steps.map((step) => `<li>${esc(step)}</li>`).join("")}</ol>${row.command ? `<div class="small">Do it: <code>${esc(row.command)}</code></div>` : ""}</details>` },
          { key: "source", label: "Object", value: (row) => row.source.label, render: (row) => `${objectLink(row.source)}<div class="type">${esc(row.source.type)}</div>` },
          { key: "from", label: "From → to (is)", value: (row) => `${row.sourceComponent} ${row.targetComponent}`, render: (row) => `<span class="${row.sourceComponent === detail.name ? "bad" : ""}">${esc(row.sourceComponent)} → ${esc(row.targetComponent)}</span>` },
          { key: "violations", label: "Dependencies", numeric: true, render: (row) => fmt(row.violations) }
        ]
      });
    }
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
    const selected = params.get("component") ?? undefined;
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
          <label class="field"><span>Group objects by</span><select id="group-by">${["auto", "module", "app", "namespace", "folder"].map((value) => `<option${value === (data.proposal.groupBy ?? "auto") ? " selected" : ""}>${value}</option>`).join("")}</select></label>
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
          <p class="muted small">Click a component for its objects, the groups inside it, and its dependencies.</p>
        </section>
        <section class="card"><h2>${proposal ? "How it was derived" : "How it is enforced"}</h2>
          ${proposal ? `<p class="muted">${({
              auto: "The relations decide: inside each app or module, objects that are tightly coupled (weighted by relation type: extends, writes, source tables, calls, …) form a component, objects that many components use form a shared core, and namespaces or folders survive only where the relations confirm them.",
              coupling: "The relations decide: inside each app or module, objects that are tightly coupled form a component, and objects that many components use form a shared core.",
              namespace: "Namespaces form the components; objects without a namespace follow their relations.",
              folder: "Folders that say what objects do form the components; objects in type folders follow their relations.",
              module: "Each module is a component.",
              app: "Each app is a component."
            })[data.proposal.groupBy] ?? ""} Components are ordered so that as little coupling as possible points the wrong way, and each one sits one layer above the deepest component it uses. Try another grouping and compare the coupling inside components.</p>
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
      ${data.matrix ? `<section class="card"><h2>Dependencies between components <span class="muted">where they should be and where they are</span>
          <span class="actions"><span class="segmented" id="dependency-mode"><button data-dependency-mode="map" aria-pressed="true">Map</button><button data-dependency-mode="matrix" aria-pressed="false">Matrix</button></span></span></h2>
        <div id="dependency-view"></div></section>` : ""}
      ${proposal && data.proposal.recommendations?.length ? appCandidatesCard(data.proposal.recommendations) : ""}
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
    const query = { propose: settings.propose ? 1 : undefined, groupBy: settings.groupBy, depth: settings.depth, minObjects: settings.minObjects };
    const openComponent = (name) => go(`component/${encodeURIComponent(name)}`, query);
    if ($("#dependency-view")) {
      const show = (mode) => {
        for (const button of $$("[data-dependency-mode]", page)) button.setAttribute("aria-pressed", String(button.dataset.dependencyMode === mode));
        $("#dependency-view").innerHTML = mode === "matrix" ? dependencyMatrixHtml(data) : dependencyMapHtml(data);
      };
      $("#dependency-mode").onclick = (event) => {
        const mode = event.target.closest("[data-dependency-mode]")?.dataset.dependencyMode;
        if (mode) show(mode);
      };
      // Hovering a component shows only its dependencies.
      $("#dependency-view").onmouseover = (event) => {
        const svg = $("#dependency-view svg");
        if (!svg) return;
        const name = event.target.closest(".dep-node")?.dataset.component;
        svg.classList.toggle("focused", Boolean(name));
        for (const path of $$(".dep", svg)) path.classList.toggle("on", Boolean(name) && (path.dataset.source === name || path.dataset.target === name));
      };
      $("#dependency-view").onchange = (event) => {
        const kind = event.target.closest("[data-show]")?.dataset.show;
        if (kind) $("#dependency-view .dependency-map")?.classList.toggle(`hide-${kind}`, !event.target.checked);
      };
      show("map");
    }
    dataTable($("#components"), {
      rows: data.components,
      sort: { key: "layer", direction: "ascending" },
      onRow: (row) => openComponent(row.name),
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
      if (component) return openComponent(component.dataset.component);
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
        ${stat({ label: "Component", text: true, value: esc(object.component ?? "–"), sub: object.component ? `<a href="#/component/${encodeURIComponent(object.component)}">open the component</a>` : "no component" })}
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
    component: componentPage,
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
