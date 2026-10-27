/* BC Atlas graph explorer: runs in the browser on the embedded graph document. */
(async () => {
  "use strict";

  /** Inflates a gzip-compressed, base64-encoded graph document. */
  async function inflate(base64) {
    // atob instead of fetch(data:): pages with a strict connect-src block fetch.
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return JSON.parse(await new Response(stream).text());
  }

  const DOC = window.BCA_GRAPH ?? await inflate(window.BCA_GRAPH_GZIP);
  const FRAMES = DOC.timeline.frames;
  const LAST_FRAME = FRAMES.length - 1;
  const GHOST_FRAMES = 2;
  const $ = (selector) => document.querySelector(selector);

  const DEPENDENCIES = {
    "intra-app": { label: "Inside one app", color: "#7b8ba6" },
    "cross-module": { label: "Across modules of one app", color: "#b07aa1" },
    declared: { label: "Declared app dependency", color: "#2bb673" },
    implicit: { label: "Implicit (Microsoft apps, platform)", color: "#5b8def" },
    undeclared: { label: "Undeclared app dependency", color: "#ff4d4f" },
    unresolved: { label: "Unresolved or external", color: "#f5a623" },
    "declared-unused": { label: "Declared but unused", color: "#a0a8b8" }
  };
  const STATUS_COLORS = { added: "#00d8ff", changed: "#ffd400", removed: "#ff3b5c" };
  const PALETTE = [
    "#5b8def", "#f28e2b", "#59a14f", "#e15759", "#b07aa1", "#76b7b2",
    "#edc948", "#ff9da7", "#9c755f", "#4e79a7", "#a0cbe8", "#8cd17d",
    "#d37295", "#86bcb6", "#f1ce63", "#bab0ac"
  ];
  const TYPE_COLORS = {
    table: "#4e8fd8", tableextension: "#7fb0e8", page: "#4caf6a", pageextension: "#83cf98",
    pagecustomization: "#83cf98", codeunit: "#f0a030", report: "#a874c8", reportextension: "#c9a0e0",
    query: "#2ab3a6", xmlport: "#e05a5a", enum: "#9aa3ad", enumextension: "#c0c6cd",
    interface: "#e6c229", permissionset: "#8b6cf0", permissionsetextension: "#ae98f5",
    controladdin: "#5fc4e0", profile: "#d4789e", app: "#5b8def"
  };

  // ---------------------------------------------------------------- indexes
  const apps = new Map();
  const workspaceFirst = { workspace: 0, "declared-only": 1, symbol: 2, platform: 3, unresolved: 4 };
  [...DOC.levels.app.nodes]
    .sort((a, b) => (workspaceFirst[a.origin] ?? 9) - (workspaceFirst[b.origin] ?? 9) || a.label.localeCompare(b.label))
    .forEach((app, index) => {
      apps.set(app.id, {
        ...app,
        color: app.origin === "unresolved" ? "#8a8f98" : app.origin === "platform" ? "#6b8fb3" : PALETTE[index % PALETTE.length],
        order: index
      });
    });

  const levels = {};
  for (const [name, level] of Object.entries(DOC.levels)) {
    const byId = new Map(level.nodes.map((node) => [node.id, node]));
    for (const node of level.nodes) {
      node.firstFrame = node.presence[0][0];
      node.searchText = [node.label, node.objectId, node.type, node.namespace, node.file, apps.get(node.app)?.label]
        .filter(Boolean).join(" ").toLowerCase();
    }
    const maxRank = Math.max(1e-9, ...level.nodes.map(({ metrics }) => metrics.pagerank));
    const maxLayer = Math.max(0, ...level.nodes.map(({ metrics }) => metrics.buildLayer));
    level.edges.forEach((edge) => { edge.firstFrame = edge.presence[0][0]; });
    levels[name] = { ...level, byId, maxRank, maxLayer };
  }

  const count = (items, read) => {
    const counts = new Map();
    for (const item of items) for (const key of read(item)) counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  };

  // ------------------------------------------------------------------ state
  const stored = (() => {
    try { return JSON.parse(localStorage.getItem("bca-explorer") ?? "{}"); } catch { return {}; }
  })();
  const state = {
    level: "object",
    dependencies: new Set(Object.keys(DEPENDENCIES)),
    apps: new Set(apps.keys()),
    types: new Set(DOC.vocabulary.types),
    kinds: new Set(DOC.vocabulary.kinds),
    appContext: true,
    hideIsolated: false,
    minDegree: 0,
    search: "",
    colorBy: "app",
    sizeBy: "pagerank",
    layout: "clusters",
    labels: "auto",
    particles: true,
    highlight: true,
    ghosts: true,
    timeline: FRAMES.length > 1 ? "git" : "build",
    frame: LAST_FRAME,
    playing: false,
    speed: 1,
    selected: undefined,
    focusDepth: 0,
    theme: stored.theme ?? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
  };
  const remember = () => {
    try { localStorage.setItem("bca-explorer", JSON.stringify({ theme: state.theme })); } catch { /* optional */ }
  };

  // --------------------------------------------------------------- timeline
  const frameCount = () => state.timeline === "git" ? FRAMES.length : levels[state.level].maxLayer + 1;
  const presentAt = (item, frame) => item.presence.some(([start, end]) => start <= frame && (end === null || frame < end));
  const removedRecently = (item, frame) => !presentAt(item, frame) &&
    item.presence.some(([, end]) => end !== null && end <= frame && frame - end < GHOST_FRAMES);

  /** present | ghost | absent for the current frame and timeline mode. */
  function visibility(item, isNode) {
    if (state.timeline === "build") {
      if (!presentAt(item, LAST_FRAME)) return "absent";
      if (!isNode) return "present";
      return item.metrics.buildLayer <= state.frame ? "present" : "absent";
    }
    if (presentAt(item, state.frame)) return "present";
    return state.ghosts && removedRecently(item, state.frame) ? "ghost" : "absent";
  }

  function status(node) {
    if (node.__ghost) return "removed";
    if (state.timeline === "build") return node.metrics.buildLayer === state.frame && state.frame < frameCount() - 1 ? "added" : undefined;
    if (state.frame > 0 && node.presence.some(([start]) => start === state.frame)) return "added";
    if (node.changes.includes(state.frame)) return "changed";
    return undefined;
  }

  // -------------------------------------------------------------- filtering
  let visible = { nodes: [], links: [], ids: new Set(), out: new Map(), in: new Map() };

  function enabledWeight(edge) {
    if (!edge.kinds || !Object.keys(edge.kinds).length) return edge.weight || 1;
    let weight = 0;
    for (const [kind, value] of Object.entries(edge.kinds)) if (state.kinds.has(kind)) weight += value;
    return weight;
  }

  function computeVisible() {
    const level = levels[state.level];
    const typeOk = (node) => state.level !== "object" || state.types.has(node.type);
    const nodeState = new Map();
    for (const node of level.nodes) {
      const value = visibility(node, true);
      if (value !== "absent" && typeOk(node)) nodeState.set(node.id, value);
    }
    const inSelection = (node) => state.apps.has(state.level === "app" ? node.id : node.app) &&
      !(state.level === "object" && state.module && node.module !== state.module);

    const candidateEdges = [];
    for (const edge of level.edges) {
      if (!nodeState.has(edge.source) || !nodeState.has(edge.target)) continue;
      if (!state.dependencies.has(edge.dependency)) continue;
      const weight = enabledWeight(edge);
      const declaredOnly = state.level !== "object" && edge.dependency === "declared-unused";
      if (!weight && !declaredOnly) continue;
      const edgeState = visibility(edge, false);
      if (edgeState === "absent") continue;
      candidateEdges.push({ edge, weight: weight || 1, ghost: edgeState === "ghost" });
    }

    let ids = new Set([...nodeState.keys()].filter((id) => inSelection(level.byId.get(id))));
    const context = new Set();
    if (state.appContext && state.apps.size < apps.size) {
      for (const { edge } of candidateEdges) {
        if (ids.has(edge.source) && !ids.has(edge.target)) context.add(edge.target);
        if (ids.has(edge.target) && !ids.has(edge.source)) context.add(edge.source);
      }
      ids = new Set([...ids, ...context]);
    }
    let edges = candidateEdges.filter(({ edge }) =>
      ids.has(edge.source) && ids.has(edge.target) && !(context.has(edge.source) && context.has(edge.target))
    );

    // Degree filters, focus neighborhood, and search isolation.
    const degree = new Map();
    for (const { edge } of edges) {
      degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
      degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
    }
    ids = new Set([...ids].filter((id) => {
      const value = degree.get(id) ?? 0;
      if (state.hideIsolated && !value) return id === state.selected;
      return value >= state.minDegree || id === state.selected;
    }));
    if (state.selected && state.focusDepth > 0 && ids.has(state.selected)) {
      const keep = new Set([state.selected]);
      let frontier = new Set([state.selected]);
      for (let depth = 0; depth < state.focusDepth && frontier.size; depth++) {
        const next = new Set();
        for (const { edge } of edges) {
          for (const [from, to] of [[edge.source, edge.target], [edge.target, edge.source]]) {
            if (frontier.has(from) && ids.has(to) && !keep.has(to)) {
              keep.add(to);
              next.add(to);
            }
          }
        }
        frontier = next;
      }
      ids = keep;
    }
    edges = edges.filter(({ edge }) => ids.has(edge.source) && ids.has(edge.target));

    const out = new Map();
    const incoming = new Map();
    for (const { edge } of edges) {
      if (!out.has(edge.source)) out.set(edge.source, []);
      out.get(edge.source).push(edge);
      if (!incoming.has(edge.target)) incoming.set(edge.target, []);
      incoming.get(edge.target).push(edge);
    }
    const nodes = [...ids].map((id) => {
      const node = level.byId.get(id);
      node.__ghost = nodeState.get(id) === "ghost";
      node.__context = context.has(id);
      return node;
    });
    seedPositions(nodes, edges);
    visible = {
      nodes,
      links: edges.map(({ edge, weight, ghost }) => ({ source: edge.source, target: edge.target, edge, weight, ghost })),
      ids,
      out,
      in: incoming
    };
  }

  /** New nodes start next to an existing neighbor so the graph visibly grows. */
  function seedPositions(nodes, edges) {
    const missing = nodes.filter((node) => node.x === undefined);
    if (!missing.length || missing.length === nodes.length) return;
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const neighbors = new Map();
    for (const { edge } of edges) {
      for (const [from, to] of [[edge.source, edge.target], [edge.target, edge.source]]) {
        if (!neighbors.has(from)) neighbors.set(from, []);
        neighbors.get(from).push(to);
      }
    }
    for (const node of missing) {
      const neighbor = (neighbors.get(node.id) ?? [])
        .map((id) => byId.get(id))
        .find((candidate) => candidate?.x !== undefined);
      if (!neighbor) continue;
      node.x = neighbor.x + (Math.random() - 0.5) * 12;
      node.y = neighbor.y + (Math.random() - 0.5) * 12;
      node.z = (neighbor.z ?? 0) + (Math.random() - 0.5) * 12;
    }
  }

  // ------------------------------------------------------------- appearance
  const neighborhood = () => {
    if (!state.selected) return undefined;
    const ids = new Set([state.selected]);
    for (const edge of visible.out.get(state.selected) ?? []) ids.add(edge.target);
    for (const edge of visible.in.get(state.selected) ?? []) ids.add(edge.source);
    return ids;
  };
  let highlightIds;
  let searchIds;
  const dim = () => state.theme === "light" ? "#d5dae3" : "#2a3346";

  function sequential(value) {
    // Blue (oldest / bottom) to amber (newest / top).
    const t = Math.max(0, Math.min(1, value));
    const from = [91, 141, 239];
    const to = [245, 166, 35];
    const mix = from.map((channel, index) => Math.round(channel + (to[index] - channel) * t));
    return `rgb(${mix.join(",")})`;
  }

  function baseColor(node) {
    const level = levels[state.level];
    switch (state.colorBy) {
      case "type": return TYPE_COLORS[node.type] ?? "#9aa3ad";
      case "community": return PALETTE[node.metrics.community % PALETTE.length];
      case "layer": return sequential(node.metrics.buildLayer / Math.max(1, level.maxLayer));
      case "age": return sequential(node.firstFrame / Math.max(1, LAST_FRAME));
      case "cross-app": {
        const crossing = node.metrics.crossAppIn + node.metrics.crossAppOut;
        return crossing ? sequential(Math.min(1, crossing / 6)) : dim();
      }
      default: return apps.get(state.level === "app" ? node.id : node.app)?.color ?? "#9aa3ad";
    }
  }

  function nodeColor(node) {
    if (highlightIds && !highlightIds.has(node.id)) return dim();
    if (searchIds && !searchIds.has(node.id)) return dim();
    const current = state.highlight ? status(node) : node.__ghost ? "removed" : undefined;
    if (current) return STATUS_COLORS[current];
    if (node.__context) return state.theme === "light" ? "#b7c0cf" : "#56627a";
    return baseColor(node);
  }

  function nodeSize(node) {
    const boost = state.highlight && status(node) && status(node) !== "removed" ? 2.5 : 1;
    return baseSize(node) * boost;
  }

  function baseSize(node) {
    const level = levels[state.level];
    if (state.level !== "object") return 3 + Math.sqrt(node.objectCount ?? 1) * 3;
    switch (state.sizeBy) {
      case "in": return 1 + node.metrics.inDegree * 1.6;
      case "out": return 1 + node.metrics.outDegree * 1.6;
      case "cross-app": return 1 + (node.metrics.crossAppIn + node.metrics.crossAppOut) * 3;
      case "uniform": return 3;
      default: return 1 + 24 * (node.metrics.pagerank / level.maxRank);
    }
  }

  function linkColor(link) {
    if (link.ghost) return STATUS_COLORS.removed;
    if (highlightIds && !(highlightIds.has(link.edge.source) && highlightIds.has(link.edge.target) &&
      (link.edge.source === state.selected || link.edge.target === state.selected))) return dim();
    if (link.edge.inCycle && link.edge.dependency === "intra-app") return "#c678dd";
    return DEPENDENCIES[link.edge.dependency]?.color ?? "#7b8ba6";
  }

  const crossesApps = (link) => link.edge.scope === "inter-app";
  function linkWidth(link) {
    const selected = state.selected && (link.edge.source === state.selected || link.edge.target === state.selected);
    if (state.level !== "object") return 0.6 + Math.log2(1 + link.weight) * 0.8 + (selected ? 1 : 0);
    if (crossesApps(link)) return 0.8 + Math.log2(1 + link.weight) * 0.5 + (selected ? 0.8 : 0);
    return selected ? 0.8 : 0;
  }
  function linkParticles(link) {
    if (!state.particles || link.ghost) return 0;
    if (link.edge.dependency === "undeclared") return 4;
    return crossesApps(link) && link.edge.dependency !== "declared-unused" ? 2 : 0;
  }

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/gu, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const nodeTitle = (node) => node.type === "app" ? node.label : `${node.type} ${node.objectId ? `${node.objectId} ` : ""}${node.label}`;
  const kindsText = (kinds) => Object.entries(kinds ?? {}).map(([kind, value]) => `${kind}${value > 1 ? ` ×${value}` : ""}`).join(", ");

  function nodeTooltip(node) {
    const app = apps.get(state.level === "app" ? node.id : node.app);
    const current = status(node);
    return `<div style="font:12px system-ui;padding:2px 4px">
      <b>${escapeHtml(nodeTitle(node))}</b><br>
      <span style="opacity:.75">${escapeHtml(app?.label ?? "")}${node.namespace ? ` · ${escapeHtml(node.namespace)}` : ""}</span><br>
      in ${node.metrics.inDegree} · out ${node.metrics.outDegree} · cross-app ${node.metrics.crossAppIn + node.metrics.crossAppOut}
      ${current ? `<br><b style="color:${STATUS_COLORS[current]}">${current}</b>` : ""}
    </div>`;
  }
  function linkTooltip(link) {
    const level = levels[state.level];
    const source = level.byId.get(link.edge.source);
    const target = level.byId.get(link.edge.target);
    return `<div style="font:12px system-ui;padding:2px 4px">
      ${escapeHtml(source?.label)} → ${escapeHtml(target?.label)}<br>
      <span style="color:${DEPENDENCIES[link.edge.dependency]?.color}">${escapeHtml(DEPENDENCIES[link.edge.dependency]?.label ?? link.edge.dependency)}</span>
      ${link.edge.kinds && Object.keys(link.edge.kinds).length ? `<br>${escapeHtml(kindsText(link.edge.kinds))}` : ""}
    </div>`;
  }

  // ------------------------------------------------------------------ graph
  let graph;
  try {
    graph = ForceGraph3D({ controlType: "orbit", rendererConfig: { antialias: true, alpha: true, preserveDrawingBuffer: true } })($("#graph"));
  } catch (error) {
    $("#fallback").style.display = "grid";
    console.error(error);
    return;
  }
  graph
    .nodeId("id")
    .nodeVal(nodeSize)
    .nodeColor(nodeColor)
    .nodeOpacity(0.92)
    .nodeResolution(12)
    .nodeLabel(nodeTooltip)
    .linkColor(linkColor)
    .linkWidth(linkWidth)
    .linkOpacity(0.55)
    .linkLabel(linkTooltip)
    .linkDirectionalArrowLength((link) => state.level !== "object" ? 5 : crossesApps(link) ? 4 : 2.5)
    .linkDirectionalArrowRelPos(1)
    .linkDirectionalArrowColor(linkColor)
    .linkDirectionalParticles(linkParticles)
    .linkDirectionalParticleWidth((link) => link.edge.dependency === "undeclared" ? 2.4 : 1.6)
    .linkDirectionalParticleSpeed(0.006)
    .linkDirectionalParticleColor(linkColor)
    .onNodeClick((node) => select(node.id, { fly: false }))
    .onNodeRightClick((node) => select(node.id, { fly: true }))
    .onLinkClick((link) => showEdge(link.edge))
    .onBackgroundClick(() => select(undefined))
    .onNodeDragEnd((node) => {
      node.fx = node.x;
      node.fy = node.y;
      node.fz = node.z;
    })
    .showNavInfo(false)
    .cooldownTime(8000)
    .warmupTicks(20);

  const resize = () => graph.width(innerWidth).height(innerHeight);
  addEventListener("resize", resize);
  resize();

  function applyBackground() {
    document.documentElement.dataset.theme = state.theme;
    graph.backgroundColor(state.theme === "light" ? "#f4f6fb" : "#0b1020");
  }

  // ----------------------------------------------------------------- layout
  function appAnchor(appId) {
    const app = apps.get(appId);
    const total = Math.max(1, apps.size);
    const index = app?.order ?? 0;
    const radius = 90 + 30 * Math.sqrt(total);
    // Fibonacci sphere keeps app clusters evenly apart in three dimensions.
    const y = total === 1 ? 0 : 1 - (index / (total - 1)) * 2;
    const ring = Math.sqrt(1 - y * y);
    const theta = Math.PI * (3 - Math.sqrt(5)) * index;
    return { x: Math.cos(theta) * ring * radius, y: y * radius * 0.6, z: Math.sin(theta) * ring * radius };
  }

  function clusterForce(alpha) {
    if (state.level === "app" || !["clusters", "app-layers"].includes(state.layout)) return;
    const strength = state.layout === "clusters" ? 0.12 : 0.05;
    for (const node of visible.nodes) {
      const anchor = appAnchor(node.app);
      node.vx += (anchor.x - node.x) * strength * alpha;
      if (state.layout === "clusters") node.vy += (anchor.y - node.y) * strength * alpha;
      node.vz += (anchor.z - node.z) * strength * alpha;
    }
  }
  graph.d3Force("appCluster", clusterForce);

  function applyLayout({ reheat = true } = {}) {
    const level = levels[state.level];
    const appLayer = (node) => {
      const app = apps.get(state.level === "app" ? node.id : node.app);
      return state.level === "app" ? node.metrics.buildLayer : levels.app.byId.get(app?.id)?.metrics.buildLayer ?? 0;
    };
    graph.numDimensions(state.layout === "flat" ? 2 : 3);
    for (const node of level.nodes) {
      node.fx = undefined;
      node.fy = undefined;
      node.fz = undefined;
      if (state.layout === "app-layers") node.fy = appLayer(node) * 110;
      if (state.layout === "build-layers") node.fy = node.metrics.buildLayer * 55;
      if (state.layout === "time") node.fx = (node.firstFrame - LAST_FRAME / 2) * Math.max(40, 600 / Math.max(1, LAST_FRAME));
      if (state.layout === "flat") node.z = 0;
    }
    if (reheat) graph.d3ReheatSimulation();
    setTimeout(() => graph.zoomToFit(600, 60), 1600);
  }

  // ------------------------------------------------------------- rendering
  let fitted = false;
  function render({ layout = false } = {}) {
    computeVisible();
    highlightIds = neighborhood();
    searchIds = state.search ? new Set(visible.nodes.filter((node) => node.searchText.includes(state.search)).map(({ id }) => id)) : undefined;
    if (layout) applyLayout({ reheat: false });
    graph.graphData({ nodes: visible.nodes, links: visible.links });
    refreshStyles();
    renderStats();
    renderFrameInfo();
    renderSpark();
    renderLegend();
    if (state.selected && !visible.ids.has(state.selected)) $("#details").classList.remove("open");
    else if (state.selected) showNode(state.selected);
    updateLabelNodes();
    if (!fitted) {
      fitted = true;
      setTimeout(() => graph.zoomToFit(600, 60), 1200);
    }
  }

  function refreshStyles() {
    highlightIds = neighborhood();
    graph
      .nodeColor(nodeColor)
      .nodeVal(nodeSize)
      .linkColor(linkColor)
      .linkWidth(linkWidth)
      .linkDirectionalArrowColor(linkColor)
      .linkDirectionalParticleColor(linkColor)
      .linkDirectionalParticles(linkParticles);
  }

  function renderStats() {
    const inter = visible.links.filter(crossesApps).length;
    const noun = { app: "apps", module: "modules" }[state.level] ?? "objects";
    $("#stats").textContent = `${visible.nodes.length} ${noun} · ${visible.links.length} dependencies · ${inter} across apps`;
  }

  // ----------------------------------------------------------------- labels
  let labelNodes = [];
  const labelLayer = $("#labels");
  function updateLabelNodes() {
    labelLayer.textContent = "";
    if (state.labels === "off") {
      labelNodes = [];
      return;
    }
    let candidates;
    if (state.labels === "all" || state.level === "app") candidates = visible.nodes.slice(0, 600);
    else {
      const chosen = new Set();
      [...visible.nodes].sort((a, b) => nodeSize(b) - nodeSize(a)).slice(0, 18).forEach(({ id }) => chosen.add(id));
      highlightIds?.forEach((id) => chosen.add(id));
      if (searchIds && searchIds.size <= 60) searchIds.forEach((id) => chosen.add(id));
      candidates = visible.nodes.filter(({ id }) => chosen.has(id));
    }
    labelNodes = candidates.map((node) => {
      const element = document.createElement("div");
      element.className = `node-label${node.id === state.selected || state.level === "app" ? " strong" : ""}`;
      element.textContent = node.label;
      labelLayer.append(element);
      return { node, element };
    });
  }
  function drawLabels() {
    if (labelNodes.length) {
      const camera = graph.camera();
      const matrix = camera.matrixWorld.elements;
      const forward = [-matrix[8], -matrix[9], -matrix[10]];
      for (const { node, element } of labelNodes) {
        if (node.x === undefined) continue;
        const dx = node.x - camera.position.x;
        const dy = node.y - camera.position.y;
        const dz = (node.z ?? 0) - camera.position.z;
        if (dx * forward[0] + dy * forward[1] + dz * forward[2] <= 0) {
          element.style.display = "none";
          continue;
        }
        const point = graph.graph2ScreenCoords(node.x, node.y, node.z ?? 0);
        element.style.display = "";
        element.style.transform = `translate(${point.x}px, ${point.y}px) translate(-50%, -160%)`;
      }
    }
    requestAnimationFrame(drawLabels);
  }
  requestAnimationFrame(drawLabels);

  // -------------------------------------------------------------- selection
  function select(requested, { fly = false } = {}) {
    const id = levels[state.level].byId.get(requested)?.id;
    state.selected = id;
    if (!id) {
      state.focusDepth = 0;
      $("#details").classList.remove("open");
      render();
      return;
    }
    if (state.focusDepth) render();
    else {
      refreshStyles();
      updateLabelNodes();
      showNode(id);
    }
    if (fly) flyTo(id);
  }

  function flyTo(id) {
    const node = levels[state.level].byId.get(id);
    if (!node || node.x === undefined) return;
    const distance = 90;
    const length = Math.hypot(node.x, node.y, node.z ?? 0) || 1;
    const ratio = 1 + distance / length;
    graph.cameraPosition(
      { x: node.x * ratio, y: node.y * ratio, z: (node.z ?? 0) * ratio + (length < 1 ? distance : 0) },
      { x: node.x, y: node.y, z: node.z ?? 0 },
      900
    );
  }

  function frameLabel(index) {
    const frame = FRAMES[index];
    if (!frame) return "";
    return `${frame.kind === "commit" ? frame.id : "working tree"} · ${frame.date?.slice(0, 10) ?? ""}`;
  }

  function dependencyList(edges, direction) {
    const level = levels[state.level];
    if (!edges.length) return `<p class="hint">None in the current filter.</p>`;
    const sorted = [...edges].sort((a, b) =>
      (a.scope === "inter-app" ? 0 : 1) - (b.scope === "inter-app" ? 0 : 1) || b.weight - a.weight);
    return `<ul class="link-list">${sorted.slice(0, 80).map((edge) => {
      const other = level.byId.get(direction === "out" ? edge.target : edge.source);
      const dependency = DEPENDENCIES[edge.dependency];
      return `<li data-node="${escapeHtml(other?.id)}" title="${escapeHtml(kindsText(edge.kinds))}">
        <span class="swatch" style="background:${apps.get(state.level === "app" ? other?.id : other?.app)?.color ?? "#999"}"></span>
        <span class="name">${escapeHtml(other?.label ?? "?")}</span>
        <span class="pill" style="background:${dependency?.color}">${escapeHtml(edge.dependency)}</span>
      </li>`;
    }).join("")}${sorted.length > 80 ? `<li class="hint">+${sorted.length - 80} more</li>` : ""}</ul>`;
  }

  function historyHtml(item) {
    if (state.timeline !== "git" || FRAMES.length < 2) return "";
    const spans = item.presence.map(([start, end]) =>
      `<li>${end === null ? "since" : "from"} <span class="mono">${escapeHtml(frameLabel(start))}</span>${end === null ? "" : ` until <span class="mono">${escapeHtml(frameLabel(end))}</span> (removed)`}</li>`);
    const changes = item.changes.map((index) =>
      `<li data-frame="${index}" style="cursor:pointer">changed in <span class="mono">${escapeHtml(frameLabel(index))}</span> ${escapeHtml(FRAMES[index]?.label ?? "")}</li>`);
    return `<h3>History</h3><ul class="history-list">${spans.join("")}${changes.slice(-12).join("")}</ul>`;
  }

  function showNode(id) {
    const level = levels[state.level];
    const node = level.byId.get(id);
    if (!node) return;
    const app = apps.get(state.level === "app" ? node.id : node.app);
    const outgoing = level.edges.filter((edge) => edge.source === id && visibility(edge, false) === "present");
    const incoming = level.edges.filter((edge) => edge.target === id && visibility(edge, false) === "present");
    const metrics = node.metrics;
    const panel = $("#details");
    const rows = state.level === "module"
      ? [
          ["App", app ? `<span class="swatch" style="display:inline-block;background:${app.color}"></span> ${escapeHtml(app.label)}` : ""],
          ["Manifest", node.path ? `<span class="mono">${escapeHtml(node.path)}</span>` : "app root"],
          ["Objects", node.objectCount],
          ["Depends on", `${metrics.outDegree} module(s)`],
          ["Used by", `${metrics.inDegree} module(s)`],
          ["Build layer", metrics.buildLayer],
          ["Cycle", metrics.cycle === undefined ? "no" : `yes (#${metrics.cycle + 1})`]
        ]
      : state.level === "app"
      ? [
          ["Publisher", node.publisher], ["Version", node.version], ["App ID", node.appId],
          ["Origin", node.origin], ["Objects", node.objectCount], ["Build layer", metrics.buildLayer]
        ]
      : [
          ["App", app ? `<span class="swatch" style="display:inline-block;background:${app.color}"></span> ${escapeHtml(app.label)}` : ""],
          ["Namespace", escapeHtml(node.namespace)],
          ["Source", node.file ? `<span class="mono">${escapeHtml(node.file)}${node.line ? `:${node.line}` : ""}</span>` : escapeHtml(node.origin)],
          ["Depends on", `${metrics.outDegree} (${metrics.crossAppOut} across apps)`],
          ["Used by", `${metrics.inDegree} (${metrics.crossAppIn} across apps)`],
          ["PageRank", metrics.pagerank.toFixed(4)],
          ["Build layer", metrics.buildLayer],
          ["Community", metrics.community],
          ["Cycle", metrics.cycle === undefined ? "no" : `yes (#${metrics.cycle + 1})`]
        ];
    panel.innerHTML = `
      <button class="icon-button close" data-action="close" title="Close (Esc)">✕</button>
      <h2>${escapeHtml(node.label)}</h2>
      <div class="subtitle">${escapeHtml(state.level === "object" ? `${node.type}${node.objectId ? ` ${node.objectId}` : ""}` : state.level)}${node.outsideSelection ? " · outside the selected path" : ""}</div>
      <div class="actions">
        <button class="icon-button" data-action="fly">Fly to</button>
        <button class="icon-button" data-action="focus" aria-pressed="${state.focusDepth > 0}">${state.focusDepth > 0 ? `Neighborhood ${state.focusDepth}` : "Isolate neighborhood"}</button>
        ${state.focusDepth > 0 ? `<button class="icon-button" data-action="deeper">+1 level</button>` : ""}
        ${state.level === "object" ? `<button class="icon-button" data-action="only-app">Only this app</button>` : `<button class="icon-button" data-action="drill">Show its objects</button>`}
      </div>
      <dl>${rows.filter(([, value]) => value !== undefined && value !== "").map(([label, value]) => `<dt>${label}</dt><dd>${typeof value === "string" && value.startsWith("<") ? value : escapeHtml(value)}</dd>`).join("")}</dl>
      <h3>Depends on (${outgoing.length})</h3>${dependencyList(outgoing, "out")}
      <h3>Used by (${incoming.length})</h3>${dependencyList(incoming, "in")}
      ${historyHtml(node)}`;
    panel.classList.add("open");
  }

  function showEdge(edge) {
    const level = levels[state.level];
    const source = level.byId.get(edge.source);
    const target = level.byId.get(edge.target);
    const dependency = DEPENDENCIES[edge.dependency];
    const evidence = (edge.evidence ?? []).map((item) =>
      `<li><b>${escapeHtml(item.kind)}</b>${item.member ? ` in ${escapeHtml(item.member)}` : ""}${item.file ? ` · <span class="mono">${escapeHtml(item.file)}${item.line ? `:${item.line}` : ""}</span>` : ""}</li>`);
    const panel = $("#details");
    panel.innerHTML = `
      <button class="icon-button close" data-action="close" title="Close (Esc)">✕</button>
      <h2>${escapeHtml(source?.label)} → ${escapeHtml(target?.label)}</h2>
      <div class="subtitle"><span class="pill" style="background:${dependency?.color}">${escapeHtml(dependency?.label ?? edge.dependency)}</span></div>
      <dl>
        <dt>Weight</dt><dd>${edge.weight}</dd>
        ${edge.objectEdges !== undefined ? `<dt>Object links</dt><dd>${edge.objectEdges}</dd><dt>In app.json</dt><dd>${edge.declared ? "yes" : "no"}</dd>` : ""}
        <dt>Kinds</dt><dd>${escapeHtml(kindsText(edge.kinds)) || "-"}</dd>
      </dl>
      <ul class="link-list">
        <li data-node="${escapeHtml(source?.id)}"><span class="name">From ${escapeHtml(source?.label)}</span></li>
        <li data-node="${escapeHtml(target?.id)}"><span class="name">To ${escapeHtml(target?.label)}</span></li>
      </ul>
      ${evidence.length ? `<h3>Evidence</h3><ul class="history-list">${evidence.join("")}</ul>` : ""}
      ${historyHtml(edge)}`;
    panel.classList.add("open");
  }

  $("#details").addEventListener("click", (event) => {
    const item = event.target.closest("[data-node]");
    if (item) return select(item.dataset.node, { fly: true });
    const frame = event.target.closest("[data-frame]");
    if (frame) return setFrame(Number(frame.dataset.frame));
    const action = event.target.closest("[data-action]")?.dataset.action;
    const node = levels[state.level].byId.get(state.selected);
    if (action === "close") select(undefined);
    if (action === "fly" && node) flyTo(node.id);
    if (action === "focus") {
      state.focusDepth = state.focusDepth ? 0 : 1;
      render();
    }
    if (action === "deeper") {
      state.focusDepth++;
      render();
    }
    if (action === "only-app" && node) {
      state.apps = new Set([node.app]);
      buildFilters();
      render({ layout: true });
    }
    if (action === "drill" && node) {
      state.apps = new Set([state.level === "app" ? node.id : node.app]);
      state.module = state.level === "module" ? node.id : undefined;
      setLevel("object");
      if (state.module) toast(`Objects of module ${node.label}; Reset filters shows all`);
    }
  });

  // ---------------------------------------------------------------- filters
  function checkList(id, items, selected, { swatch, line } = {}) {
    return items.map(([value, label, total]) => `
      <label class="check">
        <input type="checkbox" data-list="${id}" value="${escapeHtml(value)}" ${selected.has(value) ? "checked" : ""}>
        ${swatch ? `<span class="swatch${line ? " line" : ""}" style="background:${swatch(value)}"></span>` : ""}
        <span class="name" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
        <span class="count">${total ?? ""}</span>
      </label>`).join("");
  }

  function section(id, title, body, { open = true, bulk = false } = {}) {
    return `<details class="section" ${open ? "open" : ""} data-section="${id}">
      <summary>${title}${bulk ? `<span class="summary-actions"><button data-bulk="${id}" data-value="all">all</button><button data-bulk="${id}" data-value="none">none</button></span>` : ""}</summary>
      ${body}
    </details>`;
  }

  function select_(id, label, options, value) {
    return `<div class="field"><label for="option-${id}">${label}</label><select id="option-${id}" data-setting="${id}">
      ${options.map(([optionValue, optionLabel]) => `<option value="${optionValue}" ${optionValue === value ? "selected" : ""}>${optionLabel}</option>`).join("")}
    </select></div>`;
  }

  function buildFilters() {
    const level = levels[state.level];
    const openSections = new Set([...document.querySelectorAll("#filters details[open]")].map((element) => element.dataset.section));
    const isOpen = (id, fallback = true) => document.querySelector("#filters details") ? openSections.has(id) : fallback;
    const dependencyCounts = count(level.edges, (edge) => [edge.dependency]);
    const appCounts = state.level === "app"
      ? new Map(level.nodes.map((node) => [node.id, node.objectCount]))
      : count(level.nodes, (node) => [node.app]);
    const typeCounts = count(levels.object.nodes, (node) => [node.type]);
    const kindCounts = count(level.edges, (edge) => Object.keys(edge.kinds ?? {}));
    const dependencies = Object.keys(DEPENDENCIES)
      .filter((key) => dependencyCounts.has(key))
      .map((key) => [key, DEPENDENCIES[key].label, dependencyCounts.get(key)]);
    const appItems = [...apps.values()]
      .filter((app) => appCounts.has(app.id))
      .map((app) => [app.id, app.label, appCounts.get(app.id)]);
    const typeItems = DOC.vocabulary.types.map((type) => [type, type, typeCounts.get(type)]);
    const kindItems = DOC.vocabulary.kinds.filter((kind) => kindCounts.has(kind)).map((kind) => [kind, kind, kindCounts.get(kind)]);

    $("#filters").innerHTML = [
      section("dependencies", "Dependency scope", checkList("dependencies", dependencies, state.dependencies, {
        swatch: (value) => DEPENDENCIES[value].color, line: true
      }) + `<p class="hint">Inside one app vs. across app boundaries (app.json).</p>`, { open: isOpen("dependencies") }),
      section("apps", `Apps (${appItems.length})`, checkList("apps", appItems, state.apps, {
        swatch: (value) => apps.get(value)?.color
      }) + (state.level === "object" ? `<label class="check"><input type="checkbox" data-setting="appContext" ${state.appContext ? "checked" : ""}><span class="name">Show neighbors in other apps</span></label>` : ""),
      { open: isOpen("apps"), bulk: true }),
      state.level === "object"
        ? section("types", "Object types", checkList("types", typeItems, state.types, { swatch: (value) => TYPE_COLORS[value] ?? "#9aa3ad" }), { open: isOpen("types", false), bulk: true })
        : "",
      section("kinds", "Relation kinds", checkList("kinds", kindItems, state.kinds), { open: isOpen("kinds", false), bulk: true }),
      section("display", "Display", [
        select_("colorBy", "Color", [["app", "App"], ["type", "Object type"], ["community", "Community (Louvain)"], ["layer", "Build layer"], ["age", "Age (first commit)"], ["cross-app", "Cross-app coupling"]], state.colorBy),
        state.level === "object" ? select_("sizeBy", "Size", [["pagerank", "PageRank"], ["in", "Used by"], ["out", "Depends on"], ["cross-app", "Cross-app links"], ["uniform", "Uniform"]], state.sizeBy) : "",
        select_("layout", "Layout", [["clusters", "App clusters (3D)"], ["force", "Free force (3D)"], ["app-layers", "Apps as floors"], ["build-layers", "Build order as floors"], ["time", "Commit timeline axis (4D)"], ["flat", "Flat (2D)"]], state.layout),
        select_("labels", "Labels", [["auto", "Important"], ["all", "All"], ["off", "Off"]], state.labels),
        `<div class="field"><label for="option-minDegree">Min. links</label><input id="option-minDegree" data-setting="minDegree" type="range" min="0" max="10" value="${state.minDegree}"></div>`,
        `<label class="check"><input type="checkbox" data-setting="hideIsolated" ${state.hideIsolated ? "checked" : ""}><span class="name">Hide unconnected nodes</span></label>`,
        `<label class="check"><input type="checkbox" data-setting="particles" ${state.particles ? "checked" : ""}><span class="name">Animate cross-app flow</span></label>`,
        `<label class="check"><input type="checkbox" data-setting="highlight" ${state.highlight ? "checked" : ""}><span class="name">Highlight added and changed</span></label>`,
        `<label class="check"><input type="checkbox" data-setting="ghosts" ${state.ghosts ? "checked" : ""}><span class="name">Show removed as ghosts</span></label>`,
        `<p class="hint">Click: select · right-click: fly to · drag: pin · scroll: zoom</p>`,
        `<button class="icon-button" data-action="reset" style="margin:4px 0 6px">Reset filters</button>`
      ].join(""), { open: isOpen("display") })
    ].join("");
  }

  // Values read back from the page are only accepted as one of these
  // constants, so nothing typed into the DOM ever reaches innerHTML.
  const LISTS = ["dependencies", "apps", "types", "kinds"];
  const CHOICES = {
    colorBy: ["app", "type", "community", "layer", "age", "cross-app"],
    sizeBy: ["pagerank", "in", "out", "cross-app", "uniform"],
    layout: ["clusters", "force", "app-layers", "build-layers", "time", "flat"],
    labels: ["auto", "all", "off"]
  };
  const FLAGS = ["appContext", "hideIsolated", "particles", "highlight", "ghosts"];
  const known = (values, value) => values[values.indexOf(value)];
  const listValues = (list) => {
    const name = known(LISTS, list);
    if (!name) return undefined;
    const universe = name === "apps" ? [...apps.keys()]
      : name === "dependencies" ? Object.keys(DEPENDENCIES)
        : DOC.vocabulary[name];
    return { name, universe };
  };
  const toCount = (value) => Math.max(0, Math.min(10, Math.trunc(Number(value)) || 0));

  $("#filters").addEventListener("change", (event) => {
    const input = event.target;
    if (input.dataset.list) {
      const list = listValues(input.dataset.list);
      const value = list && known(list.universe, input.value);
      if (value === undefined) return;
      if (input.checked) state[list.name].add(value);
      else state[list.name].delete(value);
      return render();
    }
    const setting = input.dataset.setting;
    if (!setting) return;
    if (input.type === "checkbox") {
      const flag = known(FLAGS, setting);
      if (!flag) return;
      state[flag] = input.checked;
    } else if (input.type === "range") state.minDegree = toCount(input.value);
    else {
      const name = known(Object.keys(CHOICES), setting);
      const value = name && known(CHOICES[name], input.value);
      if (!value) return;
      state[name] = value;
    }
    if (setting === "layout") return render({ layout: true });
    if (["colorBy", "sizeBy", "particles", "highlight"].includes(setting)) {
      refreshStyles();
      return renderLegend();
    }
    if (setting === "labels") return updateLabelNodes();
    render();
  });
  $("#filters").addEventListener("input", (event) => {
    if (event.target.type !== "range") return;
    state.minDegree = toCount(event.target.value);
    render();
  });
  $("#filters").addEventListener("click", (event) => {
    const bulk = event.target.closest("[data-bulk]");
    if (bulk) {
      event.preventDefault();
      const list = listValues(bulk.dataset.bulk);
      if (!list) return;
      const shown = new Set([...document.querySelectorAll(`input[data-list="${list.name}"]`)].map((input) => input.value));
      const values = list.universe.filter((value) => shown.has(value));
      const current = state[list.name];
      state[list.name] = new Set(bulk.dataset.value === "all" ? [...current, ...values] : [...current].filter((value) => !values.includes(value)));
      buildFilters();
      return render();
    }
    if (event.target.closest("[data-action=reset]")) {
      Object.assign(state, {
        dependencies: new Set(Object.keys(DEPENDENCIES)),
        apps: new Set(apps.keys()),
        types: new Set(DOC.vocabulary.types),
        kinds: new Set(DOC.vocabulary.kinds),
        minDegree: 0,
        hideIsolated: false,
        focusDepth: 0,
        module: undefined
      });
      buildFilters();
      render();
    }
  });

  // ----------------------------------------------------------------- legend
  function renderLegend() {
    const used = new Set(visible.links.map((link) => link.edge.dependency));
    const rows = Object.entries(DEPENDENCIES)
      .filter(([key]) => used.has(key))
      .map(([, { label, color }]) => `<div class="row"><span class="swatch line" style="background:${color}"></span>${label}</div>`);
    if (state.highlight) {
      rows.push(`<div class="row"><span class="swatch" style="background:${STATUS_COLORS.added}"></span>added in this frame</div>`);
      if (state.timeline === "git") {
        rows.push(`<div class="row"><span class="swatch" style="background:${STATUS_COLORS.changed}"></span>changed in this frame</div>`);
        if (state.ghosts) rows.push(`<div class="row"><span class="swatch" style="background:${STATUS_COLORS.removed}"></span>removed</div>`);
      }
    }
    $("#legend").innerHTML = rows.join("");
  }

  // ------------------------------------------------------------------ level
  function setLevel(level) {
    state.level = level;
    state.selected = undefined;
    state.focusDepth = 0;
    $("#details").classList.remove("open");
    document.querySelectorAll("[data-level]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.level === level)));
    if (state.timeline === "build") state.frame = frameCount() - 1;
    setupTimeline();
    buildFilters();
    fitted = false;
    render({ layout: true });
  }
  document.querySelectorAll("[data-level]").forEach((button) => button.addEventListener("click", () => setLevel(known(["object", "module", "app"], button.dataset.level) ?? "object")));

  // --------------------------------------------------------------- timeline
  let timer;
  function setupTimeline() {
    const slider = $("#frame");
    slider.max = String(frameCount() - 1);
    slider.value = String(Math.min(state.frame, frameCount() - 1));
    $("#timeline-mode").value = state.timeline;
    $("#timeline-mode").querySelector('[value="git"]').disabled = FRAMES.length < 2;
  }

  function setFrame(frame) {
    state.frame = Math.max(0, Math.min(frameCount() - 1, Math.trunc(Number(frame)) || 0));
    $("#frame").value = String(state.frame);
    render();
  }

  function play(on = !state.playing) {
    state.playing = on;
    $("#play").textContent = on ? "⏸" : "▶";
    clearInterval(timer);
    if (!on) return;
    if (state.frame >= frameCount() - 1) setFrame(0);
    timer = setInterval(() => {
      if (state.frame >= frameCount() - 1) return play(false);
      setFrame(state.frame + 1);
    }, 1400 / state.speed);
  }

  function renderFrameInfo() {
    const info = $("#frame-info");
    if (state.timeline === "build") {
      const level = levels[state.level];
      const added = level.nodes.filter((node) => presentAt(node, LAST_FRAME) && node.metrics.buildLayer === state.frame).length;
      info.innerHTML = `<div class="title">Build layer ${state.frame} of ${frameCount() - 1}</div>
        <div class="meta"><span class="delta-add">+${added}</span> ${{ app: "apps", module: "modules" }[state.level] ?? "objects"} whose dependencies are all in place</div>`;
      return;
    }
    const frame = FRAMES[state.frame];
    const stats = frame.stats;
    info.innerHTML = `<div class="title" title="${escapeHtml(frame.label)}">${escapeHtml(frame.label || frame.id)}</div>
      <div class="meta">${escapeHtml(frameLabel(state.frame))}${frame.author ? ` · ${escapeHtml(frame.author)}` : ""}${frame.commits > 1 ? ` · ${frame.commits} commits` : ""}
      · <span class="delta-add">+${stats.addedNodes}</span> <span class="delta-remove">−${stats.removedNodes}</span> <span class="delta-change">~${stats.changedNodes}</span></div>`;
  }

  function renderSpark() {
    const canvas = $("#spark");
    const width = canvas.clientWidth;
    if (!width) return;
    const ratio = devicePixelRatio || 1;
    canvas.width = width * ratio;
    canvas.height = 32 * ratio;
    const context = canvas.getContext("2d");
    context.scale(ratio, ratio);
    const frames = frameCount();
    const level = levels[state.level];
    const values = state.timeline === "git"
      ? FRAMES.map((frame) => ({ total: frame.stats.nodes, added: frame.stats.addedNodes, removed: frame.stats.removedNodes, changed: frame.stats.changedNodes }))
      : Array.from({ length: frames }, (_, layer) => {
          const total = level.nodes.filter((node) => presentAt(node, LAST_FRAME) && node.metrics.buildLayer <= layer).length;
          const added = level.nodes.filter((node) => presentAt(node, LAST_FRAME) && node.metrics.buildLayer === layer).length;
          return { total, added, removed: 0, changed: 0 };
        });
    const max = Math.max(1, ...values.map(({ total }) => total));
    const barWidth = width / frames;
    values.forEach((value, index) => {
      const x = index * barWidth;
      const height = (value.total / max) * 28;
      context.fillStyle = index === state.frame ? getComputedStyle(document.documentElement).getPropertyValue("--accent") : "rgba(148,163,184,0.35)";
      context.fillRect(x + 1, 32 - height, Math.max(1, barWidth - 2), height);
      const marks = [[value.added, STATUS_COLORS.added], [value.changed, STATUS_COLORS.changed], [value.removed, STATUS_COLORS.removed]];
      let offset = 0;
      for (const [amount, color] of marks) {
        if (!amount) continue;
        const markHeight = Math.max(2, (amount / max) * 28);
        context.fillStyle = color;
        context.fillRect(x + 1, 32 - height - offset - 3, Math.max(1, barWidth - 2), 2);
        offset += Math.min(markHeight, 3);
      }
    });
  }
  $("#spark").addEventListener("click", (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setFrame(Math.floor(((event.clientX - rect.left) / rect.width) * frameCount()));
  });
  $("#frame").addEventListener("input", (event) => setFrame(Number(event.target.value)));
  $("#play").addEventListener("click", () => play());
  $("#step-back").addEventListener("click", () => setFrame(state.frame - 1));
  $("#step-forward").addEventListener("click", () => setFrame(state.frame + 1));
  $("#speed").addEventListener("change", (event) => {
    state.speed = Math.max(0.25, Math.min(8, Number(event.target.value) || 1));
    if (state.playing) play(true);
  });
  $("#timeline-mode").addEventListener("change", (event) => {
    state.timeline = event.target.value === "build" ? "build" : "git";
    state.frame = frameCount() - 1;
    setupTimeline();
    render({ layout: true });
  });

  // ----------------------------------------------------------------- search
  const searchInput = $("#search");
  const results = $("#search-results");
  let activeResult = 0;
  function searchMatches() {
    const query = searchInput.value.trim().toLowerCase();
    if (!query) return [];
    return levels[state.level].nodes
      .filter((node) => node.searchText.includes(query))
      .sort((a, b) => Number(!a.label.toLowerCase().startsWith(query)) - Number(!b.label.toLowerCase().startsWith(query)) || b.metrics.pagerank - a.metrics.pagerank)
      .slice(0, 12);
  }
  function renderResults() {
    const matches = searchMatches();
    results.innerHTML = matches.map((node, index) => `
      <button data-node="${escapeHtml(node.id)}" class="${index === activeResult ? "active" : ""}" role="option">
        <span class="swatch" style="background:${apps.get(state.level === "app" ? node.id : node.app)?.color ?? "#999"}"></span>
        ${escapeHtml(node.label)}<small>${escapeHtml(node.type === "app" ? "app" : `${node.type} ${node.objectId ?? ""}`)}</small>
      </button>`).join("");
    results.classList.toggle("open", matches.length > 0 && document.activeElement === searchInput);
  }
  let searchTimer;
  searchInput.addEventListener("input", () => {
    activeResult = 0;
    renderResults();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = searchInput.value.trim().toLowerCase();
      searchIds = state.search ? new Set(visible.nodes.filter((node) => node.searchText.includes(state.search)).map(({ id }) => id)) : undefined;
      refreshStyles();
      updateLabelNodes();
    }, 150);
  });
  searchInput.addEventListener("focus", renderResults);
  searchInput.addEventListener("blur", () => setTimeout(() => results.classList.remove("open"), 150));
  searchInput.addEventListener("keydown", (event) => {
    const matches = searchMatches();
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      activeResult = (activeResult + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % Math.max(1, matches.length);
      renderResults();
    }
    if (event.key === "Enter" && matches[activeResult]) {
      chooseResult(matches[activeResult].id);
    }
    if (event.key === "Escape") searchInput.blur();
  });
  results.addEventListener("mousedown", (event) => {
    const button = event.target.closest("[data-node]");
    if (button) chooseResult(button.dataset.node);
  });
  function chooseResult(requested) {
    results.classList.remove("open");
    const node = levels[state.level].byId.get(requested);
    if (!node) return;
    const id = node.id;
    if (!visible.ids.has(id)) {
      state.apps.add(state.level === "app" ? node.id : node.app);
      state.types.add(node.type);
      buildFilters();
      render();
    }
    select(id, { fly: true });
  }

  // ---------------------------------------------------------------- toolbar
  const toast = (message) => {
    const element = $("#toast");
    element.textContent = message;
    element.classList.add("show");
    setTimeout(() => element.classList.remove("show"), 1800);
  };
  const download = (name, url) => {
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
  };
  const fileName = (extension) => `${(DOC.title || "bc-atlas-graph").replace(/[^\w.-]+/gu, "-").toLowerCase()}.${extension}`;
  $("#fit").addEventListener("click", () => graph.zoomToFit(600, 60));
  $("#export-png").addEventListener("click", () => {
    download(fileName("png"), graph.renderer().domElement.toDataURL("image/png"));
    toast("Saved PNG");
  });
  $("#export-json").addEventListener("click", () => {
    const data = {
      schema: DOC.schema,
      lens: DOC.lens.id,
      level: state.level,
      frame: state.timeline === "git" ? FRAMES[state.frame] : { buildLayer: state.frame },
      nodes: visible.nodes.map(({ id, label, type, app, objectId, namespace, metrics }) => ({ id, label, type, app, objectId, namespace, metrics })),
      edges: visible.links.map(({ edge }) => ({ source: edge.source, target: edge.target, dependency: edge.dependency, kinds: edge.kinds, weight: edge.weight }))
    };
    download(fileName("json"), URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })));
    toast("Saved visible graph as JSON");
  });
  $("#theme").addEventListener("click", () => {
    state.theme = state.theme === "light" ? "dark" : "light";
    remember();
    applyBackground();
    refreshStyles();
    renderSpark();
  });
  $("#toggle-filters").addEventListener("click", (event) => {
    const hidden = document.body.classList.toggle("filters-hidden");
    event.currentTarget.setAttribute("aria-pressed", String(!hidden));
  });

  addEventListener("keydown", (event) => {
    if (event.target.matches("input, select, textarea")) return;
    if (event.key === " ") {
      event.preventDefault();
      play();
    } else if (event.key === "ArrowLeft") setFrame(state.frame - 1);
    else if (event.key === "ArrowRight") setFrame(state.frame + 1);
    else if (event.key === "/") {
      event.preventDefault();
      searchInput.focus();
    } else if (event.key === "Escape") select(undefined);
    else if (event.key === "1") setLevel("object");
    else if (event.key === "2" && levels.module) setLevel("module");
    else if (event.key === "3" || (event.key === "2" && !levels.module)) setLevel("app");
    else if (event.key.toLowerCase() === "f") $("#toggle-filters").click();
  });

  // ------------------------------------------------------------------- init
  if (!levels.module) document.querySelector('[data-level="module"]').hidden = true;
  $("#title").textContent = DOC.title;
  $("#title").title = DOC.title;
  $("#lens").textContent = `${DOC.lens.title} · ${FRAMES.length > 1 ? `${FRAMES.length} frames` : "snapshot"}`;
  state.frame = frameCount() - 1;
  applyBackground();
  // Tens of thousands of object edges (a Base Application) start on the
  // module or app level; drill down from there.
  const large = levels.object.edges.length > 20000;
  if (large) {
    setLevel(levels.module ? "module" : "app");
    toast("Large graph: starting on the module level. Select a module and choose Show its objects.");
  } else {
    setupTimeline();
    buildFilters();
    render({ layout: true });
  }
  window.bcaExplorer = { graph, state, document: DOC, render, setFrame, setLevel, select };
})();
