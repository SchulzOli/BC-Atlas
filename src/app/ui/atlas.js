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

  const NEUTRAL = "#94A3B8";
  const SEVERITY = { error: "#C0392B", warning: "#B7791F", info: "#2A78D6" };
  const RANK = { error: 3, warning: 2, info: 1 };
  // Calm colors that stay apart for people who see colors differently.
  const PALETTE = ["#0072B2", "#D55E00", "#009E73", "#CC79A7", "#E69F00", "#56B4E9", "#7C3AED", "#4E5D78", "#A23636", "#14766E", "#8B7400", "#A21CAF"];
  const KIND_NAMES = { object: "Object", app: "App", component: "Component", module: "Namespace", rule: "Rule", process: "Process", task: "Process test", person: "Person", requirement: "Requirement", member: "Member" };
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
  let position = new Map();
  let findingsOf = new Map();
  const insides = new Map();
  /** Reads the atlas, and what follows from it: where each node is, and its findings. */
  async function load() {
    atlas = LIVE ? await call("atlas") : SNAPSHOT.atlas;
    position = new Map(atlas.nodes.map((node, index) => [node.id, index]));
    findingsOf = new Map();
    for (const finding of atlas.findings) {
      for (const index of finding.nodes) (findingsOf.get(index) ?? findingsOf.set(index, []).get(index)).push(finding);
    }
    insides.clear();
  }
  /** One object from the inside (src/app/atlas.js), or nothing when it is not part of an export. */
  async function inside(id) {
    if (!insides.has(id)) {
      insides.set(id, LIVE ? await call("inside", { id }).catch(() => undefined) : SNAPSHOT.inside?.[id]);
    }
    return insides.get(id);
  }
  const worst = (index) => {
    let found;
    for (const finding of findingsOf.get(index) ?? []) if (!found || RANK[finding.severity] > RANK[found]) found = finding.severity;
    return found;
  };

  // ----------------------------------------------------------------- state
  // The whole view, as it is in the address: #lens=data&form=diagram&sel=...
  const DEFAULTS = { lens: "system", form: "2d", q: "", sel: "", focus: "", depth: "1", check: "", story: "", step: "0", color: "", size: "", group: "", off: "", hide: "", inside: "" };
  function readState() {
    const hash = location.hash.replace(/^#\/?/u, "");
    // Links of earlier versions to one object.
    if (hash.startsWith("object/")) return { ...DEFAULTS, sel: decodeURIComponent(hash.slice(7).split("?")[0]) };
    const params = new URLSearchParams(hash.includes("=") ? hash : "");
    return { ...DEFAULTS, ...Object.fromEntries([...params].filter(([key]) => key in DEFAULTS)) };
  }
  let state = readState();
  function stateHash(from = state) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(from)) if (value !== DEFAULTS[key]) params.set(key, value);
    return `#${params}`;
  }
  function remember() {
    const hash = stateHash();
    if (hash === (location.hash || "#")) return;
    // An embedded page may not be allowed to change its address; the view works without.
    try { history.replaceState(null, "", hash); } catch { /* optional */ }
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

  /** The class a node falls into for the color mode: { key, label, color }. */
  function classOf(node, at, mode) {
    if (mode === "level") return { key: node.level ?? "none", label: node.level ?? "no level", color: atlas.levels[node.level] ?? NEUTRAL };
    if (mode === "findings" || mode === "severity") {
      const severity = node.kind === "rule" ? node.severity : at >= 0 ? worst(at) : undefined;
      return { key: severity ?? "none", label: severity ?? "no finding", color: SEVERITY[severity] ?? NEUTRAL };
    }
    if (["component", "namespace", "app", "layer"].includes(mode)) {
      const value = node[mode] ?? (node.kind === "module" && mode === "namespace" ? node.label : undefined);
      return { key: value ?? "none", label: value ?? (node.external ? "other apps" : `no ${mode}`), color: undefined };
    }
    if (node.external) return { key: "external", label: "other apps", color: node.color };
    if (mode === "status" && node.status) return { key: `${node.kind}:${node.status}`, label: `${KIND_NAMES[node.kind]?.toLowerCase() ?? node.kind}: ${node.status}`, color: node.color };
    const key = node.kind === "object" || node.kind === "member" ? node.type : node.kind;
    return { key, label: node.kind === "object" || node.kind === "member" ? node.type : (KIND_NAMES[node.kind] ?? node.kind).toLowerCase(), color: node.color };
  }

  /**
   * The part of the atlas the state asks for, as the graph draws it:
   * { key, title, summary, entries: [{ node, at }], nodes, edges, kinds, groups, classes }.
   */
  async function sceneFor() {
    const lens = lensOf(state.lens);
    const entries = [];
    const place = new Map();
    const enter = (node, at) => {
      if (!place.has(node.id)) {
        place.set(node.id, entries.length);
        entries.push({ node, at });
      }
      return place.get(node.id);
    };
    const kindIndex = new Map();
    const kinds = [];
    const kindOf = (relation) => {
      if (!kindIndex.has(relation.kind)) {
        kindIndex.set(relation.kind, kinds.length);
        kinds.push({ ...relation });
      }
      return kindIndex.get(relation.kind);
    };
    let links = [];
    let title = lens.title;
    let summary = lens.summary;
    const within = state.inside && position.has(state.inside) ? await inside(state.inside) : undefined;
    if (within) {
      const center = atlas.nodes[position.get(state.inside)];
      title = `Inside ${center.label}`;
      summary = "Its procedures, triggers, and events, and what each of them does with other objects.";
      enter(center, position.get(state.inside));
      for (const node of within.nodes) enter(node, -1);
      for (const [from, to, relation, weight] of within.edges) {
        for (const id of [from, to]) if (!place.has(id) && position.has(id)) enter(atlas.nodes[position.get(id)], position.get(id));
        if (place.has(from) && place.has(to)) links.push([place.get(from), place.get(to), kindOf(within.relations[relation]), weight]);
      }
    } else {
      const wanted = new Set(lens.kinds);
      const relations = new Set(lens.relations);
      const from = lens.from && new Set(lens.from);
      const types = new Set(lens.types ?? []);
      const candidate = atlas.nodes.map((node) => wanted.has(node.kind));
      const found = [];
      const touched = new Set();
      for (const edge of atlas.edges) {
        const relation = atlas.relations[edge[2]];
        if (!relations.has(relation.kind) || !candidate[edge[0]] || !candidate[edge[1]]) continue;
        if (from && !from.has(atlas.nodes[edge[0]].type)) continue;
        found.push(edge);
        touched.add(edge[0]);
        touched.add(edge[1]);
      }
      atlas.nodes.forEach((node, index) => {
        if (!candidate[index]) return;
        const always = node.kind !== "object" || (types.has(node.type) && !node.external);
        if (lens.connected && !touched.has(index) && !always) return;
        enter(node, index);
      });
      // In the order of the lens, so the legend reads the same every time.
      for (const kind of lens.relations) {
        const relation = atlas.relations.find((candidateRelation) => candidateRelation.kind === kind);
        if (relation && found.some((edge) => atlas.relations[edge[2]] === relation)) kindOf(relation);
      }
      links = found.map((edge) => [place.get(atlas.nodes[edge[0]].id), place.get(atlas.nodes[edge[1]].id), kindOf(atlas.relations[edge[2]]), edge[3]]);
    }

    // Only a node and what is near it.
    let keep;
    if (state.focus && place.has(state.focus)) {
      keep = new Set([place.get(state.focus)]);
      let rim = [...keep];
      for (let depth = 0; depth < Math.max(1, Number(state.depth) || 1); depth++) {
        const next = [];
        for (const [from, to] of links) {
          for (const [a, b] of [[from, to], [to, from]]) {
            if (rim.includes(a) && !keep.has(b)) {
              keep.add(b);
              next.push(b);
            }
          }
        }
        rim = next;
      }
    }
    const kept = keep ? entries.map((entry, index) => (keep.has(index) ? entry : undefined)) : entries;
    const renumber = new Map();
    const shown = [];
    kept.forEach((entry, index) => {
      if (!entry) return;
      renumber.set(index, shown.length);
      shown.push(entry);
    });
    const edges = links.filter(([from, to]) => renumber.has(from) && renumber.has(to)).map(([from, to, kind, weight]) => [renumber.get(from), renumber.get(to), kind, weight]);

    // Groups hold together; classes give the colors and the legend.
    const groupBy = state.group || (within ? "kind" : lens.group);
    const groupOf = (node) => (groupBy === "none" ? "" : groupBy === "kind" ? (node.kind === "object" ? node.type : node.kind) : node[groupBy] ?? (node.external ? "Other apps" : node.kind === "object" ? "" : node.kind));
    const groups = [...new Set(shown.map(({ node }) => String(groupOf(node))))].sort((a, b) => a.localeCompare(b));
    const groupPosition = new Map(groups.map((group, index) => [group, index]));
    const mode = state.color || (within ? "type" : lens.color);
    const classes = new Map();
    const own = [];
    const classed = shown.map(({ node, at }) => {
      const found = classOf(node, at, mode);
      const entry = classes.get(found.key) ?? classes.set(found.key, { ...found, count: 0 }).get(found.key);
      entry.count++;
      // A color of its own (a blocked process among processes) stays.
      own.push(found.color);
      return entry;
    });
    // Classes without a color of their own share the palette, in a fixed order.
    [...classes.values()].filter(({ color }) => !color).sort((a, b) => String(a.key).localeCompare(String(b.key)))
      .forEach((entry, index) => { entry.color = entry.key === "none" ? NEUTRAL : PALETTE[index % PALETTE.length]; });
    return {
      key: [within ? `inside:${state.inside}` : lens.id, state.focus, state.depth, groupBy].join("\n"),
      lens,
      title,
      summary,
      within: Boolean(within),
      entries: shown,
      place: new Map(shown.map(({ node }, index) => [node.id, index])),
      nodes: shown.map(({ node }, index) => ({ label: node.label, group: groupPosition.get(String(groupOf(node))), color: own[index] ?? classed[index].color })),
      classOf: classed,
      classes: [...classes.values()].sort((a, b) => b.count - a.count),
      edges,
      kinds,
      groups
    };
  }

  // ----------------------------------------------------------------- graph
  let scene;
  let graph;
  let applied = {};
  let rendering = Promise.resolve();
  let told = false;

  const SIZES = [["", "Same size"], ["relations", "Relations"], ["usedBy", "Used by"], ["uses", "Uses"], ["lines", "Lines of code"], ["complexity", "Complexity"], ["objects", "Objects"], ["findings", "Findings"]];
  function sizeValues(by) {
    if (!by) return undefined;
    if (by === "relations") return Array.from(graph.degree());
    if (by === "findings") return scene.entries.map(({ at }) => (at >= 0 ? findingsOf.get(at)?.length ?? 0 : 0));
    return scene.entries.map(({ node }) => Number(node[by]) || 0);
  }

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
    if (!graph || next.key !== applied.key) {
      graph?.destroy();
      scene = next;
      graph = BCA_GRAPH.create($("#graph"), scene, {
        mode: state.form,
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
    const hidden = list(state.hide);
    const off = list(state.off);
    const showKey = `${state.hide}\n${state.off}`;
    if (applied.show !== showKey) {
      const visible = Uint8Array.from(scene.classOf, (entry) => (hidden.has(String(entry.key)) ? 0 : 1));
      const shown = Uint8Array.from(scene.kinds, ({ kind }) => (off.has(kind) ? 0 : 1));
      if (applied.show !== undefined || hidden.size || off.size) graph.show(visible, shown.length ? shown : new Uint8Array(1).fill(1));
      applied.show = showKey;
    }
    const sizes = sizeValues(state.size);
    graph.size(sizes && sizes.some((value) => value > 0) ? sizes : undefined);
    // Check: a ring in the color of the worst finding on a node.
    graph.rings(state.check ? scene.entries.map(({ at }) => {
      const severity = at >= 0 ? worst(at) : undefined;
      return severity ? { color: SEVERITY[severity], width: severity === "info" ? 1.2 : 2.4 } : undefined;
    }) : undefined);

    // What stands out: the step of a story, else what the search finds.
    const query = state.q.trim().toLowerCase();
    let lit;
    if (step) lit = new Set(step.nodes.map((index) => scene.place.get(atlas.nodes[index]?.id)).filter((index) => index !== undefined));
    else if (query) lit = new Set(matches(query));
    graph.highlight(lit);
    $(".search").classList.toggle("none", Boolean(query) && !step && !lit.size);

    const selected = state.sel && scene.place.has(state.sel) ? scene.place.get(state.sel) : -1;
    if (graph.selected() !== selected) graph.select(selected);
    const focusKey = `${applied.key}\n${state.story}\n${state.step}`;
    if (step && applied.focus !== focusKey) {
      if (lit.size) graph.center([...lit], { animate: told });
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
  }

  const matches = (query) => scene.entries.map(({ node }, index) => ([node.label, node.type, node.kind, node.component, node.namespace, node.app, node.objectId]
    .some((value) => String(value ?? "").toLowerCase().includes(query)) ? index : -1)).filter((index) => index >= 0);

  /** A double click: an object opens to its inside, a member to its source, anything else to its neighbors. */
  function open({ node }) {
    if (node.kind === "member") return source(node);
    if (node.kind === "object" && !node.external && node.id !== state.inside) return set({ inside: node.id, focus: "", sel: node.id, story: "" });
    return set({ focus: node.id, sel: node.id, story: "" });
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
    $("#lens-name").textContent = scene.title;
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
    const sync = $("#sync-button");
    sync.className = `tool status menu ${LIVE ? "live" : ""}`;
    $("#sync-text").textContent = LIVE ? "Live" : new Date(SNAPSHOT.generatedAt).toLocaleDateString();
  }

  let folded;
  function legend() {
    const element = $("#legend");
    element.hidden = !scene.entries.length;
    const hidden = list(state.hide);
    const off = list(state.off);
    const counts = new Map();
    for (const edge of scene.edges) counts.set(edge[2], (counts.get(edge[2]) ?? 0) + 1);
    const back = scene.within || state.focus
      ? `<button class="chip back" data-back>← ${esc(scene.lens.title)}</button>`
      : "";
    folded ??= innerWidth < 720;
    element.innerHTML = `
      <div class="where">${back}<b>${esc(scene.title)}</b><span>${plural(scene.entries.length, "node")}, ${plural(scene.edges.length, "relation")}</span><button class="fold" data-fold aria-expanded="${!folded}" title="${folded ? "Show the legend" : "Hide the legend"}" aria-label="Legend"></button>${folded ? "" : `<p>${esc(scene.summary)}</p>`}</div>
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
    if (chip.dataset.back !== undefined) set({ inside: "", focus: "" });
    else if (chip.dataset.class !== undefined) set({ hide: toggled(state.hide, chip.dataset.class) });
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
    const canOpen = node.kind === "object" && !node.external && node.id !== state.inside;
    element.innerHTML = `
      <header>
        <div style="flex:1;min-width:0"><div class="kind"><i style="background:${esc(scene.nodes[index].color)}"></i>${esc(kind)}${node.external ? " · other app" : ""}</div><h2>${esc(node.label)}</h2></div>
        <button class="close" data-close aria-label="Close" title="Close (Esc)">×</button>
      </header>
      ${node.about || node.caption ? `<p class="about">${rich(node.about ?? node.caption)}</p>` : ""}
      ${facts.length ? `<dl class="facts">${facts.map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`).join("")}</dl>` : ""}
      <div class="actions">
        ${canOpen ? '<button class="btn primary" data-act="inside" title="Its procedures and what each does (double click)">Open</button>' : ""}
        <button class="btn" data-act="focus">${state.focus === node.id ? "Show all" : "Neighbors"}</button>
        ${node.file ? `<button class="btn" data-act="source">${LIVE ? "Go to source" : "Source"}</button>` : ""}
        <button class="btn" data-act="link">Link</button>
      </div>
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
    const act = event.target.closest("[data-act]")?.dataset.act;
    if (act === "inside") return set({ inside: entry.node.id, focus: "", story: "" });
    if (act === "focus") return set({ focus: state.focus === entry.node.id ? "" : entry.node.id, story: "" });
    if (act === "source") return source(entry.node);
    if (act === "link") return copyLink();
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
    if (action === "save") return download(`${fileName(story.title)}.md`, storyMarkdown(story), "text/markdown");
    return undefined;
  }
  $("#story").addEventListener("click", (event) => {
    const action = event.target.closest("[data-story]")?.dataset.story;
    if (action) storyAct(action);
  });

  // ---------------------------------------------------------------- export
  const stamp = () => `_Generated by BC Atlas ${atlas.version} from the AL source of ${atlas.title}. Do not edit; export it again._`;
  function storyMarkdown(story, level = 1) {
    const head = "#".repeat(level);
    return [
      `${head} ${story.title}`, "", story.summary, "",
      ...(level === 1 ? [stamp(), ""] : []),
      ...story.steps.flatMap((step, index) => [
        `${head}# ${index + 1}. ${step.title}`, "", step.text, "",
        ...(step.nodes.length ? [`Shown: ${step.nodes.slice(0, 12).map((node) => `\`${atlas.nodes[node].label}\``).join(", ")}${step.nodes.length > 12 ? `, and ${step.nodes.length - 12} more` : ""}.`, ""] : [])
      ])
    ].join("\n");
  }
  function documentation() {
    return [
      `# ${atlas.title}`, "", stamp(), "",
      "## Read from", "", ...atlas.sources.map(([name, value]) => `- **${name}:** ${value}`), "",
      ...atlas.stories.flatMap((story) => [storyMarkdown(story, 2), ""])
    ].join("\n");
  }
  function lensMarkdown() {
    const visible = scene.entries.filter(({ node }) => node.kind !== "member");
    const findings = [...new Set(visible.flatMap(({ at }) => (at >= 0 ? findingsOf.get(at) ?? [] : [])))];
    return [
      `# ${atlas.title}: ${scene.title}`, "", scene.summary, "", stamp(), "",
      `Read from ${scene.lens.reads}.`, "",
      `| Node | Kind | ${scene.groups.length > 1 ? "Group | " : ""}Relations |`, `| --- | --- | ${scene.groups.length > 1 ? "--- | " : ""}---: |`,
      ...scene.entries.map(({ node }, index) => `| ${node.label.replaceAll("|", "\\|")} | ${node.kind === "object" ? node.type : node.kind} | ${scene.groups.length > 1 ? `${scene.groups[scene.nodes[index].group] || ""} | ` : ""}${graph.degree()[index]} |`), "",
      ...(findings.length ? ["## Findings", "", ...findings.map((finding) => `- **${finding.severity}** \`${finding.rule}\`: ${finding.message}${finding.fix ? ` Fix: ${finding.fix}` : ""}`), ""] : [])
    ].join("\n");
  }
  const csv = (rows) => rows.map((row) => row.map((value) => (/[",\n]/u.test(String(value ?? "")) ? `"${String(value).replaceAll('"', '""')}"` : String(value ?? ""))).join(",")).join("\n");
  function sceneJson() {
    return JSON.stringify({
      generator: `BC Atlas ${atlas.version}`,
      project: atlas.title,
      lens: scene.lens.id,
      title: scene.title,
      summary: scene.summary,
      sources: Object.fromEntries(atlas.sources),
      nodes: scene.entries.map(({ node, at }, index) => ({ ...node, color: undefined, group: scene.groups[scene.nodes[index].group] || undefined, findings: at >= 0 ? findingsOf.get(at)?.map(({ severity, rule, message: text }) => ({ severity, rule, message: text })) : undefined })),
      relations: scene.edges.map(([from, to, kind, weight]) => ({ from: scene.entries[from].node.id, to: scene.entries[to].node.id, kind: scene.kinds[kind].kind, weight }))
    }, null, 2);
  }
  const EXPORTS = [
    ["png", "Picture", "PNG, as you see it", async () => download(`${fileName(`${atlas.title} ${scene.title}`)}.png`, new Uint8Array(await (await graph.image()).arrayBuffer()), "image/png")],
    ["svg", "Drawing", "SVG, as you see it", () => download(`${fileName(`${atlas.title} ${scene.title}`)}.svg`, graph.svg(), "image/svg+xml")],
    ["json", "Graph", "JSON: nodes with their facts, and relations", () => download(`${fileName(`${atlas.title} ${scene.title}`)}.json`, sceneJson(), "application/json")],
    ["nodes", "Nodes", "CSV, one row per node", () => {
      const keys = [...new Set(scene.entries.flatMap(({ node }) => Object.keys(node)))].filter((key) => !["color", "id"].includes(key));
      return download(`${fileName(`${atlas.title} ${scene.title}`)}-nodes.csv`, csv([["id", ...keys, "relations", "findings"], ...scene.entries.map(({ node, at }, index) => [node.id, ...keys.map((key) => node[key]), graph.degree()[index], at >= 0 ? findingsOf.get(at)?.length ?? 0 : 0])]), "text/csv");
    }],
    ["relations", "Relations", "CSV, one row per relation", () => download(`${fileName(`${atlas.title} ${scene.title}`)}-relations.csv`, csv([["from", "to", "kind", "weight"], ...scene.edges.map(([from, to, kind, weight]) => [scene.entries[from].node.label, scene.entries[to].node.label, scene.kinds[kind].kind, weight])]), "text/csv")],
    ["lens", "This lens", "Markdown: what shows, with its findings", () => download(`${fileName(`${atlas.title} ${scene.title}`)}.md`, lensMarkdown(), "text/markdown")],
    ["docs", "Documentation", "Markdown: every story of the system", () => download(`${fileName(atlas.title)}.md`, documentation(), "text/markdown")],
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
      ${LIVE ? '<div class="actions"><button class="btn" data-sync="refresh">Read the source again</button></div>' : ""}`
  };
  let openMenu;
  function closeMenu() {
    if (!openMenu) return;
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
    if (item.dataset.setLens) {
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
    const found = matches(state.q.trim().toLowerCase());
    if (!found.length || !state.q.trim()) return;
    cursor = (cursor + (event.shiftKey ? -1 : 1) + found.length) % found.length;
    set({ sel: scene.entries[found[cursor]].node.id }).then(() => graph.center([found[cursor]]));
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
      else if (state.inside || state.focus) set({ inside: "", focus: "" });
      return;
    }
    if (typing || !atlas) return;
    if (event.key === "/") {
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
  addEventListener("hashchange", () => {
    if (stateHash() === (location.hash || "#")) return;
    state = readState();
    render();
  });

  message("<b>Reading the AL source</b><span>Every object and what it does with the others.</span>");
  await reload("Reading");
  // A linked selection comes to the middle.
  if (state.sel && scene?.place.has(state.sel) && !state.story) graph.center([scene.place.get(state.sel)], { animate: false });
})();
