// The HTML of the panels of the view: the legend, the inspector, the story
// bar, and the menus. Pure templates: they get what to show and return
// markup; atlas.js owns the state and the events. Registers BCA_PANELS.
(() => {
  "use strict";

  const esc = (value) => String(value ?? "").replace(/[&<>"']/gu, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const fmt = (value) => Number(value ?? 0).toLocaleString("en-US");
  const plural = (count, word, many = `${word}s`) => `${fmt(count)} ${count === 1 ? word : many}`;
  // `code` and **bold** in generated text.
  const rich = (text) => esc(text).replace(/`([^`]+)`/gu, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/gu, "<b>$1</b>");

  const FACTS = [
    ["objectId", "ID"], ["namespace", "Namespace"], ["app", "App"], ["origin", "Origin"],
    ["publisher", "Publisher"], ["version", "Version"], ["access", "Access"], ["obsolete", "Obsolete"], ["severity", "Severity"],
    ["objects", "Objects"], ["procedures", "Procedures"], ["lines", "Lines"], ["complexity", "Complexity"], ["uses", "Uses"], ["usedBy", "Used by"],
    ["guides", "User guides"], ["document", "Document ID"], ["features", "Features"], ["journeys", "Journeys"], ["roles", "Roles"], ["permissions", "Permission sets"], ["actions", "Actions"],
    ["header", "Declaration"]
  ];
  const SIZES = [["", "Same size"], ["relations", "Relations"], ["usedBy", "Used by"], ["uses", "Uses"], ["lines", "Lines of code"], ["complexity", "Complexity"], ["objects", "Objects"], ["findings", "Findings"]];

  /** The legend: what the lens shows, its kinds of node and relation to switch on and off. */
  function legend(scene, { hidden, off, fold }) {
    const counts = new Map();
    for (const edge of scene.edges) counts.set(edge[2], (counts.get(edge[2]) ?? 0) + 1);
    return `
      <div class="where"><b>${esc(scene.title)}</b><span>${plural(scene.entries.length, "node")}, ${plural(scene.edges.length, "relation")}</span><button class="fold" data-fold aria-expanded="${!fold}" title="${fold ? "Show the legend" : "Hide the legend"}" aria-label="Legend"></button>${fold ? "" : `<p>${esc(scene.summary)}</p>`}</div>
      ${fold ? "" : `<div class="chips">${scene.classes.map((entry) => `<button class="chip ${hidden.has(String(entry.key)) ? "off" : ""}" data-class="${esc(entry.key)}" title="Show or hide"><i style="color:${esc(entry.color)}"></i>${esc(entry.label)} <small>${fmt(entry.count)}</small></button>`).join("")}</div>
      ${scene.kinds.length && !scene.flow ? `<div class="chips">${scene.kinds.map((kind, index) => `<button class="chip ${off.has(kind.kind) ? "off" : ""}" data-kind="${esc(kind.kind)}" title="Show or hide"><i class="line ${kind.dash ? "dash" : ""}" style="color:${esc(kind.color)}"></i>${esc(kind.kind)} <small>${fmt(counts.get(index) ?? 0)}</small></button>`).join("")}</div>` : ""}`}`;
  }

  /**
   * The inspector of the selected node: its facts, what can be done with it,
   * the lenses it is in, its findings, and its relations.
   */
  function inspector({ scene, index, findings, off, kindNames, canOpen, sides, focus, live }) {
    const { node } = scene.entries[index];
    const facts = FACTS.filter(([key]) => node[key] !== undefined && node[key] !== "").map(([key, label]) => [label, node[key]]);
    if (node.level) facts.splice(3, 0, ["Visibility", `${node.level}${node.canBe ? `; can be ${node.canBe}` : ""}${node.why ? ` (${node.why})` : ""}`]);
    if (node.file) facts.push(["Source", `${node.file}${node.line ? `:${node.line}` : ""}`]);
    const out = new Map();
    const into = new Map();
    for (const [from, to, kind] of scene.edges) {
      if (off.has(scene.kinds[kind].kind)) continue;
      if (from === index) (out.get(kind) ?? out.set(kind, []).get(kind)).push(to);
      if (to === index) (into.get(kind) ?? into.set(kind, []).get(kind)).push(from);
    }
    const rows = (groups, arrow) => [...groups].map(([kind, others]) => others.slice(0, 12).map((other) =>
      `<li><small>${arrow} ${esc(scene.kinds[kind].kind)}</small><button data-go="${esc(scene.entries[other].node.id)}">${esc(scene.entries[other].node.label)}</button></li>`).join("")
      + (others.length > 12 ? `<li><small>and ${fmt(others.length - 12)} more</small></li>` : "")).join("");
    const kind = node.kind === "object" || node.kind === "member" ? node.type : kindNames[node.kind] ?? node.kind;
    return `
      <header>
        <div style="flex:1;min-width:0"><div class="kind"><i style="background:${esc(scene.nodes[index].color)}"></i>${esc(kind)}${node.external ? " · other app" : ""}</div><h2>${esc(node.label)}</h2></div>
        <button class="close" data-close aria-label="Close" title="Close (Esc)">×</button>
      </header>
      ${node.about || node.caption ? `<p class="about">${rich(node.about ?? node.caption)}</p>` : ""}
      ${facts.length ? `<dl class="facts">${facts.map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`).join("")}</dl>` : ""}
      <div class="actions">
        ${canOpen ? `<button class="btn primary" data-act="inside" title="${node.kind === "object" ? "Its procedures and what each does" : "Its objects and what they do with each other"} (double click)">Open</button>` : ""}
        <button class="btn" data-act="focus">${focus === node.id ? "Show all" : "Neighbors"}</button>
        ${node.file ? `<button class="btn" data-act="source">${live ? "Go to source" : "Source"}</button>` : ""}
        <button class="btn" data-act="link">Link</button>
      </div>
      ${sides.length ? `<h3>See in</h3><div class="chips sides">${sides.map((lens) => `<button class="chip" data-side="${esc(lens.id)}" title="${esc(lens.summary)}">${esc(lens.title)}</button>`).join("")}</div>` : ""}
      ${findings.length ? `<h3>${plural(findings.length, "finding")}</h3>${findings.slice(0, 20).map((finding) => `<div class="finding ${esc(finding.severity)}"><b>${esc(finding.severity)} · ${esc(finding.rule)}</b><p>${rich(finding.message)}</p>${finding.fix ? `<p class="fix">${rich(finding.fix)}</p>` : ""}</div>`).join("")}` : ""}
      ${out.size ? `<h3>From here</h3><ul class="rows">${rows(out, "→")}</ul>` : ""}
      ${into.size ? `<h3>To here</h3><ul class="rows">${rows(into, "←")}</ul>` : ""}`;
  }

  /** The bar of a story: the step, where it is, and the controls. */
  function storyBar(story, step, at, playing) {
    return `
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
  }

  // The menus of the toolbar, by the data-menu of their button.
  const menus = {
    // The lenses by what they answer; each in one line, its full text on hover.
    lens: ({ atlas, state }) => {
      const sections = new Map();
      for (const lens of atlas.lenses) (sections.get(lens.section ?? "More") ?? sections.set(lens.section ?? "More", []).get(lens.section ?? "More")).push(lens);
      return [...sections].map(([section, lenses]) => `<h3>${esc(section)}</h3>${lenses.map((lens) =>
        `<button class="item line" role="menuitem" data-set-lens="${esc(lens.id)}" title="${esc(lens.summary)}" ${lens.id === state.lens && !state.inside ? 'aria-current="true"' : ""}><b>${esc(lens.title)}</b><small>${esc(lens.hint ?? lens.summary)}</small></button>`).join("")}`).join("");
    },
    story: ({ atlas, state }) => `${atlas.stories.map((story) => `<button class="item" role="menuitem" data-set-story="${esc(story.id)}" ${story.id === state.story ? 'aria-current="true"' : ""}><b>${esc(story.title)}</b><span>${plural(story.steps.length, "step")}</span><small>${esc(story.summary)}</small></button>`).join("")}
      <hr><p class="text" style="color:var(--muted);font-size:12.5px">A story is generated from the source. It explains, documents, tests, or demonstrates the system on the graph, and saves as Markdown.</p>`,
    view: ({ state }) => {
      const colors = [["", "As the lens does"], ["type", "Type"], ["namespace", "Namespace"], ["app", "App"], ["level", "Visibility"], ["findings", "Findings"]];
      const groups = [["", "As the lens does"], ["namespace", "Namespace"], ["app", "App"], ["kind", "Type"], ["none", "Nothing"]];
      const select = (name, options, value) => `<label class="field"><span>${name}</span><select data-view="${name.toLowerCase()}">${options.map(([key, label]) => `<option value="${key}" ${key === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>`;
      return `${select("Color", colors, state.color)}${select("Size", SIZES, state.size)}${select("Group", groups, state.group)}
        ${state.focus ? `<label class="field"><span>Depth</span><select data-view="depth">${[1, 2, 3].map((depth) => `<option ${String(depth) === state.depth ? "selected" : ""}>${depth}</option>`).join("")}</select></label>` : ""}
        <hr><div class="actions"><button class="btn" data-view-act="arrange">Arrange again</button><button class="btn" data-view-act="reset">Reset the view</button></div>`;
    },
    export: ({ exports }) => exports.map(([id, title, text]) => `<button class="item" role="menuitem" data-export="${id}"><b>${title}</b><small>${text}</small></button>`).join(""),
    sync: ({ atlas, scene, live, snapshot }) => `
      <p class="text"><b>${live ? "Live." : "A snapshot."}</b> ${live
        ? "The graph follows the AL source of this workspace: save a file and it is read again."
        : `Read on ${esc(new Date(snapshot.generatedAt).toLocaleString())} with BC Atlas ${esc(atlas.version)}. Run <code>bca export</code> again to bring it up to date.`}</p>
      <p class="text" style="color:var(--muted)">The source code is the only fact. Everything you see is generated from it.</p>
      <h3>Read from</h3>
      <dl class="facts">${[["This lens", scene.lens.reads], ...atlas.sources].map(([name, value]) => `<dt>${esc(name)}</dt><dd>${rich(value)}</dd>`).join("")}</dl>
      ${live ? `<div class="actions"><button class="btn" data-sync="refresh">Read the source again</button></div>` : ""}`
  };

  globalThis.BCA_PANELS = { esc, fmt, plural, rich, SIZES, legend, inspector, storyBar, menus };
})();
