// BC Atlas: one view. The toolbar chooses what part of the atlas shows (a
// lens), in which form (2D, diagram, 3D), and what stands out (a search, the
// findings, a story); everything else is the graph. In VS Code the extension
// answers the view's requests (LIVE); an exported file reads the same atlas
// from an embedded snapshot. The whole state of the view is in the address,
// so any picture can be linked to and opened again.
(async () => {
  "use strict";

  const BOOT = window.BCA_APP ?? { mode: "static" };
  const LIVE = BOOT.mode === "vscode";
  const vscode = LIVE ? acquireVsCodeApi() : undefined;
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
      return call("saveFile", { name, content: text, encoding: binary ? "base64" : undefined }).catch((error) => toast(error.message));
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
  const describeOperation = (operation) => [operation.op, operation.flow ?? operation.trigger, operation.what, operation.at ? `step ${operation.at}` : "", operation.to ? `→ ${operation.to}` : "", operation.sync].filter(Boolean).join(" ");
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
      ${artifact.options.map(field).join("").replace('data-o="lens"', 'data-o="lens" list="flow-lenses"').replace('data-o="story"', 'data-o="story" list="flow-stories"')}${lensOptions}
      <label class="field wide" title="Other steps can come after it by this name"><span>Name</span><input type="text" data-f="id" value="${esc(existing?.id ?? "")}" placeholder="none: nothing waits for it" autocomplete="off" spellcheck="false"></label>
      ${existing ? muted(waits.length ? `Comes after ${esc(waits.join(", "))}. Wire it on the canvas of the builder.` : "Starts with the flow. To let it wait for another step, wire it on the canvas of the builder.") : ""}
      <hr><div class="actions"><button class="btn primary" data-flow-act="step-apply">Apply</button>${existing ? '<button class="btn" data-flow-act="step-remove">Remove</button>' : ""}<button class="btn" data-flow-act="step-back">Back</button></div>`;
  }
  function flowFormHtml() {
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
      ${flow?.steps.length ? `<hr><h3>Export</h3><div class="actions"><button class="btn" data-flow-act="github" title="One workflow file that runs this flow on GitHub and delivers what it saves">For GitHub Actions</button></div>
      ${muted(LIVE ? `Writes <code>.github/workflows/bc-atlas-${esc(flow.id)}.yml</code>: it runs on ${flow.when.includes("ci") ? "pull requests and pushes" : ""}${flow.when.includes("ci") && flow.when.includes("schedule") ? ", " : ""}${flow.when.includes("schedule") ? "the schedule" : ""}${flow.when.some((name) => name === "ci" || name === "schedule") ? ", or" : ""} by hand.` : "Copies the command that writes the workflow file.")}` : ""}`;
  }
  MENUS.flow = () => {
    if (flowForm) return flowFormHtml();
    const { flows } = atlas.flows;
    const shown = atlas.lenses.some(({ id }) => id === "flows");
    return `<p class="text"><b>Your own workflows.</b> A flow says what to make from the source, when, and where to save it.</p>
      ${flows.length ? `<h3>Flows</h3>${flows.map((flow) => `<button class="item" role="menuitem" data-flow-act="edit" data-flow="${esc(flow.id)}"><b>${esc(flow.title)}</b><span>${plural(flow.steps.length, "step")}</span><small>${flow.when.length ? `on ${esc(flow.when.join(", "))}` : "only by name"}${flow.steps.length ? `: ${esc(flow.steps.map((step) => artifactOf(step.what)?.title ?? step.what).join(", "))}` : ""}</small></button>`).join("")}` : muted("None yet. A first one could write the documentation into the repository before every push.")}
      <div class="actions"><button class="btn primary" data-flow-act="board" title="Drag artifacts into flows, order the steps, and drop triggers onto a flow">Open the builder</button><button class="btn" data-flow-act="new">New flow…</button></div>
      ${shown ? `<button class="item" role="menuitem" data-flow-act="show" ${state.lens === "flows" && !state.inside ? 'aria-current="true"' : ""}><b>Show the flows</b><small>From the trigger that starts each to the artifacts it makes and where they are saved</small></button>` : ""}
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
      else if (!flow) continue;
      else if (operation.op === "remove") flows.splice(flows.indexOf(flow), 1);
      else if (operation.op === "unstep") {
        const [gone] = flow.steps.splice(operation.at - 1, 1);
        // What waited for it no longer does.
        for (const other of flow.steps) {
          const left = wiresOf(other).filter((wire) => wire.step !== gone.id);
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
    const { flows, triggers, artifacts } = atlas.flows;
    const chip = (name, flow) => `<span class="trigger" draggable="true" data-drag="trigger" data-name="${esc(name)}" ${flow ? `data-flow="${esc(flow)}"` : ""} title="${esc(triggers[name].summary)}${flow ? `. Delivery: ${esc(triggers[name].sync)}` : ""}">${esc(name)}</span>`;
    const lane = (flow) => `<article class="lane" data-lane="${esc(flow.id)}">
        <header><button class="name" data-board="flow" data-flow="${esc(flow.id)}" title="Title, triggers, and delivery">${esc(flow.title)}</button><small>${esc(flow.id)}</small><span class="spacer"></span>
          ${LIVE ? `<button class="btn" data-flow-act="run" data-flow="${esc(flow.id)}" title="bca run --flow ${esc(flow.id)}" ${flow.steps.length ? "" : "disabled"}>Run now</button>` : ""}<button class="btn" data-flow-act="github" data-flow="${esc(flow.id)}" title="Export it as a workflow for GitHub Actions" ${flow.steps.length ? "" : "disabled"}>GitHub Actions</button></header>
        <div class="row">
          <div class="when" data-drop="when" data-flow="${esc(flow.id)}">${flow.when.map((name) => chip(name, flow.id)).join("") || '<span class="hint">Drop a trigger: without one it runs only by name</span>'}</div>
          <span class="arrow" aria-hidden="true">→</span>
          <ol class="steps" data-drop="steps" data-flow="${esc(flow.id)}">${flow.steps.map((step, index) => {
    const { what, to, id: _id, after: _after, ...options } = step;
    const detail = options.lens ?? options.story ?? options.view ?? options.language;
    return `<li class="step" draggable="true" data-drag="step" data-flow="${esc(flow.id)}" data-at="${index + 1}" tabindex="0" role="button" title="Click to change it; drag it to another place, another flow, or the bin"><b>${index + 1}. ${esc(artifactOf(what)?.title ?? what)}${detail ? `: ${esc(detail)}` : ""}</b><small>${esc(placeOfStep(step) ? `→ ${placeOfStep(step)}` : artifactOf(what)?.plugin ? "task of a plugin" : "gate")}${wiresOf(step).length ? ` · after ${esc(wiresOf(step).map((wire) => `${wire.step}${wire.if === "passed" ? "" : ` (if ${wire.if})`}`).join(", "))}` : ""}</small></li>`;
  }).join("")}<li class="add"><button class="btn" data-board="add" data-flow="${esc(flow.id)}">${flow.steps.length ? "+" : "Drop an artifact here, or add a step…"}</button></li></ol>
        </div></article>`;
    const wired = boardMode === "canvas";
    return `<header class="top"><h2>Flow builder</h2><div class="segments" role="radiogroup" aria-label="How to build"><button role="radio" data-board-mode="canvas" aria-checked="${wired}" title="Nodes to place and wire freely">Canvas</button><button role="radio" data-board-mode="lanes" aria-checked="${!wired}" title="One lane per flow, steps in a row">Lanes</button></div>
        <p>${wired ? "Drag nodes onto the canvas and wire them: a trigger into a flow, a flow into the steps it starts with, a step into those that come after it. Click a wire to say when it holds. Double-click a node for its settings." : "Drag an artifact into a flow to make it there, drag steps into their order, and drop a trigger on a flow to start it. Click a step for where it is saved and its options."}</p><button class="close" data-board="close" aria-label="Close" title="Close (Esc)">×</button></header>
      <div class="body">
        <aside class="palette" aria-label="What to drag">
          ${wired ? `<h3>Flow</h3><input type="text" id="board-title" placeholder="Title of a new flow" autocomplete="off" aria-label="Title of a new flow"><div class="flowcard" draggable="true" data-drag="flow" title="Drag it onto the canvas to start a flow"><b>New flow</b><small>drag it onto the canvas</small></div>` : ""}
          <h3>When</h3><div class="triggers">${Object.keys(triggers).map((name) => chip(name)).join("")}</div>
          <h3>Make</h3>${artifacts.map((artifact) => `<div class="artifact" draggable="true" data-drag="artifact" data-what="${esc(artifact.id)}" title="${esc(artifact.summary)}"><b>${esc(artifact.title)}</b><small>${esc(artifact.plugin ? "task of a plugin" : artifact.to ?? "gate")}</small></div>`).join("")}
          ${wired ? "" : '<div class="bin" data-drop="bin">Drop here to take it out of the flow</div>'}
        </aside>
        ${wired ? `<div class="canvas" data-drop="canvas" tabindex="0" aria-label="The canvas of the flows">
          <div class="world"></div>
          <div class="tools" role="group" aria-label="Canvas">
            <select data-canvas-if aria-label="When the step after the selected wire runs" title="When the step after this wire runs" hidden>${Object.entries(atlas.flows.conditions ?? { passed: "", failed: "", always: "" }).map(([key, text]) => `<option value="${esc(key)}" title="${esc(text)}">${esc({ passed: "Runs if it passed", failed: "Runs if it fails", always: "Runs in any case" }[key] ?? key)}</option>`).join("")}</select>
            <button class="btn" data-canvas="remove" title="Remove what is selected: a node, or a wire (Delete)" disabled>Remove</button>
            <button class="btn" data-canvas="tidy" title="Lay the nodes out again">Tidy up</button>
            <button class="btn" data-canvas="fit" title="Show everything">Fit</button>
            <button class="btn" data-canvas="out" aria-label="Zoom out">−</button><button class="btn" data-canvas="in" aria-label="Zoom in">+</button>
          </div>
          ${flowChanges.length ? `<p class="kept">${plural(flowChanges.length, "change")} kept in this snapshot. <button class="btn" data-board="save">Save the changes (JSON)</button></p>` : ""}
        </div>` : `<div class="lanes">${flows.map(lane).join("")}
          <article class="lane new" data-drop="new"><input type="text" id="board-title" placeholder="Title of a new flow" autocomplete="off" aria-label="Title of a new flow"><span class="hint">then drop an artifact or a trigger here to start it</span><button class="btn" data-board="create">Create</button></article>
          ${flowChanges.length ? `<p class="kept">${plural(flowChanges.length, "change")} kept in this snapshot. <button class="btn" data-board="save">Save the changes (JSON)</button> and apply them with <code>bca flow define --from flow-changes.json</code>.</p>` : ""}
        </div>`}
      </div>`;
  }
  function boardDraw() {
    const element = $("#board");
    element.hidden = !boardOpen || !atlas?.flows;
    if (element.hidden) return;
    const title = $("#board-title")?.value ?? "";
    element.innerHTML = boardHtml();
    $("#board-title").value = title;
    if (boardMode === "canvas") canvasDraw();
  }
  function boardShow(open) {
    boardOpen = open;
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
  /** Where in the order something dropped at this point goes: before the first step that comes after it. */
  function boardIndex(zone, event) {
    const cards = $$(".step", zone);
    const at = cards.findIndex((card) => {
      const box = card.getBoundingClientRect();
      return event.clientY < box.top || (event.clientY <= box.bottom && event.clientX < box.left + box.width / 2);
    });
    return at < 0 ? cards.length : at;
  }
  const boardMark = (zone, index) => {
    for (const marked of $$("#board .before, #board .after, #board .over")) marked.classList.remove("before", "after", "over");
    if (!zone) return;
    zone.classList.add("over");
    if (index === undefined) return;
    const cards = $$(".step", zone);
    if (cards[index]) cards[index].classList.add("before");
    else cards.at(-1)?.classList.add("after");
  };
  /** What a drop means, as operations; nothing when it changes nothing. */
  function boardDrop(zone, index) {
    const kind = zone.dataset.drop;
    const target = zone.dataset.flow;
    if (kind === "bin") {
      if (drag.kind === "step") return [{ op: "unstep", flow: drag.flow, at: drag.at }];
      if (drag.kind === "trigger" && drag.flow) return [{ op: "set", flow: drag.flow, when: flowOf(drag.flow).when.filter((name) => name !== drag.name) }];
      return [];
    }
    if (kind === "new") {
      if (drag.kind === "trigger") return [{ ...boardNewFlow("New flow"), when: [drag.name] }];
      if (drag.kind === "artifact") {
        const start = boardNewFlow(artifactOf(drag.what).title);
        return [start, { op: "step", flow: start.flow, what: drag.what, to: freePlace(drag.what) }];
      }
      return [];
    }
    const flow = flowOf(target);
    if (drag.kind === "trigger") {
      const operations = flow.when.includes(drag.name) ? [] : [{ op: "set", flow: target, when: [...flow.when, drag.name] }];
      // From another flow: it moves.
      if (drag.flow && drag.flow !== target) operations.push({ op: "set", flow: drag.flow, when: flowOf(drag.flow).when.filter((name) => name !== drag.name) });
      return operations;
    }
    if (kind !== "steps") return [];
    const count = flow.steps.length;
    const position = index ?? count;
    if (drag.kind === "artifact") {
      return [{ op: "step", flow: target, what: drag.what, to: freePlace(drag.what) }, ...(position < count ? [{ op: "move", flow: target, at: count + 1, by: position - count }] : [])];
    }
    if (drag.kind === "step" && drag.flow === target) {
      const to = position > drag.at - 1 ? position - 1 : position;
      return to === drag.at - 1 ? [] : [{ op: "move", flow: target, at: drag.at, by: to - (drag.at - 1) }];
    }
    if (drag.kind === "step") {
      // Into another flow: the step with its place and options, and out of the flow it came from.
      const { id: _id, after: _after, ...moved } = flowOf(drag.flow).steps[drag.at - 1];
      return [{ op: "step", flow: target, ...moved }, ...(position < count ? [{ op: "move", flow: target, at: count + 1, by: position - count }] : []), { op: "unstep", flow: drag.flow, at: drag.at }];
    }
    return [];
  }
  const boardZone = (event) => {
    if (!drag) return undefined;
    const zone = event.target.closest?.("[data-drop]");
    if (!zone) return event.target.closest?.(".lane[data-lane]") && drag.kind === "trigger" ? $("[data-drop=when]", event.target.closest(".lane")) : undefined;
    if (zone.dataset.drop === "canvas") return ["artifact", "trigger", "flow"].includes(drag.kind) && !drag.flow ? zone : undefined;
    // An artifact or a step dropped on the triggers of a lane goes to the end of its steps.
    if (zone.dataset.drop === "when" && drag.kind !== "trigger") return $("[data-drop=steps]", zone.closest(".lane"));
    if (zone.dataset.drop === "steps" && drag.kind === "trigger") return $("[data-drop=when]", zone.closest(".lane"));
    return zone;
  };
  $("#board").addEventListener("dragstart", (event) => {
    const item = event.target.closest?.("[data-drag]");
    if (!item) return;
    drag = { kind: item.dataset.drag, what: item.dataset.what, name: item.dataset.name, flow: item.dataset.flow, at: Number(item.dataset.at) || undefined };
    // Firefox drags only what carries data.
    event.dataTransfer.setData("text/plain", item.dataset.what ?? item.dataset.name ?? `${drag.flow} ${drag.at}`);
    event.dataTransfer.effectAllowed = "copyMove";
    item.classList.add("dragging");
    $("#board").classList.toggle("removable", drag.kind === "step" || Boolean(drag.kind === "trigger" && drag.flow));
  });
  $("#board").addEventListener("dragover", (event) => {
    const zone = boardZone(event);
    if (!zone) return boardMark();
    event.preventDefault();
    event.dataTransfer.dropEffect = drag.kind === "artifact" || (drag.kind === "trigger" && !drag.flow) ? "copy" : "move";
    boardMark(zone, zone.dataset.drop === "steps" ? boardIndex(zone, event) : undefined);
    return undefined;
  });
  $("#board").addEventListener("drop", (event) => {
    const zone = boardZone(event);
    if (!zone) return;
    event.preventDefault();
    if (zone.dataset.drop === "canvas") {
      const dropped = drag;
      drag = undefined;
      boardMark();
      canvasDrop(dropped, event);
      return;
    }
    const operations = boardDrop(zone, zone.dataset.drop === "steps" ? boardIndex(zone, event) : undefined);
    drag = undefined;
    boardMark();
    if (operations.length) flowApply(operations);
  });
  $("#board").addEventListener("dragend", () => {
    drag = undefined;
    boardMark();
    $("#board").classList.remove("removable");
    $("#board .dragging")?.classList.remove("dragging");
  });
  $("#board").addEventListener("click", (event) => {
    const step = event.target.closest(".step");
    if (step) return flowEdit(step.dataset.flow, Number(step.dataset.at));
    const item = event.target.closest("button");
    if (!item) return undefined;
    if (item.dataset.boardMode) {
      boardMode = item.dataset.boardMode;
      return boardDraw();
    }
    if (item.dataset.canvas) return canvasTool(item.dataset.canvas);
    if (item.dataset.flowAct) return flowClick(item);
    const act = item.dataset.board;
    if (act === "close") return boardShow(false);
    if (act === "flow") return flowEdit(item.dataset.flow);
    if (act === "add") return flowEdit(item.dataset.flow, "new");
    if (act === "save") return download("flow-changes.json", `${JSON.stringify({ operations: flowChanges }, null, 2)}\n`, "application/json");
    if (act === "create") {
      if (!$("#board-title").value.trim()) return toast("A flow needs a title.");
      return flowApply([boardNewFlow()]);
    }
    return undefined;
  });
  $("#board").addEventListener("keydown", (event) => {
    if (event.key === "Escape") return boardShow(false);
    if (event.target.classList?.contains("canvas")) {
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        return canvasRemove();
      }
      if (event.key === "Enter" && picked?.node) return canvasOpen(picked.node);
    }
    // A step is a button for the keyboard too; the forms do what dragging does.
    if ((event.key === "Enter" || event.key === " ") && event.target.classList?.contains("step")) {
      event.preventDefault();
      flowEdit(event.target.dataset.flow, Number(event.target.dataset.at));
    }
    if (event.key === "Enter" && event.target.id === "board-title") $('[data-board="create"]').click();
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
  const sight = { x: 28, y: 24, k: 1 };
  let wiring;
  let picked;
  let gesture;
  let removing;
  let lastClick;
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
  function canvasNodeHtml(node) {
    const { triggers } = atlas.flows;
    const style = `style="left:${node.pos[0]}px;top:${node.pos[1]}px"`;
    const ports = (into, out) => `${into ? '<span class="port in" data-port="in" title="Drop a wire here"></span>' : ""}${out ? '<span class="port out" data-port="out" title="Drag a wire from here"></span>' : ""}`;
    if (node.kind === "trigger") return `<div class="node trigger" data-key="${esc(node.key)}" ${style} title="${esc(triggers[node.name].summary)}. Delivery: ${esc(triggers[node.name].sync)}"><small>When</small><b>${esc(node.name)}</b>${ports(false, true)}</div>`;
    if (node.kind === "flow") {
      const { flow } = node;
      return `<div class="node flow" data-key="${esc(node.key)}" ${style} title="Double-click for its title, triggers, and delivery"><small>Flow · ${esc(flow.id)}</small><b>${esc(flow.title)}</b>
        <span class="acts">${LIVE ? `<button class="btn" data-flow-act="run" data-flow="${esc(flow.id)}" title="bca run --flow ${esc(flow.id)}" ${flow.steps.length ? "" : "disabled"}>Run now</button>` : ""}<button class="btn" data-flow-act="github" data-flow="${esc(flow.id)}" title="Export it as a workflow for GitHub Actions" ${flow.steps.length ? "" : "disabled"}>GitHub Actions</button></span>${ports(true, true)}</div>`;
    }
    const { what, to: _to, id: name, after: _after, ...options } = node.step;
    const artifact = artifactOf(what);
    const detail = options.lens ?? options.story ?? options.view ?? options.language;
    const place = placeOfStep(node.step);
    const loose = node.kind === "loose";
    return `<div class="node step ${loose ? "loose" : ""}" data-key="${esc(node.key)}" ${style} title="${loose ? "In no flow yet: drag a wire into it from a flow or one of its steps" : "Double-click for where it is saved and its options. Pull a wire from its right into the steps that come after it"}"><small>${loose ? "Not wired" : `Step ${node.at}`}${name ? ` · ${esc(name)}` : ""}</small><b>${esc(artifact?.title ?? what)}${detail ? `: ${esc(detail)}` : ""}</b><small>${esc(place ? `→ ${place}` : artifact?.plugin ? "task of a plugin" : "gate")}</small>${ports(true, !loose)}</div>`;
  }
  let model;
  function canvasDraw() {
    const world = $("#board .world");
    if (!world) return;
    model = canvasModel();
    world.innerHTML = `<svg class="wires" aria-hidden="true"></svg>${[...model.nodes.values()].map(canvasNodeHtml).join("")}`;
    world.style.transform = `translate(${sight.x}px, ${sight.y}px) scale(${sight.k})`;
    if (picked?.node && !model.nodes.has(picked.node)) picked = undefined;
    if (picked?.wire && !model.wires.some((wire) => wire.from === picked.wire.from && wire.to === picked.wire.to)) picked = undefined;
    if (!model.nodes.size) world.insertAdjacentHTML("beforeend", '<p class="empty">Drag <b>New flow</b> here, then an artifact, and pull a wire from the flow into it.</p>');
    canvasWires();
  }
  /** Where the ports of a node are, in the coordinates of the world. */
  function canvasPort(key, side) {
    const element = $(`#board .node[data-key="${CSS.escape(key)}"]`);
    if (!element) return undefined;
    return [element.offsetLeft + (side === "out" ? element.offsetWidth : 0), element.offsetTop + element.offsetHeight / 2];
  }
  const curve = ([x1, y1], [x2, y2]) => {
    const bend = Math.max(36, Math.abs(x2 - x1) / 2);
    return `M${x1} ${y1} C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}`;
  };
  const CONDITION = { passed: "if it passed", failed: "if it fails", always: "in any case" };
  function canvasWires() {
    const svg = $("#board .wires");
    if (!svg) return;
    const same = (wire) => picked?.wire && picked.wire.from === wire.from && picked.wire.to === wire.to;
    svg.innerHTML = model.wires.map((wire, index) => {
      const from = canvasPort(wire.from, "out");
      const to = canvasPort(wire.to, "in");
      if (!from || !to) return "";
      const path = curve(from, to);
      const label = wire.cond && wire.cond !== "passed" ? `<text class="label ${wire.cond}" x="${(from[0] + to[0]) / 2}" y="${(from[1] + to[1]) / 2 - 7}" text-anchor="middle">${CONDITION[wire.cond]}</text>` : "";
      return `<path class="wire ${wire.kind} ${wire.cond ?? ""} ${wire.loose ? "idle" : ""} ${same(wire) ? "picked" : ""}" d="${path}"></path>${label}${wire.loose ? "" : `<path class="hit" data-wire="${index}" d="${path}"><title>Click to select the wire${wire.fromAt ? " and say when it holds" : ""}, or to remove it</title></path>`}`;
    }).join("") + (wiring ? `<path class="wire pending" d="${curve(canvasPort(wiring.from, "out"), wiring.to)}"></path>` : "");
    for (const element of $$("#board .node")) element.classList.toggle("picked", picked?.node === element.dataset.key);
    const remove = $('#board [data-canvas="remove"]');
    if (remove) {
      remove.disabled = !picked;
      remove.textContent = removing && picked?.node === removing ? "Remove the flow and its steps" : "Remove";
    }
    // A wire between two steps says when the second runs.
    const chosen = picked?.wire ? model.wires.find(same) : undefined;
    const condition = $("#board [data-canvas-if]");
    if (condition) {
      condition.hidden = !chosen?.fromAt;
      if (chosen?.fromAt) condition.value = chosen.cond;
    }
  }
  /** A point of the screen in the coordinates of the world. */
  function canvasPoint(event) {
    const box = $("#board .canvas").getBoundingClientRect();
    return [(event.clientX - box.left - sight.x) / sight.k, (event.clientY - box.top - sight.y) / sight.k];
  }
  function canvasZoom(factor, anchor) {
    const element = $("#board .canvas");
    const [px, py] = anchor ?? [element.clientWidth / 2, element.clientHeight / 2];
    const k = Math.min(2, Math.max(0.3, sight.k * factor));
    sight.x = px - (px - sight.x) * (k / sight.k);
    sight.y = py - (py - sight.y) * (k / sight.k);
    sight.k = k;
    $("#board .world").style.transform = `translate(${sight.x}px, ${sight.y}px) scale(${sight.k})`;
  }
  function canvasFit() {
    const elements = $$("#board .node");
    const element = $("#board .canvas");
    if (!elements.length) return;
    const left = Math.min(...elements.map((node) => node.offsetLeft));
    const top = Math.min(...elements.map((node) => node.offsetTop));
    const right = Math.max(...elements.map((node) => node.offsetLeft + node.offsetWidth));
    const bottom = Math.max(...elements.map((node) => node.offsetTop + node.offsetHeight));
    sight.k = Math.min(1.25, Math.max(0.3, Math.min((element.clientWidth - 56) / (right - left), (element.clientHeight - 96) / (bottom - top))));
    sight.x = 28 - left * sight.k;
    sight.y = 24 - top * sight.k;
    $("#board .world").style.transform = `translate(${sight.x}px, ${sight.y}px) scale(${sight.k})`;
  }
  function canvasTool(tool) {
    if (tool === "in") return canvasZoom(1.2);
    if (tool === "out") return canvasZoom(1 / 1.2);
    if (tool === "fit") return canvasFit();
    if (tool === "remove") return canvasRemove();
    if (tool === "tidy") {
      canvas.positions = {};
      canvasSave();
      canvasDraw();
      return canvasFit();
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
   * Takes a step out of its flow, and with it the steps that run only through it: they would
   * otherwise run whatever became of it. They stay on the canvas with their wires, in no flow.
   * @param gone the step itself is removed, not kept on the canvas
   */
  function canvasDetach(flow, index, gone) {
    const out = new Set([index]);
    for (let grown = true; grown;) {
      grown = false;
      flow.steps.forEach((step, order) => {
        if (out.has(order)) return;
        const before = wiresOf(step).map((wire) => flow.steps.findIndex(({ id }) => id === wire.step));
        if (before.length && before.every((other) => out.has(other))) {
          out.add(order);
          grown = true;
        }
      });
    }
    const members = [...out].sort((a, b) => a - b);
    const kept = members.filter((order) => !(gone && order === index));
    const freed = kept.map((order) => {
      const { after: _after, ...step } = flow.steps[order];
      // Wires to what stays in the flow, or goes for good, do not come along.
      const wires = wiresOf(flow.steps[order]).filter((wire) => kept.includes(flow.steps.findIndex(({ id }) => id === wire.step)) && order !== index);
      return { step: { ...step, ...(wires.length ? { after: wires } : {}) }, pos: model.nodes.get(stepKey(flow, order)).pos };
    });
    const dropped = stepKey(flow, index);
    return flowApply(members.reverse().map((order) => ({ op: "unstep", flow: flow.id, at: order + 1 })), undefined, () => {
      const group = looseKey();
      for (const { step, pos } of freed) {
        const key = looseKey();
        canvas.loose.push({ key, step, group });
        canvas.positions[key] = pos;
      }
      if (gone) delete canvas.positions[dropped];
    });
  }
  /** Takes what is selected away: a wire, or a node. */
  async function canvasRemove() {
    if (!picked) return undefined;
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
      return canvasDetach(flow, wire.at - 1, false);
    }
    const node = model.nodes.get(picked.node);
    if (!node) return undefined;
    if (node.kind === "flow" && removing !== node.key) {
      // Asked twice before a flow goes with its steps.
      removing = node.key;
      canvasWires();
      return toast(`Remove again to take the flow ${node.flow.id} and its ${plural(node.flow.steps.length, "step")} away.`);
    }
    removing = undefined;
    picked = undefined;
    if (node.kind === "step") return canvasDetach(node.flow, node.at - 1, true);
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
    const ground = event.target.closest?.(".canvas");
    if (!ground || event.button !== 0 || event.target.closest("button, select, .tools, .kept")) return;
    const element = event.target.closest(".node");
    const hit = event.target.closest("[data-wire]");
    if (removing) removing = undefined;
    if (event.target.closest(".port.out")) {
      gesture = { kind: "wire" };
      wiring = { from: element.dataset.key, to: canvasPoint(event) };
    } else if (element) {
      const node = model.nodes.get(element.dataset.key);
      gesture = { kind: "node", key: node.key, element, start: [event.clientX, event.clientY], origin: [...node.pos], moved: false };
    } else if (hit) {
      const wire = model.wires[Number(hit.dataset.wire)];
      picked = { wire: { from: wire.from, to: wire.to } };
      ground.focus({ preventScroll: true });
      return canvasWires();
    } else {
      gesture = { kind: "pan", start: [event.clientX, event.clientY], origin: [sight.x, sight.y], moved: false };
    }
    event.preventDefault();
    ground.focus({ preventScroll: true });
    try { $("#board").setPointerCapture(event.pointerId); } catch { /* optional */ }
    return undefined;
  });
  $("#board").addEventListener("pointermove", (event) => {
    if (!gesture) return;
    if (gesture.kind === "wire") {
      wiring.to = canvasPoint(event);
      const over = document.elementFromPoint(event.clientX, event.clientY)?.closest?.("#board .node");
      for (const element of $$("#board .node.aim")) element.classList.remove("aim");
      if (over && over.dataset.key !== wiring.from) over.classList.add("aim");
      return canvasWires();
    }
    const dx = event.clientX - gesture.start[0];
    const dy = event.clientY - gesture.start[1];
    if (Math.abs(dx) + Math.abs(dy) > 3) gesture.moved = true;
    if (!gesture.moved) return;
    if (gesture.kind === "pan") {
      sight.x = gesture.origin[0] + dx;
      sight.y = gesture.origin[1] + dy;
      $("#board .world").style.transform = `translate(${sight.x}px, ${sight.y}px) scale(${sight.k})`;
      return;
    }
    const node = model.nodes.get(gesture.key);
    node.pos = [Math.round(gesture.origin[0] + dx / sight.k), Math.round(gesture.origin[1] + dy / sight.k)];
    gesture.element.style.left = `${node.pos[0]}px`;
    gesture.element.style.top = `${node.pos[1]}px`;
    canvasWires();
  });
  const canvasRelease = (event) => {
    if (!gesture) return undefined;
    const done = gesture;
    gesture = undefined;
    try { $("#board").releasePointerCapture(event.pointerId); } catch { /* optional */ }
    if (done.kind === "wire") {
      const from = wiring.from;
      wiring = undefined;
      const over = event.type === "pointerup" ? document.elementFromPoint(event.clientX, event.clientY)?.closest?.("#board .node") : undefined;
      for (const element of $$("#board .node.aim")) element.classList.remove("aim");
      canvasWires();
      return over ? canvasConnect(from, over.dataset.key) : undefined;
    }
    if (done.kind === "pan") {
      if (!done.moved) {
        picked = undefined;
        canvasWires();
      }
      return undefined;
    }
    picked = { node: done.key };
    canvasWires();
    if (!done.moved) {
      // The pointer is held by the board while it is down, so a double click is two clicks on one node.
      const twice = lastClick?.key === done.key && event.timeStamp - lastClick.time < 450;
      lastClick = twice ? undefined : { key: done.key, time: event.timeStamp };
      return twice ? canvasOpen(done.key) : undefined;
    }
    canvas.positions[done.key] = model.nodes.get(done.key).pos;
    return canvasSave();
  };
  $("#board").addEventListener("pointerup", canvasRelease);
  $("#board").addEventListener("pointercancel", canvasRelease);
  /** A node opened: the form of a flow or of a step. */
  function canvasOpen(key) {
    const node = model.nodes.get(key);
    if (!node) return undefined;
    if (node.kind === "flow") return flowEdit(node.flow.id);
    if (node.kind === "step") return flowEdit(node.flow.id, node.at);
    return toast(node.kind === "loose" ? "It is in no flow yet: pull a wire into it from a flow or one of its steps, then set its place and options." : "A trigger has no settings of its own; how it delivers is in the form of a flow.");
  }
  $("#board").addEventListener("change", (event) => {
    if (event.target.dataset.canvasIf === undefined || !picked?.wire) return undefined;
    const wire = model.wires.find(({ from, to }) => from === picked.wire.from && to === picked.wire.to);
    return wire?.fromAt ? flowApply([{ op: "wire", flow: wire.flow, from: wire.fromAt, into: wire.at, if: event.target.value }]) : undefined;
  });
  $("#board").addEventListener("wheel", (event) => {
    const ground = event.target.closest?.(".canvas");
    if (!ground) return;
    event.preventDefault();
    const box = ground.getBoundingClientRect();
    canvasZoom(event.deltaY < 0 ? 1.1 : 1 / 1.1, [event.clientX - box.left, event.clientY - box.top]);
  }, { passive: false });

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
    if (!LIVE) {
      // A snapshot shows the change and keeps it to save; the project gets it with bca flow define --from.
      flowLocal(operations);
      flowChanges.push(...operations);
      if (change) {
        change();
        await canvasSave();
      }
      toast(`Kept: ${operations.map(describeOperation).join("; ")}. Save the changes from the Flow menu.`);
      boardDraw();
      if (!openMenu) return true;
      flowForm = next?.flow && flowOf(next.flow) ? next : undefined;
      flowRedraw();
      return true;
    }
    try {
      const result = await call("defineFlows", { operations });
      toast(result.written ? `Wrote ${String(result.file).split(/[\\/]/u).pop()}.` : "Nothing changed.");
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
    await reload("Reading the flows");
    // The builder stays open on the flow, so one step follows the other.
    if (menu && next?.flow && flowOf(next.flow)) {
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
      return boardShow(true);
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
        const command = `bca flow export --flow ${id}`;
        return navigator.clipboard?.writeText(command).then(() => toast(`Copied: ${command}. Run it in the project to write the workflow.`), () => toast(`Run in the project: ${command}`)) ?? toast(`Run in the project: ${command}`);
      }
      return call("exportFlow", { flow: id }).then((result) => toast(result.action === "unchanged"
        ? `${result.path} is up to date.`
        : `Wrote ${result.path}: ${Object.entries(result.delivery).map(([trigger, sync]) => `${trigger} → ${sync}`).join(", ")}. Commit it, and GitHub runs the flow.`), (error) => toast(error.message.replace(/^flows: /u, "")));
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
    if (openMenu.dataset.menu === "flow") flowForm = undefined;
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
    if (item.dataset.flowAct) flowClick(item);
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
  async function reload(text) {
    $("#sync-button").className = "tool status menu busy";
    $("#sync-text").textContent = text;
    try {
      if (text !== "Reading" && LIVE) await call("refresh").catch(() => undefined);
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
