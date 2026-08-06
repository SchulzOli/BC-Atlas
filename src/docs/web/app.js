import DOMPurify from "/assets/dompurify.js";
import { marked } from "/assets/marked.js";

const state = {
  scenarios: [],
  diagnostics: [],
  glossary: [],
  automation: undefined,
  architecture: undefined,
  commands: [],
  selected: undefined,
  previewMode: "rendered"
};

const elements = Object.fromEntries(
  [...document.querySelectorAll("[id]")].map((item) => [
    item.id.replaceAll(/-([a-z])/gu, (_, letter) => letter.toUpperCase()),
    item
  ])
);

async function api(body) {
  const response = await fetch("/api/commands", body ? {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  } : undefined);
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "Command failed");
  return value;
}

async function command(name, options = {}) {
  return api({ command: name, ...options });
}

async function availableCommands() {
  return api();
}

function setBusy(busy, label = "Working") {
  elements.busy.hidden = !busy;
  elements.busy.lastChild.textContent = label;
  elements.syncStatus.textContent = busy ? label : "Up to date";
}

function toast(message, error = false) {
  elements.toast.textContent = message;
  elements.toast.className = error ? "visible error" : "visible";
  setTimeout(() => elements.toast.className = "", 2800);
}

function option(value, label = value) {
  return new Option(label, value);
}

function showView(name) {
  for (const view of document.querySelectorAll(".view")) {
    view.hidden = view.id !== `${name}-view`;
  }
  for (const item of document.querySelectorAll(".nav-item")) {
    item.classList.toggle("active", item.dataset.view === name);
  }
}

function scenarioButton(scenario, compact = false) {
  const button = document.createElement("button");
  const title = document.createElement("strong");
  const details = document.createElement("span");
  button.type = "button";
  button.className = compact ? "scenario-row" : "scenario-item";
  button.classList.toggle("active", scenario.id === state.selected?.id);
  title.textContent = scenario.title;
  details.textContent = compact
    ? `${scenario.id} · ${scenario.file}`
    : scenario.id;
  button.append(title, details);
  button.addEventListener("click", () => openScenario(scenario.id));
  return button;
}

function renderScenarioNavigation() {
  const query = elements.search.value.trim().toLowerCase();
  const matches = state.scenarios.filter((scenario) =>
    `${scenario.id} ${scenario.title} ${scenario.feature.join(" ")}`.toLowerCase().includes(query)
  );
  elements.scenarios.replaceChildren(...matches.map((scenario) => scenarioButton(scenario)));
  elements.scenarioTotal.textContent = state.scenarios.length;
}

function renderOverview() {
  const features = new Map();
  for (const scenario of state.scenarios) {
    for (const feature of scenario.feature.length ? scenario.feature : ["Unclassified"]) {
      features.set(feature, (features.get(feature) ?? 0) + 1);
    }
  }
  const errors = state.diagnostics.filter(({ severity }) => severity === "error").length;
  elements.scenarioCount.textContent = state.scenarios.length;
  elements.stableIdCount.textContent = state.scenarios.filter(({ idSource }) => idSource === "explicit").length;
  elements.featureCount.textContent = features.size;
  elements.issueCount.textContent = state.diagnostics.length;
  elements.navIssueCount.textContent = state.diagnostics.length;
  elements.healthBadge.textContent = errors ? "Needs attention" : "Healthy";
  elements.healthBadge.className = errors ? "badge danger" : "badge success";

  elements.featureList.replaceChildren(...[...features.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([name, count]) => {
      const row = document.createElement("div");
      const label = document.createElement("span");
      const value = document.createElement("strong");
      label.textContent = name;
      value.textContent = count;
      row.append(label, value);
      return row;
    }));
  if (!features.size) elements.featureList.textContent = "No feature metadata found.";

  elements.recentScenarios.replaceChildren(...state.scenarios.slice(0, 6)
    .map((scenario) => scenarioButton(scenario, true)));
  if (!state.scenarios.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No documented UI-test scenarios found.";
    elements.recentScenarios.replaceChildren(empty);
  }
}

