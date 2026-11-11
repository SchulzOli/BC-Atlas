// The grounding: what BC Atlas read from the source about one subject, as
// Markdown. It is what a model writes from, and nothing else: no source code,
// only names, steps, people, requirements, recordings, and findings. The same
// source gives the same text, so a page is written again only when its facts
// changed.
const SEVERITIES = ["error", "warning", "info"];
const slug = (text) => String(text).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "subject";

/** What there is to write about: the system, and every process of the battle test. */
export function subjectsOf(atlas) {
  return [
    { id: "system", kind: "system", title: atlas.title, file: "system" },
    ...atlas.nodes.filter((node) => node.kind === "process").map((node) => ({ id: `process:${node.id.slice("process::".length)}`, kind: "process", title: node.label, node: node.id, file: `process-${slug(node.id.slice("process::".length))}` }))
  ];
}

function indexOf(atlas) {
  const position = new Map(atlas.nodes.map((node, index) => [node.id, index]));
  const kindOf = (relation) => atlas.relations[relation].kind;
  return {
    position,
    out: (index, kinds) => atlas.edges.filter(([from, , relation]) => from === index && kinds.includes(kindOf(relation))).map(([, to, relation]) => [kindOf(relation), atlas.nodes[to], to]),
    into: (index, kinds) => atlas.edges.filter(([, to, relation]) => to === index && kinds.includes(kindOf(relation))).map(([from, , relation]) => [kindOf(relation), atlas.nodes[from], from])
  };
}
const objectName = (node) => `${node.type} ${node.objectId ? `${node.objectId} ` : ""}${node.label}${node.external ? " (another app)" : ""}`;
const findingLines = (findings) => findings
  .slice().sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.rule.localeCompare(b.rule) || a.message.localeCompare(b.message))
  .map((finding) => `- ${finding.severity} \`${finding.rule}\`: ${finding.message}${finding.fix ? ` Fix: ${finding.fix}` : ""}`);

function systemGrounding(atlas) {
  const summary = atlas.summary ?? {};
  const story = atlas.stories.find(({ id }) => id === "system");
  const of = (kind) => atlas.nodes.filter((node) => node.kind === kind);
  const errors = atlas.findings.filter(({ severity }) => severity !== "info");
  return [
    `# Facts about the system ${atlas.title}`, "",
    `${summary.objects} objects in ${summary.apps} app(s), ${summary.relations} relations between them.`,
    summary.health ? `Health check: ${summary.health.passed ? "passed" : "failed"} with ${summary.health.error} error(s), ${summary.health.warning} warning(s), ${summary.health.info} info.` : "",
    summary.architecture?.components ? `Architecture (${summary.architecture.mode}): ${summary.architecture.components} component(s), ${summary.architecture.violations ?? 0} dependency(ies) the wrong way.` : "",
    summary.battle ? `Battle test${summary.battle.company ? ` of ${summary.battle.company}` : ""}: ${summary.battle.passed ? "passed" : "failed"}.` : "", "",
    "## Apps", "", ...of("app").map((node) => `- ${node.label}${node.version ? ` ${node.version}` : ""}${node.objects !== undefined ? `, ${node.objects} object(s)` : ""}${node.origin && node.origin !== "This workspace" ? ` (${node.origin})` : ""}`), "",
    ...(of("component").length ? ["## Components", "", ...of("component").map((node) => `- ${node.label}${node.layer ? `, ${node.layer}` : ""}, ${node.objects ?? 0} object(s)`), ""] : []),
    ...(of("process").length ? ["## Processes", "", ...of("process").map((node) => `- ${node.label}${node.status ? ` (${node.status})` : ""}`), ""] : []),
    ...(story ? ["## What it consists of", "", ...story.steps.flatMap((step) => [`### ${step.title}`, "", step.text, ""])] : []),
    ...(errors.length ? ["## Errors and warnings", "", ...findingLines(errors), ""] : []),
    "## Read from", "", ...(atlas.sources ?? []).map(([name, value]) => `- ${name}: ${value}`), ""
  ].filter((line) => line !== undefined && line !== null).join("\n").replace(/\n{3,}/gu, "\n\n");
}

function processGrounding(atlas, subject) {
  const { position, out, into } = indexOf(atlas);
  const at = position.get(subject.node);
  const process = atlas.nodes[at];
  const tasks = out(at, ["step"]);
  const story = atlas.stories.find(({ id }) => id === subject.id);
  const recordings = atlas.stories.find(({ id }) => id === "sync");
  const involved = new Set([at, ...tasks.map(([, , index]) => index)]);
  const lines = [`# Facts about the process ${process.label}`, "", `Status: ${process.status ?? "unknown"}.${process.handovers !== undefined ? ` Handovers between roles: ${process.handovers}.` : ""}`, ""];
  for (const [, task, index] of tasks) {
    lines.push(`## Process test: ${task.label}`, "");
    if (task.about) lines.push(task.about, "");
    lines.push(`Status: ${task.status ?? "unknown"}.`, "");
    const people = into(index, ["performs", "blocked", "must not", "can, but must not"]);
    for (const [, , person] of people) involved.add(person);
    if (people.length) {
      lines.push("Who:", ...people.map(([kind, person]) => `- ${person.label}: ${{ performs: "performs it", blocked: "is assigned but blocked", "must not": "must not, and cannot", "can, but must not": "must not, but can" }[kind]}`), "");
    }
    const requirements = into(index, ["proven by"]);
    if (requirements.length) lines.push("Proves:", ...requirements.map(([, requirement]) => `- ${requirement.label}${requirement.status ? ` (${requirement.status})` : ""}`), "");
    const touched = out(index, ["touches"]);
    if (touched.length) lines.push(`Touches: ${touched.map(([, object]) => objectName(object)).sort().join("; ")}.`, "");
    // The steps as the story of the process tells them: what the user does, and what each step needs.
    const steps = (story?.steps ?? []).filter((step) => step.title.startsWith(`${task.label} · `));
    if (steps.length) lines.push("Steps:", ...steps.map((step) => `- ${step.title.slice(task.label.length + 3)}${step.status ? ` [${step.status}]` : ""}: ${step.text}`), "");
    const grounds = into(index, ["grounds"]);
    for (const [, recording] of grounds) {
      lines.push(`What really ran in Business Central (recording "${recording.label}"${recording.status ? `, ${recording.status}` : ""}):`);
      const phases = (recordings?.steps ?? []).filter((step) => step.title.startsWith(`${recording.label} · `));
      lines.push(...(phases.length ? phases.map((step) => `- ${step.title.slice(recording.label.length + 3)}: ${step.text}`) : ["- (the recording has no phases)"]), "");
    }
    if (!grounds.length && task.grounded === "no") lines.push("No recording of Business Central grounds this test: what is said about it comes from the source alone.", "");
  }
  const findings = atlas.findings.filter((finding) => finding.nodes.some((index) => involved.has(index)));
  if (findings.length) lines.push("## Findings", "", ...findingLines(findings), "");
  return lines.join("\n").replace(/\n{3,}/gu, "\n\n");
}

/** The grounding of one subject as Markdown. */
export function groundingOf(atlas, subject) {
  return `${(subject.kind === "system" ? systemGrounding(atlas) : processGrounding(atlas, subject)).trimEnd()}\n`;
}
