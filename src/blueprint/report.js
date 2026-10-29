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
    ...(proposal ? { proposal: { groupBy: proposal.groupBy, feedback: proposal.feedback, moves: proposal.moves, recommendations: proposal.recommendations } } : {}),
    baseline: {
      used: baseline.baselined,
      new: baseline.new.map(({ id }) => id),
      known: baseline.known.length,
      fixed: baseline.fixed.map(({ id }) => id)
    },
    passed: baseline.new.length === 0
  };
}

const RULE_PHRASES = {
  "internal-access": (n) => `${n.toLocaleString("en-US")} ${n === 1 ? "uses" : "use"} internal objects`,
  "dependency-rule": (n) => `${n.toLocaleString("en-US")} ${n === 1 ? "breaks" : "break"} rules of .bca.json`
};

/** "12 of them point the wrong way, 3 use internal objects" */
function violationPhrase(summary) {
  if (!summary.violations) return "none of them point the wrong way";
  const byRule = summary.byRule ?? {};
  const special = Object.keys(RULE_PHRASES).filter((rule) => byRule[rule]);
  const wrongWay = summary.violations - special.reduce((total, rule) => total + byRule[rule], 0);
  const parts = [
    ...(wrongWay ? [`${wrongWay.toLocaleString("en-US")} of them ${wrongWay === 1 ? "points" : "point"} the wrong way`] : []),
    ...special.map((rule) => RULE_PHRASES[rule](byRule[rule]))
  ];
  return parts.join(", ");
}

const CHECK_TITLES = {
  "component-cycle": "Component cycle",
  "unassigned-objects": "Unassigned objects",
  "empty-component": "Empty component",
  "unused-selector": "Unused selector",
  "unused-component-dependency": "Unused declared dependency",
  "inconsistent-component-dependency": "Declared dependency against the layers",
  "declared-component-cycle": "Declared cycle",
  "component-too-large": "Component too large",
  "unstable-dependency": "Depends on a less stable component",
  "foreign-table-write": "Table written by another component",
  "could-be-internal": "Could be Access = Internal",
  "public-surface-change": "Breaking change of the public surface"
};

/** App candidates with their components: { app, components: [recommendation] } plus the shared core and loose objects. */
function appCandidates(recommendations = []) {
  const apps = new Map();
  for (const recommendation of recommendations) {
    const key = recommendation.app ?? (recommendation.role === "shared" ? "(shared core)" : "(no relations)");
    if (!apps.has(key)) apps.set(key, []);
    apps.get(key).push(recommendation);
  }
  return [...apps].map(([app, components]) => ({ app, components }));
}

