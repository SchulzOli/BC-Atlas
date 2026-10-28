const EFFORT = { S: "small", M: "medium", L: "large" };

function count(value, singular, plural = `${singular}s`) {
  return `${value.toLocaleString("en-US")} ${value === 1 ? singular : plural}`;
}

function cell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replace(/\r?\n/gu, " ");
}

function objectName(object) {
  return `${object.type} ${object.objectId ? `${object.objectId} ` : ""}${object.label}`;
}

function location(evidence) {
  return evidence.file ? `${evidence.file}${evidence.line ? `:${evidence.line}` : ""}` : undefined;
}

/** The machine-readable report: everything except internal lookup tables. */
export function architectureJson(assessment) {
  const { result, proposal, baseline, architecture } = assessment;
  const { assignment: _assignment, ...rest } = result;
  return {
    ...rest,
    mode: proposal ? "proposal" : "configured",
    architecture,
    ...(proposal ? { proposal: { groupBy: proposal.groupBy, feedback: proposal.feedback, moves: proposal.moves } } : {}),
    baseline: {
      used: baseline.baselined,
      new: baseline.new.map(({ id }) => id),
      known: baseline.known.length,
      fixed: baseline.fixed.map(({ id }) => id)
    },
    passed: baseline.new.length === 0
  };
}

function headline(assessment) {
  const { result, proposal, baseline } = assessment;
  const { summary } = result;
  const layers = new Set(result.components.map(({ layer }) => layer).filter((layer) => layer !== undefined)).size;
  const lines = [
    `${count(summary.components, "component")}${layers ? ` in ${count(layers, "layer")}` : ""}, ${count(summary.assigned, "object")} assigned` +
      (summary.unassigned ? `, ${count(summary.unassigned, "object")} unassigned` : "") + ".",
    `${count(summary.dependencies, "object dependency", "object dependencies")} cross components; ${summary.violations.toLocaleString("en-US")} of them point the wrong way` +
      `, grouped into ${count(summary.workItems, "work item")}.`,
    summary.extractable === 1
      ? "1 component can become an app of its own today."
      : `${summary.extractable.toLocaleString("en-US")} components can each become an app of their own today.`
  ];
  if (baseline.baselined) {
    lines.push(`Baseline: ${baseline.new.length} new, ${baseline.known.length} accepted, ${baseline.fixed.length} fixed since the baseline.`);
  }
  if (proposal) {
    lines.push("This is a proposal derived from today's dependencies; save it with --write and bca check enforces it.");
  }
  return lines;
}

export function formatArchitectureText(assessment, { limit = 15 } = {}) {
  const { result, baseline } = assessment;
  const lines = [`BC Atlas architecture - ${assessment.proposal ? "proposal" : "check"}`, "", ...headline(assessment).map((line) => `  ${line}`), ""];
  lines.push("Components (layer, objects, instability, violations)");
  for (const component of [...result.components].sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0) || a.name.localeCompare(b.name))) {
    lines.push(`  ${String(component.layer ?? "-").padStart(3)}  ${component.name.padEnd(32)} ${String(component.metrics.objects).padStart(6)}  I ${component.metrics.instability.toFixed(2)}  ${String(component.violations).padStart(5)}${component.extractable ? "  ready to extract" : ""}`);
  }
  const items = baseline.baselined ? result.workItems.filter((item) => baseline.new.some(({ source, targetComponent }) =>
    source.id === item.source.id && targetComponent === item.targetComponent)) : result.workItems;
  lines.push("", items.length ? `Work items${baseline.baselined ? " (new since the baseline)" : ""}, most dependencies first` : "Work items: none");
  for (const item of items.slice(0, limit)) {
    lines.push(`  [${item.effort}] ${item.title}: ${objectName(item.source)} (${item.sourceComponent} -> ${item.targetComponent}), ${count(item.violations, "dependency", "dependencies")}`);
  }
  if (items.length > limit) lines.push(`  ... ${items.length - limit} more; use --format markdown or json for all of them`);
  return `${lines.join("\n")}\n`;
}

function mermaid(result) {
  const id = new Map(result.components.map((component, index) => [component.name, `c${index}`]));
  const lines = ["```mermaid", "flowchart BT"];
  for (const component of result.components) {
    lines.push(`  ${id.get(component.name)}["${component.name.replaceAll('"', "'")}<br/>${component.metrics.objects} objects"]`);
  }
  const links = [];
  for (const edge of result.edges) {
    lines.push(`  ${id.get(edge.source)} ${edge.allowed ? "-->" : "-.->"}|${edge.objectEdges}| ${id.get(edge.target)}`);
    links.push(edge.allowed);
  }
  links.forEach((allowed, index) => {
    if (!allowed) lines.push(`  linkStyle ${index} stroke:#d62728,stroke-width:2px`);
  });
  lines.push("```");
  return lines;
}