function renderQuality() {
  const errors = state.diagnostics.filter(({ severity }) => severity === "error").length;
  const warnings = state.diagnostics.filter(({ severity }) => severity === "warning").length;
  elements.qualitySummary.replaceChildren(
    qualityMetric("Errors", errors, "danger"),
    qualityMetric("Warnings", warnings, "warning"),
    qualityMetric("Valid scenarios", state.scenarios.length - new Set(
      state.diagnostics.map(({ documentId }) => documentId).filter(Boolean)
    ).size, "success")
  );
  elements.diagnostics.replaceChildren(...state.diagnostics.map((diagnostic) => {
    const item = document.createElement("article");
    const heading = document.createElement("div");
    const badge = document.createElement("span");
    const location = document.createElement("code");
    const message = document.createElement("p");
    item.className = "diagnostic-item";
    badge.className = `badge ${diagnostic.severity === "error" ? "danger" : "warning"}`;
    badge.textContent = diagnostic.severity;
    location.textContent = diagnostic.documentId ?? diagnostic.file;
    message.textContent = diagnostic.message;
    heading.append(badge, location);
    item.append(heading, message);
    if (diagnostic.documentId) item.addEventListener("click", () => openScenario(diagnostic.documentId));
    return item;
  }));
  if (!state.diagnostics.length) {
    const empty = document.createElement("div");
    empty.className = "quality-empty";
    empty.innerHTML = "<strong>All checks passed</strong><span>No documentation issues found.</span>";
    elements.diagnostics.replaceChildren(empty);
  }
}

function qualityMetric(label, value, tone) {
  const article = document.createElement("article");
  const caption = document.createElement("span");
  const number = document.createElement("strong");
  article.className = tone;
  caption.textContent = label;
  number.textContent = Math.max(0, value);
  article.append(caption, number);
  return article;
}

function renderGlossary() {
  elements.glossaryList.replaceChildren(...state.glossary.map((definition) => {
    const row = document.createElement("article");
    const tag = document.createElement("code");
    const details = document.createElement("div");
    const value = document.createElement("strong");
    const description = document.createElement("p");
    const meta = document.createElement("span");
    tag.textContent = `[${definition.tag}]`;
    value.textContent = definition.value;
    description.textContent = definition.description;
    meta.textContent = [
      definition.cardinality === "one" ? "Single value" : "Repeatable",
      definition.qualifiers?.length ? `Types: ${definition.qualifiers.join(", ")}` : undefined,
      definition.relation ? `Relationship: ${definition.relation}` : undefined
    ].filter(Boolean).join(" · ");
    details.append(value, description, meta);
    row.append(tag, details);
    return row;
  }));
}

function renderAutomation(plan) {
  elements.automationStatus.textContent = plan.ready ? "Ready to automate" : "Needs attention";
  elements.automationStatus.className = plan.ready ? "badge success" : "badge warning";
  elements.automationScenarios.textContent = plan.checks.scenarios;
  elements.automationStableIds.textContent = plan.checks.stableIds;
  elements.automationIssues.textContent = plan.checks.issues;
  elements.automationCommands.textContent = plan.commands.join("\n");
  elements.pipelineFilename.textContent = plan.pipeline.filename;
  elements.pipelineCode.textContent = plan.pipeline.content;
  elements.automationProvider.value = plan.provider;
  elements.automationInput.value = plan.inputPath;
  elements.automationOutput.value = plan.outputDirectory;
}

function renderArchitecture(result) {
  state.architecture = result;
  elements.architectureFiles.textContent = result.files;
  elements.architectureNodes.textContent = result.nodes;
  elements.architectureEdges.textContent = result.edges;
  elements.architectureDiagnostics.textContent = result.diagnostics.length;
  elements.architectureStatus.textContent = result.diagnostics.length ? "Diagnostics" : "Ready";
  elements.architectureStatus.className = result.diagnostics.length
    ? "badge warning"
    : "badge success";
  const svg = DOMPurify.sanitize(result.svg, {
    USE_PROFILES: { svg: true, svgFilters: true }
  });
  elements.architectureCanvas.innerHTML = svg;
}

