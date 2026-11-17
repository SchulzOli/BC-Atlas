// BC Atlas: one view. The toolbar chooses what part of the atlas shows (a
// lens), in which form (2D, diagram, 3D), and what stands out (a search, the
// findings, a story); everything else is the graph. In VS Code the extension
// answers the view's requests (LIVE); an exported file reads the same atlas
// from an embedded snapshot. The whole state of the view is in the address,
// so any picture can be linked to and opened again.
(async () => {
  "use strict";

  const BOOT = window.BCA_APP ?? { mode: "static" };
  // Live: something answers the requests of the view. In VS Code the extension, as an MCP App
  // the MCP server (vendor/mcp-app.js); both take { type: "request", id, method, params }.
  const MCP = BOOT.mode === "mcp";
  const LIVE = BOOT.mode === "vscode" || MCP;
  const vscode = MCP ? window.BCA_MCP_HOST : LIVE ? acquireVsCodeApi() : undefined;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) => String(value ?? "").replace(/[&<>"']/gu, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const fmt = (value) => Number(value ?? 0).toLocaleString("en-US");
  const plural = (count, word, many = `${word}s`) => `${fmt(count)} ${count === 1 ? word : many}`;
  // `code` and **bold** in generated text.
  const rich = (text) => esc(text).replace(/`([^`]+)`/gu, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/gu, "<b>$1</b>");

  // What shows and how it reads as text is shared with the terminal (scene.js).
  const S = BCA_SCENE;
  const { KIND_NAMES } = S;
  const FACTS = [
    ["objectId", "ID"], ["component", "Component"], ["layer", "Layer"], ["namespace", "Namespace"], ["app", "App"], ["origin", "Origin"],
    ["publisher", "Publisher"], ["version", "Version"], ["access", "Access"], ["obsolete", "Obsolete"], ["status", "Status"], ["severity", "Severity"],
    ["roles", "Roles"], ["permissionSets", "Permission sets"], ["objects", "Objects"], ["steps", "Steps"], ["handovers", "Handovers"],
    ["procedures", "Procedures"], ["lines", "Lines"], ["complexity", "Complexity"], ["uses", "Uses"], ["usedBy", "Used by"],
    ["runsOn", "Runs on"], ["delivery", "Delivery"], ["saves", "Saves to"], ["options", "Options"], ["wrongWay", "Wrong way"], ["instability", "Instability"], ["canBeApp", "Can be an app"], ["header", "Declaration"]
  ];

  async function inflate(base64) {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).text();
  }

  // ------------------------------------------------------------------ data
  const SNAPSHOT = LIVE ? undefined : JSON.parse(await inflate(window.BCA_SNAPSHOT_GZIP));

  // Requests to the extension: { type: "request", id, method, params } is
  // answered with { type: "response", id, result } or { id, error }.
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

  let atlas;
  let found;
  let position = new Map();
  let findingsOf = new Map();
  const insides = new Map();
  /** Reads the atlas, and what follows from it: where each node is, and its findings. */
  async function load() {
    atlas = LIVE ? await call("atlas") : SNAPSHOT.atlas;
    found = S.index(atlas);
    ({ position, findingsOf } = found);
    insides.clear();
    canvasRead();
  }
  /** One object from the inside (src/app/atlas.js), or nothing when it is not part of an export. */
  async function inside(id) {
    if (!insides.has(id)) {
      insides.set(id, LIVE ? await call("inside", { id }).catch(() => undefined) : SNAPSHOT.inside?.[id]);
    }
    return insides.get(id);
  }
  // ----------------------------------------------------------------- state
  // The whole view, as it is in the address: #lens=data&form=diagram&sel=...
  const { DEFAULTS } = S;
  function readState() {
    const hash = location.hash.replace(/^#\/?/u, "");
    // Links of earlier versions to one object.
    if (hash.startsWith("object/")) return { ...DEFAULTS, sel: decodeURIComponent(hash.slice(7).split("?")[0]) };
    const params = new URLSearchParams(hash.includes("=") ? hash : "");
    return { ...DEFAULTS, ...Object.fromEntries([...params].filter(([key]) => key in DEFAULTS)) };
  }
  let state = readState();
  const stateHash = (from = state) => S.stateHash(from);
  // Where the view is: a step to another place is one the Back key takes back; anything else changes the place it is at.
  const placeOf = (from) => (from.story ? `story\n${from.story}` : [from.lens, from.inside, from.focus].join("\n"));
  let place;
  function remember() {
    const hash = stateHash();
    if (hash === (location.hash || "#")) return;
    const moved = place !== undefined && placeOf(state) !== place;
    place = placeOf(state);
    // An embedded page may not be allowed to change its address; the view works without.
    try { history[moved ? "pushState" : "replaceState"](null, "", hash); } catch { /* optional */ }
    if (LIVE) vscode.postMessage({ type: "state", lens: state.lens, story: state.story });
  }
  /** Changes the view and draws it. */
  function set(change) {
    Object.assign(state, change);
    remember();
    return render();
  }
  const list = (value) => new Set(value ? value.split("|") : []);
  const toggled = (value, key) => {
    const items = list(value);
    if (items.has(key)) items.delete(key);
    else items.add(key);
    return [...items].join("|");
  };

  // ----------------------------------------------------------------- theme
  const THEME_KEY = "bca-theme";
  const storedTheme = (() => { try { return localStorage.getItem(THEME_KEY); } catch { return undefined; } })();
  // In VS Code the view follows the editor's color theme.
  const editorTheme = () => (document.body.classList.contains("vscode-light") || document.body.classList.contains("vscode-high-contrast-light") ? "light" : "dark");
  let theme = LIVE ? editorTheme() : storedTheme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const applyTheme = () => { document.documentElement.dataset.theme = theme; };
  applyTheme();
  if (LIVE) {
    $("#theme-toggle").hidden = true;
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
    toastTimer = setTimeout(() => element.classList.remove("show"), 2600);
  }
  const message = (html = "") => { $("#message").innerHTML = html; };

  function download(name, content, type = "text/plain") {
    if (LIVE) {
      const binary = content instanceof Uint8Array;
      const text = binary ? btoa(Array.from(content, (byte) => String.fromCharCode(byte)).join("")) : content;
      // The extension asks where to save; the MCP server saves into the project and says where.
      return call("saveFile", { name, content: text, encoding: binary ? "base64" : undefined }).then((saved) => (saved?.path ? toast(`Saved ${saved.path}`) : undefined), (error) => toast(error.message));
    }
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([content], { type }));
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    return undefined;
  }
  const fileName = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "bc-atlas";

  // ----------------------------------------------------------------- scene
  const lensOf = (id) => atlas.lenses.find((lens) => lens.id === id) ?? atlas.lenses[0];
  const storyOf = (id) => atlas.stories.find((story) => story.id === id);

  /** The part of the atlas the state asks for (scene.js); an object that is opened is read first. */
  async function sceneFor() {
    const inner = state.inside && position.has(state.inside) ? atlas.nodes[position.get(state.inside)] : undefined;
    const within = inner?.kind === "object" ? await inside(state.inside) : undefined;
    // A large export leaves out what is inside each object: then the view shows what is next to it.
    if (inner?.kind === "object" && !within) Object.assign(state, { inside: "", focus: inner.id });
    return S.scene(atlas, found, state, within);
  }

  // ----------------------------------------------------------------- graph
  let scene;
  let flags;
  let graph;
  let applied = {};
  let rendering = Promise.resolve();
  let told = false;

  const SIZES = [["", "Same size"], ["relations", "Relations"], ["usedBy", "Used by"], ["uses", "Uses"], ["lines", "Lines of code"], ["complexity", "Complexity"], ["objects", "Objects"], ["findings", "Findings"]];
  function render() {
    rendering = rendering.then(draw).catch((error) => {
      message(`<b>BC Atlas could not show this.</b><span>${esc(error.message)}</span>`);
    });
    return rendering;
  }

  async function draw() {
    if (!atlas) return;
    // A story decides the lens of each step.
    const story = storyOf(state.story);
    const step = story?.steps[Math.min(Number(state.step) || 0, story.steps.length - 1)];
    if (state.story && !story) state.story = "";
    if (step && (state.lens !== step.lens || state.inside || state.focus)) Object.assign(state, { lens: step.lens, inside: "", focus: "" });
    if (!atlas.lenses.some(({ id }) => id === state.lens)) state.lens = atlas.lenses[0].id;

    const next = await sceneFor();
    // The card of the selected node floats on the right: the picture fits next to it.
    const room = roomFor(next);
    // The form the state names, else the one its lens reads best in.
    const form = S.formOf(atlas, state);
    const moved = !graph || next.key !== applied.key || applied.form !== form;
    if (!graph || next.key !== applied.key) {
      // What stays in the picture stays where it is; the rest comes and goes around it.
      const before = graph?.snapshot();
      graph?.destroy();
      scene = next;
      graph = BCA_GRAPH.create($("#graph"), scene, {
        mode: form,
        from: before,
        room,
        onInfo: ({ selected }) => {
          const id = selected >= 0 ? scene.entries[selected].node.id : "";
          if (id === state.sel) return;
          state.sel = id;
          remember();
          inspector();
          // In the overview what is selected lights its way through the columns, and the picture
          // makes room for the card: a moment later, so that a double click still lands.
          if (scene.flow && !state.story && !state.q.trim()) {
            graph.highlight(S.highlight(atlas, scene, state));
            const mine = scene;
            clearTimeout(roomTimer);
            roomTimer = setTimeout(() => { if (scene === mine) graph.room(roomFor(scene), { follow: true }); }, 480);
          }
        },
        onOpen: (index) => open(scene.entries[index])
      });
      applied = { key: next.key, form };
    } else {
      scene = { ...next, nodes: scene.nodes };
      const colors = next.nodes.map(({ color }) => color);
      if (colors.join() !== applied.colors) graph.colors(colors);
    }
    applied.colors = scene.nodes.map(({ color }) => color).join();
    if (applied.form !== form) {
      graph.mode(form);
      applied.form = form;
    }

    // What shows: classes and kinds of relation switched off in the legend.
    flags = S.shown(scene, state, atlas);
    // A run builds its picture: every step shows more.
    const showKey = `${state.hide}\n${state.off}${story?.build ? `\n${state.story}\n${state.step}` : ""}`;
    if (applied.show !== showKey) {
      if (applied.show !== undefined || state.hide || state.off || story?.build) graph.show(flags.nodes, flags.kinds.length ? flags.kinds : new Uint8Array(1).fill(1));
      applied.show = showKey;
    }
    graph.room(room, { follow: moved });
    graph.size(S.sizeValues(scene, found, state.size, flags.degree));
    // Check: a ring in the color of the worst finding on a node.
    graph.rings(state.check ? S.rings(scene, found) : undefined);

    // What stands out: the step of a story, else what the search finds.
    const query = state.q.trim();
    const lit = S.highlight(atlas, scene, state);
    graph.highlight(lit);
    $(".search").classList.toggle("none", Boolean(query) && !step && !lit?.size);

    const selected = state.sel && scene.place.has(state.sel) ? scene.place.get(state.sel) : -1;
    if (graph.selected() !== selected) graph.select(selected);
    const focusKey = `${applied.key}\n${state.story}\n${state.step}`;
    if (step && applied.focus !== focusKey) {
      if (lit?.size) graph.center([...lit], { animate: told });
      else graph.fit();
      told = true;
    }
    if (!step) told = false;
    applied.focus = focusKey;

    message(scene.entries.length ? "" : "<b>Nothing to show here.</b><span>This part of the source has no such nodes.</span>");
    toolbar();
    legend();
    inspector();
    storyBar(story, step);
    remember();
    place = placeOf(state);
  }

  /** What floats on the stage: the card of the selected node, on the right. */
  let roomTimer;
  function roomFor(view) {
    const stage = $("#stage").clientWidth;
    return { right: state.sel && view.place.has(state.sel) && stage > 680 ? Math.min(340, stage - 24) + 24 : 0 };
  }

  /** A double click goes into a node: a member to its source, anything else to what it is made of or stands next to. */
  function open({ node }) {
    if (node.kind === "member") return source(node);
    const change = S.into(atlas, node, state);
    return change ? set(change) : undefined;
  }
  /** One step up the trail: out of what was gone into, back to the lens. */
  function up() {
    const crumbs = S.trail(atlas, found, state);
    if (crumbs.length < 2) return false;
    set(crumbs[crumbs.length - 2].change);
    return true;
  }
  /** The lens before or after this one. */
  function turn(by) {
    const at = atlas.lenses.findIndex(({ id }) => id === state.lens);
    const lens = atlas.lenses[(at + by + atlas.lenses.length) % atlas.lenses.length];
    return set({ lens: lens.id, inside: "", focus: "", story: "" });
  }

  function source(node) {
    if (!node.file) return toast("This node has no place in the source.");
    // A chat client has no editor to open the file in: the place is shown, and the model is told.
    if (MCP) return toast(`${node.file}${node.line ? `:${node.line}` : ""}`);
    if (LIVE) return call("openFile", { file: node.file, line: node.line }).catch((error) => toast(error.message));
    if (node.url) return window.open(node.url, "_blank", "noopener");
    return toast(`${node.file}${node.line ? `:${node.line}` : ""}`);
  }

  // --------------------------------------------------------------- toolbar
  function toolbar() {
    $("#project-name").textContent = atlas.title;
    document.title = `${atlas.title} · BC Atlas`;
    $("#lens-name").textContent = scene.lens.title;
    // Where the view is, after the lens: every part of the way is one click back.
    const crumbs = S.trail(atlas, found, state);
    const trail = $("#trail");
    trail.hidden = crumbs.length < 2;
    trail.innerHTML = crumbs.length < 2 ? "" : `<button class="up" data-crumb="${crumbs.length - 2}" title="Back to ${esc(crumbs[crumbs.length - 2].label)} (Backspace)" aria-label="Back">‹</button>`
      + crumbs.slice(1).map((crumb, index) => (index + 1 === crumbs.length - 1
        ? `<b aria-current="location" title="${esc(crumb.label)}">${esc(crumb.label)}</b>`
        : `<button data-crumb="${index + 1}" title="${esc(crumb.label)}">${esc(crumb.label)}</button>`)).join("");
    for (const button of $$("#forms button")) button.setAttribute("aria-checked", String(button.dataset.form === S.formOf(atlas, state)));
    const search = $("#search");
    if (document.activeElement !== search) search.value = state.q;
    const counts = { error: 0, warning: 0, info: 0 };
    for (const finding of atlas.findings) counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
    const total = counts.error + counts.warning || counts.info;
    const badge = $("#check-count");
    badge.hidden = !total;
    badge.textContent = fmt(total);
    badge.className = `count ${counts.error ? "error" : counts.warning ? "warning" : ""}`;
    const check = $("#check-button");
    check.setAttribute("aria-pressed", String(Boolean(state.check)));
    check.title = `${plural(counts.error, "error")}, ${plural(counts.warning, "warning")}, ${counts.info} info. Show them on the graph (C)`;
    const running = storyOf(state.story)?.kind === "run";
    $("#story-button").setAttribute("aria-pressed", String(Boolean(state.story) && !running));
    // Simulate is there when the project has process tests to perform.
    $("#simulate-button").hidden = !atlas.simulation;
    $("#simulate-button").setAttribute("aria-pressed", String(running || (state.lens === "simulation" && !state.inside)));
    // Flow is there when the flows of the project could be read.
    $("#flow-button").hidden = !atlas.flows;
    $("#flow-button").setAttribute("aria-pressed", String(state.lens === "flows" && !state.inside));
    const sync = $("#sync-button");
    sync.className = `tool status menu ${LIVE ? "live" : ""}`;
    $("#sync-text").textContent = LIVE ? "Live" : new Date(SNAPSHOT.generatedAt).toLocaleDateString();
  }

  $("#trail").addEventListener("click", (event) => {
    const at = event.target.closest("[data-crumb]")?.dataset.crumb;
    if (at !== undefined) set(S.trail(atlas, found, state)[Number(at)].change);
  });

  let folded;
  function legend() {
    const element = $("#legend");
    element.hidden = !scene.entries.length;
    const hidden = list(state.hide);
    const off = list(state.off);
    const counts = new Map();
    for (const edge of scene.edges) counts.set(edge[2], (counts.get(edge[2]) ?? 0) + 1);
    // The overview explains itself by its columns: its legend starts folded.
    const fold = folded ?? (innerWidth < 720 || Boolean(scene.flow));
    // A run says how far its picture is built.
    const building = Boolean(storyOf(state.story)?.build) && flags;
    const reached = building ? flags.nodes.reduce((sum, visible) => sum + (visible ? 1 : 0), 0) : 0;
    element.innerHTML = `
      <div class="where"><b>${esc(scene.title)}</b><span>${building ? `${fmt(reached)} of ` : ""}${plural(scene.entries.length, "node")}, ${plural(scene.edges.length, "relation")}</span><button class="fold" data-fold aria-expanded="${!fold}" title="${fold ? "Show the legend" : "Hide the legend"}" aria-label="Legend"></button>${fold ? "" : `<p>${esc(scene.summary)}</p>`}</div>
      ${fold ? "" : `<div class="chips">${scene.classes.map((entry) => `<button class="chip ${hidden.has(String(entry.key)) ? "off" : ""}" data-class="${esc(entry.key)}" title="Show or hide"><i style="color:${esc(entry.color)}"></i>${esc(entry.label)} <small>${fmt(entry.count)}</small></button>`).join("")}</div>
      ${scene.kinds.length && !scene.flow ? `<div class="chips">${scene.kinds.map((kind, index) => `<button class="chip ${off.has(kind.kind) ? "off" : ""}" data-kind="${esc(kind.kind)}" title="Show or hide"><i class="line ${kind.dash ? "dash" : ""}" style="color:${esc(kind.color)}"></i>${esc(kind.kind)} <small>${fmt(counts.get(index) ?? 0)}</small></button>`).join("")}</div>` : ""}`}`;
    element.dataset.folded = String(fold);
  }
  $("#legend").addEventListener("click", (event) => {
    if (event.target.closest("[data-fold]")) {
      folded = $("#legend").dataset.folded !== "true";
      return legend();
    }
    const chip = event.target.closest(".chip");
    if (!chip) return undefined;
    if (chip.dataset.class !== undefined) set({ hide: toggled(state.hide, chip.dataset.class) });
    else set({ off: toggled(state.off, chip.dataset.kind) });
    return undefined;
  });

  // ------------------------------------------------------------- inspector
  /** Why a component is what it is, and why an object is in its component (src/app/architecture.js). */
  function whyHere(node) {
    const known = atlas.architecture;
    if (!known) return "";
    if (node.kind === "component") {
      const component = known.components[node.label];
      return component ? `<h3>Why this component</h3><ul class="why">${component.why.slice(0, 6).map((sentence) => `<li>${esc(sentence)}</li>`).join("")}</ul>` : "";
    }
    if (node.kind !== "object" || !node.component) return "";
    const [step, sentence] = known.placements[node.id] ?? [];
    if (!step) return "";
    return `<h3>Why in ${esc(node.component)}</h3><p class="about"><b>${esc(known.stepLabels[step] ?? step)}.</b> ${esc(sentence ?? known.steps[step] ?? "")}</p>`;
  }
  function inspector() {
    const element = $("#inspector");
    const index = state.sel && scene?.place.has(state.sel) ? scene.place.get(state.sel) : -1;
    element.hidden = index < 0;
    if (index < 0) return;
    const { node, at } = scene.entries[index];
    const findings = at >= 0 ? findingsOf.get(at) ?? [] : [];
    const facts = FACTS.filter(([key]) => node[key] !== undefined && node[key] !== "").map(([key, label]) => [label, node[key]]);
    if (node.level) facts.splice(3, 0, ["Visibility", `${node.level}${node.canBe ? `; can be ${node.canBe}` : ""}${node.why ? ` (${node.why})` : ""}`]);
    if (node.file) facts.push(["Source", `${node.file}${node.line ? `:${node.line}` : ""}`]);
    const out = new Map();
    const into = new Map();
    const off = list(state.off);
    for (const [from, to, kind] of scene.edges) {
      if (off.has(scene.kinds[kind].kind)) continue;
      if (from === index) (out.get(kind) ?? out.set(kind, []).get(kind)).push(to);
      if (to === index) (into.get(kind) ?? into.set(kind, []).get(kind)).push(from);
    }
    const rows = (groups, arrow) => [...groups].map(([kind, others]) => others.slice(0, 12).map((other) =>
      `<li><small>${arrow} ${esc(scene.kinds[kind].kind)}</small><button data-go="${esc(scene.entries[other].node.id)}">${esc(scene.entries[other].node.label)}</button></li>`).join("")
      + (others.length > 12 ? `<li><small>and ${fmt(others.length - 12)} more</small></li>` : "")).join("");
    const kind = node.kind === "object" || node.kind === "member" ? node.type : KIND_NAMES[node.kind] ?? node.kind;
    // A large export leaves out what is inside each object: there is nothing to open then.
    const canOpen = Boolean(S.into(atlas, node, state)?.inside) && (node.kind !== "object" || LIVE || Boolean(SNAPSHOT.inside?.[node.id]));
    // The same node from another side: the lenses it is in.
    const sides = at >= 0 ? S.lensesOf(atlas, found, node.id).filter(({ id }) => id !== state.lens || state.inside || state.focus) : [];
    element.innerHTML = `
      <header>
        <div style="flex:1;min-width:0"><div class="kind"><i style="background:${esc(scene.nodes[index].color)}"></i>${esc(kind)}${node.external ? " · other app" : ""}</div><h2>${esc(node.label)}</h2></div>
        <button class="close" data-close aria-label="Close" title="Close (Esc)">×</button>
      </header>
      ${node.about || node.caption ? `<p class="about">${rich(node.about ?? node.caption)}</p>` : ""}
      ${facts.length ? `<dl class="facts">${facts.map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`).join("")}</dl>` : ""}
      <div class="actions">
        ${canOpen ? `<button class="btn primary" data-act="inside" title="${node.kind === "object" ? "Its procedures and what each does" : "Its objects and what they do with each other"} (double click)">Open</button>` : ""}
        <button class="btn" data-act="focus">${state.focus === node.id ? "Show all" : "Neighbors"}</button>
        ${node.file ? `<button class="btn" data-act="source">${LIVE ? "Go to source" : "Source"}</button>` : ""}
        <button class="btn" data-act="link">Link</button>
        ${atlas.flows && (node.kind === "flow" || node.kind === "artifact") ? '<button class="btn" data-act="flow" title="Change it in the Flow menu">Change…</button>' : ""}
        ${atlas.simulation && SIM_NODES[node.kind] ? `<button class="btn" data-act="define" title="Change it in the simulation">${node.kind === "task" ? "Ground…" : "Define…"}</button>` : ""}
      </div>
      ${whyHere(node)}
      ${sides.length ? `<h3>See in</h3><div class="chips sides">${sides.map((lens) => `<button class="chip" data-side="${esc(lens.id)}" title="${esc(lens.summary)}">${esc(lens.title)}</button>`).join("")}</div>` : ""}
      ${findings.length ? `<h3>${plural(findings.length, "finding")}</h3>${findings.slice(0, 20).map((finding) => `<div class="finding ${esc(finding.severity)}"><b>${esc(finding.severity)} · ${esc(finding.rule)}</b><p>${rich(finding.message)}</p>${finding.fix ? `<p class="fix">${rich(finding.fix)}</p>` : ""}</div>`).join("")}` : ""}
      ${out.size ? `<h3>From here</h3><ul class="rows">${rows(out, "→")}</ul>` : ""}
      ${into.size ? `<h3>To here</h3><ul class="rows">${rows(into, "←")}</ul>` : ""}`;
  }
  $("#inspector").addEventListener("click", (event) => {
    const index = scene.place.get(state.sel);
    const entry = scene.entries[index];
    if (event.target.closest("[data-close]")) return set({ sel: "" });
    const go = event.target.closest("[data-go]")?.dataset.go;
    if (go) {
      set({ sel: go }).then(() => graph.center([scene.place.get(go)]));
      return undefined;
    }
    const side = event.target.closest("[data-side]")?.dataset.side;
    if (side) {
      // Another lens, the same node: it stays selected and in the middle.
      const id = entry.node.id;
      set({ lens: side, inside: "", focus: "", story: "", sel: id }).then(() => {
        if (scene.place.has(id)) graph.center([scene.place.get(id)]);
      });
      return undefined;
    }
    const act = event.target.closest("[data-act]")?.dataset.act;
    if (act === "inside") return open(entry);
    if (act === "focus") return set({ focus: state.focus === entry.node.id ? "" : entry.node.id, story: "" });
    if (act === "source") return source(entry.node);
    if (act === "link") return copyLink();
    if (act === "flow") {
      // flow::<id>, or artifact::<flow>::<step>.
      const [, flow, step] = entry.node.id.split("::");
      return flowEdit(flow, step ? Number(step) : undefined);
    }
    if (act === "define") {
      // The node of a person, a role, a requirement, or a process test, as the simulation names it.
      const kind = SIM_NODES[entry.node.kind];
      const name = entry.node.id.slice(entry.node.id.indexOf("::") + 2);
      return simulateEdit(kind, name);
    }
    return undefined;
  });

  function copyLink() {
    const link = LIVE ? stateHash() : `${location.href.split("#")[0]}${stateHash()}`;
    const done = () => toast(LIVE ? "Copied. Open it with \"BC Atlas: Open\"." : "Link to this view copied.");
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(link).then(done, () => toast(link));
    else toast(link);
  }

  // ----------------------------------------------------------------- story
  let playing;
  function stop() {
    clearTimeout(playing);
    playing = undefined;
  }
  function play(story) {
    stop();
    const step = story.steps[Number(state.step) || 0];
    // As long as it takes to read the step.
    playing = setTimeout(() => {
      const next = (Number(state.step) || 0) + 1;
      if (next >= story.steps.length) {
        stop();
        storyBar(story, step);
        return;
      }
      set({ step: String(next) }).then(() => play(story));
    }, Math.max(3500, Math.min(12000, 2200 + (step?.text.length ?? 0) * 42)));
  }
  function storyBar(story, step) {
    const element = $("#story");
    element.hidden = !step;
    $("#stage").classList.toggle("telling", Boolean(step));
    if (!step) return stop();
    const at = Math.min(Number(state.step) || 0, story.steps.length - 1);
    element.innerHTML = `
      <i class="progress" style="width:${((at + 1) / story.steps.length) * 100}%"></i>
      <div class="head"><h2>${esc(step.title)}</h2>${step.status ? `<span class="state ${esc(step.status)}">${esc(step.status)}</span>` : ""}<small>${at + 1} / ${story.steps.length}</small><button class="close" data-story="end" aria-label="End the story" title="End the story (Esc)">×</button></div>
      <p>${rich(step.text)}</p>
      <div class="controls">
        <button class="btn" data-story="previous" ${at ? "" : "disabled"} title="Previous step (←)">←</button>
        <button class="btn primary" data-story="play" title="Play or pause (Space)">${playing ? "Pause" : "Play"}</button>
        <button class="btn" data-story="next" ${at < story.steps.length - 1 ? "" : "disabled"} title="Next step (→)">→</button>
        <span class="title">${esc(story.title)}</span>
        <button class="btn" data-story="save" title="This story as a document">Markdown</button>
      </div>`;
    return undefined;
  }
  function storyAct(action) {
    const story = storyOf(state.story);
    if (!story) return undefined;
    const at = Number(state.step) || 0;
    if (action === "end") {
      stop();
      return set({ story: "", step: "0" });
    }
    if (action === "previous" && at > 0) {
      stop();
      return set({ step: String(at - 1) });
    }
    if (action === "next" && at < story.steps.length - 1) {
      stop();
      return set({ step: String(at + 1) });
    }
    if (action === "play") {
      if (playing) stop();
      else if (at >= story.steps.length - 1) return set({ step: "0" }).then(() => play(story)).then(render);
      else play(story);
      return render();
    }
    if (action === "save") return download(`${fileName(story.title)}.md`, S.storyMarkdown(atlas, story), "text/markdown");
    return undefined;
  }
  $("#story").addEventListener("click", (event) => {
    const action = event.target.closest("[data-story]")?.dataset.story;
    if (action) storyAct(action);
  });

  // ---------------------------------------------------------------- export
  const base = () => fileName(`${atlas.title} ${scene.title}`);
  const EXPORTS = [
    ["png", "Picture", "PNG, as you see it", async () => download(`${base()}.png`, new Uint8Array(await (await graph.image()).arrayBuffer()), "image/png")],
    ["svg", "Drawing", "SVG, as you see it", () => download(`${base()}.svg`, graph.svg(), "image/svg+xml")],
    ["json", "Graph", "JSON: nodes with their facts, and relations", () => download(`${base()}.json`, JSON.stringify(S.sceneData(atlas, found, scene, flags), null, 2), "application/json")],
    ["nodes", "Nodes", "CSV, one row per node", () => download(`${base()}-nodes.csv`, S.nodesCsv(found, scene, flags), "text/csv")],
    ["relations", "Relations", "CSV, one row per relation", () => download(`${base()}-relations.csv`, S.relationsCsv(scene, flags), "text/csv")],
    ["lens", "This lens", "Markdown: what shows, with its findings", () => download(`${base()}.md`, S.lensMarkdown(atlas, found, scene, flags), "text/markdown")],
    ["docs", "Documentation", "Markdown: every story of the system", () => download(`${fileName(atlas.title)}.md`, S.documentation(atlas), "text/markdown")],
    ["link", "Link", "To this view, as it is now", copyLink]
  ];

  // --------------------------------------------------------------- popover
  const MENUS = {
    // The lenses by what they answer; each in one line, its full text on hover.
    lens: () => {
      const sections = new Map();
      for (const lens of atlas.lenses) (sections.get(lens.section ?? "More") ?? sections.set(lens.section ?? "More", []).get(lens.section ?? "More")).push(lens);
      return [...sections].map(([section, lenses]) => `<h3>${esc(section)}</h3>${lenses.map((lens) =>
        `<button class="item line" role="menuitem" data-set-lens="${esc(lens.id)}" title="${esc(lens.summary)}" ${lens.id === state.lens && !state.inside ? 'aria-current="true"' : ""}><b>${esc(lens.title)}</b><small>${esc(lens.hint ?? lens.summary)}</small></button>`).join("")}`).join("");
    },
    story: () => `${atlas.stories.map((story) => `<button class="item" role="menuitem" data-set-story="${esc(story.id)}" ${story.id === state.story ? 'aria-current="true"' : ""}><b>${esc(story.title)}</b><span>${plural(story.steps.length, "step")}</span><small>${esc(story.summary)}</small></button>`).join("")}
      <hr><p class="text" style="color:var(--muted);font-size:12.5px">A story is generated from the source. It explains, documents, tests, or demonstrates the system on the graph, and saves as Markdown.</p>`,
    view: () => {
      const colors = [["", "As the lens does"], ["type", "Type"], ["component", "Component"], ["namespace", "Namespace"], ["app", "App"], ["level", "Visibility"], ["findings", "Findings"]];
      const groups = [["", "As the lens does"], ["component", "Component"], ["namespace", "Namespace"], ["app", "App"], ["kind", "Type"], ["none", "Nothing"]];
      const select = (name, options, value) => `<label class="field"><span>${name}</span><select data-view="${name.toLowerCase()}">${options.map(([key, label]) => `<option value="${key}" ${key === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>`;
      return `${select("Color", colors, state.color)}${select("Size", SIZES, state.size)}${select("Group", groups, state.group)}
        ${state.focus ? `<label class="field"><span>Depth</span><select data-view="depth">${[1, 2, 3].map((depth) => `<option ${String(depth) === state.depth ? "selected" : ""}>${depth}</option>`).join("")}</select></label>` : ""}
        <hr><div class="actions"><button class="btn" data-view-act="arrange">Arrange again</button><button class="btn" data-view-act="reset">Reset the view</button></div>`;
    },
    export: () => EXPORTS.map(([id, title, text]) => `<button class="item" role="menuitem" data-export="${id}"><b>${title}</b><small>${text}</small></button>`).join(""),
    sync: () => `
      <p class="text"><b>${LIVE ? "Live." : "A snapshot."}</b> ${LIVE
        ? "The graph follows the AL source of this workspace: save a file and it is read again."
        : `Read on ${esc(new Date(SNAPSHOT.generatedAt).toLocaleString())} with BC Atlas ${esc(atlas.version)}. Run <code>bca export</code> again to bring it up to date.`}</p>
      <p class="text" style="color:var(--muted)">The source code is the only fact. Everything you see is generated from it.</p>
      <h3>Read from</h3>
      <dl class="facts">${[["This lens", scene.lens.reads], ...atlas.sources].map(([name, value]) => `<dt>${esc(name)}</dt><dd>${rich(value)}</dd>`).join("")}</dl>
      ${LIVE ? `<div class="actions"><button class="btn" data-sync="refresh">Read the source again</button>${architectureAction()}</div>` : ""}`
  };
  // ----------------------------------------------------------- simulation
  // Simulate: who uses the app. The menu shows the company of the battle test and defines it:
  // every change is an operation (src/simulation/define.js). In VS Code it is applied to
  // .bca.json and the simulation runs again; an exported file collects the changes to save.
  const SIM_NODES = { person: "agent", role: "role", requirement: "requirement", task: "ground" };
  const SIM_KINDS = {
    agent: { title: "Agent", list: "agents", key: "name", lists: ["roles", "permissionSets", "taskGroups", "tasks", "mustNot"], texts: [] },
    role: { title: "Role", list: "roles", key: "name", lists: ["permissionSets", "taskGroups", "tasks", "mustNot"], texts: ["description"] },
    taskGroup: { title: "Task group", list: "taskGroups", key: "name", lists: ["tasks", "features"], texts: ["description"] },
    requirement: { title: "Requirement", list: "requirements", key: "id", lists: ["tasks", "features"], texts: ["title", "description"] }
  };
  const SIM_LABELS = { roles: "Roles", permissionSets: "Permission sets", taskGroups: "Task groups", tasks: "Process tests", features: "Features", mustNot: "Must not be able to do", title: "Title", description: "Description" };
  let simForm;
  const simChanges = [];
  const simOptions = (field) => {
    const { definition, tasks, permissionSets } = atlas.simulation;
    const names = (list) => (list ?? []).map(({ name }) => [name, name]);
    const tests = tasks.map(({ id, title }) => [id, title]);
    const features = [...new Set(tasks.flatMap((task) => task.features ?? []))].map((feature) => [feature, feature]);
    if (field === "roles") return names(definition.roles);
    if (field === "permissionSets") return permissionSets.map((name) => [name, name]);
    if (field === "taskGroups") return names(definition.taskGroups);
    if (field === "tasks") return tests;
    if (field === "features") return features;
    return [...tests, ...names(definition.taskGroups).map(([name]) => [name, `${name} (task group)`])];
  };
  const simEntry = (kind, name) => (atlas.simulation.definition[SIM_KINDS[kind].list] ?? []).find((entry) => entry[SIM_KINDS[kind].key] === name);
  function simulateForm() {
    if (simForm.kind === "ground") {
      const { tasks, recordings, definition } = atlas.simulation;
      const grounded = definition.grounding?.[simForm.name] ?? "";
      return `<h3>Ground a process test</h3>
        <p class="text" style="color:var(--muted);font-size:12.5px">A recording of Business Central says what really ran. The process test stands on it; where they differ is a finding.</p>
        <label class="field"><span>Test</span><select data-f="task">${tasks.map(({ id, title }) => `<option value="${esc(id)}" ${id === simForm.name ? "selected" : ""}>${esc(title)}</option>`).join("")}</select></label>
        <label class="field"><span>Recording</span><select data-f="snapshot"><option value="">None, or the one with the same title</option>${recordings.map(({ id, label }) => `<option value="${esc(id)}" ${id === grounded ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></label>
        ${recordings.length ? "" : '<p class="text" style="color:var(--muted);font-size:12.5px">The project has no recordings yet. Record a process in Business Central and sync it with <code>bca sync run</code>.</p>'}
        <hr><div class="actions"><button class="btn primary" data-sim="apply">Apply</button><button class="btn" data-sim="back">Back</button></div>`;
    }
    const kind = SIM_KINDS[simForm.kind];
    const entry = simForm.name ? simEntry(simForm.kind, simForm.name) ?? {} : {};
    const checks = (field) => {
      const chosen = new Set(entry[field] ?? []);
      const options = simOptions(field);
      for (const value of chosen) if (!options.some(([key]) => key === value)) options.push([value, value]);
      return options.length ? `<fieldset class="checks"><legend>${SIM_LABELS[field]}</legend>${options.map(([value, label]) => `<label><input type="checkbox" data-f="${field}" value="${esc(value)}" ${chosen.has(value) ? "checked" : ""}>${esc(label)}${label !== value ? ` <small>${esc(value)}</small>` : ""}</label>`).join("")}</fieldset>` : "";
    };
    return `<h3>${simForm.name ? `${kind.title} ${esc(simForm.name)}` : `New ${kind.title.toLowerCase()}`}</h3>
      <label class="field"><span>${kind.key === "id" ? "ID" : "Name"}</span><input type="text" data-f="name" value="${esc(simForm.name ?? "")}" ${simForm.name ? "readonly" : ""} autocomplete="off" spellcheck="false"></label>
      ${kind.texts.map((field) => `<label class="field"><span>${SIM_LABELS[field]}</span><input type="text" data-f="${field}" value="${esc(entry[field] ?? "")}" autocomplete="off"></label>`).join("")}
      ${kind.lists.map(checks).join("")}
      <hr><div class="actions"><button class="btn primary" data-sim="apply">Apply</button>${simForm.name && simEntry(simForm.kind, simForm.name) ? '<button class="btn" data-sim="remove">Remove</button>' : ""}<button class="btn" data-sim="back">Back</button></div>`;
  }
  const runsOf = () => atlas.stories.filter(({ kind }) => kind === "run");
  // ------------------------------------------------------------ architecture
  // Why the components are what they are, how well the architecture meets the goals of the
  // template in use, and the architecture as it is next to the one it should be. In VS Code
  // the weights and the template can be changed and the comparison is made again; a snapshot
  // shows what it was exported with.
  let archPage = "goals";
  let archCompare;
  let archWeights;
  const archBar = (value) => `<span class="meter" aria-hidden="true"><i style="width:${Math.round(Math.max(0, Math.min(1, value)) * 100)}%"></i></span>`;
  const archSigned = (value) => (Math.abs(value) < 0.005 ? "=" : `${value > 0 ? "+" : ""}${value.toFixed(2)}`);
  function archCompareHtml() {
    const known = atlas.architecture;
    const result = archCompare ?? known.compare;
    const weights = archWeights ?? known.goals.weights;
    const side = (name, chosen) => `<select data-arch-side="${name}">${["structure", "configured", "proposal", "best"].map((kind) => `<option value="${kind}" ${kind === chosen ? "selected" : ""}>${esc({ structure: "The structure of the source today", configured: "What .bca.json configures", proposal: "The proposal", best: "The best of several proposals" }[kind])}</option>`).join("")}</select>`;
    return `<h3>Current and target architecture</h3>
      ${LIVE ? `<label class="field wide"><span>Current</span>${side("from", result?.from ?? "structure")}</label>
      <label class="field wide"><span>Target</span>${side("to", result?.to ?? (known.mode === "configured" ? "configured" : "best"))}</label>
      <h3>What counts, and how much</h3><div class="weights">${known.criteria.map(({ id, title, meaning }) => `<label title="${esc(meaning)}"><span>${esc(title)}</span><input type="number" min="0" max="20" step="1" data-arch-weight="${esc(id)}" value="${esc(weights[id] ?? 0)}"></label>`).join("")}</div>
      <div class="actions"><button class="btn primary" data-arch="compare">Compare</button><button class="btn" data-arch="reset" title="The weights of the template in use">Reset the weights</button></div>` : muted("This file shows the comparison it was exported with. In VS Code, or with <code>bca architecture compare</code>, you choose the states and the weights.")}
      ${result ? `<hr><p class="text"><b>${esc(result.current.title)}</b> scores <b>${result.summary.current.toFixed(1)}</b>; <b>${esc(result.target.title)}</b> scores <b>${result.summary.target.toFixed(1)}</b> of 100. ${result.summary.moves ? `${plural(result.summary.moves, "object")} of ${fmt(result.summary.objects)} would move (${Math.round(result.summary.distance * 100)}%).` : "No object has to move."}</p>
      <table class="compare"><thead><tr><th>Goal</th><th title="Weight">W</th><th>Is</th><th>Target</th><th></th></tr></thead><tbody>${result.criteria.filter(({ weight }) => weight > 0).map((row) => `<tr title="${esc(row.why ?? "")}"><td>${esc(row.title)}</td><td>${esc(row.weight)}</td><td>${row.current.toFixed(2)}</td><td>${row.target.toFixed(2)}</td><td class="${row.delta > 0.005 ? "up" : row.delta < -0.005 ? "down" : ""}">${archSigned(row.delta)}</td></tr>`).join("")}</tbody></table>
      ${result.candidates?.length ? `<h3>Proposals that competed</h3><ul class="pending">${result.candidates.map((candidate) => `<li>${candidate.chosen ? "<b>" : ""}${esc(candidate.label)}: ${candidate.error ? esc(candidate.error) : `${candidate.total.toFixed(1)}, ${plural(candidate.components, "component")}`}${candidate.chosen ? "</b> (chosen)" : ""}</li>`).join("")}</ul>` : ""}
      <h3>Components of the target</h3><ul class="pending">${result.mapping.slice(0, 30).map((entry) => `<li><b>${esc(entry.target)}</b> (${fmt(entry.objects)}): ${esc(entry.status)}${entry.status === "same" ? "" : ` from ${esc(entry.from.map(({ component, objects }) => `${component} (${objects})`).join(", ") || "nothing of today")}`}</li>`).join("")}</ul>
      <h3>Steps</h3><ol class="steps">${result.steps.map((step) => `<li><b>${esc(step.title)}</b><p>${esc(step.why)}</p>${step.commands.slice(0, 6).map((command) => `<button class="command" data-arch-copy="${esc(command)}" title="Copy the command">${esc(command)}</button>`).join("")}${step.commands.length > 6 ? `<small>and ${step.commands.length - 6} more</small>` : ""}</li>`).join("")}</ol>
      ${LIVE && result.to !== "configured" ? `<div class="actions"><button class="btn" data-arch="adopt" title="Write the components of the target to .bca.json: what bca check enforces from then on">Make the target the architecture…</button></div>` : ""}` : LIVE ? muted("Choose the two states and compare.") : ""}
      <hr><div class="actions"><button class="btn" data-arch="page" data-page="goals">Back</button></div>`;
  }
  MENUS.architecture = () => {
    const known = atlas.architecture;
    if (!known) return muted("The architecture was not read.");
    if (archPage === "compare") return archCompareHtml();
    const { template, score, templates, mode } = known;
    const components = Object.entries(known.components);
    return `<p class="text"><b>${mode === "proposal" ? "A proposal" : "The architecture of .bca.json"}</b>: ${plural(components.length, "component")}. It meets the goals of the template <b>${esc(template.title ?? template.name)}</b> with <b>${score.total.toFixed(1)}</b> of 100.</p>
      <h3>Goals</h3><table class="compare">${score.criteria.filter(({ weight }) => weight > 0).map((row) => `<tr title="${esc(row.why ?? "")}"><td>${esc(row.title)}</td><td>${archBar(row.score)}</td><td>${row.score.toFixed(2)}</td><td title="Weight">×${esc(row.weight)}</td></tr>`).join("")}</table>
      <div class="actions"><button class="btn primary" data-arch="page" data-page="compare">Current and target…</button></div>
      <h3>Template</h3>
      ${LIVE ? `<label class="field wide" title="What a good architecture is here, and how much each goal weighs"><span>In use</span><select data-arch-template>${templates.map((item) => `<option value="${esc(item.name)}" ${item.active ? "selected" : ""} ${item.error ? "disabled" : ""} title="${esc(item.summary ?? item.error ?? "")}">${esc(item.title ?? item.name)}${item.origin === "preset" ? "" : " (yours)"}</option>`).join("")}</select></label>` : ""}
      ${muted(esc(template.summary ?? ""))}
      ${LIVE ? `<label class="field wide" title="Saves the template in use with the weights of the comparison as a template of your own, and takes it into use"><span>Save as</span><input type="text" data-arch-name placeholder="our-way" autocomplete="off" spellcheck="false"></label>
      <div class="actions"><button class="btn" data-arch="save">Save as a template</button>${templates.find(({ active }) => active)?.origin === "preset" ? "" : '<button class="btn" data-arch="remove">Remove this template</button>'}</div>` : ""}
      <h3>Why these components</h3>${components.map(([name, component]) => `<button class="item" role="menuitem" data-arch-component="${esc(name)}"><b>${esc(name)}</b><span>${fmt(component.objects)}</span><small>${esc(component.why[0] ?? "")}</small></button>`).join("")}
      <hr>${muted(LIVE ? "A template and the architecture are written to <code>.bca.json</code>. Select a component or an object in the graph to see why it is where it is." : "The same from a terminal or an agent: <code>bca architecture --explain</code>, <code>bca architecture compare</code>, <code>bca architecture templates</code>, and the MCP tools <code>bc_atlas_architecture_*</code>.")}`;
  };
  const archRedraw = () => { $("#popover").innerHTML = MENUS.architecture(); };
  const archValues = () => ({
    from: $('#popover [data-arch-side="from"]')?.value,
    to: $('#popover [data-arch-side="to"]')?.value,
    ...(archWeights ? { weights: archWeights } : {})
  });
  async function archClick(item) {
    if (item.dataset.archCopy) return navigator.clipboard?.writeText(item.dataset.archCopy).then(() => toast(`Copied: ${item.dataset.archCopy}`), () => toast(item.dataset.archCopy)) ?? toast(item.dataset.archCopy);
    if (item.dataset.archComponent) {
      // The component in the graph, selected: its inspector says why it is what it is.
      closeMenu();
      const id = `component::${item.dataset.archComponent}`;
      await set({ lens: "components", inside: "", focus: "", story: "", sel: id });
      if (scene.place.has(id)) graph.center([scene.place.get(id)]);
      return undefined;
    }
    const act = item.dataset.arch;
    if (act === "page") {
      archPage = item.dataset.page;
      return archRedraw();
    }
    if (act === "reset") {
      archWeights = undefined;
      archCompare = undefined;
      return archRedraw();
    }
    try {
      if (act === "compare") {
        archWeights = Object.fromEntries($$("#popover [data-arch-weight]").map((input) => [input.dataset.archWeight, Math.max(0, Number(input.value) || 0)]));
        const values = archValues();
        item.textContent = "Comparing…";
        archCompare = await call("compareArchitecture", values);
        return archRedraw();
      }
      if (act === "adopt") {
        // Asked twice before .bca.json gets the components.
        if (item.textContent !== "Write the target to .bca.json") {
          item.textContent = "Write the target to .bca.json";
          item.classList.add("primary");
          return undefined;
        }
        const written = await call("adoptTarget", archValues());
        closeMenu();
        archCompare = undefined;
        toast(`Wrote ${plural(written.components, "component")} to ${String(written.file).split(/[\\/]/u).pop()}.`);
        return reload("Reading the architecture");
      }
      if (act === "save" || act === "remove") {
        const name = act === "save" ? $("#popover [data-arch-name]").value.trim().toLowerCase() : atlas.architecture.template.name;
        if (act === "save" && !/^[a-z0-9][a-z0-9._-]*$/u.test(name)) return toast("A template needs a name of lowercase letters, digits, \".\", \"_\", or \"-\".");
        if (act === "remove" && item.textContent !== "Remove it") {
          item.textContent = "Remove it";
          item.classList.add("primary");
          return undefined;
        }
        const written = await call("architectureTemplate", { action: act, name, values: archWeights ? { weights: archWeights } : {} });
        closeMenu();
        archWeights = undefined;
        archCompare = undefined;
        toast(act === "save" ? `Saved the template ${written.name}; it is in use.` : `Removed the template ${written.name}.`);
        return reload("Reading the architecture");
      }
    } catch (error) {
      toast(error.message);
      archRedraw();
    }
    return undefined;
  }
  $("#popover").addEventListener("change", async (event) => {
    if (event.target.dataset.archTemplate === undefined) return;
    try {
      const written = await call("architectureTemplate", { action: "use", name: event.target.value });
      closeMenu();
      archWeights = undefined;
      archCompare = undefined;
      toast(`The template ${written.name} is in use.`);
      await reload("Reading the architecture");
    } catch (error) {
      toast(error.message);
    }
  });

  MENUS.simulate = () => {
    if (simForm) return simulateForm();
    const { definition, derived } = atlas.simulation;
    const battle = atlas.summary.battle ?? {};
    const people = atlas.nodes.filter((node) => node.kind === "person");
    const stopped = people.filter((node) => (findingsOf.get(position.get(node.id)) ?? []).some(({ severity }) => severity === "error")).length;
    // What the simulation found, the most severe first: each leads to the person or the process test it is about.
    const problems = atlas.findings.filter(({ origin, severity, nodes }) => origin === "battle test" && severity !== "info" && nodes.length)
      .sort((a, b) => (a.severity === "error" ? 0 : 1) - (b.severity === "error" ? 0 : 1));
    const items = (kind) => (definition[SIM_KINDS[kind].list] ?? []).map((entry) => {
      const name = entry[SIM_KINDS[kind].key];
      const detail = kind === "agent" ? (entry.roles ?? []).join(", ") : kind === "role" ? (entry.permissionSets ?? []).join(", ") : kind === "requirement" ? entry.title : plural((entry.tasks ?? entry.features ?? []).length, kind === "taskGroup" && !entry.tasks ? "feature" : "process test");
      return `<button class="item" role="menuitem" data-sim-edit="${kind}" data-name="${esc(name)}"><b>${esc(name)}</b><small>${esc(detail ?? "")}</small></button>`;
    }).join("");
    return `<p class="text"><b>${esc(definition.company ?? battle.company ?? "The company")}</b>${derived ? ", as the process tests describe it. Nothing is defined yet: the first change starts from this." : ", as <code>.bca.json</code> defines it."}
        ${plural(people.length, "agent")}, ${stopped ? `${stopped} stopped or able to do what they must not` : "all get through"}.</p>
      ${problems.length ? `<h3>${battle.passed ? "To look at" : "What stops it"}</h3>${problems.slice(0, 6).map((finding) => `<button class="item" role="menuitem" data-sim-go="${esc(atlas.nodes[finding.nodes[0]]?.id ?? "")}"><b>${esc(finding.severity)} · ${esc(finding.rule)}</b><small>${esc(finding.message)}${finding.fix ? ` ${esc(finding.fix)}` : ""}</small></button>`).join("")}${problems.length > 6 ? `<p class="text" style="color:var(--muted);font-size:12.5px">and ${problems.length - 6} more: turn on Check.</p>` : ""}` : ""}
      ${runsOf().length ? `<h3>Run, step by step</h3>${runsOf().map((story) => `<button class="item" role="menuitem" data-sim-run="${esc(story.id)}" ${story.id === state.story ? 'aria-current="true"' : ""}><b>▶ ${esc(story.title)}</b><span>${plural(story.steps.length, "step")}</span><small>${esc(story.summary)}</small></button>`).join("")}` : ""}
      ${derived && LIVE ? '<div class="actions"><button class="btn primary" data-sim="init" title="Writes the roles the process tests name into .bca.json, as the start of your own company">Start from the process tests</button></div>' : ""}
      <button class="item" role="menuitem" data-sim="show" ${state.lens === "simulation" && !state.inside ? 'aria-current="true"' : ""}><b>Show the simulation</b><small>People and roles, the process tests each does or must not do, the recordings they stand on, the requirements they prove</small></button>
      <h3>Agents</h3>${items("agent")}
      <h3>Roles</h3>${items("role")}
      ${definition.taskGroups?.length ? `<h3>Task groups</h3>${items("taskGroup")}` : ""}
      ${definition.requirements?.length ? `<h3>Requirements</h3>${items("requirement")}` : ""}
      <hr><h3>Define</h3>
      <div class="actions"><button class="btn" data-sim-new="agent">Agent…</button><button class="btn" data-sim-new="role">Role…</button><button class="btn" data-sim-new="taskGroup">Task group…</button><button class="btn" data-sim-new="requirement">Requirement…</button><button class="btn" data-sim-new="ground">Ground…</button></div>
      ${simChanges.length ? `<hr><h3>${plural(simChanges.length, "change")} to save</h3><ul class="pending">${simChanges.map((operation) => `<li>${esc(operation.op)} ${esc(operation.kind ?? "")} ${esc(operation.name ?? operation.task ?? "")}</li>`).join("")}</ul>
        <div class="actions"><button class="btn primary" data-sim="save">Save the changes (JSON)</button><button class="btn" data-sim="forget">Forget them</button></div>
        <p class="text" style="color:var(--muted);font-size:12.5px">This file is a snapshot. Apply the changes to the project with <code>bca simulate define --from simulation-changes.json</code>.</p>` : ""}
      <hr><h3>Build</h3>
      ${LIVE ? '<div class="actions"><button class="btn" data-sim="bundle" title="Validation, the simulation with its runs and snapshots, the documentation, and the view, as one folder and one ZIP file">Build the bundle</button></div>'
    : '<p class="text" style="color:var(--muted);font-size:12.5px">Everything the simulation shows as one artifact: <code>bca bundle</code>.</p>'}
      <hr><p class="text" style="color:var(--muted);font-size:12.5px">${LIVE ? "A change is written to <code>.bca.json</code> and the simulation runs again." : "The same from a terminal or an agent: <code>bca simulate define</code>, or the MCP tool <code>bc_atlas_simulation_define</code>."}</p>`;
  };
  /** Opens the Simulate menu on the form of one thing: from the menu, or from the card of a node. */
  function simulateEdit(kind, name) {
    closeMenu();
    simForm = { kind, name };
    showMenu($("#simulate-button"));
  }
  /** Sends one operation: applied and run again in VS Code, kept to save in an exported file. */
  async function simulateApply(operation) {
    simForm = undefined;
    closeMenu();
    if (!LIVE) {
      simChanges.push(operation);
      toast(`Kept: ${operation.op} ${operation.kind ?? ""} ${operation.name ?? operation.task ?? ""}. Save the changes from the Simulate menu.`);
      return;
    }
    try {
      const result = await call("defineSimulation", { operations: [operation] });
      toast(result.written ? `Wrote ${String(result.file).split(/[\\/]/u).pop()}. ${result.line}` : "Nothing changed.");
      await reload("Running the simulation");
    } catch (error) {
      toast(error.message);
    }
  }
  function simulateClick(item) {
    if (item.dataset.sim === "show") {
      closeMenu();
      return set({ lens: "simulation", form: "diagram", inside: "", focus: "", story: "", hide: "", off: "" });
    }
    if (item.dataset.simEdit || item.dataset.simNew) {
      simForm = { kind: item.dataset.simEdit ?? item.dataset.simNew, name: item.dataset.name };
      if (simForm.kind === "ground") simForm.name = atlas.simulation.tasks[0]?.id;
      $("#popover").innerHTML = MENUS.simulate();
      return $("#popover").querySelector("input:not([readonly]), select")?.focus({ preventScroll: true });
    }
    if (item.dataset.simRun) {
      // A run plays on the canvas of the simulation and builds its picture step by step.
      const story = storyOf(item.dataset.simRun);
      closeMenu();
      stop();
      return set({ story: story.id, step: "0", q: "", form: "diagram", sel: "", hide: "", off: "" }).then(() => play(story));
    }
    if (item.dataset.sim === "bundle") {
      closeMenu();
      toast("Building the bundle…");
      return call("bundle").then((result) => toast(`${result.passed ? "Everything passed." : "Not everything passed."} Wrote ${result.folder} and ${result.folder}.zip.`), (error) => toast(error.message));
    }
    if (item.dataset.simGo) {
      // To what a finding is about, on the canvas of the simulation.
      const id = item.dataset.simGo;
      closeMenu();
      return set({ lens: "simulation", form: "diagram", inside: "", focus: "", story: "", hide: "", off: "", sel: id, check: "1" }).then(() => {
        if (scene.place.has(id)) graph.center([scene.place.get(id)]);
      });
    }
    if (item.dataset.sim === "init") {
      simForm = undefined;
      closeMenu();
      return call("defineSimulation", { init: true }).then((result) => {
        toast(result.written ? `Wrote ${String(result.file).split(/[\\/]/u).pop()}: the company of the process tests is yours to change.` : "Nothing changed.");
        return reload("Running the simulation");
      }, (error) => toast(error.message));
    }
    if (item.dataset.sim === "back") {
      simForm = undefined;
      $("#popover").innerHTML = MENUS.simulate();
      return undefined;
    }
    if (item.dataset.sim === "forget") {
      simChanges.length = 0;
      $("#popover").innerHTML = MENUS.simulate();
      return undefined;
    }
    if (item.dataset.sim === "save") {
      closeMenu();
      return download("simulation-changes.json", `${JSON.stringify({ operations: simChanges }, null, 2)}\n`, "application/json");
    }
    const value = (field) => $(`#popover [data-f="${field}"]`)?.value.trim() ?? "";
    if (simForm.kind === "ground") {
      return simulateApply(value("snapshot") ? { op: "ground", task: value("task"), snapshot: value("snapshot") } : { op: "unground", task: value("task") });
    }
    const name = value("name");
    if (!name) return toast("It needs a name.");
    if (item.dataset.sim === "remove") return simulateApply({ op: "remove", kind: simForm.kind, name });
    const kind = SIM_KINDS[simForm.kind];
    const operation = { op: "set", kind: simForm.kind, name };
    for (const field of kind.texts) operation[field] = value(field);
    for (const field of kind.lists) {
      if ($(`#popover [data-f="${field}"]`)) operation[field] = $$(`#popover [data-f="${field}"]:checked`).map((box) => box.value);
    }
    if (simForm.kind === "requirement" && !operation.title) return toast("A requirement needs a title.");
    return simulateApply(operation);
  }

  // ------------------------------------------------------------------ flows
  // Flow: your own workflows. The menu builds them: a flow, the triggers it runs on, and its
  // steps, each an artifact made from the source and the place it is saved to. Every change is
  // an operation (src/flows/config.js). In VS Code it is written to .bca.json; an exported file
  // collects the changes to save.
  let flowForm;
  const flowChanges = [];
  const flowOf = (id) => atlas.flows.flows.find((flow) => flow.id === id);
  const artifactOf = (id) => atlas.flows.artifacts.find((artifact) => artifact.id === id);
  const flowIdOf = (title) => title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9._]+/gu, "-").replace(/^[-._]+|-+$/gu, "") || "flow";
  const stepLine = (step) => {
    const { what, to, id: _id, after: _after, ...options } = step;
    const detail = Object.entries(options).map(([key, value]) => `${key}=${value}`).join(", ");
    const waits = [step.after ?? []].flat().map((wire) => (typeof wire === "string" ? wire.replace(":", " if ") : `${wire.step}${wire.if && wire.if !== "passed" ? ` if ${wire.if}` : ""}`)).join(", ");
    return `${to ? `→ ${to}` : artifactOf(what)?.plugin ? "task of a plugin" : "gate: it only passes or fails"}${detail ? ` · ${detail}` : ""}${waits ? ` · after ${waits}` : ""}`;
  };
  const describeOperation = (operation) => [operation.op, operation.flow ?? operation.trigger ?? operation.name, operation.what, operation.at ? `step ${operation.at}` : "", operation.to ? `→ ${operation.to}` : "", operation.sync].filter(Boolean).join(" ");
  const muted = (text) => `<p class="text" style="color:var(--muted);font-size:12.5px">${text}</p>`;
  function flowStepForm() {
    const flow = flowOf(flowForm.flow);
    const existing = typeof flowForm.step === "number" ? flow.steps[flowForm.step - 1] : undefined;
    const what = flowForm.what ?? existing?.what ?? "layers";
    const artifact = artifactOf(what);
    const same = existing?.what === what ? existing : {};
    const waits = existing ? [existing.after ?? []].flat().map((wire) => (typeof wire === "string" ? wire.replace(":", " if ") : `${wire.step}${wire.if && wire.if !== "passed" ? ` if ${wire.if}` : ""}`)) : [];
    const field = (option) => {
      const value = String(same[option.name] ?? "");
      return `<label class="field wide" title="${esc(option.hint ?? "")}"><span>${esc(option.title)}</span>${option.values
        ? `<select data-o="${esc(option.name)}"><option value="">Default</option>${option.values.map((item) => `<option ${item === value ? "selected" : ""}>${esc(item)}</option>`).join("")}</select>`
        : `<input type="text" data-o="${esc(option.name)}" value="${esc(value)}" placeholder="${esc(option.hint ?? "")}" autocomplete="off" spellcheck="false">`}</label>`;
    };
    const lensOptions = what === "view" ? `<datalist id="flow-lenses">${atlas.lenses.map((lens) => `<option value="${esc(lens.id)}">${esc(lens.title)}</option>`).join("")}</datalist><datalist id="flow-stories">${atlas.stories.filter(({ kind }) => kind !== "run").map((story) => `<option value="${esc(story.id)}">${esc(story.title)}</option>`).join("")}</datalist>` : "";
    return `<h3>${existing ? `Step ${flowForm.step} of ${esc(flow.title)}` : `New step of ${esc(flow.title)}`}</h3>
      <label class="field wide"><span>Make</span><select data-flow-what>${atlas.flows.artifacts.map((item) => `<option value="${esc(item.id)}" ${item.id === what ? "selected" : ""}>${esc(item.title)}</option>`).join("")}</select></label>
      ${muted(`${esc(artifact.summary)}.${artifact.stable === false ? " It differs on every run, so it is not for a trigger that verifies." : ""}`)}
      ${artifact.plugin ? muted("A task of a plugin saves where its own section of <code>.bca.json</code> says.") : `<label class="field wide" title="Relative to the project"><span>Save to</span><input type="text" data-f="to" value="${esc(same.to ?? "")}" placeholder="${esc(artifact.to ?? "nowhere: only pass or fail")}" autocomplete="off" spellcheck="false"></label>
      ${muted(artifact.target === "folder" ? "A folder of the project." : `One file: ${artifact.extensions.map((item) => `.${esc(item)}`).join(", ")}.${artifact.optional ? " Without a place it only passes or fails." : ""}`)}`}
      ${artifact.options.map(field).join("").replace('data-o="lens"', 'data-o="lens" list="flow-lenses"').replace('data-o="story"', 'data-o="story" list="flow-stories"').replace('data-o="profile"', 'data-o="profile" list="flow-profiles"')}${lensOptions}${what === "layers" ? `<datalist id="flow-profiles">${(atlas.flows.profiles ?? []).map((name) => `<option value="${esc(name)}"></option>`).join("")}</datalist>${muted(`A profile says which pages and sections are written, for which part of the system, in which language, and from which templates: <code>layers.profiles</code> in <code>.bca.json</code>.${(atlas.flows.profiles ?? []).length ? "" : " There is none yet."}`)}` : ""}
      <label class="field wide" title="Other steps can come after it by this name"><span>Name</span><input type="text" data-f="id" value="${esc(existing?.id ?? "")}" placeholder="none: nothing waits for it" autocomplete="off" spellcheck="false"></label>
      ${existing ? muted(waits.length ? `Comes after ${esc(waits.join(", "))}. Wire it on the canvas of the builder.` : "Starts with the flow. To let it wait for another step, wire it on the canvas of the builder.") : ""}
      <hr><div class="actions"><button class="btn primary" data-flow-act="step-apply">Apply</button>${existing ? '<button class="btn" data-flow-act="step-remove">Remove</button>' : ""}<button class="btn" data-flow-act="step-back">Back</button></div>`;
  }
  /** The form of a trigger: what starts one of your own, and how any trigger delivers what was saved. */
  function triggerFormHtml() {
    const { triggers, syncModes, events = {}, hooks = [] } = atlas.flows;
    const name = flowForm.trigger;
    const trigger = triggers[name];
    const own = !trigger || trigger.custom;
    const listed = (key) => esc((trigger?.[key] ?? []).join(", "));
    const modes = trigger?.modes ?? Object.keys(syncModes);
    const users = trigger ? atlas.flows.flows.filter(({ when }) => when.includes(name)) : [];
    const text = (key, title, hint, value) => `<label class="field wide" title="${esc(hint)}"><span>${esc(title)}</span><input type="text" data-f="${key}" value="${value}" placeholder="${esc(hint)}" autocomplete="off" spellcheck="false"></label>`;
    return `<h3>${trigger ? `Trigger ${esc(name)}` : "New trigger"}</h3>
      ${trigger ? muted(`${esc(trigger.summary)}.${users.length ? ` It starts ${esc(users.map(({ title }) => title).join(", "))}.` : " No flow runs on it yet: pull a wire from it into a flow."}`) : muted("A trigger of your own says what starts it. Flows run on it like on a built-in one.")}
      ${trigger ? "" : text("name", "Name", "release", "")}
      ${own ? `${text("title", "What it is", "A release tag", esc(trigger?.title ?? ""))}
      <fieldset class="checks" style="max-height:none"><legend>Started in a pipeline by</legend>${Object.entries(events).map(([event, summary]) => `<label title="${esc(summary)}"><input type="checkbox" data-f="on" value="${esc(event)}" ${trigger?.on?.includes(event) ? "checked" : ""}>${esc(event)} <small>${esc(summary)}</small></label>`).join("")}</fieldset>
      ${text("branches", "Only these branches", "main, release/*", listed("branches"))}
      ${text("paths", "Only when these changed", "src/**/*.al", listed("paths"))}
      ${text("tags", "Only these tags", "v*", listed("tags"))}
      ${text("cron", "Or on a schedule (cron)", "0 2 * * *", esc(trigger?.cron ?? ""))}
      <label class="field wide" title="Instead of a pipeline: a Git hook on the machine of each developer. bca setup apply --from-config installs it"><span>Or as a Git hook</span><select data-f="hook"><option value="">No hook</option>${hooks.map((hook) => `<option ${trigger?.hook === hook ? "selected" : ""}>${esc(hook)}</option>`).join("")}</select></label>
      ${muted("With none of these, only its name starts it: <code>bca run --trigger &lt;name&gt;</code>, from a script of yours.")}`
    : name === "schedule" ? text("cron", "Schedule (cron)", "0 6 * * 1", esc(trigger.cron ?? "")) : ""}
      <label class="field wide" title="What happens to what the flows of this trigger saved"><span>Delivery</span><select data-f="sync">${modes.map((mode) => `<option value="${esc(mode)}" ${mode === (trigger?.sync ?? "none") ? "selected" : ""} title="${esc(syncModes[mode])}">${esc(mode)}: ${esc(syncModes[mode])}</option>`).join("")}</select></label>
      ${own ? muted("A Git hook delivers with none, verify, or stage; a pipeline with none, verify, artifact, pull-request, or commit.") : ""}
      <hr><div class="actions"><button class="btn primary" data-flow-act="trigger-apply">Apply</button>${trigger?.custom ? '<button class="btn" data-flow-act="trigger-remove">Remove</button>' : ""}<button class="btn" data-flow-act="back">Back</button></div>`;
  }
  function flowFormHtml() {
    if (flowForm.trigger !== undefined) return triggerFormHtml();
    if (flowForm.step !== undefined) return flowStepForm();
    const flow = flowForm.flow ? flowOf(flowForm.flow) : undefined;
    const { triggers, syncModes } = atlas.flows;
    const chosen = new Set(flow?.when ?? []);
    return `<h3>${flow ? `Flow ${esc(flow.id)}` : "New flow"}</h3>
      <label class="field"><span>Title</span><input type="text" data-f="title" value="${esc(flow?.title ?? "")}" placeholder="Documentation in the repository" autocomplete="off"></label>
      <fieldset class="checks"><legend>When: the triggers it runs on</legend>${Object.entries(triggers).map(([name, trigger]) => `<label title="${esc(trigger.summary)}"><input type="checkbox" data-f="when" value="${esc(name)}" ${chosen.has(name) ? "checked" : ""}>${esc(name)} <small>${esc(trigger.summary)}</small></label>`).join("")}</fieldset>
      ${flow ? `<h3>What it makes, and where it is saved</h3>${flow.steps.map((step, index) => `<div class="step"><button class="item" role="menuitem" data-flow-act="step" data-at="${index + 1}"><b>${index + 1}. ${esc(artifactOf(step.what)?.title ?? step.what)}</b><small>${esc(stepLine(step))}</small></button><button class="mini" data-flow-act="up" data-at="${index + 1}" title="Earlier" aria-label="Move step ${index + 1} up" ${index ? "" : "disabled"}>↑</button><button class="mini" data-flow-act="down" data-at="${index + 1}" title="Later" aria-label="Move step ${index + 1} down" ${index + 1 < flow.steps.length ? "" : "disabled"}>↓</button></div>`).join("") || muted("No steps yet.")}
      <div class="actions"><button class="btn" data-flow-act="step" data-at="new">Add a step…</button></div>
      ${flow.when.length ? `<h3>Delivery: what happens to what was saved</h3>${flow.when.map((name) => `<label class="field wide" title="${esc(syncModes[triggers[name].sync])}"><span>${esc(name)}</span><select data-deliver="${esc(name)}">${triggers[name].modes.map((mode) => `<option value="${esc(mode)}" ${mode === triggers[name].sync ? "selected" : ""} title="${esc(syncModes[mode])}">${esc(mode)}: ${esc(syncModes[mode])}</option>`).join("")}</select></label>`).join("")}
      ${flow.when.some((name) => name !== "manual" && !triggers[name].configured) ? muted("Nothing calls some of these triggers yet: <code>bca setup</code> installs the Git hook or the pipeline.") : ""}` : ""}` : muted("Apply it, then add its steps.")}
      <hr><div class="actions"><button class="btn primary" data-flow-act="apply">Apply</button>${flow && LIVE ? `<button class="btn" data-flow-act="run" title="bca run --flow ${esc(flow.id)}">Run now</button>` : ""}${flow ? '<button class="btn" data-flow-act="remove">Remove</button>' : ""}<button class="btn" data-flow-act="back">Back</button></div>
      ${flow?.steps.length ? `<hr><h3>Export</h3><div class="actions"><button class="btn" data-flow-act="github" title="One workflow file that runs this flow on GitHub and delivers what it saves">For GitHub Actions</button><button class="btn" data-flow-act="github" data-to="azure-devops" title="One pipeline file that runs this flow in Azure Pipelines and delivers what it saves">For Azure Pipelines</button></div>
      ${muted(LIVE ? `Writes <code>.github/workflows/bc-atlas-${esc(flow.id)}.yml</code>: it runs on ${flow.when.includes("ci") ? "pull requests and pushes" : ""}${flow.when.includes("ci") && flow.when.includes("schedule") ? ", " : ""}${flow.when.includes("schedule") ? "the schedule" : ""}${flow.when.some((name) => name === "ci" || name === "schedule") ? ", or" : ""} by hand.` : "Copies the command that writes the workflow file.")}` : ""}`;
  }
  MENUS.flow = () => {
    if (procForm) return procFormHtml();
    if (flowForm) return flowFormHtml();
    const { flows } = atlas.flows;
    const shown = atlas.lenses.some(({ id }) => id === "flows");
    return `<p class="text"><b>Your own workflows.</b> A flow says what to make from the source, when, and where to save it.</p>
      ${flows.length ? `<h3>Flows</h3>${flows.map((flow) => `<button class="item" role="menuitem" data-flow-act="edit" data-flow="${esc(flow.id)}"><b>${esc(flow.title)}</b><span>${plural(flow.steps.length, "step")}</span><small>${flow.when.length ? `on ${esc(flow.when.join(", "))}` : "only by name"}${flow.steps.length ? `: ${esc(flow.steps.map((step) => artifactOf(step.what)?.title ?? step.what).join(", "))}` : ""}</small></button>`).join("")}` : muted("None yet. A first one could write the documentation into the repository before every push.")}
      <div class="actions"><button class="btn primary" data-flow-act="board" title="A canvas of nodes to place and wire freely">Open the builder</button><button class="btn" data-flow-act="new">New flow…</button></div>
      ${shown ? `<button class="item" role="menuitem" data-flow-act="show" ${state.lens === "flows" && !state.inside ? 'aria-current="true"' : ""}><b>Show the flows</b><small>From the trigger that starts each to the artifacts it makes and where they are saved</small></button>` : ""}
      ${atlas.processes ? `<hr><p class="text"><b>Processes.</b> How the company works with the app: steps in lanes, mined from the process tests, run with the people of the simulation.</p>
      ${atlas.processes.processes.map((model) => { const run = atlas.processes.runs.find(({ id }) => id === model.id); return `<button class="item" role="menuitem" data-flow-act="process" data-process="${esc(model.id)}"><b>${esc(model.title)}</b><span>${run?.passed ? "runs" : "stops"}</span><small>${plural(model.steps.length, "step")}, ${plural(run?.handovers ?? 0, "handover")}, ${run?.findings.length ?? 0} to improve</small></button>`; }).join("")}
      <div class="actions"><button class="btn" data-flow-act="process" title="Processes in lanes (BPMN): build, mine, play, improve">Open the process builder</button></div>` : ""}
      ${flowChanges.length ? `<hr><h3>${plural(flowChanges.length, "change")} to save</h3><ul class="pending">${flowChanges.map((operation) => `<li>${esc(describeOperation(operation))}</li>`).join("")}</ul>
        <div class="actions"><button class="btn primary" data-flow-act="save">Save the changes (JSON)</button><button class="btn" data-flow-act="forget">Forget them</button></div>
        ${muted("This file is a snapshot. Apply the changes to the project with <code>bca flow define --from flow-changes.json</code>.")}` : ""}
      <hr>${muted(LIVE ? "A change is written to <code>.bca.json</code>. <code>bca run</code> runs the flows of a trigger; <b>Run now</b> runs one here." : "The same from a terminal or an agent: <code>bca flow define</code>, or the MCP tool <code>bc_atlas_flow_define</code>. <code>bca run --flow &lt;id&gt;</code> runs one.")}`;
  };
  /** The wires into a step: [{ step, if }], however .bca.json writes them. */
  const wiresOf = (step) => [step.after ?? []].flat().map((wire) => (typeof wire === "string" ? { step: wire.split(":")[0], if: wire.split(":")[1] ?? "passed" } : { step: wire.step, if: wire.if ?? "passed" }));
  /** A name no step of these has: its artifact, then check-2 (as src/flows/config.js names one). */
  function freeStepId(steps, what, taken = new Set()) {
    const used = new Set([...steps.map(({ id }) => id).filter(Boolean), ...taken]);
    for (let count = 1; ; count += 1) {
      const candidate = count === 1 ? flowIdOf(what) : `${flowIdOf(what)}-${count}`;
      if (!used.has(candidate)) return candidate;
    }
  }
  /** What is not valid about the flows as they are now, as src/flows/config.js would say it; nothing when all is well. */
  function flowWrong() {
    const places = new Map();
    for (const flow of atlas.flows.flows) {
      const names = new Set();
      for (const step of flow.steps) {
        if (step.id && names.has(step.id)) return `The flow ${flow.id} has two steps "${step.id}".`;
        if (step.id) names.add(step.id);
        const artifact = artifactOf(step.what);
        if (!artifact) return `"${step.what}" is not an artifact.`;
        const place = placeOfStep(step);
        if (place && artifact.extensions && !artifact.extensions.includes(place.slice(place.lastIndexOf(".") + 1).toLowerCase())) return `${artifact.title} saves one file that ends in ${artifact.extensions.map((item) => `.${item}`).join(", ")}, not "${place}".`;
        if (place && places.has(place)) return `"${place}" is saved twice: by ${places.get(place)} and by ${step.what} of the flow ${flow.id}. Give one of them another place.`;
        if (place) places.set(place, `${step.what} of the flow ${flow.id}`);
      }
      for (const step of flow.steps) for (const wire of wiresOf(step)) if (!names.has(wire.step)) return `A step of the flow ${flow.id} comes after "${wire.step}", which is not a step of it.`;
    }
    return undefined;
  }
  /** What operations do to the flows, in a snapshot: the same as src/flows/config.js, without its checks. */
  function flowLocal(operations) {
    const { flows, triggers } = atlas.flows;
    const filled = (entry) => Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== "" && value !== undefined && value !== null && !(Array.isArray(value) && !value.length)));
    for (const operation of operations) {
      const flow = flows.find(({ id }) => id === operation.flow);
      if (operation.op === "set") {
        if (!flow) flows.push({ id: operation.flow, title: operation.title || operation.flow, when: operation.when ?? [], steps: [] });
        else Object.assign(flow, operation.title ? { title: operation.title } : {}, operation.when ? { when: operation.when } : {});
      } else if (operation.op === "deliver") triggers[operation.trigger].sync = operation.sync;
      else if (operation.op === "trigger") {
        // A trigger of your own, as src/automation/config.js describes it; the project checks it when the changes are applied.
        const before = triggers[operation.name] ?? {};
        const list = (value) => [value ?? []].flat().flatMap((item) => String(item).split(",")).map((item) => item.trim()).filter(Boolean);
        if (operation.name === "schedule") {
          before.cron = operation.cron;
          continue;
        }
        const next = { ...before, custom: true, configured: true, tasks: before.tasks ?? [], sync: operation.sync ?? before.sync ?? "none" };
        for (const key of ["on", "branches", "paths", "tags"]) if (operation[key] !== undefined) next[key] = list(operation[key]);
        for (const key of ["title", "cron", "hook"]) if (operation[key] !== undefined) next[key] = String(operation[key]).trim();
        for (const key of ["title", "on", "branches", "paths", "tags", "cron", "hook"]) if (!next[key]?.length) delete next[key];
        next.kind = next.hook ? "hook" : next.on || next.cron ? "pipeline" : "call";
        next.modes = next.kind === "hook" ? ["none", "verify", "stage"] : next.kind === "pipeline" ? ["none", "verify", "artifact", "pull-request", "commit"] : Object.keys(atlas.flows.syncModes);
        if (!next.modes.includes(next.sync)) next.sync = "none";
        next.summary = next.title ?? (next.hook ? `Git hook ${next.hook}` : [...(next.on ?? []), ...(next.cron ? [`cron ${next.cron}`] : [])].join(", ") || `bca run --trigger ${operation.name}`);
        triggers[operation.name] = next;
      } else if (operation.op === "untrigger") {
        delete triggers[operation.name];
        for (const other of flows) other.when = other.when.filter((item) => item !== operation.name);
        canvas.triggers = canvas.triggers.filter((item) => item !== operation.name);
      } else if (!flow) continue;
      else if (operation.op === "remove") flows.splice(flows.indexOf(flow), 1);
      else if (operation.op === "unstep") {
        // The way closes around it, as in src/flows/config.js: what came after it comes after what it came after.
        const [gone] = flow.steps.splice(operation.at - 1, 1);
        for (const other of gone.id ? flow.steps : []) {
          const wires = wiresOf(other);
          const through = wires.find((wire) => wire.step === gone.id);
          if (!through) continue;
          const rest = wires.filter((wire) => wire.step !== gone.id);
          for (const wire of wiresOf(gone)) if (!rest.some((item) => item.step === wire.step)) rest.push({ step: wire.step, if: through.if });
          if (rest.length) other.after = rest;
          else delete other.after;
        }
      } else if (operation.op === "detach") {
        // The step, and every step that waits for nothing but steps that leave.
        const index = operation.at - 1;
        const before = flow.steps.map((step) => wiresOf(step).map((wire) => flow.steps.findIndex(({ id }) => id === wire.step)));
        const out = new Set([index]);
        for (let grown = true; grown;) {
          grown = false;
          before.forEach((others, order) => {
            if (!out.has(order) && others.length && others.every((other) => out.has(other))) {
              out.add(order);
              grown = true;
            }
          });
        }
        const kept = [...out].sort((a, b) => a - b);
        // They stay on the canvas, in no flow, with the wires among them.
        const group = looseKey();
        for (const order of kept) {
          const { after: _after, ...step } = flow.steps[order];
          const wires = order === index ? [] : wiresOf(flow.steps[order]).filter((wire) => kept.includes(flow.steps.findIndex(({ id }) => id === wire.step)));
          const key = looseKey();
          canvas.loose.push({ key, step: { ...step, ...(wires.length ? { after: wires } : {}) }, group });
          if (canvas.positions[stepKey(flow, order)]) canvas.positions[key] = canvas.positions[stepKey(flow, order)];
        }
        const names = new Set(kept.map((order) => flow.steps[order].id).filter(Boolean));
        flow.steps = flow.steps.filter((_, order) => !out.has(order));
        for (const other of flow.steps) {
          const left = wiresOf(other).filter((wire) => !names.has(wire.step));
          if (left.length) other.after = left;
          else delete other.after;
        }
      } else if (operation.op === "move") flow.steps.splice(operation.at - 1 + operation.by, 0, ...flow.steps.splice(operation.at - 1, 1));
      else if (operation.op === "wire" || operation.op === "unwire") {
        const from = flow.steps[operation.from - 1];
        const into = flow.steps[operation.into - 1];
        from.id ??= freeStepId(flow.steps, from.what);
        const left = wiresOf(into).filter((wire) => wire.step !== from.id);
        if (operation.op === "wire") left.push({ step: from.id, if: operation.if ?? "passed" });
        if (left.length) into.after = left;
        else delete into.after;
      } else if (operation.op === "step") {
        const { op: _op, flow: _flow, at, ...step } = operation;
        if (!at) flow.steps.push(filled(step));
        else {
          const { id, after, ...rest } = flow.steps[at - 1];
          flow.steps[at - 1] = filled({ ...(step.what && step.what !== rest.what ? {} : rest), ...(id ? { id } : {}), ...(after ? { after } : {}), ...step });
        }
      }
    }
  }

  // ---------------------------------------------------------------- builder
  // The flows as a board to build on by drag and drop: the triggers and the artifacts on the
  // left, one lane per flow. An artifact dropped into a lane is a step, where it was dropped; a
  // step is dragged to its place in the order, or into another flow; a trigger dropped on a lane
  // starts that flow; what is dropped on the bin is taken away. Every drop is the same
  // operations the forms send (flowApply). A click on a step opens its form.
  let boardOpen = false;
  let drag;
  const placeOfStep = (step) => step.to ?? artifactOf(step.what)?.to;
  /** A place nothing saves to yet: docs/layers, then docs/layers-2. */
  function freePlace(what, taken = []) {
    const base = artifactOf(what)?.to;
    if (!base) return undefined;
    const used = new Set([...atlas.flows.flows.flatMap(({ steps }) => steps.map(placeOfStep)), ...taken]);
    const dot = base.lastIndexOf(".") > base.lastIndexOf("/") ? base.lastIndexOf(".") : base.length;
    for (let count = 1; ; count += 1) {
      const candidate = count === 1 ? base : `${base.slice(0, dot)}-${count}${base.slice(dot)}`;
      if (!used.has(candidate)) return candidate;
    }
  }
  function boardHtml() {
    const { triggers, artifacts } = atlas.flows;
    const chip = (name) => `<span class="trigger ${triggers[name].custom ? "own" : ""}" draggable="true" data-drag="trigger" data-name="${esc(name)}" title="${esc(triggers[name].summary)}">${esc(name)}</span>`;
    const flows = boardMode === "canvas";
    return `<header class="top"><h2>Builder</h2><div class="segments" role="radiogroup" aria-label="What to build"><button role="radio" data-board-mode="canvas" aria-checked="${flows}" title="Your own workflows: what to make from the source, when, and where to save it">Flows</button><button role="radio" data-board-mode="process" aria-checked="${!flows}" title="How the company works with the app: processes in lanes (BPMN), mined, run, improved">Processes</button></div>
        <p>${flows ? "Drag nodes onto the canvas and wire them: a trigger into a flow, a flow into the steps it starts with, a step into those that come after it. Click a wire to say when it holds. Double-click a node for its settings; Shift-drag selects several." : "A process in lanes: every step in the lane of the role that does it. Drag a process test into a lane, pull a wire from a step into the one that comes after it, and play it with the people of the simulation."}</p><button class="btn" data-board="undo" title="Take the last change back (Ctrl+Z)" ${undone.length ? "" : "disabled"}>Undo</button><button class="close" data-board="close" aria-label="Close" title="Close (Esc)">×</button></header>
      <div class="body">${flows ? `
        <aside class="palette" aria-label="What to drag">
          <h3>Flow</h3><input type="text" id="board-title" placeholder="Title of a new flow" autocomplete="off" aria-label="Title of a new flow"><div class="flowcard" draggable="true" data-drag="flow" title="Drag it onto the canvas to start a flow"><b>New flow</b><small>drag it onto the canvas</small></div>
          <h3>When</h3><div class="triggers">${Object.keys(triggers).map((name) => chip(name)).join("")}</div><button class="btn" data-flow-act="trigger-new" title="A trigger of your own: a tag, a release, paths that changed, a schedule, a Git hook, or a name your own script calls">New trigger…</button>
          <h3>Make</h3>${artifacts.map((artifact) => `<div class="artifact" draggable="true" data-drag="artifact" data-what="${esc(artifact.id)}" title="${esc(artifact.summary)}"><b>${esc(artifact.title)}</b><small>${esc(artifact.plugin ? "task of a plugin" : artifact.to ?? "gate")}</small></div>`).join("")}
        </aside>
        <div class="canvas" data-drop="canvas" tabindex="0" aria-label="The canvas of the flows">
        </div>` : procHtml()}
      </div>`;
  }
  function boardDraw() {
    const element = $("#board");
    element.hidden = !boardOpen || !atlas?.flows;
    if (element.hidden) return;
    const titles = ["#board-title", "#proc-title", "#proc-newlane"].map((id) => [id, $(id)?.value ?? ""]);
    element.innerHTML = boardHtml();
    for (const [id, value] of titles) if ($(id)) $(id).value = value;
    if (boardMode === "canvas") canvasDraw();
    else procWiresDraw();
  }
  function boardShow(open, mode) {
    boardOpen = open;
    if (mode) boardMode = mode;
    boardDraw();
  }
  /** The id and title of a flow that starts on the board. */
  function boardNewFlow(fallback) {
    const title = $("#board-title").value.trim() || fallback;
    let id = flowIdOf(title);
    for (let count = 2; flowOf(id); count += 1) id = `${flowIdOf(title)}-${count}`;
    $("#board-title").value = "";
    return { op: "set", flow: id, title };
  }
  /** Where something that is dragged may be dropped. */
  const boardZone = (event) => {
    const zone = drag ? event.target.closest?.("[data-drop]") : undefined;
    if (!zone) return undefined;
    if (zone.dataset.drop === "canvas") return ["artifact", "trigger", "flow"].includes(drag.kind) ? zone : undefined;
    return ["test", "blank", "role", "pstep"].includes(drag.kind) ? zone : undefined;
  };
  const boardOver = (zone) => {
    for (const marked of $$("#board .over")) marked.classList.remove("over");
    zone?.classList.add("over");
  };
  $("#board").addEventListener("dragstart", (event) => {
    const item = event.target.closest?.("[data-drag]");
    if (!item || event.target.closest(".port")) return event.preventDefault();
    drag = { kind: item.dataset.drag, what: item.dataset.what, name: item.dataset.name, test: item.dataset.test, step: item.dataset.step };
    // Firefox drags only what carries data.
    event.dataTransfer.setData("text/plain", item.dataset.what ?? item.dataset.name ?? item.dataset.test ?? item.dataset.step ?? drag.kind);
    event.dataTransfer.effectAllowed = "copyMove";
    item.classList.add("dragging");
    return undefined;
  });
  $("#board").addEventListener("dragover", (event) => {
    const zone = boardZone(event);
    boardOver(zone);
    if (!zone) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = drag.kind === "pstep" ? "move" : "copy";
  });
  $("#board").addEventListener("drop", (event) => {
    const zone = boardZone(event);
    if (!zone) return;
    event.preventDefault();
    const dropped = drag;
    drag = undefined;
    boardOver();
    if (zone.dataset.drop === "canvas") canvasDrop(dropped, event);
    else procDrop(zone, dropped);
  });
  $("#board").addEventListener("dragend", () => {
    drag = undefined;
    boardOver();
    $("#board .dragging")?.classList.remove("dragging");
  });
  $("#board").addEventListener("click", (event) => {
    const item = event.target.closest("button");
    if (!item) {
      // A step or a wire of a process: selected.
      const step = event.target.closest(".pstep");
      const hit = event.target.closest("[data-pwire]");
      if (step || hit) {
        procPicked = step ? { step: step.dataset.step } : { wire: hit.dataset.pwire.split("\n") };
        procWiresDraw();
      }
      return undefined;
    }
    if (item.dataset.boardMode) {
      boardMode = item.dataset.boardMode;
      return boardDraw();
    }
    if (item.dataset.canvas) return canvasTool(item.dataset.canvas);
    if (item.dataset.proc) return procClick(item);
    if (item.dataset.flowAct) return flowClick(item);
    const act = item.dataset.board;
    if (act === "close") return boardShow(false);
    if (act === "undo") return boardUndo();
    if (act === "save") return download("flow-changes.json", `${JSON.stringify({ operations: flowChanges }, null, 2)}\n`, "application/json");
    return undefined;
  });
  $("#board").addEventListener("dblclick", (event) => {
    const step = event.target.closest?.(".pstep");
    if (step) procEdit(step.dataset.step);
  });
  $("#board").addEventListener("keydown", (event) => {
    if (event.key === "Escape") return boardShow(false);
    const typing = event.target.matches?.("input, select");
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z" && !typing) {
      event.preventDefault();
      return boardUndo();
    }
    if (event.target.closest?.(".canvas") && !typing) {
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        return canvasRemove();
      }
      if (event.key === "Enter" && picked?.node) return canvasOpen(picked.node);
    }
    if (event.target.closest?.(".proc") && !typing) {
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        return procRemove();
      }
      // A step is a button for the keyboard too.
      if ((event.key === "Enter" || event.key === " ") && event.target.classList.contains("pstep")) {
        event.preventDefault();
        return procEdit(event.target.dataset.step);
      }
    }
    if (event.key === "Enter" && event.target.id === "board-title") toast("Drag New flow onto the canvas to start it.");
    if (event.key === "Enter" && event.target.id === "proc-title") $('[data-proc="create"]').click();
    return undefined;
  });

  // ------------------------------------------------------------------- undo
  // What the builder changed, to take back: the flows or the processes as they were before each
  // change. Undo sends them as one operation (restore), so it is checked and written like any other.
  const undone = [];
  const keepForUndo = (entry) => {
    undone.push(entry);
    if (undone.length > 50) undone.shift();
  };
  /** A trigger of your own as .bca.json holds it. */
  const triggerJson = (trigger) => ({ ...Object.fromEntries(["title", "on", "branches", "paths", "tags", "cron", "hook"].filter((key) => trigger[key] !== undefined).map((key) => [key, trigger[key]])), ...(trigger.tasks?.length ? { tasks: trigger.tasks } : {}), ...(trigger.sync && trigger.sync !== "none" ? { sync: trigger.sync } : {}) });
  const flowsBefore = () => structuredClone({
    flows: atlas.flows.flows,
    sync: Object.fromEntries(Object.entries(atlas.flows.triggers).map(([name, trigger]) => [name, trigger.sync])),
    // The triggers of your own, to put back, and all of them as the view shows them.
    own: Object.fromEntries(Object.entries(atlas.flows.triggers).filter(([, trigger]) => trigger.custom).map(([name, trigger]) => [name, triggerJson(trigger)])),
    described: atlas.flows.triggers,
    loose: canvas.loose,
    triggers: canvas.triggers
  });
  async function boardUndo() {
    const last = undone.pop();
    if (!last) return toast("Nothing to take back.");
    if (last.kind === "process") {
      if (LIVE) {
        try {
          await call("defineProcesses", { operations: [{ op: "restore", processes: last.before }] });
        } catch (error) {
          return toast(error.message.replace(/^processes: /u, ""));
        }
        toast("Taken back.");
        return reload("Running the processes", false);
      }
      atlas.processes.processes = last.before;
      procChanges.splice(procChanges.length - last.changes, last.changes);
    } else {
      // The flows, how their triggers deliver, and what was on the canvas in no flow; the nodes stay where they are now.
      const delivery = Object.entries(last.before.sync).filter(([name, sync]) => !last.before.own[name] && atlas.flows.triggers[name]?.sync !== sync).map(([trigger, sync]) => ({ op: "deliver", trigger, sync }));
      canvas.loose = last.before.loose;
      canvas.triggers = last.before.triggers;
      if (LIVE) {
        try {
          await call("defineFlows", { operations: [{ op: "restore", flows: last.before.flows, triggers: last.before.own }, ...delivery] });
        } catch (error) {
          return toast(error.message.replace(/^flows: /u, ""));
        }
        await canvasSave();
        toast("Taken back.");
        return reload("Reading the flows", false);
      }
      atlas.flows.flows = last.before.flows;
      atlas.flows.triggers = last.before.described;
      flowChanges.splice(flowChanges.length - last.changes, last.changes);
    }
    toast("Taken back.");
    return boardDraw();
  }

  // ---------------------------------------------------------------- process
  // The processes of the company as BPMN lanes to build on (src/process): every step in the lane
  // of the role that does it, bound to the process test or recording that shows it works, wired
  // to what it comes after. A process test dragged into a lane is a step; a wire pulled from a
  // step into another says what comes after what; Play walks the process with the people of the
  // simulation. Every change is an operation: written to .bca.json in VS Code, kept to save in
  // an exported file.
  let processId;
  let procPicked;
  let procForm;
  let procWiring;
  const procChanges = [];
  const procModels = () => atlas.processes?.processes ?? [];
  const procModel = () => procModels().find(({ id }) => id === processId) ?? procModels()[0];
  const procWires = (step) => [step.after ?? []].flat().map((wire) => (typeof wire === "string" ? { step: wire } : { step: wire.step, when: wire.when }));
  const procRun = (model) => atlas.processes.runs.find(({ id }) => id === model.id);
  /** How a step ran, as long as it is the step that ran. */
  const procStatus = (model, step) => procRun(model)?.steps.find((ran) => ran.id === step.id && (ran.test ?? "") === (step.test ?? "") && ran.lane === (step.lane ?? ""))?.status;
  /** A time span for people, as src/process/telemetry.js writes it. */
  const procSpan = (ms) => {
    if (ms === undefined) return "";
    const round = (value) => (value >= 10 ? String(Math.round(value)) : String(Math.round(value * 10) / 10));
    return ms < 1000 ? `${Math.round(ms)} ms` : ms < 60000 ? `${round(ms / 1000)} s` : ms < 3600000 ? `${round(ms / 60000)} min` : ms < 86400000 ? `${round(ms / 3600000)} h` : `${round(ms / 86400000)} d`;
  };
  const PROC_STATUS = { runs: "runs", blocked: "stopped", "other-lane": "other role", unstaffed: "nobody set", unproven: "no test", unknown: "test missing" };
  /** The wires of a process that lead back to a step the way already passed: its loops (as src/process/index.js finds them). */
  function procBack(model) {
    const at = new Map(model.steps.map((step, index) => [step.id, index]));
    const next = model.steps.map(() => []);
    model.steps.forEach((step, index) => {
      for (const wire of procWires(step)) if (at.has(wire.step)) next[at.get(wire.step)].push(index);
    });
    const state = model.steps.map(() => 0);
    const back = new Set();
    const visit = (index) => {
      state[index] = 1;
      for (const after of [...next[index]].sort((a, b) => b - a)) {
        if (state[after] === 1) back.add(`${model.steps[index].id}\n${model.steps[after].id}`);
        else if (state[after] === 0) visit(after);
      }
      state[index] = 2;
    };
    const starts = model.steps.map((_, index) => index).filter((index) => !procWires(model.steps[index]).length);
    for (const index of [...[...(starts.length ? starts : model.steps.length ? [0] : [])].reverse(), ...model.steps.keys()]) if (state[index] === 0) visit(index);
    return back;
  }
  /** The lanes of a process in the order its steps name them, and the column of each step: one after the last it comes after, loops aside. */
  function procLayout(model) {
    const back = procBack(model);
    const columns = new Map();
    const column = (step) => {
      if (!columns.has(step.id)) {
        columns.set(step.id, 1);
        const before = procWires(step).filter((wire) => !back.has(`${wire.step}\n${step.id}`)).map((wire) => model.steps.find(({ id }) => id === wire.step)).filter(Boolean);
        columns.set(step.id, 1 + Math.max(0, ...before.map(column)));
      }
      return columns.get(step.id);
    };
    for (const step of model.steps) column(step);
    return { lanes: [...new Set(model.steps.map(({ lane }) => lane ?? ""))], columns, back, count: Math.max(1, ...columns.values()) };
  }
  function procHtml() {
    if (!atlas.processes) return '<div class="proc"><p class="empty">The processes of <code>.bca.json</code> are not valid; <code>bca process</code> says what is wrong.</p></div>';
    const { mined, roles, tests, simulated } = atlas.processes;
    const model = procModel();
    const test = (id) => tests.find((item) => item.id === id);
    let board = `<p class="empty">No process yet. ${mined.length ? "Take one as the process tests have it, on the left, or name a new one." : "Name one on the left and create it."}</p>`;
    if (model) {
      const layout = procLayout(model);
      const run = procRun(model);
      const stale = procChanges.length > 0;
      const card = (step) => {
        const status = procStatus(model, step);
        const timing = stale ? undefined : run?.steps.find(({ id }) => id === step.id)?.timing;
        return `<div class="pstep ${status ? `st-${status}` : "st-new"} ${procPicked?.step === step.id ? "picked" : ""}" draggable="true" data-drag="pstep" data-step="${esc(step.id)}" tabindex="0" role="button" title="${esc(status ? atlas.processes.statuses[status] : "Not run yet")}. Double-click to change it; drag it to another lane; pull a wire from its right into the step that comes after it"><span class="port in"></span><b>${esc(step.title ?? step.id)}</b><small>${esc(step.test ? test(step.test)?.title ?? step.test : "no test yet")}</small><small class="st">${esc(status ? PROC_STATUS[status] : "not run yet")}</small>${timing ? `<small class="time" title="In the telemetry: how often it is done, and how long it takes on average">${timing.count}× · ${esc(procSpan(timing.duration.avg))}${timing.repeated ? ` · again in ${timing.repeated}` : ""}</small>` : ""}<span class="port out" draggable="false" title="Drag a wire from here"></span></div>`;
      };
      const row = (lane) => `<section class="plane" data-drop="lane" data-lane="${esc(lane)}"><header><input type="text" data-proc-lane="${esc(lane)}" value="${esc(lane)}" placeholder="No lane" list="proc-roles" title="The role that does these steps. Change it to rename the lane" aria-label="Lane" autocomplete="off"></header><div class="track">${Array.from({ length: layout.count }, (_, index) => `<div class="cell">${model.steps.filter((step) => (step.lane ?? "") === lane && layout.columns.get(step.id) === index + 1).map(card).join("")}</div>`).join("")}</div></section>`;
      board = `<div class="ptools"><b>${esc(model.title)}</b>${run && !stale ? `<span class="state ${run.passed ? "ok" : "bad"}">${run.passed ? "Runs" : "Stops"} · ${plural(run.steps.length, "step")} · ${plural(run.handovers, "handover")} · ${run.findings.length} to improve</span>${run.timing ? `<span class="state" title="From the telemetry: ${esc(run.timing.variants.map(({ steps, cases }) => `${cases}× ${steps.join(" > ")}`).join("; "))}">${plural(run.timing.cases, "case")} in the telemetry · a case takes ${esc(procSpan(run.timing.throughput.avg))} · ${plural(run.timing.variants.length, "way")} taken</span>` : ""}` : '<span class="state">changed: it runs again once the changes are in the project</span>'}<span class="spacer"></span>
          <button class="btn primary" data-proc="play" title="Walk the process step by step with the people of the simulation" ${model.steps.length ? "" : "disabled"}>▶ Play</button>
          <button class="btn" data-proc="bpmn" title="Save it as BPMN 2.0, for other tools" ${model.steps.length ? "" : "disabled"}>BPMN</button>
          <button class="btn" data-proc="unpick" title="Remove what is selected: a step, or a wire (Delete)" disabled>Remove</button>
          <button class="btn" data-proc="remove" title="Remove the whole process">Remove the process</button></div>
        <div class="swim" style="--columns:${layout.count}"><svg class="pwires" aria-hidden="true"></svg>${layout.lanes.map(row).join("")}
          <section class="plane new" data-drop="newlane"><header><input type="text" id="proc-newlane" placeholder="New lane: a role" list="proc-roles" autocomplete="off" aria-label="Name of a new lane"></header><div class="track"><span class="hint">Name the lane, then drop a step here; or drop a role.</span></div></section>
        </div>
        ${run && !stale && run.findings.length ? `<div class="pfindings"><h3>What to improve</h3>${run.findings.map((finding) => `<button class="finding ${esc(finding.severity)}" data-proc="goto" data-step="${esc(finding.step ?? "")}"><b>${esc(finding.severity)} · ${esc(finding.rule)}</b><p>${rich(finding.message)}</p>${finding.fix ? `<p class="fix">${rich(finding.fix)}</p>` : ""}</button>`).join("")}</div>` : ""}
        ${simulated ? "" : '<p class="hint">The project has no process tests and no recordings: nothing can show whether a step works.</p>'}
        ${procChanges.length ? `<p class="kept">${plural(procChanges.length, "change")} kept in this snapshot. <button class="btn" data-proc="save">Save the changes (JSON)</button> and apply them with <code>bca process define --from process-changes.json</code>.</p>` : ""}`;
    }
    return `<aside class="palette" aria-label="What to drag">
        <h3>Process</h3>
        ${procModels().length ? `<select data-proc-select aria-label="The process to build on">${procModels().map((item) => `<option value="${esc(item.id)}" ${item.id === model?.id ? "selected" : ""}>${esc(item.title ?? item.id)}</option>`).join("")}</select>` : ""}
        <input type="text" id="proc-title" placeholder="Title of a new process" autocomplete="off" aria-label="Title of a new process"><button class="btn" data-proc="create">Create</button>
        ${mined.length ? `<h3>As the tests have it</h3>${mined.map((found) => `<button class="mined" data-proc="adopt" data-id="${esc(found.id)}" title="Mined from the ${esc(found.sources.join(" and "))}: who really does what, in which order. Take it as a model to change"><b>${esc(found.title)}</b><small>${plural(found.steps.length, "step")}, ${plural(found.handovers, "handover")} · ${procModels().some(({ id }) => id === found.id) ? "take again" : "take as a model"}</small></button>`).join("")}` : ""}
        <h3>Steps</h3>
        <div class="artifact" draggable="true" data-drag="blank" title="Something that is done and has no test yet"><b>Empty step</b><small>no test yet</small></div>
        ${tests.map((item) => `<div class="artifact" draggable="true" data-drag="test" data-test="${esc(item.id)}" title="${esc(item.recorded ? "A recording of Business Central" : "A process test")}: ${esc(item.id)}"><b>${esc(item.title)}</b><small>${esc(item.recorded ? "recording" : "process test")} · ${esc(item.id)}</small></div>`).join("")}
        ${roles.length ? `<h3>Roles</h3><div class="triggers">${roles.map((role) => `<span class="trigger role" draggable="true" data-drag="role" data-name="${esc(role.name)}" title="${esc(role.description ?? "A role of the company")}. Drop it on the board for a lane">${esc(role.name)}</span>`).join("")}</div>` : ""}
        <datalist id="proc-roles">${roles.map((role) => `<option value="${esc(role.name)}"></option>`).join("")}</datalist>
      </aside>
      <div class="proc" tabindex="0" aria-label="The lanes of the process">${board}</div>`;
  }
  /** The wires of the process, drawn over its lanes from where the steps are. */
  function procWiresDraw() {
    const swim = $("#board .swim");
    const model = procModel();
    for (const element of $$("#board .pstep")) element.classList.toggle("picked", procPicked?.step === element.dataset.step);
    const remove = $('#board [data-proc="unpick"]');
    if (remove) remove.disabled = !procPicked;
    if (!swim || !model) return;
    const box = swim.getBoundingClientRect();
    const port = (id, side) => {
      const rect = $(`#board .pstep[data-step="${CSS.escape(id)}"]`)?.getBoundingClientRect();
      return rect ? [(side === "out" ? rect.right : rect.left) - box.left, rect.top + rect.height / 2 - box.top, rect.top - box.top] : undefined;
    };
    const paths = [];
    const loops = procBack(model);
    // From the telemetry: how many of the cases go a way, and how long the work waits on it.
    const taken = procChanges.length ? [] : procRun(model)?.timing?.ways ?? [];
    for (const step of model.steps) {
      for (const wire of procWires(step)) {
        const from = port(wire.step, "out");
        const to = port(step.id, "in");
        if (!from || !to) continue;
        const back = loops.has(`${wire.step}\n${step.id}`);
        // A way back goes around, above the steps it passes.
        const over = Math.min(from[2], to[2]) - 14;
        const path = back ? `M${from[0]} ${from[1]} H${from[0] + 16} V${over} H${to[0] - 16} V${to[1]} H${to[0]}` : curve(from, to);
        const chosen = procPicked?.wire?.[0] === wire.step && procPicked.wire[1] === step.id;
        paths.push(`<path class="wire ${back ? "back" : ""} ${chosen ? "picked" : ""}" d="${path}"></path>${(() => { const seen = taken.find((way) => way.from === wire.step && way.into === step.id); const label = [wire.when, seen ? `${seen.share}% · waits ${procSpan(seen.wait.avg)}` : ""].filter(Boolean).join(" · "); return label ? `<text class="label" x="${(from[0] + to[0]) / 2}" y="${back ? over - 5 : (from[1] + to[1]) / 2 - 7}" text-anchor="middle">${esc(label)}</text>` : ""; })()}<path class="hit" data-pwire="${esc(`${wire.step}\n${step.id}`)}" d="${path}"><title>Click to select the wire, then Remove; the name of a way is in the form of the step</title></path>`);
      }
    }
    if (procWiring) paths.push(`<path class="wire pending" d="${curve(port(procWiring.from, "out"), procWiring.to)}"></path>`);
    $("#board .pwires").innerHTML = paths.join("");
  }
  /** What operations do to the processes, in a snapshot: the same as src/process/index.js, without its checks. */
  function procLocal(operations) {
    const processes = atlas.processes.processes;
    const filled = (entry) => Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== "" && value !== undefined && value !== null && !(Array.isArray(value) && !value.length)));
    const write = (wires) => wires.map((wire) => (wire.when ? wire : wire.step));
    for (const operation of operations) {
      const model = processes.find(({ id }) => id === operation.process);
      if (operation.op === "set") {
        if (!model) processes.push({ id: operation.process, title: operation.title || operation.process, steps: [] });
        else if (operation.title) model.title = operation.title;
      } else if (operation.op === "adopt") {
        const entry = { id: operation.model.id, title: operation.model.title, steps: operation.model.steps.map(({ id, title, lane, test, after }) => filled({ id, title, lane, test, after: procWires({ after }).map((wire) => filled(wire)) })) };
        const at = processes.findIndex(({ id }) => id === entry.id);
        if (at >= 0) processes[at] = entry;
        else processes.push(entry);
      } else if (!model) continue;
      else if (operation.op === "remove") processes.splice(processes.indexOf(model), 1);
      else if (operation.op === "step") {
        const { op: _op, process: _process, step: name, ...fields } = operation;
        const step = name ? model.steps.find(({ id }) => id === name) : undefined;
        if (step) Object.assign(step, fields), Object.keys(step).forEach((key) => (step[key] === "" ? delete step[key] : undefined));
        else model.steps.push(filled(fields));
      } else if (operation.op === "unstep") {
        const gone = model.steps.find(({ id }) => id === operation.step);
        model.steps.splice(model.steps.indexOf(gone), 1);
        // The way goes on without it.
        for (const other of model.steps) {
          const wires = procWires(other);
          const through = wires.find((wire) => wire.step === gone.id);
          if (!through) continue;
          const rest = wires.filter((wire) => wire.step !== gone.id);
          for (const before of procWires(gone)) if (!rest.some((wire) => wire.step === before.step)) rest.push(filled({ step: before.step, when: through.when ?? before.when }));
          if (rest.length) other.after = write(rest);
          else delete other.after;
        }
      } else if (operation.op === "wire" || operation.op === "unwire") {
        const into = model.steps.find(({ id }) => id === operation.into);
        const rest = procWires(into).filter((wire) => wire.step !== operation.from);
        if (operation.op === "wire") rest.push(filled({ step: operation.from, when: operation.when }));
        if (rest.length) into.after = write(rest);
        else delete into.after;
      } else if (operation.op === "lane") {
        for (const step of model.steps) if ((step.lane ?? "") === (operation.lane ?? "")) step.lane = operation.title;
      }
    }
  }
  /** Sends operations: written to .bca.json in VS Code, kept to save in an exported file. */
  async function procApply(operations) {
    if (!operations.length) return false;
    const before = structuredClone(atlas.processes.processes);
    if (!LIVE) {
      keepForUndo({ kind: "process", before, changes: operations.length });
      procLocal(operations);
      // What the project would not take, a snapshot does not keep either.
      const wrong = atlas.processes.processes.map((model) => {
        const names = model.steps.map(({ id }) => id);
        if (new Set(names).size !== names.length) return `The process ${model.title ?? model.id} has two steps of one name.`;
        const lost = model.steps.flatMap((step) => procWires(step)).find((wire) => !names.includes(wire.step));
        return lost ? `A step of the process ${model.title ?? model.id} comes after "${lost.step}", which is not a step of it.` : undefined;
      }).find(Boolean);
      if (wrong) {
        undone.pop();
        atlas.processes.processes = before;
        toast(wrong);
        boardDraw();
        return false;
      }
      procChanges.push(...operations);
      toast(`Kept ${plural(operations.length, "change")}. Save the changes from the builder.`);
      procForm = undefined;
      closeMenu();
      boardDraw();
      return true;
    }
    try {
      const result = await call("defineProcesses", { operations });
      if (result.written) keepForUndo({ kind: "process", before, changes: operations.length });
      toast(result.written ? `Wrote ${String(result.file).split(/[\\/]/u).pop()}.` : "Nothing changed.");
    } catch (error) {
      // What is not valid was not written.
      toast(error.message.replace(/^processes: /u, ""));
      return false;
    }
    procForm = undefined;
    closeMenu();
    await reload("Running the processes", false);
    return true;
  }
  /** Whether a step comes, directly or through others, after another. */
  function procComesAfter(model, step, other, seen = new Set()) {
    if (seen.has(step)) return false;
    seen.add(step);
    return procWires(model.steps.find(({ id }) => id === step) ?? {}).some((wire) => wire.step === other || procComesAfter(model, wire.step, other, seen));
  }
  const procFreeId = (model, title) => {
    for (let count = 1; ; count += 1) {
      const candidate = count === 1 ? flowIdOf(title) : `${flowIdOf(title)}-${count}`;
      if (!model.steps.some(({ id }) => id === candidate)) return candidate;
    }
  };
  /** Something dropped on a lane: a new step there, or a step that changes its lane. */
  function procDrop(zone, dropped) {
    const model = procModel();
    if (!model) return toast("Create a process first, on the left.");
    const lane = dropped.kind === "role" ? dropped.name : zone.dataset.drop === "lane" ? zone.dataset.lane : $("#proc-newlane").value.trim();
    if (zone.dataset.drop === "newlane" && !lane) return toast("Name the new lane first: a role of the company.");
    if (dropped.kind === "pstep") {
      const step = model.steps.find(({ id }) => id === dropped.step);
      return (step.lane ?? "") === lane ? undefined : procApply([{ op: "step", process: model.id, step: step.id, lane }]);
    }
    const found = dropped.kind === "test" ? atlas.processes.tests.find(({ id }) => id === dropped.test) : undefined;
    const title = found?.title ?? "New step";
    const id = procFreeId(model, title);
    // It comes after the step that is selected, so one step follows the other.
    const before = procPicked?.step && model.steps.some(({ id: own }) => own === procPicked.step) ? procPicked.step : undefined;
    procPicked = { step: id };
    if ($("#proc-newlane")) $("#proc-newlane").value = "";
    return procApply([{ op: "step", process: model.id, id, title, lane, ...(found ? { test: found.id } : {}) }, ...(before ? [{ op: "wire", process: model.id, from: before, into: id }] : [])]);
  }
  function procRemove() {
    const model = procModel();
    if (!model || !procPicked) return undefined;
    const chosen = procPicked;
    procPicked = undefined;
    return procApply([chosen.wire ? { op: "unwire", process: model.id, from: chosen.wire[0], into: chosen.wire[1] } : { op: "unstep", process: model.id, step: chosen.step }]);
  }
  /** The form of a step: its title, its lane, its test, and the names of the ways into it. */
  function procEdit(step) {
    closeMenu();
    procForm = { process: procModel().id, step };
    showMenu($("#flow-button"));
  }
  function procFormHtml() {
    const model = procModels().find(({ id }) => id === procForm.process);
    const step = model?.steps.find(({ id }) => id === procForm.step);
    if (!step) return muted("The step is gone.");
    const { tests } = atlas.processes;
    const status = procStatus(model, step);
    const ran = procRun(model)?.steps.find(({ id }) => id === step.id);
    return `<h3>Step of ${esc(model.title)}</h3>
      <label class="field wide"><span>Title</span><input type="text" data-p="title" value="${esc(step.title ?? "")}" autocomplete="off"></label>
      <label class="field wide" title="The role that does it"><span>Lane</span><input type="text" data-p="lane" value="${esc(step.lane ?? "")}" list="proc-form-roles" placeholder="a role of the company" autocomplete="off"></label>
      <datalist id="proc-form-roles">${atlas.processes.roles.map((role) => `<option value="${esc(role.name)}"></option>`).join("")}</datalist>
      <label class="field wide" title="What shows that the step works"><span>Test</span><select data-p="test"><option value="">None yet</option>${tests.map((item) => `<option value="${esc(item.id)}" ${item.id === step.test ? "selected" : ""}>${esc(item.title)}${item.recorded ? " (recording)" : ""}</option>`).join("")}${step.test && !tests.some(({ id }) => id === step.test) ? `<option value="${esc(step.test)}" selected>${esc(step.test)} (not there)</option>` : ""}</select></label>
      ${procWires(step).map((wire) => `<label class="field wide" title="When the way is one of several, its name: approved, rejected"><span>After ${esc(model.steps.find(({ id }) => id === wire.step)?.title ?? wire.step)}</span><input type="text" data-p-when="${esc(wire.step)}" value="${esc(wire.when ?? "")}" placeholder="always; or the name of the way" autocomplete="off"></label>`).join("") || muted("It starts the process. Pull a wire into it from the step it comes after.")}
      ${status ? muted(`${esc(atlas.processes.statuses[status])}.${ran?.performers.length ? ` ${status === "runs" || status === "other-lane" ? "Performed" : "Tried"} by ${esc(ran.performers.map(({ agent }) => agent).join(", "))}.` : ""}${ran?.missing.length ? ` Missing: ${ran.missing.map((line) => `<code>${esc(line)}</code>`).join(", ")}.` : ""}${ran?.touches.objects.length ? ` In the app: ${plural(ran.touches.steps, "click")}, opens ${ran.touches.opens}, runs ${ran.touches.runs}, reads ${ran.touches.reads}, writes ${ran.touches.writes}.` : ""}`) : ""}
      <hr><div class="actions"><button class="btn primary" data-proc="step-apply">Apply</button><button class="btn" data-proc="step-remove">Remove</button><button class="btn" data-proc="step-close">Close</button></div>`;
  }
  function procClick(item) {
    const act = item.dataset.proc;
    const model = procModel();
    if (act === "create") {
      const title = $("#proc-title").value.trim();
      if (!title) return toast("A process needs a title.");
      let id = flowIdOf(title);
      for (let count = 2; procModels().some((other) => other.id === id); count += 1) id = `${flowIdOf(title)}-${count}`;
      $("#proc-title").value = "";
      processId = id;
      return procApply([{ op: "set", process: id, title }]);
    }
    if (act === "adopt") {
      const found = atlas.processes.mined.find(({ id }) => id === item.dataset.id);
      processId = found.id;
      return procApply([{ op: "adopt", model: { id: found.id, title: found.title, steps: found.steps.map(({ id, title, lane, test, after }) => ({ id, title, lane, test, after })) } }]);
    }
    if (act === "save") return download("process-changes.json", `${JSON.stringify({ operations: procChanges }, null, 2)}\n`, "application/json");
    if (act === "step-close") return closeMenu();
    if (act === "step-remove") return procApply([{ op: "unstep", process: procForm.process, step: procForm.step }]);
    if (act === "step-apply") {
      const value = (name) => $(`#popover [data-p="${name}"]`).value.trim();
      const target = procModels().find(({ id }) => id === procForm.process);
      const step = target.steps.find(({ id }) => id === procForm.step);
      if (!value("title")) return toast("A step needs a title.");
      const operations = [{ op: "step", process: target.id, step: step.id, title: value("title"), lane: value("lane"), test: value("test") }];
      for (const input of $$("#popover [data-p-when]")) {
        const wire = procWires(step).find((item) => item.step === input.dataset.pWhen);
        if ((wire.when ?? "") !== input.value.trim()) operations.push({ op: "wire", process: target.id, from: wire.step, into: step.id, when: input.value.trim() });
      }
      return procApply(operations);
    }
    if (!model) return undefined;
    if (act === "unpick") return procRemove();
    if (act === "goto") {
      procPicked = item.dataset.step ? { step: item.dataset.step } : undefined;
      procWiresDraw();
      return $(`#board .pstep[data-step="${CSS.escape(item.dataset.step)}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    if (act === "remove") {
      // Asked twice before a process goes.
      if (item.textContent !== "Remove it for good") {
        item.textContent = "Remove it for good";
        item.classList.add("primary");
        return undefined;
      }
      processId = undefined;
      return procApply([{ op: "remove", process: model.id }]);
    }
    if (act === "bpmn") {
      const xml = atlas.processes.bpmn[model.id];
      if (!xml || procChanges.length) return toast(`The BPMN is written from the project: apply the changes, then bca process export --process ${model.id}.`);
      return download(`${model.id}.bpmn`, xml, "application/xml");
    }
    if (act === "play") {
      // The run plays on the lens of the process models, step by step.
      const story = storyOf(`model:${model.id}`);
      if (!story || procChanges.length) return toast(`The run is of the project: apply the changes, then play it, or bca process run --process ${model.id}.`);
      boardShow(false);
      stop();
      return set({ story: story.id, step: "0", q: "", form: "diagram", sel: "", hide: "", off: "" }).then(() => play(story));
    }
    return undefined;
  }
  $("#board").addEventListener("change", (event) => {
    if (event.target.dataset.procSelect !== undefined) {
      processId = event.target.value;
      procPicked = undefined;
      return boardDraw();
    }
    // A lane with another name: every step of it moves.
    const lane = event.target.dataset.procLane;
    if (lane !== undefined && event.target.value.trim() && event.target.value.trim() !== lane) return procApply([{ op: "lane", process: procModel().id, lane, title: event.target.value.trim() }]);
    return undefined;
  });

  // ----------------------------------------------------------------- canvas
  // The flows as nodes to place and wire freely. A trigger, a flow, and every step is a node with
  // ports: a wire from a trigger into a flow starts the flow on it, a wire from a flow into a step
  // makes that its first step, a wire from a step into another makes that the next. A node that
  // no wire leads to is on the canvas and in no flow. Wiring, unwiring, and removing send the
  // operations the forms send; where the nodes are, and what is on the canvas without a flow, is
  // the canvas (src/flows/canvas.js), kept in .bca/flow-canvas.json.
  let boardMode = "canvas";
  let canvas = { positions: {}, loose: [], triggers: [] };
  const curve = ([x1, y1], [x2, y2]) => {
    const bend = Math.max(36, Math.abs(x2 - x1) / 2);
    return `M${x1} ${y1} C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}`;
  };
  let picked;
  let gesture;
  let removing;
  const CANVAS_KEY = () => `bca-flow-canvas:${atlas.title}`;
  /** The canvas of the project: from the atlas, and in a snapshot what this browser kept. */
  function canvasRead() {
    canvas = structuredClone(atlas.flows?.canvas ?? { positions: {}, loose: [], triggers: [] });
    if (LIVE) return;
    try {
      // Where the nodes were; what was changed in a snapshot is gone with the page, so nothing else is kept.
      const kept = JSON.parse(localStorage.getItem(CANVAS_KEY()) ?? "null");
      if (kept && typeof kept === "object") Object.assign(canvas.positions, kept);
    } catch { /* optional */ }
  }
  /** Keeps the canvas: in the project in VS Code, in this browser for a snapshot. */
  async function canvasSave() {
    if (LIVE) return call("saveFlowCanvas", canvas).catch((error) => toast(error.message));
    try { localStorage.setItem(CANVAS_KEY(), JSON.stringify(canvas.positions)); } catch { /* optional */ }
    return undefined;
  }
  /** The key of a step: the place it saves to, which no other step has; for a gate, its flow and number. */
  function stepKey(flow, index) {
    const step = flow.steps[index];
    const place = placeOfStep(step);
    if (place) return `step:${place}`;
    return `gate:${flow.id}:${step.what}:${flow.steps.slice(0, index).filter((other) => other.what === step.what && !placeOfStep(other)).length + 1}`;
  }
  /** The nodes and wires of the flows as they are, each node where the canvas has it or where it falls by itself. */
  function canvasModel() {
    const { flows, triggers } = atlas.flows;
    const nodes = new Map();
    const wires = [];
    const at = (key, x, y) => canvas.positions[key] ?? [x, y];
    const tops = [];
    let top = 36;
    for (const flow of flows) {
      const key = `flow:${flow.id}`;
      tops.push(top);
      nodes.set(key, { key, kind: "flow", flow, pos: at(key, 250, top) });
      const index = new Map(flow.steps.flatMap((step, order) => (step.id ? [[step.id, order]] : [])));
      // By itself a step falls one column after the last step it waits for.
      const columns = new Map();
      const column = (order, seen = new Set()) => {
        if (!columns.has(order)) {
          const before = seen.has(order) ? [] : wiresOf(flow.steps[order]).map((wire) => index.get(wire.step)).filter((other) => other !== undefined);
          columns.set(order, 1 + Math.max(0, ...before.map((other) => column(other, new Set([...seen, order])))));
        }
        return columns.get(order);
      };
      const filled = new Map();
      flow.steps.forEach((step, order) => {
        const own = stepKey(flow, order);
        const lane = filled.get(column(order)) ?? 0;
        filled.set(column(order), lane + 1);
        nodes.set(own, { key: own, kind: "step", flow, at: order + 1, step, pos: at(own, 250 + 250 * column(order), top + lane * 84) });
        const before = wiresOf(step);
        if (!before.length) wires.push({ from: key, to: own, kind: "then", flow: flow.id, at: order + 1 });
        for (const wire of before) {
          if (index.has(wire.step)) wires.push({ from: stepKey(flow, index.get(wire.step)), to: own, kind: "then", cond: wire.if, flow: flow.id, at: order + 1, fromAt: index.get(wire.step) + 1 });
        }
      });
      top += Math.max(150, Math.max(0, ...filled.values()) * 84 + 50);
    }
    const named = [...new Set([...flows.flatMap(({ when }) => when), ...canvas.triggers])].filter((name) => triggers[name]);
    let spare = 0;
    for (const name of named) {
      const key = `trigger:${name}`;
      const first = flows.findIndex(({ when }) => when.includes(name));
      nodes.set(key, { key, kind: "trigger", name, pos: at(key, 28, first >= 0 ? tops[first] + flows[first].when.indexOf(name) * 50 : top + spare++ * 50) });
      for (const flow of flows) if (flow.when.includes(name)) wires.push({ from: key, to: `flow:${flow.id}`, kind: "starts", trigger: name, flow: flow.id });
    }
    canvas.loose.forEach((entry, order) => {
      nodes.set(entry.key, { key: entry.key, kind: "loose", step: entry.step, group: entry.group, pos: at(entry.key, 500 + order * 28, top + order * 28) });
      // What left a flow together keeps its wires, to come back together.
      for (const wire of wiresOf(entry.step)) {
        const before = canvas.loose.find((other) => other !== entry && entry.group && other.group === entry.group && other.step.id === wire.step);
        if (before) wires.push({ from: before.key, to: entry.key, kind: "then", cond: wire.if, loose: true });
      }
    });
    return { nodes, wires };
  }
  /** What the card of a node says, and what its buttons do; the library draws the card (scripts/flow-canvas-entry.js). */
  function canvasNodeData(node) {
    const { triggers } = atlas.flows;
    const remove = { id: "remove", label: "Remove", tip: "Remove it (Delete)" };
    const settings = { id: "open", label: "Settings…", tip: "Its settings (double-click, or Enter)" };
    if (node.kind === "trigger") return { over: `When${triggers[node.name].custom ? " · your own" : ""}`, title: node.name, under: triggers[node.name].summary, actions: [settings, remove] };
    if (node.kind === "flow") {
      const { flow } = node;
      const none = !flow.steps.length;
      return { over: `Flow · ${flow.id}`, title: flow.title, under: flow.when.length ? `on ${flow.when.join(", ")}` : "only by name", actions: [settings,
        ...(LIVE ? [{ id: "run", label: "Run now", tip: `bca run --flow ${flow.id}`, disabled: none }] : []),
        { id: "github", label: "GitHub Actions", tip: "Export it as a workflow for GitHub Actions", disabled: none },
        { id: "azure", label: "Azure Pipelines", tip: "Export it as a pipeline for Azure Pipelines", disabled: none },
        remove] };
    }
    const { what, to: _to, id: name, after: _after, ...options } = node.step;
    const artifact = artifactOf(what);
    const detail = options.lens ?? options.story ?? options.view ?? options.profile ?? options.language;
    const place = placeOfStep(node.step);
    const loose = node.kind === "loose";
    return { over: `${loose ? "Not wired" : `Step ${node.at}`}${name ? ` · ${name}` : ""}`, title: `${artifact?.title ?? what}${detail ? `: ${detail}` : ""}`, under: place ? `→ ${place}` : artifact?.plugin ? "task of a plugin" : "gate", actions: loose ? [remove] : [settings, remove] };
  }
  const NODE_TITLE = {
    trigger: "Double-click for what starts it and how it delivers. Pull a wire from its right into a flow",
    flow: "Double-click for its title, triggers, and delivery",
    step: "Double-click for where it is saved and its options. Pull a wire from its right into the steps that come after it",
    loose: "In no flow yet: drag a wire into it from a flow or one of its steps"
  };
  const CONDITION = { passed: "if it passed", failed: "if it fails", always: "in any case" };
  const wireId = (wire) => `${wire.from}\n${wire.to}`;
  let model;
  // The canvas itself is a library (React Flow, vendor/flow-canvas.js): it draws the nodes and
  // wires, and says what was dragged, wired, selected, and opened. Its element outlives the board.
  let flowCanvas;
  let canvasFitted = false;
  function canvasHost() {
    if (flowCanvas) return flowCanvas;
    const element = document.createElement("div");
    element.className = "flowcanvas";
    // The library fills in what the canvas can do once it is drawn, so it is asked each time.
    flowCanvas = window.BCAFlowCanvas.mount(element, {
      connect: (from, to) => canvasConnect(from, to),
      allowed: (from, to) => canvasAllowed(from, to),
      moved: (nodes) => {
        for (const { key, pos } of nodes) {
          canvas.positions[key] = pos;
          if (model.nodes.has(key)) model.nodes.get(key).pos = pos;
        }
        return canvasSave();
      },
      picked: ({ nodes, wires }) => {
        const wire = (id) => ({ from: id.split("\n")[0], to: id.split("\n")[1] });
        picked = !nodes.length && !wires.length ? undefined
          : nodes.length === 1 && !wires.length ? { node: nodes[0] }
            : wires.length === 1 && !nodes.length ? { wire: wire(wires[0]) }
              : { many: { nodes, wires: wires.map(wire) } };
        if (removing && picked?.node !== removing) removing = undefined;
        canvasPicked();
      },
      opened: (key) => canvasOpen(key),
      action: (key, id) => {
        const node = model.nodes.get(key);
        if (!node) return undefined;
        if (id === "open") return canvasOpen(key);
        if (id === "remove") {
          picked = { node: key };
          return canvasRemove();
        }
        return flowClick({ dataset: { flowAct: id === "run" ? "run" : "github", flow: node.flow.id, ...(id === "azure" ? { to: "azure-devops" } : {}) } });
      },
      // A wire between two steps says when the second runs.
      chosen: (id, value) => {
        const wire = model.wires.find((other) => wireId(other) === id);
        return wire?.fromAt ? flowApply([{ op: "wire", flow: wire.flow, from: wire.fromAt, into: wire.at, if: value }]) : undefined;
      },
      tool: (id) => (id === "save" ? download("flow-changes.json", `${JSON.stringify({ operations: flowChanges }, null, 2)}\n`, "application/json") : canvasTool(id)),
      dark: () => document.documentElement.dataset.theme === "dark"
    });
    flowCanvas.element = element;
    return flowCanvas;
  }
  /** Whether a wire from one node may lead into another: what the canvas shows while one is pulled. */
  function canvasAllowed(from, to) {
    const source = model?.nodes.get(from);
    const target = model?.nodes.get(to);
    if (!source || !target) return false;
    if (source.kind === "trigger") return target.kind === "flow";
    return (source.kind === "flow" || source.kind === "step") && (target.kind === "step" || target.kind === "loose");
  }
  function canvasDraw() {
    const ground = $("#board .canvas");
    if (!ground) return;
    const host = canvasHost();
    if (host.element.parentElement !== ground) ground.prepend(host.element);
    model = canvasModel();
    if (picked?.node && !model.nodes.has(picked.node)) picked = undefined;
    if (picked?.wire && !model.wires.some((wire) => wire.from === picked.wire.from && wire.to === picked.wire.to)) picked = undefined;
    if (picked?.many) picked = undefined;
    const conditions = Object.keys(atlas.flows.conditions ?? { passed: "", failed: "", always: "" }).map((value) => ({ value, label: { passed: "Runs if it passed", failed: "Runs if it fails", always: "Runs in any case" }[value] ?? value }));
    host.set({
      nodes: [...model.nodes.values()].map((node) => ({ key: node.key, kind: node.kind, ...canvasNodeData(node), tip: NODE_TITLE[node.kind], pos: node.pos, into: node.kind !== "trigger", out: node.kind !== "loose" })),
      wires: model.wires.map((wire) => ({ id: wireId(wire), from: wire.from, to: wire.to, kind: `${wire.kind} ${wire.cond ?? ""} ${wire.loose ? "idle" : ""}`, label: wire.cond && wire.cond !== "passed" ? CONDITION[wire.cond] : undefined, fixed: Boolean(wire.loose), ...(wire.fromAt ? { choice: { value: wire.cond, options: conditions } } : {}) })),
      tools: [
        ...(flowChanges.length ? [{ id: "save", label: `Save ${plural(flowChanges.length, "change")} (JSON)`, tip: "The changes kept in this snapshot, for bca flow define --from" }] : []),
        { id: "remove", label: "Remove", tip: "Remove what is selected: nodes, or wires (Delete)", needsPicked: true },
        { id: "tidy", label: "Tidy up", tip: "Lay the nodes out again" }
      ],
      hint: model.nodes.size ? undefined : "Drag New flow here, then an artifact, and pull a wire from the flow into it."
    }, { picked: { nodes: picked?.node ? [picked.node] : [], wires: picked?.wire ? [wireId(picked.wire)] : [] } });
    // Shown for the first time: everything in sight.
    if (!canvasFitted && model.nodes.size) {
      canvasFitted = true;
      setTimeout(() => host.fit(), 60);
    }
  }
  /** What is selected changed; the library shows its buttons. */
  function canvasPicked() {}
  /** A point of the screen in the coordinates of the canvas. */
  function canvasPoint(event) {
    return canvasHost().point(event.clientX, event.clientY);
  }
  function canvasTool(tool) {
    if (tool === "remove") return canvasRemove();
    if (tool === "tidy") {
      canvas.positions = {};
      canvasSave();
      canvasDraw();
      return setTimeout(() => canvasHost().fit(), 60);
    }
    return undefined;
  }
  let looseCount = 0;
  const looseKey = () => {
    do looseCount += 1; while (canvas.loose.some(({ key }) => key === `loose:${looseCount}`));
    return `loose:${looseCount}`;
  };
  /** Something of the palette dropped on the canvas: a node there. */
  async function canvasDrop(dropped, event) {
    const [x, y] = canvasPoint(event);
    const pos = [Math.round(x - 90), Math.round(y - 24)];
    if (dropped.kind === "trigger") {
      const key = `trigger:${dropped.name}`;
      if (!model.nodes.has(key)) canvas.triggers.push(dropped.name);
      canvas.positions[key] = pos;
      picked = { node: key };
      await canvasSave();
      return canvasDraw();
    }
    if (dropped.kind === "artifact") {
      const key = looseKey();
      canvas.loose.push({ key, step: { what: dropped.what } });
      canvas.positions[key] = pos;
      picked = { node: key };
      await canvasSave();
      return canvasDraw();
    }
    const start = boardNewFlow(`Flow ${atlas.flows.flows.length + 1}`);
    picked = { node: `flow:${start.flow}` };
    return flowApply([start], undefined, () => { canvas.positions[`flow:${start.flow}`] = pos; });
  }
  /** Whether a step of a flow waits, directly or through others, for another (both by index). */
  function waitsFor(flow, step, other, seen = new Set()) {
    if (seen.has(step)) return false;
    seen.add(step);
    return wiresOf(flow.steps[step]).some((wire) => {
      const before = flow.steps.findIndex(({ id }) => id === wire.step);
      return before === other || (before >= 0 && waitsFor(flow, before, other, seen));
    });
  }
  /** A wire pulled from one node into another: what it means for the flows. */
  async function canvasConnect(from, to) {
    const source = model.nodes.get(from);
    const target = model.nodes.get(to);
    if (!source || !target || from === to) return undefined;
    if (source.kind === "trigger") {
      if (target.kind !== "flow") return toast("A trigger starts a flow: pull its wire into a flow.");
      if (target.flow.when.includes(source.name)) return undefined;
      return flowApply([{ op: "set", flow: target.flow.id, when: [...target.flow.when, source.name] }]);
    }
    if (target.kind !== "step" && target.kind !== "loose") return toast(target.kind === "flow" ? "Only a trigger leads into a flow." : "A wire from a flow or a step leads into a step.");
    const flow = source.flow;
    const count = flow.steps.length;
    if (target.kind === "step" && target.flow.id === flow.id) {
      // From the flow: the step starts with it, and waits for nothing.
      if (source.kind === "flow") return wiresOf(target.step).length ? flowApply([{ op: "step", flow: flow.id, at: target.at, after: [] }]) : undefined;
      if (wiresOf(target.step).some((wire) => wire.step === source.step.id)) return undefined;
      if (waitsFor(flow, source.at - 1, target.at - 1)) return toast("That would be a circle: the step you pull from already comes after this one.");
      return flowApply([{ op: "wire", flow: flow.id, from: source.at, into: target.at }]);
    }
    if (target.kind === "step") {
      // From another flow: the step itself, with its place and options; what waited for it there no longer does.
      const { id, after: _after, ...moved } = target.step;
      const name = id && !flow.steps.some((step) => step.id === id) ? { id } : {};
      return flowApply([{ op: "step", flow: flow.id, ...moved, ...name }, ...(source.kind === "step" ? [{ op: "wire", flow: flow.id, from: source.at, into: count + 1 }] : []), { op: "unstep", flow: target.flow.id, at: target.at }]);
    }
    // A node in no flow, and with it those that left a flow together with it and come after it.
    const members = [canvas.loose.find(({ key }) => key === to)];
    for (let grown = true; grown;) {
      grown = false;
      for (const entry of canvas.loose) {
        if (members.includes(entry) || !entry.group || entry.group !== members[0].group) continue;
        if (wiresOf(entry.step).some((wire) => members.some((member) => member.step.id === wire.step))) {
          members.push(entry);
          grown = true;
        }
      }
    }
    // Names and places that the flow has already are given anew.
    const names = new Map();
    const taken = new Set();
    const places = [];
    const steps = members.map((entry) => {
      const { after: _after, ...step } = entry.step;
      if (step.id) {
        const name = flow.steps.some(({ id }) => id === step.id) || taken.has(step.id) ? freeStepId(flow.steps, step.what, taken) : step.id;
        names.set(step.id, name);
        taken.add(name);
        step.id = name;
      }
      step.to ??= freePlace(step.what, places);
      if (step.to) places.push(step.to);
      return step;
    });
    const operations = steps.map((step) => ({ op: "step", flow: flow.id, ...step }));
    if (source.kind === "step") operations.push({ op: "wire", flow: flow.id, from: source.at, into: count + 1 });
    members.forEach((entry, order) => {
      if (!order) return;
      for (const wire of wiresOf(entry.step)) {
        const before = members.findIndex((member) => member.step.id === wire.step);
        if (before >= 0) operations.push({ op: "wire", flow: flow.id, from: count + 1 + before, into: count + 1 + order, if: wire.if });
      }
    });
    return flowApply(operations, undefined, () => {
      canvas.loose = canvas.loose.filter((entry) => !members.includes(entry));
      // The nodes stay where they are, under the keys they have in a flow.
      members.forEach((entry, order) => {
        if (steps[order].to) canvas.positions[`step:${steps[order].to}`] = model.nodes.get(entry.key).pos;
        delete canvas.positions[entry.key];
      });
    });
  }
  /**
   * Takes the only wire into a step away: the step is in no flow any more, and neither are the
   * steps that run only through it. They stay on the canvas with their wires (src/flows/config.js, detach).
   */
  async function canvasDetach(flow, index) {
    // Where the nodes are, so that those that leave the flow stay where they are.
    flow.steps.forEach((_, order) => {
      const node = model.nodes.get(stepKey(flow, order));
      if (node) canvas.positions[node.key] = node.pos;
    });
    await canvasSave();
    return flowApply([{ op: "detach", flow: flow.id, at: index + 1 }]);
  }
  /** Takes what is selected away: a wire, or a node. */
  async function canvasRemove() {
    if (!picked) return undefined;
    if (picked.many) {
      // Several: one after the other, each found again by what it is, as the flows change under them.
      const { nodes, wires } = picked.many;
      const flows = nodes.filter((key) => model.nodes.get(key)?.kind === "flow");
      for (const wire of wires) {
        // A wire of a node that goes anyway goes with it.
        if (nodes.includes(wire.from) || nodes.includes(wire.to) || !model.wires.some(({ from, to }) => from === wire.from && to === wire.to)) continue;
        picked = { wire };
        await canvasRemove();
      }
      for (const key of nodes.filter((item) => !flows.includes(item))) {
        if (!model.nodes.has(key)) continue;
        picked = { node: key };
        await canvasRemove();
      }
      picked = undefined;
      canvasPicked();
      return flows.length ? toast(`A flow goes with its steps: select ${flows.length === 1 ? "it" : "each"} alone to remove it.`) : undefined;
    }
    if (picked.wire) {
      const wire = model.wires.find(({ from, to }) => from === picked.wire.from && to === picked.wire.to);
      picked = undefined;
      if (!wire || wire.loose) return undefined;
      const flow = flowOf(wire.flow);
      if (wire.kind === "starts") {
        // The trigger stays on the canvas, starting nothing.
        return flowApply([{ op: "set", flow: flow.id, when: flow.when.filter((name) => name !== wire.trigger) }], undefined, () => {
          if (!canvas.triggers.includes(wire.trigger)) canvas.triggers.push(wire.trigger);
        });
      }
      // One of several wires into a step: the step waits for one step less.
      if (wire.fromAt && wiresOf(flow.steps[wire.at - 1]).length > 1) return flowApply([{ op: "unwire", flow: flow.id, from: wire.fromAt, into: wire.at }]);
      // The only wire into it: the step is in no flow any more.
      return canvasDetach(flow, wire.at - 1);
    }
    const node = model.nodes.get(picked.node);
    if (!node) return undefined;
    if (node.kind === "flow" && removing !== node.key) {
      // Asked twice before a flow goes with its steps.
      removing = node.key;
      canvasPicked();
      return toast(`Remove again to take the flow ${node.flow.id} and its ${plural(node.flow.steps.length, "step")} away.`);
    }
    removing = undefined;
    picked = undefined;
    // A step that is removed: the way closes around it, as in a process and from the terminal.
    if (node.kind === "step") return flowApply([{ op: "unstep", flow: node.flow.id, at: node.at }], undefined, () => { delete canvas.positions[node.key]; });
    const gone = () => {
      delete canvas.positions[node.key];
      if (node.kind === "loose") canvas.loose = canvas.loose.filter(({ key }) => key !== node.key);
      if (node.kind === "trigger") canvas.triggers = canvas.triggers.filter((name) => name !== node.name);
    };
    const operations = node.kind === "loose" ? []
      : node.kind === "trigger" ? atlas.flows.flows.filter(({ when }) => when.includes(node.name)).map((flow) => ({ op: "set", flow: flow.id, when: flow.when.filter((name) => name !== node.name) }))
        : [{ op: "remove", flow: node.flow.id }];
    if (operations.length) return flowApply(operations, undefined, gone);
    // Only on the canvas: nothing of the flows changes.
    gone();
    await canvasSave();
    return canvasDraw();
  }
  // Pointer: a wire from a port, a node by its body, the canvas by its ground.
  $("#board").addEventListener("pointerdown", (event) => {
    // A wire from a step of a process into the step that comes after it.
    const from = event.button === 0 ? event.target.closest?.(".pstep .port.out")?.closest(".pstep") : undefined;
    if (from) {
      const box = $("#board .swim").getBoundingClientRect();
      gesture = { kind: "pwire", box };
      procWiring = { from: from.dataset.step, to: [event.clientX - box.left, event.clientY - box.top] };
      event.preventDefault();
      try { $("#board").setPointerCapture(event.pointerId); } catch { /* optional */ }
    }
    return undefined;
  });
  $("#board").addEventListener("pointermove", (event) => {
    if (!gesture) return;
    if (gesture.kind === "pwire") {
      procWiring.to = [event.clientX - gesture.box.left, event.clientY - gesture.box.top];
      const over = document.elementFromPoint(event.clientX, event.clientY)?.closest?.("#board .pstep");
      for (const element of $$("#board .pstep.aim")) element.classList.remove("aim");
      if (over && over.dataset.step !== procWiring.from) over.classList.add("aim");
      return procWiresDraw();
    }
    return undefined;
  });
  const canvasRelease = (event) => {
    if (!gesture) return undefined;
    const done = gesture;
    gesture = undefined;
    try { $("#board").releasePointerCapture(event.pointerId); } catch { /* optional */ }
    if (done.kind === "pwire") {
      const from = procWiring.from;
      procWiring = undefined;
      const into = event.type === "pointerup" ? document.elementFromPoint(event.clientX, event.clientY)?.closest?.("#board .pstep")?.dataset.step : undefined;
      for (const element of $$("#board .pstep.aim")) element.classList.remove("aim");
      procWiresDraw();
      const process = procModel();
      if (!into || into === from || procWires(process.steps.find(({ id }) => id === into)).some((wire) => wire.step === from)) return undefined;
      // A wire into a step the way already passed is a loop: the work is done again.
      if (procComesAfter(process, from, into)) toast("A way back: the steps between them are done again. Name the way in the form of the step.");
      return procApply([{ op: "wire", process: process.id, from, into }]);
    }
    return undefined;
  };
  $("#board").addEventListener("pointerup", canvasRelease);
  $("#board").addEventListener("pointercancel", canvasRelease);
  /** A node opened: the form of a flow or of a step. */
  function canvasOpen(key) {
    const node = model.nodes.get(key);
    if (!node) return undefined;
    if (node.kind === "flow") return flowEdit(node.flow.id);
    if (node.kind === "step") return flowEdit(node.flow.id, node.at);
    if (node.kind === "trigger") return triggerEdit(node.name);
    return toast("It is in no flow yet: pull a wire into it from a flow or one of its steps, then set its place and options.");
  }

  /** Opens the Flow menu on one trigger: from its node. */
  function triggerEdit(name) {
    closeMenu();
    flowForm = { trigger: name };
    showMenu($("#flow-button"));
  }
  /** Opens the Flow menu on one flow, or on one of its steps: from the card of a node. */
  function flowEdit(flow, step) {
    closeMenu();
    flowForm = { flow, step };
    showMenu($("#flow-button"));
  }
  const flowRedraw = () => {
    $("#popover").innerHTML = MENUS.flow();
    $("#popover").querySelector("input[type=text], select")?.focus({ preventScroll: true });
  };
  /** Sends operations: written to .bca.json in VS Code, kept to save in an exported file. Then back to `next`. */
  /**
   * @param next the form to go back to, when the menu is open
   * @param change what the change means for the canvas of the builder: done once the flows changed
   * @returns whether the flows changed
   */
  async function flowApply(operations, next, change) {
    if (!operations.length) {
      if (!openMenu) return false;
      flowForm = next;
      flowRedraw();
      return false;
    }
    const before = flowsBefore();
    if (!LIVE) {
      // A snapshot shows the change and keeps it to save; the project gets it with bca flow define --from.
      keepForUndo({ kind: "flow", before, changes: operations.length });
      flowLocal(operations);
      // What the project would not take, a snapshot does not keep either.
      const wrong = flowWrong();
      if (wrong) {
        undone.pop();
        atlas.flows.flows = before.flows;
        atlas.flows.triggers = before.described;
        canvas.loose = before.loose;
        canvas.triggers = before.triggers;
        toast(wrong);
        boardDraw();
        return false;
      }
      flowChanges.push(...operations);
      if (change) {
        change();
        await canvasSave();
      }
      toast(`Kept: ${operations.map(describeOperation).join("; ")}. Save the changes from the Flow menu.`);
      boardDraw();
      if (!openMenu) return true;
      flowForm = (next?.flow && flowOf(next.flow)) || (next?.trigger && atlas.flows.triggers[next.trigger]) ? next : undefined;
      flowRedraw();
      return true;
    }
    try {
      const result = await call("defineFlows", { operations });
      if (result.written) keepForUndo({ kind: "flow", before, changes: operations.length });
      const open = (result.rerouted ?? []).filter(({ after }) => !after.length).map(({ step }) => step);
      toast(`${result.written ? `Wrote ${String(result.file).split(/[\\/]/u).pop()}.` : "Nothing changed."}${open.length ? ` ${open.join(", ")} came after nothing else and now ${open.length === 1 ? "starts" : "start"} the flow.` : ""}`);
    } catch (error) {
      // What is not valid was not written: the flows and the canvas are as they were.
      toast(error.message.replace(/^flows: /u, ""));
      return false;
    }
    if (change) {
      change();
      await canvasSave();
    }
    const menu = Boolean(openMenu);
    closeMenu();
    await reload("Reading the flows", false);
    // The builder stays open on the flow, so one step follows the other.
    if (menu && ((next?.flow && flowOf(next.flow)) || (next?.trigger && atlas.flows.triggers[next.trigger]))) {
      flowForm = next;
      showMenu($("#flow-button"));
    }
    return true;
  }
  function flowClick(item) {
    const act = item.dataset.flowAct;
    const value = (name) => $(`#popover [data-f="${name}"]`)?.value.trim() ?? "";
    if (act === "show") {
      closeMenu();
      return set({ lens: "flows", form: "diagram", inside: "", focus: "", story: "", hide: "", off: "" });
    }
    if (act === "new" || act === "edit") {
      flowForm = { flow: item.dataset.flow };
      return flowRedraw();
    }
    if (act === "forget") {
      flowChanges.length = 0;
      return flowRedraw();
    }
    if (act === "save") {
      closeMenu();
      return download("flow-changes.json", `${JSON.stringify({ operations: flowChanges }, null, 2)}\n`, "application/json");
    }
    if (act === "back") {
      flowForm = undefined;
      return flowRedraw();
    }
    if (act === "board") {
      closeMenu();
      return boardShow(true, "canvas");
    }
    if (act === "process") {
      closeMenu();
      if (item.dataset.process) processId = item.dataset.process;
      return boardShow(true, "process");
    }
    if (act === "trigger-new") {
      closeMenu();
      flowForm = { trigger: "" };
      return showMenu($("#flow-button"));
    }
    if (act === "trigger-remove") {
      const name = flowForm.trigger;
      const users = atlas.flows.flows.filter(({ when }) => when.includes(name));
      // Asked twice when flows run on it.
      if (users.length && item.textContent !== "Remove the trigger") {
        item.textContent = "Remove the trigger";
        item.classList.add("primary");
        return toast(`${users.map(({ title }) => title).join(", ")} ${users.length === 1 ? "runs" : "run"} on it and will not any more.`);
      }
      return flowApply([{ op: "untrigger", name }], undefined, () => {
        canvas.triggers = canvas.triggers.filter((other) => other !== name);
        delete canvas.positions[`trigger:${name}`];
      });
    }
    if (act === "trigger-apply") {
      const { triggers } = atlas.flows;
      const name = flowForm.trigger || value("name").toLowerCase();
      const trigger = triggers[name];
      const sync = value("sync");
      if (!flowForm.trigger) {
        if (!/^[a-z0-9][a-z0-9._-]*$/u.test(name)) return toast("A trigger needs a name of lowercase letters, digits, \".\", \"_\", or \"-\".");
        if (trigger) return toast(`There is a trigger ${name} already.`);
      }
      if (trigger && !trigger.custom) {
        const operations = [];
        if (name === "schedule" && value("cron") && value("cron") !== trigger.cron) operations.push({ op: "trigger", name, cron: value("cron") });
        if (sync !== trigger.sync) operations.push({ op: "deliver", trigger: name, sync });
        return flowApply(operations, { trigger: name });
      }
      const list = (key) => value(key).split(",").map((part) => part.trim()).filter(Boolean);
      const operation = { op: "trigger", name, title: value("title"), on: $$('#popover [data-f="on"]:checked').map((box) => box.value), branches: list("branches"), paths: list("paths"), tags: list("tags"), cron: value("cron"), hook: value("hook"), sync };
      // Only what differs is sent, so a snapshot keeps a short list.
      const same = trigger && ["title", "cron", "hook"].every((key) => (trigger[key] ?? "") === operation[key]) && ["on", "branches", "paths", "tags"].every((key) => (trigger[key] ?? []).join() === operation[key].join()) && trigger.sync === sync;
      return flowApply(same ? [] : [operation], { trigger: name }, () => {
        if (!canvas.triggers.includes(name)) canvas.triggers.push(name);
      });
    }
    const id = item.dataset.flow ?? flowForm?.flow;
    if (act === "step") {
      flowForm = { flow: id, step: item.dataset.at === "new" ? "new" : Number(item.dataset.at) };
      return flowRedraw();
    }
    if (act === "step-back") {
      flowForm = { flow: id };
      return flowRedraw();
    }
    if (act === "up" || act === "down") return flowApply([{ op: "move", flow: id, at: Number(item.dataset.at), by: act === "up" ? -1 : 1 }], { flow: id });
    if (act === "step-remove") return flowApply([{ op: "unstep", flow: id, at: flowForm.step }], { flow: id });
    if (act === "step-apply") {
      const operation = { op: "step", flow: id, what: $("#popover [data-flow-what]").value, ...(typeof flowForm.step === "number" ? { at: flowForm.step } : {}) };
      if ($('#popover [data-f="to"]')) operation.to = value("to");
      // A name is kept unless it is changed: taking it away would leave others waiting for nothing.
      if (value("id")) operation.id = value("id");
      for (const input of $$("#popover [data-o]")) operation[input.dataset.o] = input.value.trim();
      return flowApply([operation], { flow: id });
    }
    if (act === "remove") {
      // Asked twice before a flow goes.
      if (item.textContent !== "Remove the flow") {
        item.textContent = "Remove the flow";
        item.classList.add("primary");
        return undefined;
      }
      return flowApply([{ op: "remove", flow: id }], undefined);
    }
    if (act === "github") {
      closeMenu();
      if (!LIVE) {
        // A snapshot cannot write into the repository: the command does.
        const command = `bca flow export --flow ${id}${item.dataset.to ? ` --to ${item.dataset.to}` : ""}`;
        return navigator.clipboard?.writeText(command).then(() => toast(`Copied: ${command}. Run it in the project to write the workflow.`), () => toast(`Run in the project: ${command}`)) ?? toast(`Run in the project: ${command}`);
      }
      return call("exportFlow", { flow: id, ...(item.dataset.to ? { to: item.dataset.to } : {}) }).then((result) => toast(result.action === "unchanged"
        ? `${result.path} is up to date.`
        : `Wrote ${result.path}: ${Object.entries(result.delivery).map(([trigger, sync]) => `${trigger} → ${sync}`).join(", ")}. ${result.to === "github" ? "Commit it, and GitHub runs the flow." : "Commit it, and create a pipeline from it in Azure DevOps."}`), (error) => toast(error.message.replace(/^flows: /u, "")));
    }
    if (act === "run") {
      closeMenu();
      toast(`Running the flow ${id}…`);
      return call("runFlow", { flow: id }).then((result) => {
        const failed = result.steps.filter(({ ok }) => !ok);
        toast(failed.length ? `${failed.length} of ${plural(result.steps.length, "step")} failed: ${failed.map(({ what, summary }) => `${what} (${summary})`).join("; ")}` : `Made ${plural(result.steps.length, "artifact")}: ${result.outputs.join(", ") || "nothing to save"}.`);
      }, (error) => toast(error.message));
    }
    if (act === "apply") {
      const title = value("title");
      const when = $$('#popover [data-f="when"]:checked').map((box) => box.value);
      const flow = id ? flowOf(id) : undefined;
      if (!flow && !title) return toast("A flow needs a title.");
      const target = flow?.id ?? flowIdOf(title);
      if (!flow && flowOf(target)) return toast(`There is a flow ${target} already.`);
      const operations = [];
      if (!flow || title !== flow.title || when.join() !== flow.when.join()) operations.push({ op: "set", flow: target, title, when });
      for (const select of $$("#popover [data-deliver]")) {
        const trigger = select.dataset.deliver;
        if (when.includes(trigger) && select.value !== atlas.flows.triggers[trigger].sync) operations.push({ op: "deliver", trigger, sync: select.value });
      }
      return flowApply(operations, { flow: target });
    }
    return undefined;
  }

  // What the view may write back: the architecture it proposes, and the baseline of what is accepted.
  function architectureAction() {
    const { mode, violations } = atlas.summary.architecture;
    if (mode === "proposal") return '<button class="btn" data-sync="adoptArchitecture" data-sure="Write it to .bca.json" title="The components are a proposal: no architecture is configured">Keep these components</button>';
    return violations ? '<button class="btn" data-sync="updateBaseline" data-sure="Write the baseline" title="bca check then fails only on new ones">Accept the wrong-way dependencies</button>' : "";
  }
  let openMenu;
  function closeMenu() {
    if (!openMenu) return;
    if (openMenu.dataset.menu === "simulate") simForm = undefined;
    if (openMenu.dataset.menu === "flow") {
      flowForm = undefined;
      procForm = undefined;
    }
    $("#popover").hidden = true;
    openMenu.setAttribute("aria-expanded", "false");
    openMenu = undefined;
  }
  function showMenu(button) {
    if (openMenu === button) return closeMenu();
    closeMenu();
    if (!atlas || !scene) return undefined;
    const popover = $("#popover");
    popover.innerHTML = MENUS[button.dataset.menu]();
    popover.hidden = false;
    const box = button.getBoundingClientRect();
    const width = popover.offsetWidth;
    popover.style.top = `${box.bottom + 6}px`;
    popover.style.left = `${Math.max(8, Math.min(box.left, innerWidth - width - 8))}px`;
    button.setAttribute("aria-expanded", "true");
    openMenu = button;
    popover.querySelector("button, select")?.focus({ preventScroll: true });
    return undefined;
  }
  for (const button of $$("[data-menu]")) button.addEventListener("click", () => showMenu(button));
  addEventListener("pointerdown", (event) => {
    if (openMenu && !event.target.closest("#popover, [data-menu]")) closeMenu();
  });
  $("#popover").addEventListener("click", async (event) => {
    const item = event.target.closest("button");
    if (!item) return;
    if (item.dataset.proc) procClick(item);
    else if (item.dataset.arch || item.dataset.archCopy || item.dataset.archComponent) archClick(item);
    else if (item.dataset.flowAct) flowClick(item);
    else if (item.dataset.sim || item.dataset.simEdit || item.dataset.simNew || item.dataset.simGo !== undefined || item.dataset.simRun) simulateClick(item);
    else if (item.dataset.setLens) {
      closeMenu();
      set({ lens: item.dataset.setLens, inside: "", focus: "", story: "", hide: "", off: "", size: "", color: "", group: "" });
    } else if (item.dataset.setStory) {
      closeMenu();
      stop();
      set({ story: item.dataset.setStory, step: "0", q: "" });
    } else if (item.dataset.export) {
      closeMenu();
      try {
        await EXPORTS.find(([id]) => id === item.dataset.export)[3]();
      } catch (error) {
        toast(error.message);
      }
    } else if (item.dataset.viewAct === "arrange") graph.relayout();
    else if (item.dataset.viewAct === "reset") {
      closeMenu();
      set({ color: "", size: "", group: "", hide: "", off: "", focus: "", depth: "1", q: "" }).then(() => graph.fit());
    } else if (item.dataset.sync === "refresh") {
      closeMenu();
      reload("Reading the source again");
    } else if (item.dataset.sync) {
      // Asked twice before anything is written.
      if (item.textContent !== item.dataset.sure) {
        item.textContent = item.dataset.sure;
        item.classList.add("primary");
        return;
      }
      closeMenu();
      try {
        const written = await call(item.dataset.sync);
        toast(`Wrote ${String(written.file).split(/[\\/]/u).pop()}.`);
        await reload("Reading the source again");
      } catch (error) {
        toast(error.message);
      }
    }
  });
  $("#popover").addEventListener("change", (event) => {
    const field = event.target.dataset.view;
    if (field) set({ [field]: event.target.value });
    // Another artifact has other options and another place.
    if (event.target.dataset.flowWhat !== undefined && flowForm) {
      flowForm.what = event.target.value;
      $("#popover").innerHTML = MENUS.flow();
      $("#popover [data-flow-what]")?.focus({ preventScroll: true });
    }
  });

  // --------------------------------------------------------------- toolbar
  $("#forms").addEventListener("click", (event) => {
    const form = event.target.closest("button")?.dataset.form;
    if (form) set({ form });
  });
  $("#check-button").addEventListener("click", () => set({ check: state.check ? "" : "1" }));
  let cursor = -1;
  $("#search").addEventListener("input", (event) => {
    cursor = -1;
    set({ q: event.target.value, story: "" });
  });
  $("#search").addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.target.value = "";
      set({ q: "" });
      $(".graph-canvas")?.focus();
    }
    if (event.key !== "Enter") return;
    const hits = S.matches(scene, state.q);
    if (!hits.length) return;
    cursor = (cursor + (event.shiftKey ? -1 : 1) + hits.length) % hits.length;
    set({ sel: scene.entries[hits[cursor]].node.id }).then(() => graph.center([hits[cursor]]));
  });
  $("#zoom").addEventListener("click", (event) => {
    const action = event.target.closest("button")?.dataset.zoom;
    if (action === "in") graph?.zoom(1.3);
    else if (action === "out") graph?.zoom(1 / 1.3);
    else if (action === "fit") graph?.fit();
  });

  addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const typing = event.target.closest?.("input, select, textarea");
    if (event.key === "Escape") {
      if (openMenu) closeMenu();
      else if (typing) return;
      else if (state.story) storyAct("end");
      else if (state.sel) set({ sel: "" });
      else if (atlas) up();
      return;
    }
    if (typing || !atlas) return;
    if (event.key === "Backspace") {
      if (up()) event.preventDefault();
    } else if (event.key === "[" || event.key === "]") turn(event.key === "[" ? -1 : 1);
    else if (event.key === "/") {
      event.preventDefault();
      $("#search").focus();
    } else if (event.key === "1" || event.key === "2" || event.key === "3") set({ form: ["2d", "diagram", "3d"][Number(event.key) - 1] });
    else if (event.key === "c" || event.key === "C") set({ check: state.check ? "" : "1" });
    else if (state.story && event.key === "ArrowRight") storyAct("next");
    else if (state.story && event.key === "ArrowLeft") storyAct("previous");
    else if (state.story && event.key === " ") {
      event.preventDefault();
      storyAct("play");
    }
  });

  // ---------------------------------------------------------- live updates
  /** @param again read the source again; false for what changed the graph and not the analysis (the flows, the processes) */
  async function reload(text, again = true) {
    $("#sync-button").className = "tool status menu busy";
    $("#sync-text").textContent = text;
    try {
      if (again && text !== "Reading" && LIVE) await call("refresh").catch(() => undefined);
      await load();
      applied = { ...applied, key: undefined };
      await render();
      boardDraw();
    } catch (error) {
      message(`<b>The analysis failed.</b><span>${esc(error.message)}</span>`);
      $("#sync-text").textContent = "Failed";
    }
  }
  if (LIVE) {
    // From the extension: the source changed, show a view, or show the object of the editor.
    addEventListener("message", (event) => {
      const data = event.data;
      if (data?.type === "changed") {
        load().then(() => {
          applied = { ...applied, key: undefined };
          toast("The source changed; the graph shows the new analysis.");
          boardDraw();
          return render();
        }).catch(() => {});
      }
      if (data?.type === "host-missing") message("<b>This page is the BC Atlas view as an MCP App.</b><span>It shows a project inside a chat client that renders MCP Apps. Open it from there, or use <code>bca export --view app</code> for a file that stands alone.</span>");
      if (data?.type === "navigate" && typeof data.hash === "string") {
        location.hash = data.hash;
        state = readState();
        place = placeOf(state);
        render();
      }
      if (data?.type === "reveal" && typeof data.id === "string" && atlas && position.has(data.id)) {
        set({ sel: data.id }).then(() => {
          const index = scene.place.get(data.id);
          if (index !== undefined) graph.center([index]);
        });
      }
    });
  }
  // Back and Forward of the browser, and an address that is typed or followed.
  const followAddress = () => {
    if (stateHash() === (location.hash || "#")) return;
    state = readState();
    place = placeOf(state);
    render();
  };
  addEventListener("popstate", followAddress);
  addEventListener("hashchange", followAddress);

  message("<b>Reading the AL source</b><span>Every object and what it does with the others.</span>");
  await reload("Reading");
})();
