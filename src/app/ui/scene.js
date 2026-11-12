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
  const KIND_NAMES = { object: "Object", app: "App", component: "Component", module: "Namespace", rule: "Rule", process: "Process", task: "Process test", person: "Person", role: "Role", requirement: "Requirement", member: "Member", recording: "Recording", channel: "Channel", area: "Area" };
  const DEFAULTS = Object.freeze({ lens: "overview", form: "", q: "", sel: "", focus: "", depth: "1", check: "", story: "", step: "0", color: "", size: "", group: "", off: "", hide: "", inside: "" });
  const FORMS = Object.freeze(["2d", "diagram", "3d"]);
  const COLORS = Object.freeze(["type", "component", "namespace", "app", "level", "findings"]);
  const SIZES = Object.freeze(["relations", "usedBy", "uses", "lines", "complexity", "objects", "findings"]);
  const GROUPS = Object.freeze(["component", "namespace", "app", "kind", "none"]);

  // What an app, a component, and a namespace hold: the objects that name them.
  const HOLDERS = {
    app: (node, holder) => node.app === holder.label,
    component: (node, holder) => node.component === holder.label,
    module: (node, holder) => node.namespace === holder.label && (!holder.app || node.app === holder.app)
  };

  // The overview reads from left to right: who uses the app, what they do, on which screens,
  // with which logic, in which data. Each is a column; what is in none of them is not in the overview.
  const FLOW = [
    { key: "people", title: "People", one: "person", of: (node) => node.kind === "person" },
    { key: "processes", title: "Processes", one: "process test", of: (node) => node.kind === "task" },
    { key: "screens", title: "Screens", one: "screen", of: (node) => node.kind === "object" && ["page", "pageextension", "pagecustomization", "report", "reportextension", "requestpage"].includes(node.type) },
    { key: "logic", title: "Logic", one: "logic object", of: (node) => node.kind === "object" && ["codeunit", "query", "xmlport", "interface"].includes(node.type) },
    { key: "data", title: "Data", one: "table", of: (node) => node.kind === "object" && ["table", "tableextension"].includes(node.type) }
  ];
  /** Above this many objects the overview shows areas (components, namespaces, or apps) in place of single objects. */
  const FLOW_OBJECTS = 48;
  /** A column of the overview holds at most this many areas; the smallest are one box. */
  const FLOW_AREAS = 12;

  const list = (value) => new Set(value ? String(value).split("|") : []);
  const kindOf = (node) => (node.kind === "object" || node.kind === "member" ? node.type : node.kind);
  const fmtCount = (value) => Number(value).toLocaleString("en-US");

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
    if (node.kind === "area") return { key: node.column, label: `${node.column}, by area`, color: node.color };
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
    // An app, a component, or a namespace that is gone into: its objects.
    const holder = !opened && state.inside && position.has(state.inside) ? atlas.nodes[position.get(state.inside)] : undefined;
    const holds = holder && HOLDERS[holder.kind];
    // What the overview adds to a node: its column, and its place in it.
    const ranks = new Map();
    let columns;
    // What each process test of the overview touches, also what it reaches through something else.
    const touching = new Map();
    if (lens.flow && !opened) {
      const inside = holds ? (node) => holds(node, holder) : undefined;
      if (holds) {
        title = holder.label;
        summary = `How the ${(KIND_NAMES[holder.kind] ?? holder.kind).toLowerCase()} ${holder.label} works, from left to right: its screens, its logic, its data, and who uses them.`;
      }
      const column = atlas.nodes.map((node) => (node.test ? -1 : FLOW.findIndex(({ of }) => of(node))));
      // In a holder: its objects, and what reaches them from outside the columns of objects.
      if (inside) atlas.nodes.forEach((node, at) => { if (column[at] >= 2 && (node.external || !inside(node))) column[at] = -1; });
      const objects = column.filter((at) => at >= 2).length;
      // Many objects: an area stands for the objects of one kind it holds.
      let areaOf;
      let unit = (at) => atlas.nodes[at];
      let finish = () => {};
      if (objects > FLOW_OBJECTS) {
        const own = atlas.nodes.filter((node, at) => column[at] >= 2 && !node.external);
        const by = ["component", "namespace", "app"].find((key) => new Set(own.map((node) => node[key] ?? "")).size > 1) ?? "component";
        areaOf = (node) => (node.external ? "Other apps" : node[by] ?? `No ${by}`);
        const size = FLOW.map(() => new Map());
        atlas.nodes.forEach((node, at) => { if (column[at] >= 2) size[column[at]].set(areaOf(node), (size[column[at]].get(areaOf(node)) ?? 0) + 1); });
        const kept = size.map((areas) => new Set([...areas].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, areas.size > FLOW_AREAS ? FLOW_AREAS - 1 : FLOW_AREAS).map(([name]) => name)));
        const named = areaOf;
        areaOf = (node, at) => (kept[column[at]].has(named(node)) ? named(node) : "");
        const holderKind = { component: "component", namespace: "module", app: "app" }[by];
        const areas = new Map();
        const areaAt = (at) => {
          const node = atlas.nodes[at];
          if (column[at] < 2) return node;
          const name = areaOf(node, at);
          const key = `area::${FLOW[column[at]].key}::${name}`;
          if (!areas.has(key)) {
            const real = name && atlas.nodes.find((candidate) => candidate.kind === holderKind && candidate.label === (by === "namespace" ? node.namespace : name) && (by !== "namespace" || !candidate.app || candidate.app === node.app));
            areas.set(key, { id: key, kind: "area", column: FLOW[column[at]].key, area: name, label: "", color: node.color, holder: real?.id, count: 0, members: [] });
          }
          const area = areas.get(key);
          area.count++;
          if (area.members.length < 6) area.members.push(node.label);
          return area;
        };
        const units = atlas.nodes.map((_, at) => (column[at] < 0 ? undefined : areaAt(at)));
        unit = (at) => units[at];
        finish = () => {
          const others = FLOW.map((_, at) => (size[at].size > kept[at].size ? size[at].size - kept[at].size : 0));
          for (const area of areas.values()) {
            const at = FLOW.findIndex(({ key }) => key === area.column);
            const what = `${fmtCount(area.count)} ${FLOW[at].one}${area.count === 1 ? "" : "s"}`;
            area.label = `${area.area || `${fmtCount(others[at])} more areas`} · ${fmtCount(area.count)}`;
            area.about = `${what} ${area.area ? `of ${area.area}` : `of ${fmtCount(others[at])} smaller areas`}: ${area.members.join(", ")}${area.count > area.members.length ? `, and ${fmtCount(area.count - area.members.length)} more` : ""}.`;
          }
        };
      }
      // Relations between columns, each once, from the left column to the right.
      const system = atlas.lenses.find(({ id }) => id === "system");
      const between = new Set(system?.relations ?? []);
      const weights = new Map();
      const flows = new Map();
      const add = (from, to, kind, weight) => {
        if (column[from] < 0 || column[to] < 0 || column[from] === column[to]) return;
        const [a, b] = column[from] < column[to] ? [from, to] : [to, from];
        const key = `${unit(a).id}\n${unit(b).id}\n${kind}`;
        if (!weights.has(key)) flows.set(key, [a, b, kind]);
        weights.set(key, (weights.get(key) ?? 0) + (weight ?? 1));
      };
      const touches = new Map();
      for (const [from, to, relation, weight] of atlas.edges) {
        const kind = atlas.relations[relation].kind;
        if (column[from] === 0 && column[to] === 1 && (kind === "performs" || kind === "blocked")) add(from, to, kind === "blocked" ? "stopped at" : "does", weight);
        else if (column[from] === 1 && column[to] >= 2 && kind === "touches") (touches.get(from) ?? touches.set(from, []).get(from)).push(to);
        else if (column[from] >= 2 && column[to] >= 2 && between.has(kind)) add(from, to, "uses", weight);
      }
      // A process test leads to what it touches first: what that uses in turn is reached through it.
      const after = new Map();
      for (const [a, b] of flows.values()) if (column[a] >= 2) (after.get(unit(a).id) ?? after.set(unit(a).id, new Set()).get(unit(a).id)).add(unit(b).id);
      const reach = (start) => {
        const seen = new Set();
        const open = [start];
        while (open.length) for (const next of after.get(open.pop()) ?? []) if (!seen.has(next)) { seen.add(next); open.push(next); }
        return seen;
      };
      const reached = new Map();
      for (const [task, targets] of touches) {
        const ids = [...new Set(targets.map((at) => unit(at).id))];
        const behind = new Set();
        for (const id of ids) for (const other of (reached.get(id) ?? reached.set(id, reach(id)).get(id))) behind.add(other);
        for (const target of targets) if (!behind.has(unit(target).id)) add(task, target, "uses", 1);
        touching.set(atlas.nodes[task].id, new Set(ids));
      }
      // People and process tests show when the objects do; in a holder, only those that lead into it.
      const leading = new Set();
      for (const [a] of flows.values()) if (column[a] === 1) leading.add(a);
      for (const [a, b] of flows.values()) if (column[a] === 0 && leading.has(b)) leading.add(a);
      // Between areas, a relation that also runs through the column in between is told by that way.
      if (areaOf) {
        for (const [key, [a, b]] of [...flows]) {
          if (column[b] - column[a] < 2) continue;
          const through = [...(after.get(unit(a).id) ?? [])].some((middle) => middle !== unit(b).id && after.get(middle)?.has(unit(b).id));
          if (through) flows.delete(key);
        }
      }
      const order = new Map();
      // Areas stand in the same order in every column: the largest first, the rest of them last.
      if (areaOf) {
        const total = new Map();
        atlas.nodes.forEach((_, at) => { if (column[at] >= 2) total.set(unit(at).area, (total.get(unit(at).area) ?? 0) + 1); });
        const sorted = [...total.keys()].sort((a, b) => (a === "") - (b === "") || total.get(b) - total.get(a) || a.localeCompare(b, undefined, { numeric: true }));
        atlas.nodes.forEach((_, at) => { if (column[at] >= 2) order.set(unit(at).id, sorted.indexOf(unit(at).area)); });
      }
      atlas.nodes.forEach((node, at) => {
        if (column[at] < 0 || (inside && column[at] < 2 && !leading.has(at))) return;
        const shown = unit(at);
        if (!place.has(shown.id)) {
          ranks.set(shown.id, column[at]);
          // Process tests stand in the order of the process.
          if (column[at] === 1) order.set(shown.id, at);
        }
        enter(shown, shown === node ? at : -1);
      });
      finish();
      for (const name of ["does", "stopped at", "uses"]) {
        if ([...flows.values()].some(([, , kind]) => kind === name)) kindAt({ kind: name, ...(name === "stopped at" ? { color: SEVERITY.error } : {}) });
      }
      for (const [key, [a, b, kind]] of flows) {
        if (!place.has(unit(a).id) || !place.has(unit(b).id)) continue;
        links.push([place.get(unit(a).id), place.get(unit(b).id), kindAt({ kind }), weights.get(key)]);
      }
      columns = FLOW.map(({ key, title: name }, rank) => ({ key, title: name, rank })).filter(({ rank }) => [...ranks.values()].includes(rank));
      for (const [id, at] of order) ranks.set(id, { rank: ranks.get(id), order: at });
    } else if (holds) {
      title = holder.label;
      summary = `The objects of the ${(KIND_NAMES[holder.kind] ?? holder.kind).toLowerCase()} ${holder.label}, and what they do with each other.`;
      const system = atlas.lenses.find(({ id }) => id === "system") ?? lens;
      const relations = new Set(system.relations);
      const member = atlas.nodes.map((node) => node.kind === "object" && !node.external && holds(node, holder));
      atlas.nodes.forEach((node, at) => { if (member[at]) enter(node, at); });
      for (const kind of system.relations) {
        const relation = atlas.relations.find((candidate) => candidate.kind === kind);
        if (relation && atlas.edges.some((edge) => atlas.relations[edge[2]] === relation && member[edge[0]] && member[edge[1]])) kindAt(relation);
      }
      for (const edge of atlas.edges) {
        if (!member[edge[0]] || !member[edge[1]] || !relations.has(atlas.relations[edge[2]].kind)) continue;
        links.push([place.get(atlas.nodes[edge[0]].id), place.get(atlas.nodes[edge[1]].id), kindAt(atlas.relations[edge[2]]), edge[3]]);
      }
    } else if (opened) {
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

    const renumbered = new Map(shownEntries.map(({ node }, at) => [node.id, at]));
    // Groups hold together; classes give the colors and the legend.
    const groupBy = state.group || (opened ? "kind" : holds ? (holder.kind === "module" ? "kind" : "namespace") : lens.group);
    // The overview groups by its columns, in their order.
    const byColumn = columns && !state.group;
    const columnOf = (node) => FLOW[ranks.get(node.id)?.rank ?? ranks.get(node.id)]?.title ?? "";
    const groupOf = (node) => (byColumn ? columnOf(node) : groupBy === "none" ? "" : groupBy === "kind" ? kindOf(node) : node[groupBy] ?? (node.external ? "Other apps" : node.kind === "object" ? "" : node.kind));
    const groups = [...new Set(shownEntries.map(({ node }) => String(groupOf(node))))].sort((a, b) => (byColumn ? FLOW.findIndex(({ title: name }) => name === a) - FLOW.findIndex(({ title: name }) => name === b) : a.localeCompare(b)));
    const groupPosition = new Map(groups.map((group, at) => [group, at]));
    const mode = state.color || (opened || holds ? "type" : lens.color);
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
      key: [opened || holds ? `inside:${state.inside}${columns ? ":flow" : ""}` : lens.id, state.focus, state.depth, groupBy].join("\n"),
      lens,
      title,
      summary,
      within: Boolean(opened || holds),
      entries: shownEntries,
      place: new Map(shownEntries.map(({ node }, at) => [node.id, at])),
      // Each with its id, so a node keeps its place when what shows changes.
      nodes: shownEntries.map(({ node }, at) => {
        const rank = ranks.get(node.id);
        return { id: node.id, label: node.label, group: groupPosition.get(String(groupOf(node))), color: own[at] ?? classed[at].color,
          ...(rank === undefined ? {} : typeof rank === "number" ? { rank } : rank) };
      }),
      // The overview: its columns, and relations that stay quiet until something is selected.
      ...(columns ? { touches: new Map([...touching].filter(([id]) => renumbered.has(id)).map(([id, ids]) => [renumbered.get(id), new Set([...ids].filter((other) => renumbered.has(other)).map((other) => renumbered.get(other)))])) } : {}),
      ...(columns ? { flow: true, columns: columns.filter(({ rank }) => shownEntries.some(({ node }) => (ranks.get(node.id)?.rank ?? ranks.get(node.id)) === rank)) } : {}),
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
  function shown(view, state, atlas) {
    const hidden = list(state.hide);
    const off = list(state.off);
    // A class by its key, or by its name in the legend ("other apps").
    const nodes = Uint8Array.from(view.classOf, (entry) => (hidden.has(String(entry.key)) || hidden.has(String(entry.label)) ? 0 : 1));
    // A story that builds its picture (a run of the simulation): what no step has reached yet does not show.
    const story = atlas?.stories.find(({ id }) => id === state.story);
    if (story?.build) {
      const reached = new Set();
      const upTo = Math.min(Number(state.step) || 0, story.steps.length - 1);
      for (const step of story.steps.slice(0, upTo + 1)) for (const at of step.nodes) reached.add(atlas.nodes[at]?.id);
      view.entries.forEach(({ node }, at) => { if (!reached.has(node.id)) nodes[at] = 0; });
    }
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
    if (String(state.q ?? "").trim()) return new Set(hits);
    // In the overview a selected node lights its way: what leads to it, and what it leads to.
    if (view.flow && state.sel && view.place.has(state.sel)) return pathOf(view, view.place.get(state.sel));
    return undefined;
  }

  /**
   * The way of a node through the overview. A process test: who performs it and what it touches.
   * A person: their process tests and what those touch. An object: what uses it and what it uses,
   * all the way, the process tests that touch it, and who performs them.
   */
  function pathOf(view, start) {
    const lit = new Set([start]);
    const rank = (at) => view.nodes[at].rank;
    const walk = (from, here, there, only) => {
      const open = [from];
      while (open.length) {
        const at = open.pop();
        for (const edge of view.edges) {
          if (edge[here] !== at || lit.has(edge[there]) || !only(edge[there])) continue;
          lit.add(edge[there]);
          open.push(edge[there]);
        }
      }
    };
    const isObject = (at) => rank(at) >= 2;
    const tasks = new Set();
    if (rank(start) === 1) tasks.add(start);
    else if (rank(start) === 0) { for (const [from, to] of view.edges) if (from === start) tasks.add(to); }
    else {
      walk(start, 0, 1, isObject);
      walk(start, 1, 0, isObject);
      // Without process tests that know what they touch, what uses it leads up to who does it.
      for (const [task, touched] of view.touches ?? []) if (touched.has(start)) tasks.add(task);
    }
    for (const task of tasks) {
      lit.add(task);
      for (const other of view.touches?.get(task) ?? []) lit.add(other);
      if (rank(start) !== 0) for (const [from, to] of view.edges) if (to === task && rank(from) === 0) lit.add(from);
    }
    return lit;
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

  /**
   * Where going into a node leads: an object opens to its procedures; an app, a component, or a
   * namespace to its objects; anything else to itself and what is near it, in the lens it lives in.
   * @returns the change of state, or nothing for a node that has no inside (a procedure: its source)
   */
  function into(atlas, node, state) {
    if (node.kind === "member") return undefined;
    if (node.kind === "area") return node.holder && node.holder !== state.inside ? { inside: node.holder, focus: "", sel: "", story: "" } : undefined;
    if ((node.kind === "object" && !node.external) || HOLDERS[node.kind]) {
      return node.id === state.inside ? undefined : { inside: node.id, focus: "", sel: node.id, story: "" };
    }
    const home = atlas.lenses.find(({ id, kinds }) => id === state.lens && kinds.includes(node.kind))
      // An object of another app: the lens with every relation shows what is next to it.
      ?? (node.kind === "object" ? atlas.lenses.find(({ id }) => id === "system") : undefined)
      ?? atlas.lenses.find(({ kinds }) => kinds[0] === node.kind)
      // What a plugin added lives in the lens of that plugin.
      ?? atlas.lenses.find(({ kinds, plugin }) => node.plugin && plugin === node.plugin && kinds.includes(node.kind))
      ?? atlas.lenses.find(({ kinds }) => kinds.includes(node.kind));
    return { lens: home?.id ?? state.lens, inside: "", focus: node.id, depth: node.kind === "process" ? "2" : "1", sel: node.id, story: "" };
  }

  /**
   * The way to where the view is: the lens, then what was gone into, from the outside in.
   * @returns [{ label, change }] where change is the state that leads there; the last is where the view is
   */
  /**
   * The lenses a node is in, so the same node can be looked at from another side.
   * @returns the lenses of the atlas that show the node, in their order
   */
  function lensesOf(atlas, found, id) {
    found.inLens ??= new Map();
    return atlas.lenses.filter((lens) => {
      if (!found.inLens.has(lens.id)) found.inLens.set(lens.id, new Set(scene(atlas, found, { ...DEFAULTS, lens: lens.id }).place.keys()));
      return found.inLens.get(lens.id).has(id);
    });
  }
  function trail(atlas, found, state) {
    const lens = atlas.lenses.find(({ id }) => id === state.lens) ?? atlas.lenses[0];
    const crumbs = [{ label: lens.title, change: { inside: "", focus: "", story: "" } }];
    const node = (id) => (found.position.has(id) ? atlas.nodes[found.position.get(id)] : undefined);
    const inner = node(state.inside);
    if (inner) {
      // An object is in its component, when the project has components.
      const component = inner.kind === "object" && inner.component ? atlas.nodes.find(({ kind, label }) => kind === "component" && label === inner.component) : undefined;
      if (component) crumbs.push({ label: component.label, change: { inside: component.id, focus: "", sel: component.id, story: "" } });
      crumbs.push({ label: inner.label, change: { inside: inner.id, focus: "", story: "" } });
    }
    const near = node(state.focus);
    if (near) crumbs.push({ label: `near ${near.label}`, change: {} });
    return crumbs;
  }

  /** The form a state is drawn in: the one it names, else the one its lens reads best in. */
  function formOf(atlas, state) {
    if (FORMS.includes(state.form)) return state.form;
    const lens = atlas.lenses.find(({ id }) => id === state.lens) ?? atlas.lenses[0];
    return FORMS.includes(lens?.form) ? lens.form : "2d";
  }

  /** The address of a state: only what differs from the start. */
  function stateHash(state) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(state)) if (key in DEFAULTS && value !== DEFAULTS[key] && value !== undefined) params.set(key, value);
    return `#${params}`;
  }

  root.BCA_SCENE = {
    DEFAULTS, FORMS, COLORS, SIZES, GROUPS, SEVERITY, KIND_NAMES, formOf, pathOf,
    index, scene, shown, matches, sizeValues, rings, highlight, kindOf, into, trail, lensesOf,
    storyMarkdown, documentation, lensMarkdown, nodesCsv, relationsCsv, sceneData, stateHash
  };
})(globalThis);