async function buildArchitecture(event) {
  event?.preventDefault();
  setBusy(true, "Rendering architecture");
  try {
    const view = elements.architectureViewSelect.value;
    const selector = elements.architectureSelector.value.trim() || undefined;
    const result = await command("graph", {
      view,
      direction: elements.architectureDirection.value,
      focus: view === "workflow" ? undefined : selector,
      entry: view === "workflow" ? selector : undefined
    });
    renderArchitecture(result);
  } catch (error) {
    elements.architectureStatus.textContent = "Failed";
    elements.architectureStatus.className = "badge danger";
    toast(error.message, true);
  } finally {
    setBusy(false);
  }
}

function renderMetadata(scenario) {
  elements.metadata.replaceChildren(...scenario.metadata.map(({ tag, value, qualifier }) => {
    const row = document.createElement("div");
    const key = document.createElement("code");
    const text = document.createElement("span");
    const remove = document.createElement("button");
    row.className = "metadata-row";
    key.textContent = `[${tag}]${qualifier ? ` [${qualifier}]` : ""}`;
    text.textContent = value;
    remove.type = "button";
    remove.className = "remove-button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => removeMetadata(tag, value, qualifier));
    row.append(key, text, remove);
    return row;
  }));
}

function setPreviewMode(mode) {
  state.previewMode = mode;
  const rendered = mode === "rendered";
  elements.previewRendered.hidden = !rendered;
  elements.previewSource.hidden = rendered;
  elements.showRendered.classList.toggle("active", rendered);
  elements.showSource.classList.toggle("active", !rendered);
  elements.showRendered.setAttribute("aria-pressed", rendered);
  elements.showSource.setAttribute("aria-pressed", !rendered);
}

function renderMarkdown(markdown) {
  const html = marked.parse(markdown, { gfm: true });
  elements.previewRendered.innerHTML = DOMPurify.sanitize(html);
  elements.previewSource.textContent = markdown;
  setPreviewMode(state.previewMode);
}

function renderScenario(scenario) {
  elements.title.textContent = scenario.title;
  elements.source.textContent = `${scenario.file} · ${scenario.procedure}`;
  elements.documentId.textContent = scenario.id;
  elements.status.textContent = scenario.diagnostics.length ? `${scenario.diagnostics.length} issue(s)` : "Valid";
  elements.status.className = scenario.diagnostics.length ? "badge danger" : "badge success";
  renderMarkdown(scenario.markdown);
  renderMetadata(scenario);
  renderScenarioNavigation();
}

