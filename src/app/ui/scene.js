// What the view shows, without the view: the part of the atlas
// (src/app/atlas.js) a state asks for, and that part as text. The page
// (atlas.js) draws it; `bca view` and the MCP tool write the same from a
// terminal (src/app/view.js). One place, so both always agree.
//
// A state is what the toolbar sets, as it stands in the address of the view:
// { lens, form, q, sel, focus, depth, check, story, step, color, size, group, off, hide, inside }.
(function (root) {
  "use strict";

  const NEUTRAL = "#94A3B8";
  const SEVERITY = { error: "#C0392B", warning: "#B7791F", info: "#2A78D6" };
  const RANK = { error: 3, warning: 2, info: 1 };
  // Calm colors that stay apart for people who see colors differently.
  const PALETTE = ["#0072B2", "#D55E00", "#009E73", "#CC79A7", "#E69F00", "#56B4E9", "#7C3AED", "#4E5D78", "#A23636", "#14766E", "#8B7400", "#A21CAF"];
  const KIND_NAMES = { object: "Object", app: "App", component: "Component", module: "Namespace", rule: "Rule", process: "Process", task: "Process test", person: "Person", requirement: "Requirement", member: "Member" };
  const DEFAULTS = Object.freeze({ lens: "system", form: "2d", q: "", sel: "", focus: "", depth: "1", check: "", story: "", step: "0", color: "", size: "", group: "", off: "", hide: "", inside: "" });
  const FORMS = Object.freeze(["2d", "diagram", "3d"]);
  const COLORS = Object.freeze(["type", "component", "namespace", "app", "level", "findings"]);
  const SIZES = Object.freeze(["relations", "usedBy", "uses", "lines", "complexity", "objects", "findings"]);
  const GROUPS = Object.freeze(["component", "namespace", "app", "kind", "none"]);

  const list = (value) => new Set(value ? String(value).split("|") : []);
  const kindOf = (node) => (node.kind === "object" || node.kind === "member" ? node.type : node.kind);

  /** Where each node of an atlas is, the findings on it, and the worst of them. */
  function index(atlas) {
    const position = new Map(atlas.nodes.map((node, at) => [node.id, at]));
    const findingsOf = new Map();
    for (const finding of atlas.findings) {
      for (const at of finding.nodes) (findingsOf.get(at) ?? findingsOf.set(at, []).get(at)).push(finding);
    }
    const worst = (at) => {
      let found;
      for (const finding of findingsOf.get(at) ?? []) if (!found || RANK[finding.severity] > RANK[found]) found = finding.severity;
      return found;
    };
    return { position, findingsOf, worst };
  }

  /** The class a node falls into for a color mode: { key, label, color }. */
  function classOf(atlas, found, node, at, mode) {
    if (mode === "level") return { key: node.level ?? "none", label: node.level ?? "no level", color: atlas.levels[node.level] ?? NEUTRAL };
    if (mode === "findings" || mode === "severity") {
      const severity = node.kind === "rule" ? node.severity : at >= 0 ? found.worst(at) : undefined;
      return { key: severity ?? "none", label: severity ?? "no finding", color: SEVERITY[severity] ?? NEUTRAL };
    }
    if (["component", "namespace", "app", "layer"].includes(mode)) {
      const value = node[mode] ?? (node.kind === "module" && mode === "namespace" ? node.label : undefined);
      return { key: value ?? "none", label: value ?? (node.external ? "other apps" : `no ${mode}`), color: undefined };
    }
    if (node.external) return { key: "external", label: "other apps", color: node.color };
    if (mode === "status" && node.status) return { key: `${node.kind}:${node.status}`, label: `${KIND_NAMES[node.kind]?.toLowerCase() ?? node.kind}: ${node.status}`, color: node.color };
    return { key: kindOf(node), label: node.kind === "object" || node.kind === "member" ? node.type : (KIND_NAMES[node.kind] ?? node.kind).toLowerCase(), color: node.color };
  }

  /**
   * The part of the atlas a state asks for, as the graph draws it.
   * @param found index(atlas)
   * @param within the inside of state.inside (createInside in src/app/atlas.js), when the state opens an object
   * @returns { key, lens, title, summary, within, entries: [{ node, at }], place, nodes: [{ label, group, color }],
   *   classOf, classes: [{ key, label, color, count }], edges: [[from, to, kind, weight]], kinds, groups }
   */
  function scene(atlas, found, state, within) {
    const lens = atlas.lenses.find(({ id }) => id === state.lens) ?? atlas.lenses[0];
    const { position } = found;
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
    const kindAt = (relation) => {
      if (!kindIndex.has(relation.kind)) {
        kindIndex.set(relation.kind, kinds.length);
        kinds.push({ ...relation });
      }
      return kindIndex.get(relation.kind);
    };
    let links = [];
    let title = lens.title;
    let summary = lens.summary;
    const opened = within && state.inside && position.has(state.inside);
    if (opened) {
      const center = atlas.nodes[position.get(state.inside)];
      title = `Inside ${center.label}`;
      summary = "Its procedures, triggers, and events, and what each of them does with other objects.";
      enter(center, position.get(state.inside));
      for (const node of within.nodes) enter(node, -1);
      for (const [from, to, relation, weight] of within.edges) {
        for (const id of [from, to]) if (!place.has(id) && position.has(id)) enter(atlas.nodes[position.get(id)], position.get(id));
        if (place.has(from) && place.has(to)) links.push([place.get(from), place.get(to), kindAt(within.relations[relation]), weight]);
      }
    } else {
      const wanted = new Set(lens.kinds);
      const relations = new Set(lens.relations);
      const from = lens.from && new Set(lens.from);
      const types = new Set(lens.types ?? []);
      const candidate = atlas.nodes.map((node) => wanted.has(node.kind));
      const picked = [];
      const touched = new Set();
      for (const edge of atlas.edges) {
        const relation = atlas.relations[edge[2]];
        if (!relations.has(relation.kind) || !candidate[edge[0]] || !candidate[edge[1]]) continue;
        if (from && !from.has(atlas.nodes[edge[0]].type)) continue;
        picked.push(edge);
        touched.add(edge[0]);
        touched.add(edge[1]);
      }
      atlas.nodes.forEach((node, at) => {
        if (!candidate[at]) return;
        const always = node.kind !== "object" || (types.has(node.type) && !node.external);
        if (lens.connected && !touched.has(at) && !always) return;
        enter(node, at);
      });
      // In the order of the lens, so the legend reads the same every time.
      for (const kind of lens.relations) {
        const relation = atlas.relations.find((candidateRelation) => candidateRelation.kind === kind);
        if (relation && picked.some((edge) => atlas.relations[edge[2]] === relation)) kindAt(relation);
      }
      links = picked.map((edge) => [place.get(atlas.nodes[edge[0]].id), place.get(atlas.nodes[edge[1]].id), kindAt(atlas.relations[edge[2]]), edge[3]]);
    }

    // Only a node and what is near it.
    let keep;
    if (state.focus && place.has(state.focus)) {
      keep = new Set([place.get(state.focus)]);
      let rim = new Set(keep);
      for (let depth = 0; depth < Math.max(1, Number(state.depth) || 1); depth++) {
        const next = new Set();
        for (const [from, to] of links) {
          for (const [a, b] of [[from, to], [to, from]]) {
            if (rim.has(a) && !keep.has(b)) {
              keep.add(b);
              next.add(b);
            }
          }
        }
        rim = next;
      }
    }
    const renumber = new Map();
    const shownEntries = [];
    entries.forEach((entry, at) => {
      if (keep && !keep.has(at)) return;
      renumber.set(at, shownEntries.length);
      shownEntries.push(entry);
    });
    const edges = links.filter(([from, to]) => renumber.has(from) && renumber.has(to)).map(([from, to, kind, weight]) => [renumber.get(from), renumber.get(to), kind, weight]);

    // Groups hold together; classes give the colors and the legend.
    const groupBy = state.group || (opened ? "kind" : lens.group);
    const groupOf = (node) => (groupBy === "none" ? "" : groupBy === "kind" ? kindOf(node) : node[groupBy] ?? (node.external ? "Other apps" : node.kind === "object" ? "" : node.kind));
    const groups = [...new Set(shownEntries.map(({ node }) => String(groupOf(node))))].sort((a, b) => a.localeCompare(b));
    const groupPosition = new Map(groups.map((group, at) => [group, at]));
    const mode = state.color || (opened ? "type" : lens.color);
    const classes = new Map();
    const own = [];
    const classed = shownEntries.map(({ node, at }) => {
      const hit = classOf(atlas, found, node, at, mode);
      const entry = classes.get(hit.key) ?? classes.set(hit.key, { ...hit, count: 0 }).get(hit.key);
      entry.count++;
      // A color of its own (a blocked process among processes) stays.
      own.push(hit.color);
      return entry;
    });
    // Classes without a color of their own share the palette, in a fixed order.
    [...classes.values()].filter(({ color }) => !color).sort((a, b) => String(a.key).localeCompare(String(b.key)))
      .forEach((entry, at) => { entry.color = entry.key === "none" ? NEUTRAL : PALETTE[at % PALETTE.length]; });
    return {
      key: [opened ? `inside:${state.inside}` : lens.id, state.focus, state.depth, groupBy].join("\n"),
      lens,
      title,
      summary,
      within: Boolean(opened),
      entries: shownEntries,
      place: new Map(shownEntries.map(({ node }, at) => [node.id, at])),
      nodes: shownEntries.map(({ node }, at) => ({ label: node.label, group: groupPosition.get(String(groupOf(node))), color: own[at] ?? classed[at].color })),
      classOf: classed,
      classes: [...classes.values()].sort((a, b) => b.count - a.count),
      edges,
      kinds,
      groups
    };
  }

  /**
   * What of a scene shows: the classes and kinds of relation a state hides are out.
   * @returns { nodes: Uint8Array, kinds: Uint8Array, degree: Uint32Array } flags by index, and how many relations each node has among what shows
   */
  function shown(view, state) {
    const hidden = list(state.hide);
    const off = list(state.off);
    // A class by its key, or by its name in the legend ("other apps").
    const nodes = Uint8Array.from(view.classOf, (entry) => (hidden.has(String(entry.key)) || hidden.has(String(entry.label)) ? 0 : 1));
    const kinds = Uint8Array.from(view.kinds, ({ kind }) => (off.has(kind) ? 0 : 1));
    const degree = new Uint32Array(view.entries.length);
    for (const [from, to, kind] of view.edges) {
      if (!nodes[from] || !nodes[to] || !kinds[kind]) continue;
      degree[from]++;
      degree[to]++;
    }
    return { nodes, kinds, degree };
  }

  /** The nodes of a scene a search finds, by index. */
  function matches(view, query) {
    const wanted = String(query ?? "").trim().toLowerCase();
    if (!wanted) return [];
    return view.entries.map(({ node }, at) => ([node.label, node.type, node.kind, node.component, node.namespace, node.app, node.objectId]
      .some((value) => String(value ?? "").toLowerCase().includes(wanted)) ? at : -1)).filter((at) => at >= 0);
  }

  /** A number per node to size it by, or nothing for the same size. */
  function sizeValues(view, found, by, degree) {
    if (!by) return undefined;
    const values = by === "relations" ? Array.from(degree)
      : by === "findings" ? view.entries.map(({ at }) => (at >= 0 ? found.findingsOf.get(at)?.length ?? 0 : 0))
        : view.entries.map(({ node }) => Number(node[by]) || 0);
    return values.some((value) => value > 0) ? values : undefined;
  }

  /** Check: a ring per node in the color of its worst finding, or nothing. */
  function rings(view, found) {
    return view.entries.map(({ at }) => {
      const severity = at >= 0 ? found.worst(at) : undefined;
      return severity ? { color: SEVERITY[severity], width: severity === "info" ? 1.2 : 2.4 } : undefined;
    });
  }

  /** The nodes that stand out: the step of a story, else what a search finds. A Set of indexes, or nothing. */
  function highlight(atlas, view, state) {
    const story = atlas.stories.find(({ id }) => id === state.story);
    const step = story?.steps[Math.min(Number(state.step) || 0, story.steps.length - 1)];
    if (step) return new Set(step.nodes.map((at) => view.place.get(atlas.nodes[at]?.id)).filter((at) => at !== undefined));
    const hits = matches(view, state.q);
    return String(state.q ?? "").trim() ? new Set(hits) : undefined;
  }

  // ---------------------------------------------------------------- as text
  const stamp = (atlas) => `_Generated by BC Atlas ${atlas.version} from the AL source of ${atlas.title}. Do not edit; export it again._`;

  function storyMarkdown(atlas, story, level = 1) {
    const head = "#".repeat(level);
    return [
      `${head} ${story.title}`, "", story.summary, "",
      ...(level === 1 ? [stamp(atlas), ""] : []),
      ...story.steps.flatMap((step, at) => [
        `${head}# ${at + 1}. ${step.title}`, "", step.text, "",
        ...(step.nodes.length ? [`Shown: ${step.nodes.slice(0, 12).map((node) => `\`${atlas.nodes[node].label}\``).join(", ")}${step.nodes.length > 12 ? `, and ${step.nodes.length - 12} more` : ""}.`, ""] : [])
      ])
    ].join("\n");
  }

  /** Every story of the system as one document. */
  function documentation(atlas) {
    return [
      `# ${atlas.title}`, "", stamp(atlas), "",
      "## Read from", "", ...atlas.sources.map(([name, value]) => `- **${name}:** ${value}`), "",
      ...atlas.stories.flatMap((story) => [storyMarkdown(atlas, story, 2), ""])
    ].join("\n");
  }

  const visibleEntries = (view, flags) => view.entries.map((entry, at) => ({ ...entry, index: at })).filter(({ index: at }) => flags.nodes[at]);
  const visibleEdges = (view, flags) => view.edges.filter(([from, to, kind]) => flags.nodes[from] && flags.nodes[to] && flags.kinds[kind]);
  // The findings on these nodes, each once, the most severe first.
  const findingsIn = (found, entries) => [...new Set(entries.flatMap(({ at }) => (at >= 0 ? found.findingsOf.get(at) ?? [] : [])))]
    .sort((a, b) => (RANK[b.severity] ?? 0) - (RANK[a.severity] ?? 0));

  /** What a lens shows, what it is read from, and its findings. */
  function lensMarkdown(atlas, found, view, flags) {
    const entries = visibleEntries(view, flags);
    const findings = findingsIn(found, entries.filter(({ node }) => node.kind !== "member"));
    const grouped = view.groups.length > 1;
    return [
      `# ${atlas.title}: ${view.title}`, "", view.summary, "", stamp(atlas), "",
      `Read from ${view.lens.reads}.`, "",
      `| Node | Kind | ${grouped ? "Group | " : ""}Relations |`, `| --- | --- | ${grouped ? "--- | " : ""}---: |`,
      ...entries.map(({ node, index: at }) => `| ${String(node.label).replaceAll("|", "\\|")} | ${kindOf(node)} | ${grouped ? `${view.groups[view.nodes[at].group] || ""} | ` : ""}${flags.degree[at]} |`), "",
      ...(findings.length ? ["## Findings", "", ...findings.map((finding) => `- **${finding.severity}** \`${finding.rule}\`: ${finding.message}${finding.fix ? ` Fix: ${finding.fix}` : ""}`), ""] : [])
    ].join("\n");
  }

  const csv = (rows) => rows.map((row) => row.map((value) => (/[",\n]/u.test(String(value ?? "")) ? `"${String(value).replaceAll('"', '""')}"` : String(value ?? ""))).join(",")).join("\n");

  /** One row per node, with every fact a node of this scene has. */
  function nodesCsv(found, view, flags) {
    const entries = visibleEntries(view, flags);
    const keys = [...new Set(entries.flatMap(({ node }) => Object.keys(node)))].filter((key) => !["color", "id"].includes(key));
    return csv([["id", ...keys, "relations", "findings"], ...entries.map(({ node, at, index: place }) => [node.id, ...keys.map((key) => node[key]), flags.degree[place], at >= 0 ? found.findingsOf.get(at)?.length ?? 0 : 0])]);
  }

  /** One row per relation. */
  function relationsCsv(view, flags) {
    return csv([["from", "to", "kind", "weight"], ...visibleEdges(view, flags).map(([from, to, kind, weight]) => [view.entries[from].node.label, view.entries[to].node.label, view.kinds[kind].kind, weight])]);
  }

  /** The scene as data: nodes with their facts and findings, and relations by node id. */
  function sceneData(atlas, found, view, flags) {
    return {
      generator: `BC Atlas ${atlas.version}`,
      project: atlas.title,
      lens: view.lens.id,
      title: view.title,
      summary: view.summary,
      sources: Object.fromEntries(atlas.sources),
      nodes: visibleEntries(view, flags).map(({ node, at, index: place }) => ({
        ...node,
        color: undefined,
        group: view.groups[view.nodes[place].group] || undefined,
        relations: flags.degree[place],
        findings: at >= 0 ? found.findingsOf.get(at)?.map(({ severity, rule, message, fix }) => ({ severity, rule, message, fix })) : undefined
      })),
      relations: visibleEdges(view, flags).map(([from, to, kind, weight]) => ({ from: view.entries[from].node.id, to: view.entries[to].node.id, kind: view.kinds[kind].kind, weight }))
    };
  }

  /** The address of a state: only what differs from the start. */
  function stateHash(state) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(state)) if (key in DEFAULTS && value !== DEFAULTS[key] && value !== undefined) params.set(key, value);
    return `#${params}`;
  }

  root.BCA_SCENE = {
    DEFAULTS, FORMS, COLORS, SIZES, GROUPS, SEVERITY, KIND_NAMES,
    index, scene, shown, matches, sizeValues, rings, highlight, kindOf,
    storyMarkdown, documentation, lensMarkdown, nodesCsv, relationsCsv, sceneData, stateHash
  };
})(globalThis);
