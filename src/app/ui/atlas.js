// BC Atlas: one view. The toolbar chooses what part of the atlas shows (a
// lens), in which form (2D, diagram, 3D), and what stands out (a search, the
// findings, a story); everything else is the graph. In VS Code the extension
// answers the view's requests (LIVE); an exported file reads the same atlas
// from an embedded snapshot. The whole state of the view is in the address,
// so any picture can be linked to and opened again.
(async () => {
  "use strict";

  const BOOT = window.BCA_APP ?? { mode: "static" };
  // Where the view runs, and what answers its requests (host.js).
  const { MCP, LIVE, vscode, inflate, call, toast, message, download, fileName } = BCA_HOST.connect(BOOT);
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  // The markup of the panels and menus (panels.js).
  const P = BCA_PANELS;
  const { esc, fmt, plural } = P;

  // What shows and how it reads as text is shared with the terminal (scene.js).
  const S = BCA_SCENE;
  const { KIND_NAMES } = S;

  // ------------------------------------------------------------------ data
  const SNAPSHOT = LIVE ? undefined : JSON.parse(await inflate(window.BCA_SNAPSHOT_GZIP));

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

  // ----------------------------------------------------------------- scene
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
    $("#story-button").setAttribute("aria-pressed", String(Boolean(state.story)));
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
    // The overview explains itself by its columns: its legend starts folded.
    const fold = folded ?? (innerWidth < 720 || Boolean(scene.flow));
    element.innerHTML = P.legend(scene, { hidden: list(state.hide), off: list(state.off), fold });
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
    // A large export leaves out what is inside each object: there is nothing to open then.
    const canOpen = Boolean(S.into(atlas, node, state)?.inside) && (node.kind !== "object" || LIVE || Boolean(SNAPSHOT.inside?.[node.id]));
    element.innerHTML = P.inspector({
      scene,
      index,
      findings: at >= 0 ? findingsOf.get(at) ?? [] : [],
      off: list(state.off),
      kindNames: KIND_NAMES,
      canOpen,
      // The same node from another side: the lenses it is in.
      sides: at >= 0 ? S.lensesOf(atlas, found, node.id).filter(({ id }) => id !== state.lens || state.inside || state.focus) : [],
      focus: state.focus,
      live: LIVE
    });
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
    element.innerHTML = P.storyBar(story, step, at, playing);
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
    popover.innerHTML = P.menus[button.dataset.menu]({ atlas, scene, state, live: LIVE, snapshot: SNAPSHOT, exports: EXPORTS });
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
      if (data?.type === "host-missing") message("<b>This page is the BC Atlas view as an MCP App.</b><span>It shows a project inside a chat client that renders MCP Apps. Open it from there, or use <code>bca export</code> for a file that stands alone.</span>");
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