async function loadWorkspace() {
  setBusy(true, "Refreshing");
  try {
    state.commands = await availableCommands();
    const hasArchitecture = state.commands.includes("graph");
    elements.architectureNav.hidden = !hasArchitecture;
    [state.scenarios, state.diagnostics, state.glossary, state.automation] = await Promise.all([
      command("list"),
      command("validate"),
      command("glossary"),
      command("automation")
    ]);
    refreshScenarioOptions();
    renderScenarioNavigation();
    renderOverview();
    renderQuality();
    renderGlossary();
    renderAutomation(state.automation);
    if (hasArchitecture && !state.architecture) await buildArchitecture();
  } catch (error) {
    toast(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function openScenario(id) {
  setBusy(true, "Loading scenario");
  try {
    state.selected = await command("show", { id });
    renderScenario(state.selected);
    showView("scenario");
  } catch (error) {
    toast(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function saveMetadata(event) {
  event.preventDefault();
  setBusy(true, "Saving metadata");
  try {
    const result = await command("set", {
      id: state.selected.id,
      tag: elements.tag.value,
      qualifier: elements.qualifierField.hidden ? undefined : elements.qualifier.value,
      value: elements.value.value,
      expectedFileHash: state.selected.fileHash
    });
    elements.value.value = "";
    await loadWorkspace();
    await openScenario(result.documentId);
    toast("Metadata saved");
  } catch (error) {
    toast(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function removeMetadata(tag, value, qualifier) {
  setBusy(true, "Removing metadata");
  try {
    const result = await command("unset", {
      id: state.selected.id,
      tag,
      value,
      qualifier,
      expectedFileHash: state.selected.fileHash
    });
    await loadWorkspace();
    await openScenario(result.documentId);
    toast("Metadata removed");
  } catch (error) {
    toast(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function generateDocumentation() {
  setBusy(true, "Generating Markdown");
  try {
    const result = await command("generate", { outputDirectory: "docs/generated" });
    toast(`Generated ${result.files.length} file(s)`);
  } catch (error) {
    toast(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function validateDocumentation() {
  setBusy(true, "Validating");
  try {
    state.diagnostics = await command("validate");
    renderOverview();
    renderQuality();
    toast(state.diagnostics.length ? `${state.diagnostics.length} issue(s) found` : "All checks passed");
  } catch (error) {
    toast(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function buildAutomation(event) {
  event?.preventDefault();
  setBusy(true, "Building workflow");
  try {
    state.automation = await command("automation", {
      provider: elements.automationProvider.value,
      inputPath: elements.automationInput.value,
      outputDirectory: elements.automationOutput.value
    });
    renderAutomation(state.automation);
  } catch (error) {
    toast(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function copyText(value, message) {
  try {
    await navigator.clipboard.writeText(value);
    toast(message);
  } catch (error) {
    toast(error.message, true);
  }
}

function refreshScenarioOptions() {
  const options = state.scenarios.map(({ id }) => option(id));
  elements.scenarioIds.replaceChildren(...options);
}

function updateMetadataForm() {
  const definition = state.glossary.find(({ tag }) => tag === elements.tag.value);
  elements.qualifierField.hidden = !definition?.qualifiers;
  elements.value.placeholder = definition?.relation ? "Select a scenario ID" : "Metadata value";
}

for (const item of document.querySelectorAll(".nav-item")) {
  item.addEventListener("click", () => showView(item.dataset.view));
}
elements.search.addEventListener("input", renderScenarioNavigation);
elements.refresh.addEventListener("click", loadWorkspace);
elements.generate.addEventListener("click", generateDocumentation);
elements.runValidation.addEventListener("click", validateDocumentation);
elements.automationForm.addEventListener("submit", buildAutomation);
elements.architectureForm.addEventListener("submit", buildArchitecture);
elements.metadataForm.addEventListener("submit", saveMetadata);
elements.tag.addEventListener("change", updateMetadataForm);
elements.backToOverview.addEventListener("click", () => showView("overview"));
elements.showRendered.addEventListener("click", () => setPreviewMode("rendered"));
elements.showSource.addEventListener("click", () => setPreviewMode("source"));
elements.browseScenarios.addEventListener("click", () => {
  elements.search.focus();
  elements.search.scrollIntoView({ behavior: "smooth", block: "center" });
});
elements.copyPreview.addEventListener("click", async () => {
  await copyText(state.selected.markdown, "Markdown copied");
});
elements.copyCommands.addEventListener("click", () => copyText(
  state.automation.commands.join("\n"),
  "Commands copied"
));
elements.copyPipeline.addEventListener("click", () => copyText(
  state.automation.pipeline.content,
  "Pipeline copied"
));

await loadWorkspace();
elements.tag.replaceChildren(...state.glossary.map(({ tag }) => option(tag, `[${tag}]`)));
const given = state.glossary.find(({ tag }) => tag === "GIVEN");
elements.qualifier.replaceChildren(...given.qualifiers.map((value) => option(value)));
updateMetadataForm();
showView("overview");