function headline(assessment) {
  const { result, proposal, baseline } = assessment;
  const { summary } = result;
  const layers = new Set(result.components.map(({ layer }) => layer).filter((layer) => layer !== undefined)).size;
  const lines = [
    `${count(summary.components, "component")}${layers ? ` in ${count(layers, "layer")}` : ""}, ${count(summary.assigned, "object")} assigned` +
      (summary.unassigned ? `, ${count(summary.unassigned, "object")} unassigned` : "") + ".",
    `${count(summary.dependencies, "object dependency", "object dependencies")} cross components; ${violationPhrase(summary)}` +
      (summary.workItems ? `, grouped into ${count(summary.workItems, "work item")}.` : "."),
    ...(summary.coupling ? [`${Math.round(summary.coupling.share * 100)}% of the coupling stays inside components (modularity ${summary.coupling.modularity.toFixed(2)}).`] : []),
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
  lines.push("Components (layer, objects, cohesion, instability, violations)");
  for (const component of [...result.components].sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0) || a.name.localeCompare(b.name))) {
    const cohesion = component.metrics.cohesion === undefined ? "   -" : `${String(Math.round(component.metrics.cohesion * 100)).padStart(3)}%`;
    lines.push(`  ${String(component.layer ?? "-").padStart(3)}  ${component.name.padEnd(32)} ${String(component.metrics.objects).padStart(6)}  ${cohesion}  I ${component.metrics.instability.toFixed(2)}  ${String(component.violations).padStart(5)}${component.extractable ? "  ready to extract" : ""}`);
  }
  if (assessment.proposal?.recommendations?.length) {
    lines.push("", "App candidates and namespaces");
    for (const { app, components } of appCandidates(assessment.proposal.recommendations)) {
      lines.push(`  ${app}`);
      for (const recommendation of components) lines.push(`    ${recommendation.component.padEnd(30)} ${recommendation.namespace ?? ""}${recommendation.keepsNamespace ? " (kept)" : ""}`);
    }
  }
  const items = baseline.baselined ? result.workItems.filter((item) => baseline.new.some(({ source, targetComponent }) =>
    source.id === item.source.id && targetComponent === item.targetComponent)) : result.workItems;
  const structural = items.filter(({ strategy }) => strategy !== "move-permissions");
  const grants = items.length - structural.length;
  lines.push("", items.length ? `Work items${baseline.baselined ? " (new since the baseline)" : ""}, most dependencies first${grants ? ` (plus ${grants} permission set grant(s) to split)` : ""}` : "Work items: none");
  for (const item of structural.slice(0, limit)) {
    lines.push(`  [${item.effort}] ${item.title}: ${objectName(item.source)} (${item.sourceComponent} -> ${item.targetComponent}), ${count(item.violations, "dependency", "dependencies")}`);
  }
  if (structural.length > limit) lines.push(`  ... ${structural.length - limit} more; use --format markdown or json for all of them`);
  const checks = result.checks ?? [];
  if (checks.length) {
    lines.push("", "Architecture checks");
    for (const check of checks.slice(0, limit)) lines.push(`  ${check.severity.toUpperCase().padEnd(7)} ${check.message}`);
    if (checks.length > limit) lines.push(`  ... ${checks.length - limit} more`);
  }
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
    "| Layer | Component | Objects | Depends on | Cohesion | Instability | Abstractness | Distance | Wrong-way | Ready to extract |",
    "| ---: | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |"
  );
  for (const component of [...result.components].sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0) || a.name.localeCompare(b.name))) {
    const metrics = component.metrics;
    lines.push(`| ${component.layer ?? ""} | ${cell(component.name)} | ${metrics.objects} | ${cell((component.dependsOn ?? component.dependsOnActual).join(", ") || "-")} | ${metrics.cohesion === undefined ? "-" : `${Math.round(metrics.cohesion * 100)}%`} | ${metrics.instability.toFixed(2)} | ${metrics.abstractness.toFixed(2)} | ${metrics.distance.toFixed(2)} | ${component.violations} | ${component.extractable ? "yes" : "no"} |`);
  }
  lines.push("", "Layer 0 is the core. Cohesion is the share of a component's coupling that stays inside it. Instability is outgoing / (incoming + outgoing) coupling; components should depend on more stable ones. Distance measures how far a component is from the balance of abstractness and stability.", "");
  if (proposal?.recommendations?.length) {
    lines.push("## App candidates and namespaces", "",
      "Components that are coupled more to each other than to the rest could become one app together; a component on its own could become an app by itself. The shared core holds objects that many components use.", "",
      "| App candidate | Component | Role | Namespace |", "| --- | --- | --- | --- |");
    const roles = { app: "app of its own", component: "component", shared: "shared core", review: "no relations" };
    for (const { app, components } of appCandidates(proposal.recommendations)) {
      for (const recommendation of components) {
        lines.push(`| ${cell(app)} | ${cell(recommendation.component)} | ${roles[recommendation.role]} | \`${cell(recommendation.namespace)}\`${recommendation.keepsNamespace ? " (kept)" : ""} |`);
      }
    }
    lines.push("");
  }

  const items = baseline.baselined
    ? result.workItems.filter((item) => baseline.new.some(({ source, targetComponent }) => source.id === item.source.id && targetComponent === item.targetComponent))
    : result.workItems;
  lines.push(`## Dependencies to resolve${baseline.baselined ? " (new since the baseline)" : ""}`, "");
  if (Object.keys(result.summary.byStrategy).length) {
    lines.push("| Strategy | Dependencies |", "| --- | ---: |");
    for (const [strategy, total] of Object.entries(result.summary.byStrategy)) lines.push(`| \`${strategy}\` | ${total} |`);
    lines.push("");
  }
  // Permission grants are mechanical; list them apart from structural work.
  const permissions = items.filter(({ strategy }) => strategy === "move-permissions");
  const structural = items.filter(({ strategy }) => strategy !== "move-permissions");
  if (!structural.length) lines.push(permissions.length ? "Only permission grants, see below." : "None.", "");
  structural.slice(0, limit).forEach((item, index) => {
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
  if (structural.length > limit) lines.push(`${structural.length - limit} more work item(s); use --format json for all of them.`, "");
  if (permissions.length) {
    const total = permissions.reduce((sum, item) => sum + item.violations, 0);
    lines.push("## Permission sets to split", "",
      `${count(permissions.length, "permission set grant")} (${count(total, "object")}) give access to objects of outer components. When a component becomes an app, it brings these grants in a permission set or permission set extension of its own.`, "",
      "| Permission set | In | Grants objects of | Objects |", "| --- | --- | --- | ---: |");
    for (const item of permissions.slice(0, 60)) {
      lines.push(`| ${cell(objectName(item.source))} | ${cell(item.sourceComponent)} | ${cell(item.targetComponent)} | ${item.violations} |`);
    }
    if (permissions.length > 60) lines.push(`| ${permissions.length - 60} more | | | |`);
    lines.push("");
  }

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
  if (result.dataOwnership?.length) {
    const users = (list) => cell(list.map(({ component, objects }) => `${component} (${objects.length})`).join(", ")) || "-";
    lines.push("## Data ownership", "",
      "Tables of one component that other components use. A table that others write is the hardest dependency to cut: its writes belong behind a codeunit of the owner, or the table belongs elsewhere.", "",
      "| Table | Owner | Written by | Read by | Related from | Extended by |", "| --- | --- | --- | --- | --- | --- |");
    for (const table of result.dataOwnership.slice(0, limit)) {
      lines.push(`| ${cell(table.table)}${table.status === "shared-writes" ? " ⚠" : ""} | ${cell(table.component)} | ${users(table.writers)} | ${users(table.readers)} | ${users(table.relations)} | ${users(table.extenders)} |`);
    }
    if (result.dataOwnership.length > limit) lines.push(`| ${result.dataOwnership.length - limit} more | | | | | |`);
    lines.push("");
  }
  const surfaces = (result.surface ?? []).filter(({ api, candidates }) => api.length || candidates.length);
  if (surfaces.length) {
    lines.push("## Public surface", "",
      "What other components use of each component (its de facto API), and what nobody outside uses and could be `Access = Internal` (`bca refactor surface`).", "",
      "| Component | Used by others | Objects others use | Could be internal |", "| --- | ---: | --- | --- |");
    for (const surface of surfaces) {
      const used = surface.api.map(({ object, usedBy, internal }) => `${object}${internal ? " (internal)" : ""} ← ${usedBy.map(({ component }) => component).join(", ")}`);
      lines.push(`| ${cell(surface.component)} | ${surface.api.length} of ${surface.objects} | ${cell(used.slice(0, 12).join("; "))}${used.length > 12 ? `; +${used.length - 12} more` : ""} | ${cell(surface.candidates.map(({ object }) => object).slice(0, 8).join(", ")) || "-"} |`);
    }
    lines.push("");
  }
  if (result.surfaceChanges?.length) {
    lines.push("## Breaking changes of the public surface", "", "Since `.bca-surface.json` was recorded (`bca architecture --update-surface`):", "",
      ...result.surfaceChanges.map(({ message }) => `- ${cell(message)}`), "");
  }
  // Cycles, stability, and unassigned objects have sections of their own.
  const checks = (result.checks ?? []).filter(({ rule }) => !["unstable-dependency", "unassigned-objects", "foreign-table-write", "could-be-internal", "public-surface-change"].includes(rule));
  if (checks.length) {
    lines.push("## Architecture checks", "", "| Severity | Check | Finding |", "| --- | --- | --- |");
    for (const check of checks.slice(0, limit)) lines.push(`| ${check.severity} | ${CHECK_TITLES[check.rule] ?? check.rule} (\`${check.rule}\`) | ${cell(check.message)} |`);
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
