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
    ["wrongWay", "Wrong way"], ["instability", "Instability"], ["canBeApp", "Can be an app"], ["header", "Declaration"]
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
    const stage = $("#stage").clientWidth;
    const room = { right: state.sel && next.place.has(state.sel) && stage > 680 ? Math.min(340, stage - 24) + 24 : 0 };
    const moved = !graph || next.key !== applied.key || applied.form !== state.form;
    if (!graph || next.key !== applied.key) {
      // What stays in the picture stays where it is; the rest comes and goes around it.
      const before = graph?.snapshot();
      graph?.destroy();
      scene = next;
      graph = BCA_GRAPH.create($("#graph"), scene, {
        mode: state.form,
        from: before,
        room,
        onInfo: ({ selected }) => {
          const id = selected >= 0 ? scene.entries[selected].node.id : "";
          if (id === state.sel) return;
          state.sel = id;
          remember();
          inspector();
        },
        onOpen: (index) => open(scene.entries[index])
      });
      applied = { key: next.key, form: state.form };
    } else {
      scene = { ...next, nodes: scene.nodes };
      const colors = next.nodes.map(({ color }) => color);
      if (colors.join() !== applied.colors) graph.colors(colors);
    }
    applied.colors = scene.nodes.map(({ color }) => color).join();
    if (applied.form !== state.form) {
      graph.mode(state.form);
      applied.form = state.form;
    }

    // What shows: classes and kinds of relation switched off in the legend.
    flags = S.shown(scene, state);
    const showKey = `${state.hide}\n${state.off}`;
    if (applied.show !== showKey) {
      if (applied.show !== undefined || state.hide || state.off) graph.show(flags.nodes, flags.kinds.length ? flags.kinds : new Uint8Array(1).fill(1));
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
    for (const button of $$("#forms button")) button.setAttribute("aria-checked", String(button.dataset.form === state.form));
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
    $("#story-button").setAttribute("aria-pressed", String(Boolean(state.story)));
    // Simulate is there when the project has process tests to perform.
    $("#simulate-button").hidden = !atlas.simulation;
    $("#simulate-button").setAttribute("aria-pressed", String(state.lens === "simulation" && !state.inside));
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
    folded ??= innerWidth < 720;
    element.innerHTML = `
      <div class="where"><b>${esc(scene.title)}</b><span>${plural(scene.entries.length, "node")}, ${plural(scene.edges.length, "relation")}</span><button class="fold" data-fold aria-expanded="${!folded}" title="${folded ? "Show the legend" : "Hide the legend"}" aria-label="Legend"></button>${folded ? "" : `<p>${esc(scene.summary)}</p>`}</div>
      ${folded ? "" : `<div class="chips">${scene.classes.map((entry) => `<button class="chip ${hidden.has(String(entry.key)) ? "off" : ""}" data-class="${esc(entry.key)}" title="Show or hide"><i style="color:${esc(entry.color)}"></i>${esc(entry.label)} <small>${fmt(entry.count)}</small></button>`).join("")}</div>
      ${scene.kinds.length ? `<div class="chips">${scene.kinds.map((kind, index) => `<button class="chip ${off.has(kind.kind) ? "off" : ""}" data-kind="${esc(kind.kind)}" title="Show or hide"><i class="line ${kind.dash ? "dash" : ""}" style="color:${esc(kind.color)}"></i>${esc(kind.kind)} <small>${fmt(counts.get(index) ?? 0)}</small></button>`).join("")}</div>` : ""}`}`;
  }
  $("#legend").addEventListener("click", (event) => {
    if (event.target.closest("[data-fold]")) {
      folded = !folded;
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
    lens: () => atlas.lenses.map((lens) => `<button class="item" role="menuitem" data-set-lens="${esc(lens.id)}" ${lens.id === state.lens && !state.inside ? 'aria-current="true"' : ""}><b>${esc(lens.title)}</b><small>${esc(lens.summary)}</small></button>`).join(""),
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
  MENUS.simulate = () => {
    if (simForm) return simulateForm();
    const { definition, derived } = atlas.simulation;
    const battle = atlas.summary.battle ?? {};
    const people = atlas.nodes.filter((node) => node.kind === "person");
    const stopped = people.filter((node) => (findingsOf.get(position.get(node.id)) ?? []).some(({ severity }) => severity === "error")).length;
    const items = (kind) => (definition[SIM_KINDS[kind].list] ?? []).map((entry) => {
      const name = entry[SIM_KINDS[kind].key];
      const detail = kind === "agent" ? (entry.roles ?? []).join(", ") : kind === "role" ? (entry.permissionSets ?? []).join(", ") : kind === "requirement" ? entry.title : plural((entry.tasks ?? entry.features ?? []).length, kind === "taskGroup" && !entry.tasks ? "feature" : "process test");
      return `<button class="item" role="menuitem" data-sim-edit="${kind}" data-name="${esc(name)}"><b>${esc(name)}</b><small>${esc(detail ?? "")}</small></button>`;
    }).join("");
    return `<p class="text"><b>${esc(definition.company ?? battle.company ?? "The company")}</b>${derived ? ", as the process tests describe it. Nothing is defined yet: the first change starts from this." : ", as <code>.bca.json</code> defines it."}
        ${plural(people.length, "agent")}, ${stopped ? `${stopped} stopped or able to do what they must not` : "all get through"}.</p>
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
    if (item.dataset.sim || item.dataset.simEdit || item.dataset.simNew) simulateClick(item);
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
