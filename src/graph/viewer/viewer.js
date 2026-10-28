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
  const LARGE_EDGES = 20000;
  const $ = (selector) => document.querySelector(selector);

  const DEPENDENCIES = {
    "intra-app": { label: "Inside one app", color: "#7b8ba6" },
    "cross-module": { label: "Across modules of one app", color: "#b07aa1" },
    declared: { label: "Declared app dependency", color: "#2bb673" },
    implicit: { label: "Implicit (Microsoft apps, platform)", color: "#5b8def" },
    undeclared: { label: "Undeclared app dependency", color: "#ff4d4f" },
    unresolved: { label: "Unresolved or external", color: "#f5a623" },
    "declared-unused": { label: "Declared but unused", color: "#a0a8b8" },
    allowed: { label: "Allowed by the architecture", color: "#2bb673" },
    violation: { label: "Against the architecture", color: "#ff4d4f" }
  };
  const VIOLATION_COLOR = "#ff4d4f";
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

  // Components of the target architecture, in configuration order.
  const ARCHITECTURE = DOC.architecture;
  const components = new Map((ARCHITECTURE?.components ?? []).map((component, index) => [component.name, {
    ...component,
    color: PALETTE[index % PALETTE.length],
    order: index
  }]));
  const componentColor = (name) => components.get(name)?.color ?? "#8a8f98";

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
    // The "Min. links" slider reaches the 95th percentile of links per node:
    // 10 on a small app, around 100 on the Base Application.
    const degrees = level.nodes.map(({ metrics }) => metrics.inDegree + metrics.outDegree).sort((a, b) => a - b);
    const maxLinks = Math.max(10, Math.min(200, degrees[Math.floor(degrees.length * 0.95)] ?? 10));
    level.edges.forEach((edge) => { edge.firstFrame = edge.presence[0][0]; });
    levels[name] = { ...level, byId, maxRank, maxLayer, maxLinks };
  }

  const count = (items, read) => {
    const counts = new Map();
    for (const item of items) for (const key of read(item)) counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  };

  // ------------------------------------------------------------------ state
  const SPACING = { min: 0.5, max: 5, step: 0.25 };
  const stored = (() => {
    try { return JSON.parse(localStorage.getItem("bca-explorer") ?? "{}"); } catch { return {}; }
  })();
  // Inside the BC Atlas app the explorer follows the app's theme and hands
  // object details over to it.
  const EMBEDDED = window.parent !== window;
  const requestedTheme = new URLSearchParams(location.search).get("theme");
  const state = {
    level: "object",
    dependencies: new Set(Object.keys(DEPENDENCIES)),
    apps: new Set(apps.keys()),
    types: new Set(DOC.vocabulary.types),
    kinds: new Set(DOC.vocabulary.kinds),
    appContext: true,
    hideIsolated: false,
    minDegree: 0,
    // Distance between nodes: 1 is the default; links, repulsion, clusters, and floors scale with it.
    spacing: Number.isFinite(stored.spacing) ? Math.min(SPACING.max, Math.max(SPACING.min, stored.spacing)) : 1,
    search: "",
    colorBy: ARCHITECTURE ? "component" : "app",
    violationsOnly: false,
    component: undefined,
    sizeBy: "pagerank",
    // Open space: a large free-floating graph to fly through, like the
    // large-graph example of 3d-force-graph; apps or components only drift together.
    layout: "space",
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
    theme: ["light", "dark"].includes(requestedTheme) ? requestedTheme
      : stored.theme ?? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
  };
  const remember = () => {
    try { localStorage.setItem("bca-explorer", JSON.stringify({ theme: state.theme, spacing: state.spacing, filters: !document.body.classList.contains("filters-hidden") })); } catch { /* optional */ }
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
    const inSelection = (node) => state.level === "component" || (
      state.apps.has(state.level === "app" ? node.id : node.app) &&
      !(state.level === "object" && state.module && node.module !== state.module) &&
      !(state.level === "object" && state.component && node.component !== state.component));

    const candidateEdges = [];
    for (const edge of level.edges) {
      if (!nodeState.has(edge.source) || !nodeState.has(edge.target)) continue;
      if (!state.dependencies.has(edge.dependency) && !(edge.violation && state.dependencies.has("violation"))) continue;
      if (state.violationsOnly && !edge.violation && edge.dependency !== "violation") continue;
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
      case "component": return componentColor(node.component);
      default: return state.level === "component"
        ? componentColor(node.component)
        : apps.get(state.level === "app" ? node.id : node.app)?.color ?? "#9aa3ad";
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
      // Mostly uniform nodes, so the structure shows and hubs still stand out.
      default: return 1 + (state.layout === "space" ? 7 : 24) * (node.metrics.pagerank / level.maxRank);
    }
  }

  function linkColor(link) {
    if (link.ghost) return STATUS_COLORS.removed;
    if (highlightIds && !(highlightIds.has(link.edge.source) && highlightIds.has(link.edge.target) &&
      (link.edge.source === state.selected || link.edge.target === state.selected))) return dim();
    if (link.edge.violation) return VIOLATION_COLOR;
    if (link.edge.inCycle && link.edge.dependency === "intra-app") return "#c678dd";
    return DEPENDENCIES[link.edge.dependency]?.color ?? "#7b8ba6";
  }

  const crossesApps = (link) => link.edge.scope === "inter-app";
  function linkWidth(link) {
    const selected = state.selected && (link.edge.source === state.selected || link.edge.target === state.selected);
    if (state.level !== "object") return 0.6 + Math.log2(1 + link.weight) * 0.8 + (selected ? 1 : 0);
    // Open space: hairlines; the color tells inside-app, cross-app, and violations apart.
    if (state.layout === "space") return link.edge.violation ? 0.8 : selected ? 0.6 : 0;
    if (link.edge.violation) return 1.2 + (selected ? 0.8 : 0);
    if (crossesApps(link)) return 0.8 + Math.log2(1 + link.weight) * 0.5 + (selected ? 0.8 : 0);
    return selected ? 0.8 : 0;
  }
  function linkParticles(link) {
    if (!state.particles || link.ghost) return 0;
    if (link.edge.dependency === "undeclared" || link.edge.violation || link.edge.dependency === "violation") return 4;
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
      ${link.edge.violation ? `<br><b style="color:${VIOLATION_COLOR}">Against the architecture:</b> ${escapeHtml(link.edge.violation.title)}` : ""}
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
    .linkDirectionalParticleWidth((link) => link.edge.dependency === "undeclared" || link.edge.violation ? 2.4 : 1.6)
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

  // Inside VS Code the app passes the editor theme's colors as tokens.
  let themeTokens;

  function applyBackground() {
    document.documentElement.dataset.theme = state.theme;
    graph.backgroundColor(themeTokens?.["--bg"] || (state.theme === "light" ? "#f4f6fb" : "#0b1020"));
  }

  // ----------------------------------------------------------------- layout
  function appAnchor(appId) {
    const app = apps.get(appId);
    const total = Math.max(1, apps.size);
    const index = app?.order ?? 0;
    const radius = (90 + 30 * Math.sqrt(total)) * state.spacing;
    // Fibonacci sphere keeps app clusters evenly apart in three dimensions.
    const y = total === 1 ? 0 : 1 - (index / (total - 1)) * 2;
    const ring = Math.sqrt(1 - y * y);
    const theta = Math.PI * (3 - Math.sqrt(5)) * index;
    return { x: Math.cos(theta) * ring * radius, y: y * radius * 0.6, z: Math.sin(theta) * ring * radius };
  }

  function componentAnchor(name) {
    const total = Math.max(1, components.size);
    const index = components.get(name)?.order ?? 0;
    const radius = (90 + 30 * Math.sqrt(total)) * state.spacing;
    const y = total === 1 ? 0 : 1 - (index / (total - 1)) * 2;
    const ring = Math.sqrt(1 - y * y);
    const theta = Math.PI * (3 - Math.sqrt(5)) * index;
    return { x: Math.cos(theta) * ring * radius, y: y * radius * 0.6, z: Math.sin(theta) * ring * radius };
  }

  // Open space spreads the cluster centers with the size of the graph.
  const spread = () => state.layout === "space" ? 1.8 * Math.max(1, Math.cbrt(visible.nodes.length / 120)) : 1;

  function clusterForce(alpha) {
    if (["app", "component"].includes(state.level) || !["space", "clusters", "app-layers", "component-layers"].includes(state.layout)) return;
    const strength = { space: 0.012, clusters: 0.12 }[state.layout] ?? 0.05;
    const scale = spread();
    for (const node of visible.nodes) {
      const anchor = ARCHITECTURE && node.component ? componentAnchor(node.component) : appAnchor(node.app);
      node.vx += (anchor.x * scale - node.x) * strength * alpha;
      if (["space", "clusters"].includes(state.layout)) node.vy += (anchor.y * scale - node.y) * strength * alpha;
      node.vz += (anchor.z * scale - node.z) * strength * alpha;
    }
  }
  graph.d3Force("appCluster", clusterForce);

  // Spacing: links get longer (more so between large nodes, so hubs get room)
  // and nodes push each other away harder.
  const nodeRadius = (node) => 4 * Math.cbrt(Math.max(1, nodeSize(node)));
  function applySpacing() {
    const open = state.layout === "space" && state.level === "object";
    graph.d3Force("link")?.distance((link) => state.spacing * ((open ? 34 : 20) + nodeRadius(link.source) + nodeRadius(link.target)));
    // Repulsion reaches only so far, so unconnected objects do not drift off into the distance.
    graph.d3Force("charge")?.strength((open ? -70 : -30) * state.spacing * state.spacing).distanceMax(open ? 320 * state.spacing : Infinity);
    graph.linkOpacity(open ? 0.32 : 0.55);
  }
  applySpacing();

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
      if (state.layout === "app-layers") node.fy = appLayer(node) * 110 * state.spacing;
      if (state.layout === "component-layers") node.fy = (components.get(node.component)?.layer ?? node.layer ?? 0) * (state.level === "component" ? 60 : 110) * state.spacing;
      if (state.layout === "build-layers") node.fy = node.metrics.buildLayer * 55 * state.spacing;
      if (state.layout === "time") node.fx = (node.firstFrame - LAST_FRAME / 2) * Math.max(40, 600 / Math.max(1, LAST_FRAME)) * state.spacing;
      if (state.layout === "flat") node.z = 0;
    }
    // On the component level, a layer is a row: spread its components side by side.
    if (state.layout === "component-layers" && state.level === "component") {
      const rows = new Map();
      for (const node of [...level.nodes].sort((a, b) => a.label.localeCompare(b.label))) {
        const layer = node.layer ?? 0;
        if (!rows.has(layer)) rows.set(layer, []);
        rows.get(layer).push(node);
      }
      for (const row of rows.values()) {
        row.forEach((node, index) => {
          node.fx = (index - (row.length - 1) / 2) * 70 * state.spacing;
          node.fz = 0;
        });
      }
    }
    applySpacing();
    if (reheat) graph.d3ReheatSimulation();
    fitWhenSettled();
  }

  // ------------------------------------------------------------- rendering
  // The camera frames the graph early and again once the layout has settled,
  // so a graph that keeps spreading out is not cut off.
  let settleFit = false;
  // Frame what is connected; a few loose objects should not push the camera far away.
  function fit(duration, padding) {
    const linked = new Set(visible.links.flatMap((link) => [link.source.id ?? link.source, link.target.id ?? link.target]));
    graph.zoomToFit(duration, padding, linked.size ? (node) => linked.has(node.id) : undefined);
  }
  function fitWhenSettled() {
    settleFit = true;
    setTimeout(() => fit(600, 60), 1600);
  }
  graph.onEngineStop(() => {
    if (!settleFit) return;
    settleFit = false;
    fit(900, 20);
  });
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
      fitWhenSettled();
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
    const noun = { app: "apps", module: "modules", component: "components" }[state.level] ?? "objects";
    const third = ARCHITECTURE
      ? `${visible.links.filter((link) => link.edge.violation || link.edge.dependency === "violation").length} against the architecture`
      : `${visible.links.filter(crossesApps).length} across apps`;
    $("#stats").textContent = `${visible.nodes.length} ${noun} · ${visible.links.length} dependencies · ${third}`;
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
      [...visible.nodes].sort((a, b) => nodeSize(b) - nodeSize(a)).slice(0, state.layout === "space" ? 10 : 18).forEach(({ id }) => chosen.add(id));
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

  function spacingText() {
    return `${Math.round(state.spacing * 100)} %`;
  }

  function frameLabel(index) {
    const frame = FRAMES[index];
    if (!frame) return "";
    const kind = { "pull-request": "PR ", release: "release ", unreleased: "" }[frame.kind] ?? "";
    return `${frame.kind === "working-tree" ? "working tree" : `${kind}${frame.id}`} · ${frame.date?.slice(0, 10) ?? ""}`;
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
    const rows = state.level === "component"
      ? [
          ["Layer", node.layer],
          ["Objects", node.objectCount],
          ["May depend on", (node.dependsOn ?? []).join(", ") || "-"],
          ["Instability", node.componentMetrics?.instability.toFixed(2)],
          ["Abstractness", node.componentMetrics?.abstractness.toFixed(2)],
          ["Distance", node.componentMetrics?.distance.toFixed(2)],
          ["Wrong-way deps", node.violations],
          ["Ready to extract", node.extractable ? "yes" : "no"]
        ]
      : state.level === "module"
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
          ...(node.component ? [["Component", `<span class="swatch" style="display:inline-block;background:${componentColor(node.component)}"></span> ${escapeHtml(node.component)}`]] : []),
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
        ${EMBEDDED && state.level === "object" ? `<button class="icon-button" data-action="open-object">Open object</button>` : ""}
      </div>
      <dl>${rows.filter(([, value]) => value !== undefined && value !== "").map(([label, value]) => `<dt>${label}</dt><dd>${typeof value === "string" && value.startsWith("<") ? value : escapeHtml(value)}</dd>`).join("")}</dl>
      ${violationsHtml(outgoing)}
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
      ${edge.violation ? `<h3>Against the architecture</h3>
        <p><b>${escapeHtml(edge.violation.title)}</b> · <span class="mono">${escapeHtml(edge.violation.strategy)}</span> · effort ${EFFORT[edge.violation.effort]}</p>
        <ul class="history-list">${edge.violation.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ul>` : ""}
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
    if (action === "open-object" && node) window.parent.postMessage({ type: "bca-open-object", id: node.id }, "*");
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
      if (state.level === "component") {
        state.component = node.component;
        state.module = undefined;
        setLevel("object");
        toast(`Objects of component ${node.label}; Reset filters shows all`);
        return;
      }
      state.apps = new Set([state.level === "app" ? node.id : node.app]);
      state.module = state.level === "module" ? node.id : undefined;
      state.component = undefined;
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

  const EFFORT = { S: "small", M: "medium", L: "large" };

  /** Summary of the target architecture and the work items, largest first. */
  function architectureHtml() {
    const summary = ARCHITECTURE.summary;
    const items = ARCHITECTURE.workItems.slice(0, 12).map((item, index) => {
      const source = levels.object.byId.get(item.source);
      return `<li data-work-item="${index}" title="${escapeHtml(item.steps.join(" "))}">
        <span class="pill" style="background:${VIOLATION_COLOR}">${item.violations}</span>
        <span class="name">${escapeHtml(source?.label ?? "?")}: ${escapeHtml(item.sourceComponent)} → ${escapeHtml(item.targetComponent)}<br><small>${escapeHtml(item.title)} · ${EFFORT[item.effort]}</small></span>
      </li>`;
    }).join("");
    return `<dl class="architecture-summary">
        <dt>Components</dt><dd>${summary.components}</dd>
        <dt>Wrong-way</dt><dd>${summary.violations.toLocaleString("en-US")} ${summary.violations === 1 ? "dependency" : "dependencies"}</dd>
        <dt>Work items</dt><dd>${summary.workItems.toLocaleString("en-US")}</dd>
        <dt>Extractable</dt><dd>${summary.extractable} of ${summary.components}</dd>
        ${summary.byStrategy?.["move-permissions"] ? `<dt>Grants</dt><dd>${summary.byStrategy["move-permissions"].toLocaleString("en-US")} in permission sets</dd>` : ""}
      </dl>
      ${items ? `<ul class="link-list work-items">${items}</ul>` : `<p class="hint">Every dependency follows the architecture.</p>`}
      <p class="hint">${ARCHITECTURE.mode === "proposal" ? "Proposed from today's dependencies. " : ""}Click a work item to see its object.</p>`;
  }

  function violationsHtml(edges) {
    const wrong = edges.filter(({ violation }) => violation);
    if (!wrong.length) return "";
    const first = wrong[0].violation;
    return `<h3>Against the architecture (${wrong.length})</h3>
      <p><b>${escapeHtml(first.title)}</b> · effort ${EFFORT[first.effort]}</p>
      <ul class="history-list">${first.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ul>`;
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
      ARCHITECTURE ? section("architecture", ARCHITECTURE.mode === "proposal" ? "Proposed architecture" : "Architecture", architectureHtml(), { open: isOpen("architecture") }) : "",
      section("dependencies", "Dependency scope", checkList("dependencies", dependencies, state.dependencies, {
        swatch: (value) => DEPENDENCIES[value].color, line: true
      }) + (ARCHITECTURE ? `<label class="check"><input type="checkbox" data-setting="violationsOnly" ${state.violationsOnly ? "checked" : ""}><span class="swatch line" style="background:${VIOLATION_COLOR}"></span><span class="name">Only dependencies against the architecture</span></label>` : "") +
        `<p class="hint">Inside one app vs. across app boundaries (app.json).</p>`, { open: isOpen("dependencies") }),
      state.level === "component" ? "" : section("apps", `Apps (${appItems.length})`, checkList("apps", appItems, state.apps, {
        swatch: (value) => apps.get(value)?.color
      }) + (state.level === "object" ? `<label class="check"><input type="checkbox" data-setting="appContext" ${state.appContext ? "checked" : ""}><span class="name">Show neighbors in other apps</span></label>` : ""),
      { open: isOpen("apps"), bulk: true }),
      state.level === "object"
        ? section("types", "Object types", checkList("types", typeItems, state.types, { swatch: (value) => TYPE_COLORS[value] ?? "#9aa3ad" }), { open: isOpen("types", false), bulk: true })
        : "",
      section("kinds", "Relation kinds", checkList("kinds", kindItems, state.kinds), { open: isOpen("kinds", false), bulk: true }),
      section("display", "Display", [
        select_("colorBy", "Color", [...(ARCHITECTURE ? [["component", "Component"]] : []), ["app", "App"], ["type", "Object type"], ["community", "Community (Louvain)"], ["layer", "Build layer"], ["age", "Age (first commit)"], ["cross-app", "Cross-app coupling"]], state.colorBy),
        state.level === "object" ? select_("sizeBy", "Size", [["pagerank", "PageRank"], ["in", "Used by"], ["out", "Depends on"], ["cross-app", "Cross-app links"], ["uniform", "Uniform"]], state.sizeBy) : "",
        select_("layout", "Layout", [["space", "Open space (3D)"], ["clusters", ARCHITECTURE ? "Component clusters (3D)" : "App clusters (3D)"], ...(ARCHITECTURE ? [["component-layers", "Architecture layers as floors"]] : []), ["force", "Free force (3D)"], ["app-layers", "Apps as floors"], ["build-layers", "Build order as floors"], ["time", "Commit timeline axis (4D)"], ["flat", "Flat (2D)"]], state.layout),
        select_("labels", "Labels", [["auto", "Important"], ["all", "All"], ["off", "Off"]], state.labels),
        `<div class="field wide"><label for="option-minDegree">Min. links <output id="min-degree-value">${state.minDegree}</output></label><input id="option-minDegree" data-setting="minDegree" type="range" min="0" max="${levels[state.level].maxLinks}" value="${Math.min(state.minDegree, levels[state.level].maxLinks)}"></div>`,
        `<div class="field wide"><label for="option-spacing" title="Longer links and more room between nodes; large nodes get the most">Spacing <output id="spacing-value">${spacingText()}</output></label><input id="option-spacing" data-setting="spacing" type="range" min="${SPACING.min}" max="${SPACING.max}" step="${SPACING.step}" value="${state.spacing}"></div>`,
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
    colorBy: ["component", "app", "type", "community", "layer", "age", "cross-app"],
    sizeBy: ["pagerank", "in", "out", "cross-app", "uniform"],
    layout: ["space", "clusters", "force", "component-layers", "app-layers", "build-layers", "time", "flat"],
    labels: ["auto", "all", "off"]
  };
  const FLAGS = ["appContext", "hideIsolated", "particles", "highlight", "ghosts", "violationsOnly"];
  const known = (values, value) => values[values.indexOf(value)];
  const listValues = (list) => {
    const name = known(LISTS, list);
    if (!name) return undefined;
    const universe = name === "apps" ? [...apps.keys()]
      : name === "dependencies" ? Object.keys(DEPENDENCIES)
        : DOC.vocabulary[name];
    return { name, universe };
  };
  const toCount = (value) => Math.max(0, Math.min(levels[state.level].maxLinks, Math.trunc(Number(value)) || 0));
  const toSpacing = (value) => Math.max(SPACING.min, Math.min(SPACING.max, Number(value) || 1));
  let spacingTimer;
  // Spreads or tightens the graph while the slider moves, then fits it on screen.
  function setSpacing(value) {
    state.spacing = toSpacing(value);
    $("#spacing-value").textContent = spacingText();
    remember();
    clearTimeout(spacingTimer);
    spacingTimer = setTimeout(() => applyLayout(), 120);
  }

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
    } else if (setting === "spacing") return setSpacing(input.value);
    else if (input.type === "range") state.minDegree = toCount(input.value);
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
    if (event.target.dataset.setting === "spacing") return setSpacing(event.target.value);
    state.minDegree = toCount(event.target.value);
    $("#min-degree-value").textContent = String(state.minDegree);
    render();
  });
  $("#filters").addEventListener("click", (event) => {
    const workItem = event.target.closest("[data-work-item]");
    if (workItem) {
      const item = ARCHITECTURE?.workItems[Number(workItem.dataset.workItem)];
      if (!item) return;
      state.component = undefined;
      state.module = undefined;
      if (state.level !== "object") setLevel("object");
      // Show the object with its neighbors only, so the work item stands out.
      state.focusDepth = 1;
      return chooseResult(item.source);
    }
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
        module: undefined,
        component: undefined,
        violationsOnly: false
      });
      buildFilters();
      render();
    }
  });

  // ----------------------------------------------------------------- legend
  function renderLegend() {
    const used = new Set(visible.links.map((link) => link.edge.dependency));
    if (visible.links.some((link) => link.edge.violation)) used.add("violation");
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
    // Components read best stacked by architecture layer.
    if (level === "component" && ["space", "clusters"].includes(state.layout)) state.layout = "component-layers";
    if (level !== "component" && state.layout === "component-layers" && state.level === "component") state.layout = "space";
    state.level = level;
    state.minDegree = Math.min(state.minDegree, levels[level].maxLinks);
    state.selected = undefined;
    state.focusDepth = 0;
    $("#details").classList.remove("open");
    document.querySelectorAll("[data-level]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.level === level)));
    if (state.timeline === "build") state.frame = frameCount() - 1;
    limitLargeView();
    setupTimeline();
    buildFilters();
    fitted = false;
    render({ layout: true });
  }

  /**
   * Tens of thousands of edges inside one module (the Base Application's root
   * module alone has about 66,000) overwhelm the layout; show the edges that
   * leave a module first and let the viewer turn the rest back on.
   */
  function limitLargeView() {
    if (state.level !== "object" || !state.dependencies.has("intra-app")) return;
    computeVisible();
    if (visible.links.length <= LARGE_EDGES) return;
    state.dependencies.delete("intra-app");
    state.hideIsolated = true;
    toast(`${visible.links.length.toLocaleString()} dependencies: showing those that leave a module. Turn on "Inside one app" to see all.`);
  }
  document.querySelectorAll("[data-level]").forEach((button) => button.addEventListener("click", () => setLevel(known(["object", "module", "app", "component"], button.dataset.level) ?? "object")));

  // --------------------------------------------------------------- timeline
  let timer;
  function setupTimeline() {
    const slider = $("#frame");
    slider.max = String(frameCount() - 1);
    slider.value = String(Math.min(state.frame, frameCount() - 1));
    $("#timeline-mode").value = state.timeline;
    const git = $("#timeline-mode").querySelector('[value="git"]');
    git.disabled = FRAMES.length < 2;
    git.textContent = { prs: "Pull requests", releases: "Releases" }[DOC.timeline.by] ?? "Git history";
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
      <div class="meta">${escapeHtml(frameLabel(state.frame))}${frame.author ? ` · ${escapeHtml(frame.author)}` : ""}${frame.commits > 1 ? ` · ${frame.commits} commits` : ""}${frame.includes > 1 ? ` · ${frame.includes} ${{ "pull-request": "pull requests", release: "releases" }[frame.kind] ?? "steps"}` : ""}
      · <span class="delta-add">+${stats.addedNodes}</span> <span class="delta-remove">−${stats.removedNodes}</span> <span class="delta-change">~${stats.changedNodes}</span>${Number.isFinite(frame.violations) ? ` · <span class="delta-remove">${Number(frame.violations).toLocaleString("en-US")} against the architecture</span>` : ""}</div>`;
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
    // Violations against the architecture per commit: a red line over the bars.
    const violations = state.timeline === "git" ? FRAMES.map((frame) => frame.violations) : [];
    // Scaled to their own range, so a slow drift over the commits shows.
    const known = violations.filter(Number.isFinite);
    const minViolations = Math.min(...known);
    const range = Math.max(1, Math.max(...known) - minViolations);
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
    if (violations.some(Number.isFinite)) {
      context.strokeStyle = VIOLATION_COLOR;
      context.lineWidth = 1.5;
      context.beginPath();
      violations.forEach((value, index) => {
        const x = index * barWidth + barWidth / 2;
        const y = 30 - (((value ?? minViolations) - minViolations) / range) * 26;
        if (index) context.lineTo(x, y);
        else context.moveTo(x, y);
      });
      context.stroke();
    }
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
  $("#fit").addEventListener("click", () => fit(600, 40));
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
  const setTheme = (theme, tokens) => {
    state.theme = theme;
    if (tokens && typeof tokens === "object") {
      themeTokens = tokens;
      for (const [name, value] of Object.entries(tokens)) {
        if (/^--[a-z0-9-]+$/u.test(name) && typeof value === "string") document.documentElement.style.setProperty(name, value);
      }
    }
    remember();
    applyBackground();
    refreshStyles();
    renderSpark();
  };
  $("#theme").addEventListener("click", () => setTheme(state.theme === "light" ? "dark" : "light"));
  if (EMBEDDED) {
    // The app around it shows the title and owns the theme.
    for (const element of [$("#theme"), $("#title"), $("#lens")]) element.hidden = true;
    addEventListener("message", (event) => {
      if (event.source !== window.parent) return;
      if (event.data?.type === "bca-theme" && ["light", "dark"].includes(event.data.theme)) setTheme(event.data.theme, event.data.tokens);
      if (event.data?.type === "bca-select" && levels.object.byId.has(event.data.id)) {
        if (state.level !== "object") setLevel("object");
        select(event.data.id, { fly: true });
      }
    });
    window.parent.postMessage({ type: "bca-ready" }, "*");
  }
  // The graph gets the whole window until the filters are opened (F); the choice is remembered.
  const showFilters = (shown) => {
    document.body.classList.toggle("filters-hidden", !shown);
    $("#toggle-filters").setAttribute("aria-pressed", String(shown));
  };
  showFilters(stored.filters === true);
  $("#toggle-filters").addEventListener("click", () => {
    showFilters(document.body.classList.contains("filters-hidden"));
    remember();
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
    else if (event.key === "4" && levels.component) setLevel("component");
    else if (event.key.toLowerCase() === "f") $("#toggle-filters").click();
  });

  // ------------------------------------------------------------------- init
  if (!levels.module) document.querySelector('[data-level="module"]').hidden = true;
  if (!levels.component) document.querySelector('[data-level="component"]').hidden = true;
  $("#title").textContent = DOC.title;
  $("#title").title = DOC.title;
  $("#lens").textContent = `${DOC.lens.title} · ${FRAMES.length > 1 ? `${FRAMES.length} frames` : "snapshot"}`;
  state.frame = frameCount() - 1;
  applyBackground();
  // Tens of thousands of object edges (a Base Application) start on the
  // module or app level; drill down from there.
  const large = levels.object.edges.length > LARGE_EDGES;
  if (large && levels.component) {
    setLevel("component");
    toast("Large graph: starting on the architecture components. Select one and choose Show its objects.");
  } else if (large) {
    setLevel(levels.module ? "module" : "app");
    toast("Large graph: starting on the module level. Select a module and choose Show its objects.");
  } else {
    setupTimeline();
    buildFilters();
    render({ layout: true });
  }
  window.bcaExplorer = { graph, state, document: DOC, render, setFrame, setLevel, select };
})();