export function formatArchitectureMarkdown(assessment, { limit = 100 } = {}) {
  const { result, proposal, baseline } = assessment;
  const lines = [`# ${proposal ? "Proposed architecture" : "Architecture check"}`, "", ...headline(assessment), ""];

  lines.push("## Components", "");
  if (result.components.length <= 40) lines.push(...mermaid(result), "", "Solid arrows are allowed dependencies, dashed red arrows point the wrong way; labels count object dependencies.", "");
  lines.push(
    "| Layer | Component | Objects | Depends on | Instability | Abstractness | Distance | Wrong-way | Ready to extract |",
    "| ---: | --- | ---: | --- | ---: | ---: | ---: | ---: | --- |"
  );
  for (const component of [...result.components].sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0) || a.name.localeCompare(b.name))) {
    const metrics = component.metrics;
    lines.push(`| ${component.layer ?? ""} | ${cell(component.name)} | ${metrics.objects} | ${cell((component.dependsOn ?? component.dependsOnActual).join(", ") || "-")} | ${metrics.instability.toFixed(2)} | ${metrics.abstractness.toFixed(2)} | ${metrics.distance.toFixed(2)} | ${component.violations} | ${component.extractable ? "yes" : "no"} |`);
  }
  lines.push("", "Layer 0 is the core. Instability is outgoing / (incoming + outgoing) coupling; components should depend on more stable ones. Distance measures how far a component is from the balance of abstractness and stability.", "");

  const items = baseline.baselined
    ? result.workItems.filter((item) => baseline.new.some(({ source, targetComponent }) => source.id === item.source.id && targetComponent === item.targetComponent))
    : result.workItems;
  lines.push(`## Dependencies to resolve${baseline.baselined ? " (new since the baseline)" : ""}`, "");
  if (Object.keys(result.summary.byStrategy).length) {
    lines.push("| Strategy | Dependencies |", "| --- | ---: |");
    for (const [strategy, total] of Object.entries(result.summary.byStrategy)) lines.push(`| \`${strategy}\` | ${total} |`);
    lines.push("");
  }
  if (!items.length) lines.push("None.", "");
  items.slice(0, limit).forEach((item, index) => {
    lines.push(`### ${index + 1}. ${cell(objectName(item.source))}: ${item.sourceComponent} → ${item.targetComponent}`, "");
    lines.push(`**${item.title}** (\`${item.strategy}\`, effort ${EFFORT[item.effort]}, resolves ${count(item.violations, "dependency", "dependencies")})`, "");
    for (const step of item.steps) lines.push(`- ${step}`);
    if (item.alternatives.length) lines.push(`- Alternative: ${item.alternatives.map(({ title, strategy }) => `${title} (\`${strategy}\`)`).join("; ")}`);
    const targets = item.targets.map((target) => `${target.type} ${target.label}`);
    lines.push(`- Targets: ${cell(targets.join(", "))}${item.violations > targets.length ? `, +${item.violations - targets.length} more` : ""}`);
    const places = item.evidence.map(location).filter(Boolean);
    if (places.length) lines.push(`- Where: ${places.map((place) => `\`${place}\``).join(", ")}`);
    lines.push("");
  });
  if (items.length > limit) lines.push(`${items.length - limit} more work item(s); use --format json for all of them.`, "");

  if (proposal?.moves.length) {
    lines.push("## Objects that belong elsewhere", "", "Moving these objects removes cross-component dependencies without other changes.", "",
      "| Object | From | To | Links to target | Links to own |", "| --- | --- | --- | ---: | ---: |");
    for (const move of proposal.moves.slice(0, 30)) {
      lines.push(`| ${cell(objectName(move.object))} | ${cell(move.from)} | ${cell(move.to)} | ${move.linksToTarget} | ${move.linksToOwn} |`);
    }
    lines.push("");
  }
  if (result.stability.length) {
    lines.push("## Stable dependencies principle", "", "These components depend on components that are less stable than themselves.", "",
      "| From | Instability | To | Instability | Dependencies |", "| --- | ---: | --- | ---: | ---: |");
    for (const item of result.stability.slice(0, 30)) {
      lines.push(`| ${cell(item.source)} | ${item.sourceInstability.toFixed(2)} | ${cell(item.target)} | ${item.targetInstability.toFixed(2)} | ${item.objectEdges} |`);
    }
    lines.push("");
  }
  if (result.unassigned.length) {
    lines.push("## Unassigned objects", "", `${count(result.unassigned.length, "object")} match no component selector: ${cell(result.unassigned.slice(0, 20).map(objectName).join(", "))}${result.unassigned.length > 20 ? ", ..." : ""}.`, "");
  }
  if (baseline.fixed.length) {
    lines.push("## Fixed since the baseline", "", `${count(baseline.fixed.length, "accepted violation")} no longer exist. Run \`bca architecture --update-baseline\` to lock in the progress.`, "");
  }
  if (proposal) {
    lines.push("## Adopt this architecture", "",
      "1. `bca architecture --propose --write` saves the components, layers, and allowed dependencies to `.bca.json`; edit names and selectors as you like.",
      "2. `bca architecture --update-baseline` accepts today's violations, so only new ones fail.",
      "3. `bca check` fails CI on new violations and reports fixed ones; the baseline only shrinks.", "");
  }
  return `${lines.join("\n")}`;
}
