// Single source of truth for every BC Atlas command. The CLI parser, the
// built-in help, the generated documentation, and the machine-readable
// `bca help --format json` contract are all derived from this catalog.
// Commands of plugins come from their manifests (plugin.json).
import { BUILTIN_PLUGINS } from "./plugins/builtin.js";
import { parseManifest } from "./plugins/manifest.js";

const BUILTIN_MANIFESTS = BUILTIN_PLUGINS.map(({ manifest }) => parseManifest(manifest, `built-in plugin ${manifest.id}`));

export const VIEWS = Object.freeze([
  ["project", "AL objects grouped into role lanes (Data, UI, Services, ...)"],
  ["module", "Aggregated namespace or folder dependencies"],
  ["object", "One object with incoming and outgoing neighbors"],
  ["data", "Tables with reads, writes, relations, and extensions"],
  ["call", "Procedure and trigger call graph"],
  ["boundary", "Dependencies crossing a namespace, folder, app, or object"],
  ["contracts", "Interfaces and their direct or enum implementations"],
  ["events", "Event publishers and subscribers"],
  ["ui", "Pages, source tables, parts, actions, and navigation"],
  ["workflow", "Calls, events, and data mutations traced from entry points"],
  ["visibility", "What is public, internal, or local: objects, procedures, events, and fields in three levels, and what each can be"]
]);

export const FORMATS = Object.freeze(["d2", "json", "svg", "png", "pdf"]);
// What `bca export` can write besides the diagram views.
export const EXPORTS = Object.freeze([
  ["app", "The BC Atlas view as one offline HTML file to share: a toolbar and the graph, with every lens, finding, and story"],
  ["report", "Markdown report (README.md) with health, diagrams, and an optional object catalog"],
  ["explorer", "Interactive 3D dependency explorer (HTML), replayable over Git history, or its graph as JSON"],
  ["catalog", "One linked Markdown page per AL object"],
  ["handbook", "System handbook: Markdown pages that explain the system across all objects (events, data, permissions, interfaces, user interface, code health)"],
  ["knowledge-graph", "The analyzed project as RDF with the BC Atlas OWL ontology, for knowledge graphs and triple stores: Turtle, RDF/XML (.rdf, .owl), N-Triples, or JSON-LD"]
]);
// RDF syntaxes of the knowledge-graph export.
export const KNOWLEDGE_FORMATS = Object.freeze(["ttl", "rdf", "owl", "nt", "jsonld"]);
export const SEVERITIES = Object.freeze(["error", "warning", "info"]);
export const FAIL_LEVELS = Object.freeze(["error", "warning", "info", "never"]);
export const REPORT_VIEWS = Object.freeze(["project", "module", "data", "contracts", "events", "ui"]);
// What the view shows (the lenses of src/app/atlas.js), its forms, and what `bca view` writes.
export const VIEW_LENSES = Object.freeze(["overview", "system", "components", "apps", "modules", "data", "calls", "events", "contracts", "pages", "security", "visibility", "health", "processes", "people", "requirements", "simulation", "run"]);
export const VIEW_FORMS = Object.freeze(["2d", "diagram", "3d"]);
export const VIEW_FORMATS = Object.freeze(["text", "json", "md", "csv", "svg", "png", "link"]);

export const FEATURE_AREAS = Object.freeze([
  {
    id: "start",
    title: "Get started",
    summary: "Set up a project; in VS Code, the BC Atlas extension shows everything in the editor."
  },
  {
    id: "analyze",
    title: "Analyze",
    summary: "Gate CI on architecture health, keep a target architecture in place, and battle-test the app as your company uses it."
  },
  {
    id: "export",
    title: "Export",
    summary: "Write what the app shows as files, look at any part of it from the terminal, and write user guides from AL UI tests."
  },
  {
    id: "integrate",
    title: "Integrate",
    summary: "Connect BC Atlas to Git hooks, pipelines, schedules, and AI agents."
  }
]);

const string = (description, extra = {}) => ({ type: "string", description, ...extra });
const flag = (description, extra = {}) => ({ type: "boolean", description, ...extra });

const OUTPUT = "Output";
const SELECTION = "View selection";
const FILTERS = "Filters";
const CALLS = "Call view";
const WORKFLOW = "Workflow view";
const RENDERING = "Rendering";
const LINKS = "Source links";
const GENERAL = "General";

const sourceLinkOptions = {
  sourceUrl: string("Node-link template with {file}, {line}, and {ref} placeholders.", { group: LINKS, value: "template" }),
  sourceRef: string("Commit or branch substituted for {ref}.", { group: LINKS, value: "ref", default: "main" }),
  sourcePathPrefix: string("Repository-relative prefix prepended to {file}.", { group: LINKS, value: "path" })
};

const projectOptions = {
  projectRoot: string("Analyze this app or workspace root; the positional path becomes the focus.", {
    group: GENERAL,
    value: "path"
  }),
  config: string("Configuration file (default: <app-root>/.bca.json).", { group: GENERAL, value: "path" }),
  strict: flag("Fail when analysis produces warning or error diagnostics.", { group: GENERAL }),
  compiler: string("AL compiler for calls and diagnostics: auto (AL Language extension or AL Development Tools when installed), off, or a path to alc, al, or the extension folder.", {
    group: "AL tools",
    value: "mode"
  }),
  compilerLog: string("Import diagnostics from an AL compiler error log file or folder (alc /errorlog, al workspace compile, AL-Go).", {
    group: "AL tools",
    value: "path"
  })
};

const filterOptions = {
  namespace: string("Namespace glob.", { group: FILTERS, repeatable: true, value: "glob" }),
  type: string("Comma-separated AL object types.", { group: FILTERS, repeatable: true, value: "types" }),
  include: string("File or object glob to include.", { group: FILTERS, repeatable: true, value: "glob" }),
  exclude: string("File or object glob to exclude.", { group: FILTERS, repeatable: true, value: "glob" })
};

const diagramOptions = {
  object: string("Object name, ID, key, or typed selector such as codeunit:50100.", { group: SELECTION, value: "selector" }),
  objectInboundDepth: string("Incoming depth for the object view.", { group: SELECTION, value: "n", default: "1" }),
  objectOutboundDepth: string("Outgoing depth for the object view.", { group: SELECTION, value: "n", default: "1" }),
  members: string("Members to list: fields,actions,triggers,events,procedures.", { group: SELECTION, value: "list" }),
  scope: string("Boundary scope: namespace:, folder:, app:, or object: selector.", {
    group: SELECTION,
    repeatable: true,
    value: "selector"
  }),
  focus: string("Name fragment for the contracts, events, ui, or visibility view.", { group: SELECTION, value: "text" }),
  groupBy: string("Diagram views: role, namespace, folder, or type (default: role for project, else namespace). Proposed architecture: auto, coupling, namespace, folder, module, or app.", {
    group: SELECTION,
    enum: ["auto", "coupling", "namespace", "folder", "module", "app", "type", "role"]
  }),
  moduleDepth: string("Namespace segments in the module view, or auto.", { group: SELECTION, value: "n", default: "auto" }),
  folderDepth: string("Folder segments in a folder-grouped module view.", { group: SELECTION, value: "n", default: "1" }),
  ...filterOptions,
  includeUnresolvedCalls: flag("Include unresolved and isolated calls.", { group: CALLS }),
  rootProcedure: string("Call root procedure selector.", { group: CALLS, repeatable: true, value: "selector" }),
  callDepth: string("Call traversal depth from each root.", { group: CALLS, value: "n", default: "3" }),
  callDirection: string("Call traversal direction.", { group: CALLS, enum: ["incoming", "outgoing", "both"], default: "outgoing" }),
  expandProcedures: flag("Call view: show procedures instead of owning-object aggregates. Visibility view: show every procedure, event, and field inside its object.", { group: CALLS }),
  expandFrameworkCalls: flag("Show individual framework and standard-library calls.", { group: CALLS }),
  entry: string("Workflow entry procedure, trigger, action, or event.", { group: WORKFLOW, repeatable: true, value: "selector" }),
  workflowDepth: string("Workflow traversal depth.", { group: WORKFLOW, value: "n", default: "8" }),
  workflowMaxNodes: string("Workflow node cap.", { group: WORKFLOW, value: "n", default: "100" }),
  workflowEdgeTypes: string("Comma-separated calls,events,writes,reads.", {
    group: WORKFLOW,
    value: "list",
    default: "calls,events,writes"
  }),
  maxEdges: string("Diagram edge cap.", { group: RENDERING, value: "n", default: "500" }),
  direction: string("Diagram direction.", { group: RENDERING, enum: ["right", "down", "left", "up"], default: "right" }),
  noLegend: flag("Hide edge and confidence legends.", { group: RENDERING }),
  details: flag("Show member counts in nodes.", { group: RENDERING }),
  noExternal: flag("Hide unresolved and external dependencies.", { group: RENDERING })
};

const pathsOption = string("Only analyze AL files in this folder or matching this glob, relative to the project root.", {
  group: FILTERS,
  repeatable: true,
  value: "path"
});

const graphOptions = {
  root: string("Exact node ID, label, or Atlas key; repeat for multiple roots.", { group: FILTERS, repeatable: true, value: "selector" }),
  rootGroup: string("Named root group in the saved graph, e.g. legacy.", { group: FILTERS, value: "name" }),
  depth: string("Traversal depth; 0 selects only roots. Without roots the entire graph is returned.", { group: FILTERS, value: "n", default: "1" }),
  direction: string("Follow dependencies, callers, or both; edge directions remain unchanged.", { group: FILTERS, enum: ["outgoing", "incoming", "both"], default: "outgoing" }),
  kind: string("Traverse edges containing this relation kind; aggregated evidence stays intact.", { group: FILTERS, repeatable: true, value: "kind" }),
  level: string("Temporal graph level: object, app, module, or component.", { group: FILTERS, value: "name", default: "object" }),
  frame: string("Temporal presence frame index (default: latest); labels/evidence reflect the saved document.", { group: FILTERS, value: "n" })
};

const exportOptions = {
  view: string("What to write: app, report, explorer, catalog, handbook, knowledge-graph, or a diagram view.", {
    group: OUTPUT,
    enum: [...EXPORTS.map(([id]) => id), ...VIEWS.map(([id]) => id)],
    default: "app"
  }),
  output: string("Output file or folder (default: bc-atlas.html, docs/atlas, bc-atlas-explorer.html, docs/codegraph, docs/handbook, bc-atlas.ttl, or bc-atlas-<view>.svg); - writes JSON to stdout.", {
    group: OUTPUT,
    short: "o",
    value: "path"
  }),
  format: string("app: html; explorer: html or json; report: svg or d2 diagrams; catalog and handbook: md; knowledge-graph: ttl, rdf, owl, nt, or jsonld; diagram views: svg, d2, json, png, or pdf. Inferred from the output extension when omitted.", {
    group: OUTPUT,
    short: "f",
    enum: ["html", "md", ...FORMATS, ...KNOWLEDGE_FORMATS]
  }),
  baseIri: string("Knowledge graph: base IRI of the exported resources (default urn:bc-atlas:).", { group: OUTPUT, value: "iri" }),
  catalog: string("Handbook: link object names to the object catalog in this folder (as bca export --view catalog writes it).", { group: OUTPUT, value: "folder" }),
  language: string("Handbook: language of the pages, en (default) or de (de-DE).", { group: OUTPUT, value: "tag" }),
  noEvidence: flag("Knowledge graph: leave out the bca:Relation resources with each relation's file, line, and operations; the direct relation triples stay. About a third of the size.", { group: OUTPUT }),
  title: string("Title of the report, explorer, or diagram.", { group: OUTPUT, value: "text" }),
  watch: flag("Write again whenever AL source, app.json, or .bca.json changes.", { group: OUTPUT }),
  debounce: string("Delay before writing again with --watch, in milliseconds.", { group: OUTPUT, value: "ms", default: "250" }),
  views: string("Report: comma-separated diagram views.", { group: "Report", value: "list", default: REPORT_VIEWS.join(",") }),
  codegraph: flag("Report: also write the object catalog.", { group: "Report" }),
  handbook: flag("Report: also write the system handbook to <output>/handbook, linked to the catalog with --codegraph.", { group: "Report" }),
  json: flag("Report: also write the resolved model as model.json.", { group: "Report" }),
  history: flag("Explorer: replay Git history, one frame per step (see --history-by) that changed AL files or app.json.", { group: "Timeline" }),
  historyBy: string("One frame per commit, per merged pull request, or per release tag; implies --history.", { group: "Timeline", enum: ["commits", "prs", "releases"], default: "commits" }),
  last: string("Only the last n steps (commits, pull requests, or releases).", { group: "Timeline", value: "n" }),
  maxCommits: string("Most frames to replay; older steps are sampled evenly.", { group: "Timeline", value: "n", default: "60" }),
  since: string("Only replay commits after this date (anything git log --since accepts).", { group: "Timeline", value: "date" }),
  propose: flag("Explorer: show a proposed target architecture when .bca.json defines none.", { group: SELECTION }),
  lens: string("Explorer: relationship family.", { group: SELECTION, enum: ["dependency"], default: "dependency" }),
  ...diagramOptions,
  paths: pathsOption,
  ...sourceLinkOptions,
  ...projectOptions
};

const checkOptions = {
  failOn: string("Lowest severity that fails the check.", { group: GENERAL, enum: FAIL_LEVELS, default: "error" }),
  format: string("Report format; sarif for GitHub code scanning and Azure DevOps.", { group: OUTPUT, short: "f", enum: ["text", "json", "markdown", "sarif"], default: "text" }),
  output: string("Write the report to a file instead of stdout.", { group: OUTPUT, short: "o", value: "path" }),
  compare: string("Add the trend against an earlier report of bca check --format json: new and fixed findings, and how counts and metrics changed.", { group: OUTPUT, value: "path" }),
  maxFanIn: string("Warn when an object has more distinct dependents.", { group: GENERAL, value: "n", default: "25" }),
  maxFanOut: string("Warn when an object has more distinct dependencies.", { group: GENERAL, value: "n", default: "25" }),
  analyzers: string("Code analyzers for the AL compile: CodeCop, UICop, AppSourceCop, PerTenantExtensionCop, or DLL paths (default: al.codeAnalyzers when al.enableCodeAnalysis is on).", {
    group: "AL tools",
    value: "list"
  }),
  ...filterOptions,
  ...projectOptions
};

const blueprintOptions = {
  format: string("Report format.", { group: OUTPUT, short: "f", enum: ["text", "markdown", "json"], default: "text" }),
  output: string("Write the report to a file instead of stdout.", { group: OUTPUT, short: "o", value: "path" }),
  propose: flag("Propose an architecture from today's dependencies, even when .bca.json defines one.", { group: "Proposal" }),
  groupBy: string("How the proposal groups objects into components; auto: the typed, weighted relations decide (coupling is the same); namespace or folder: the code structure decides, objects without it follow their relations; module or app: one component each.", {
    group: "Proposal",
    enum: ["auto", "coupling", "namespace", "folder", "module", "app"],
    default: "auto"
  }),
  depth: string("With --group-by namespace or folder: segments per component; default: split until no component is too large.", { group: "Proposal", value: "n" }),
  minObjects: string("Merge smaller groups into the component they depend on most.", { group: "Proposal", value: "n", default: "1" }),
  startFrom: string("Existing structures that compete with the relations as a starting point: namespace, folder, both (comma-separated), or none for relations only; architecture.proposal.startFrom in .bca.json.", { group: "Proposal", value: "list", default: "namespace,folder" }),
  ignore: string("Relation kinds that never shape a component (comma-separated, e.g. permits,includes,uses); architecture.proposal.ignore in .bca.json.", { group: "Proposal", value: "kinds", default: "permits,includes" }),
  granularity: string("How finely the relations split: above 1 gives more and smaller components, below 1 fewer and larger ones; architecture.proposal.granularity in .bca.json.", { group: "Proposal", value: "n", default: "1" }),
  sharedCore: string("Pull objects that many components use into a shared core component; architecture.proposal.sharedCore in .bca.json.", { group: "Proposal", enum: ["true", "false"], default: "true" }),
  extract: string("Plan extracting this component as an app of its own: blockers, dependencies, app.json, table moves, and steps.", { group: "Extraction", value: "component" }),
  explain: string("Explain why an object is in its component: the selector that assigns it and its coupling to each component (name, ID, or type:name).", { group: "Proposal", value: "object" }),
  write: flag("Save the architecture to .bca.json (architecture section).", { group: "Enforcement" }),
  updateBaseline: flag("Accept today's violations in the baseline file; only new ones fail afterwards.", { group: "Enforcement" }),
  updateSurface: flag("Record each component's public surface (what other components use) in .bca-surface.json; bca check then reports changes that break its users.", { group: "Enforcement" }),
  paths: pathsOption,
  ...filterOptions,
  projectRoot: projectOptions.projectRoot,
  config: projectOptions.config,
  compiler: projectOptions.compiler
};

const docsFormat = string("Output mode.", { group: OUTPUT, enum: ["text", "json"], default: "text" });

const cliName = (name) => `--${name.replaceAll(/([a-z])([A-Z])/gu, "$1-$2").toLowerCase()}`;

function command(definition) {
  const { options = {}, rules = [], examples = [], ...rest } = definition;
  return {
    ...rest,
    options: Object.fromEntries(Object.entries(options).map(([name, option]) => {
      const { short, ...value } = option;
      return [name, {
        cli: cliName(name),
        ...(short ? { short: `-${short}` } : {}),
        ...value
      }];
    })),
    rules,
    examples
  };
}

/**
 * Catalog entries for plugin commands (`bca <plugin> <command>`), built from manifests only.
 * Every command gets --config; commands with a project path also get [app-root].
 */
export function pluginCommands(manifests) {
  return manifests.flatMap((manifest) => manifest.contributes.commands.map((definition) => {
    const positional = definition.argv ?? "[app-root]";
    const options = Object.fromEntries(Object.entries(definition.options).map(([name, option]) => {
      const { type, description, ...extra } = option;
      return [name, type === "boolean" ? flag(description, extra) : string(description, extra)];
    }));
    if (!options.config) options.config = projectOptions.config;
    return command({
      id: `${manifest.id}.${definition.name}`,
      area: manifest.area,
      plugin: manifest.id,
      argv: ["bca", manifest.id, definition.name, ...(positional ? [positional] : [])],
      purpose: definition.purpose,
      options,
      output: definition.output ? { type: "json", when: "--format json", schema: definition.output } : { type: "text" },
      rules: definition.rules,
      examples: definition.examples
    });
  }));
}

/**
 * @param version BC Atlas version
 * @param plugins plugin manifests whose commands join the catalog: the built-in ones by default,
 *   plus project plugins when the CLI found any (bca plugins list shows where they come from)
 */
export function createCapabilities(version, { plugins = BUILTIN_MANIFESTS } = {}) {
  return {
    schemaVersion: 1,
    name: "bc-atlas",
    version,
    transport: {
      stdout: "json",
      encoding: "utf-8",
      rule: "For machine reads, use check, simulate, architecture, docs, or export (a diagram view, -o -) with --format json, and help --format json for this contract. Parse stdout only after exit code 0."
    },
    exitCodes: { success: 0, operation: 1, usage: 2 },
    conventions: {
      optionSyntax: "Use each option as a separate argv token. Repeat repeatable options.",
      paths: "Pass paths as single argv values; do not build a shell command string. An omitted [app-root] means the current directory.",
      mutations: "Use --dry-run first and pass --expected-hash when writing AL metadata.",
      sourceOfTruth: "AL source is authoritative; generated JSON, Markdown, D2, and SVG are outputs."
    },
    areas: FEATURE_AREAS,
    exports: EXPORTS.map(([id, summary]) => ({ id, summary })),
    views: VIEWS.map(([id, summary]) => ({ id, summary })),
    commands: [
      command({
        id: "setup",
        area: "start",
        argv: ["bca", "setup", "[app-root]"],
        purpose: "Set up BC Atlas for a project step by step: .bca.json, features, Git hooks, pipelines, schedules, and sync.",
        options: {
          yes: flag("Accept every recommendation without asking."),
          dryRun: flag("Show the planned files without writing them.")
        },
        output: { type: "process", interactive: true },
        rules: ["Without a terminal, use setup plan and setup apply, or let an agent run them (setup agent)."],
        examples: ["bca setup", "bca setup ./app --yes --dry-run"]
      }),
      command({
        id: "setup.plan",
        area: "start",
        argv: ["bca", "setup", "plan", "[app-root]"],
        purpose: "Detect the project and list setup questions with recommended answers.",
        options: { format: string("Output mode.", { enum: ["text", "json"], default: "text" }) },
        output: { type: "json", when: "--format json", schema: "SetupPlan" },
        examples: ["bca setup plan --format json"]
      }),
      command({
        id: "setup.apply",
        area: "start",
        argv: ["bca", "setup", "apply", "[app-root]"],
        purpose: "Write .bca.json, Git hooks, and a pipeline from setup answers.",
        options: {
          features: string("Features to automate: check, report, docs, codegraph.", { group: "Features", value: "list" }),
          tests: string("Folder with AL UI tests for the docs feature.", { group: "Features", value: "path" }),
          docsExport: string("Documentation formats: markdown, html, dita, ado-csv, bpmn.", { group: "Features", value: "list" }),
          docsAs: string("Documentation type.", { group: "Features", enum: ["guide", "testcase"] }),
          language: string("Documentation language, e.g. de-DE.", { group: "Features", value: "tag" }),
          hooks: string("Git hook manager.", { group: "Triggers", enum: ["husky", "git", "none"] }),
          preCommit: string("Features to run before each commit, or none.", { group: "Triggers", value: "list" }),
          prePush: string("Features to run before each push, or none.", { group: "Triggers", value: "list" }),
          hookSync: string("How hooks keep generated files in sync.", { group: "Sync", enum: ["verify", "stage", "none"] }),
          editor: string("Editor tasks for the local development loop.", { group: "Triggers", enum: ["vscode", "none"] }),
          updates: string("Propose new BC Atlas versions as pull requests (needs Husky).", { group: "Triggers", enum: ["dependabot", "none"] }),
          fromConfig: flag("Start from the answers in the existing .bca.json instead of recommendations.", { group: OUTPUT }),
          ci: string("Pipeline provider.", { group: "Triggers", enum: ["github", "azure-devops", "none"] }),
          ciSync: string("What pull requests and pushes do with generated files.", { group: "Sync", enum: ["verify", "artifact", "none"] }),
          schedule: string("Cron expression (UTC) for scheduled runs, or none.", { group: "Triggers", value: "cron" }),
          scheduleSync: string("What scheduled runs do with generated files.", {
            group: "Sync",
            enum: ["pull-request", "commit", "artifact", "verify", "none"]
          }),
          dryRun: flag("Show the planned files without writing them.", { group: OUTPUT }),
          force: flag("Replace pipeline files that were not generated by bca setup.", { group: OUTPUT }),
          format: string("Output mode.", { group: OUTPUT, enum: ["text", "json"], default: "text" })
        },
        output: { type: "json", when: "--format json", schema: "SetupResult" },
        rules: [
          "Omitted answers use the recommendation from setup plan.",
          "Lists are comma-separated; none means empty.",
          "Preview with --dry-run before writing."
        ],
        examples: [
          "bca setup apply --features check,report,docs --tests test --hooks husky --pre-commit check --pre-push report,docs --dry-run",
          "bca setup apply --ci github --ci-sync verify --schedule \"0 6 * * 1\" --schedule-sync pull-request"
        ]
      }),
      command({
        id: "setup.agent",
        area: "start",
        argv: ["bca", "setup", "agent", "[app-root]"],
        purpose: "Add a /bca-setup command for your AI agent that runs the guided setup through the CLI.",
        options: {
          agent: string("Agent to prepare.", { enum: ["claude", "copilot", "cursor", "generic"], default: "generic" }),
          print: flag("Print the instructions instead of writing a file."),
          force: flag("Replace an existing command file.")
        },
        output: { type: "file" },
        rules: ["generic always prints the prompt; paste it into any agent."],
        examples: ["bca setup agent --agent claude", "bca setup agent --agent copilot", "bca setup agent --print"]
      }),
      command({
        id: "check",
        area: "analyze",
        argv: ["bca", "check", "[app-root]"],
        purpose: "Score architecture health and fail CI on cycles, policy violations, or diagnostics.",
        options: checkOptions,
        output: { type: "json", when: "--format json", schema: "HealthReport" },
        rules: [
          "Exit code 1 means at least one finding reached --fail-on.",
          "--compare adds the trend to text, markdown, and json (trend); it does not change the exit code."
        ],
        examples: [
          "bca check ./app",
          "bca check ./app --fail-on warning",
          "bca check ./app --format markdown -o health.md",
          "bca check ./app --compare health-main.json --format markdown -o health.md"
        ]
      }),
      command({
        id: "simulate",
        area: "analyze",
        argv: ["bca", "simulate", "[app-root]"],
        purpose: "Battle-test the app as your company uses it: agents with roles, permission sets, and task groups perform the process tests (AL UI tests) step by step; reports who is blocked where and who can do what they must not, explains every permission a step needs, and writes the fit-gap analysis.",
        options: {
          tests: string("Folder with the process tests: AL UI tests with [SCENARIO] (default: simulation.tests, then docs.tests in .bca.json, then the app itself).", { group: GENERAL, value: "path" }),
          company: string("JSON file with the company (roles, agents, task groups, requirements) instead of the simulation section of .bca.json.", { group: GENERAL, value: "path" }),
          recordings: string("Folder with recordings of Business Central (fact snapshots as JSON) the agents perform as well: a recording with the title of a process test adds what really ran to that test, any other is a process of its own (default: simulation.recordings).", { group: GENERAL, value: "path" }),
          snapshots: string("Also write one fact snapshot per process test into this folder, from the source: its steps as phases, what each step needs as technical steps (default: simulation.snapshotDir, when set).", { group: OUTPUT, value: "path" }),
          failOn: string("Lowest severity that fails the battle test.", { group: GENERAL, enum: FAIL_LEVELS, default: "error" }),
          format: string("Report format (default: text, or the extension of --output).", { group: OUTPUT, short: "f", enum: ["text", "markdown", "json"] }),
          output: string("Write the report to a file instead of stdout.", { group: OUTPUT, short: "o", value: "path" }),
          language: string("Language of the report and the steps, en (default) or de.", { group: OUTPUT, value: "tag" }),
          title: string("Title of the report.", { group: OUTPUT, value: "text" }),
          projectRoot: projectOptions.projectRoot,
          config: projectOptions.config,
          compiler: projectOptions.compiler,
          compilerLog: projectOptions.compilerLog
        },
        output: { type: "json", when: "--format json", schema: "SimulationReport" },
        rules: [
          "Exit code 1 means a finding reached --fail-on: an agent cannot complete an assigned task, or can complete one it must not.",
          "Without roles in .bca.json (simulation.roles), every combination of [PERMISSIONS] in the tests is a role that performs the tests naming it.",
          "The battle test reads the source; it does not run the app or the tests."
        ],
        examples: [
          "bca simulate ./app --tests ./test",
          "bca simulate ./app --format markdown -o docs/simulation/README.md",
          "bca simulate ./app --company company.json --language de",
          "bca simulate ./app --format json"
        ]
      }),
      command({
        id: "simulate.define",
        area: "analyze",
        argv: ["bca", "simulate", "define", "[app-root]"],
        purpose: "Define the simulation: the company of the battle test. Add or change an agent, a role, a task group, or a requirement, ground a process test on a recording of Business Central, and run the changed simulation at once. Without options it shows the simulation as it is.",
        options: {
          agent: string("Add or change this agent (a person who uses the app): --roles, --permission-sets, --task-groups, --tasks, --must-not.", { group: SELECTION, value: "name" }),
          role: string("Add or change this role: --permission-sets, --task-groups, --tasks, --features, --must-not, --description.", { group: SELECTION, value: "name" }),
          taskGroup: string("Add or change this task group (what there is to do): --tasks, --features, --description.", { group: SELECTION, value: "name" }),
          requirement: string("Add or change this requirement of the company, by its id: --title, --tasks, --features, --objects, --description.", { group: SELECTION, value: "id" }),
          roles: string("The roles of an agent, comma-separated. An empty value takes them away.", { group: GENERAL, value: "list" }),
          permissionSets: string("The permission sets of a role or an agent, comma-separated.", { group: GENERAL, value: "list" }),
          taskGroups: string("The task groups a role or an agent does, comma-separated.", { group: GENERAL, value: "list" }),
          tasks: string("Process tests by document ID, comma-separated: what a role, an agent, or a task group does, or what proves a requirement.", { group: GENERAL, value: "list" }),
          features: string("Process tests by [FEATURE], comma-separated.", { group: GENERAL, value: "list" }),
          mustNot: string("What a role or an agent must not be able to do: process tests, features, or task groups, comma-separated.", { group: GENERAL, value: "list" }),
          objects: string("Objects that should cover a requirement, comma-separated: page:Name, codeunit:Name.", { group: GENERAL, value: "list" }),
          title: string("The title of a requirement.", { group: GENERAL, value: "text" }),
          description: string("What a role, a task group, or a requirement is.", { group: GENERAL, value: "text" }),
          remove: string("Remove something, as kind:name: agent:Anna, role:Team lead, taskGroup:Approval, requirement:REQ-2. Repeatable.", { group: SELECTION, repeatable: true, value: "kind:name" }),
          ground: string("Ground a process test on a recording of Business Central (a fact snapshot of the sync plugin): <document ID>=<recording>. Repeatable.", { group: SELECTION, repeatable: true, value: "task=recording" }),
          unground: string("Take the recording of a process test away. Repeatable.", { group: SELECTION, repeatable: true, value: "task" }),
          companyName: string("The name of the company.", { group: GENERAL, value: "text" }),
          init: flag("Write the company the process tests describe (a role per combination of [PERMISSIONS]) into .bca.json, as the start of a definition.", { group: SELECTION }),
          from: string("Apply the operations of a JSON file: a list of { op, kind, name, ... } (set, remove, ground, unground, company). What the Simulate menu of the view saves.", { group: SELECTION, value: "path" }),
          dryRun: flag("Run the changed simulation and report it; write nothing.", { group: OUTPUT }),
          format: string("text (default) or json: the definition and the result of the run.", { group: OUTPUT, short: "f", enum: ["text", "json"], default: "text" }),
          tests: string("Folder with the process tests (default: simulation.tests, then docs.tests in .bca.json, then the app itself).", { group: GENERAL, value: "path" }),
          projectRoot: projectOptions.projectRoot,
          config: projectOptions.config,
          compiler: projectOptions.compiler,
          compilerLog: projectOptions.compilerLog
        },
        output: { type: "json", when: "--format json", schema: "bc-atlas.simulation-definition" },
        rules: [
          "A change names what it changes and keeps the rest: --agent Ben --roles \"Team lead\" leaves Ben's other settings as they are. An empty value takes a field away.",
          "The first change of a project that defines nothing yet starts from the company the process tests describe, so nothing is lost.",
          "The changed simulation runs before anything is written; a definition that is not valid never reaches .bca.json.",
          "The exit code is 0 when the definition was applied, whatever the simulation finds; bca simulate is the gate."
        ],
        examples: [
          "bca simulate define ./app",
          "bca simulate define ./app --init",
          "bca simulate define ./app --role \"Team lead\" --permission-sets \"PR - REQUEST,PR - APPROVE\" --task-groups Requesting,Approval",
          "bca simulate define ./app --agent Ben --roles \"Team lead\"",
          "bca simulate define ./app --agent Dana --roles Purchaser --must-not Approval --dry-run",
          "bca simulate define ./app --requirement REQ-7 --title \"Orders are created from approved requests\" --tasks purchase-request-order",
          "bca simulate define ./app --ground purchase-request-approve=approve-a-released-purchase-request",
          "bca simulate define ./app --remove agent:Dana",
          "bca simulate define ./app --from operations.json --format json"
        ]
      }),
      command({
        id: "graph.query",
        area: "analyze",
        argv: ["bca", "graph", "query", "<graph.json>"],
        purpose: "Query a saved Atlas graph or nodes/edges snapshot without analyzing AL; retain IDs and evidence as reusable JSON.",
        options: {
          ...graphOptions,
          output: string("Write the reusable graph slice to this file; otherwise JSON goes to stdout.", { group: OUTPUT, value: "path", short: "o" })
        },
        output: { type: "json", schema: "bc-atlas.graph.slice" },
        rules: ["Input must be a version 1 graph with valid nodes and edges; output never overwrites the input.", "Depth limits traversal, not an induced subgraph: only edges visited from expanded roots are retained."],
        examples: [
          "bca graph query graph.json --root-group legacy --depth 2 -o orders.json",
          "bca graph query graph.json --root \"Sales-Post\" --direction incoming"
        ]
      }),
      command({
        id: "graph.render",
        area: "export",
        argv: ["bca", "graph", "render", "<graph.json>"],
        purpose: "Render a saved graph selection as local SVG/HTML, Graphviz DOT, or reusable JSON without analyzing AL.",
        options: {
          ...graphOptions,
          output: string("Output file; its extension selects the format when --format is omitted.", { group: OUTPUT, value: "path", short: "o", default: "bc-atlas-graph.svg" }),
          format: string("Output format.", { group: OUTPUT, enum: ["json", "dot", "svg", "html"], short: "f" }),
          title: string("Graph title.", { group: OUTPUT, value: "text" }),
          maxNodes: string("SVG/HTML node limit; oversized selections fail explicitly instead of being truncated.", { group: RENDERING, value: "n", default: "1500" }),
          maxEdges: string("SVG/HTML edge limit.", { group: RENDERING, value: "n", default: "5000" })
        },
        output: { type: "file", pathOption: "output" },
        rules: ["SVG and HTML use the built-in local renderer; Graphviz is not required.", "Roots are blue, unresolved boundaries orange; every selected edge keeps its original direction."],
        examples: [
          "bca graph render graph.json --root-group legacy -o orders.svg",
          "bca graph render orders.json -o orders.html"
        ]
      }),
      command({
        id: "architecture",
        area: "analyze",
        argv: ["bca", "architecture", "[app-root]"],
        purpose: "Find a target architecture (components, layers, allowed dependencies), list every dependency that points the wrong way with how to resolve it, and enforce it with a baseline.",
        options: blueprintOptions,
        output: { type: "json", when: "--format json", schema: "ArchitectureReport" },
        rules: [
          "Without an architecture section in .bca.json, the command proposes one from today's dependencies: components from the typed, weighted relations (with or without namespaces), a shared core, app candidates, and a namespace for each component.",
          "Exit code 1 when the configured architecture has violations that are not in the baseline.",
          "bca check enforces the same rules in CI; the baseline only shrinks."
        ],
        examples: [
          "bca architecture ./app",
          "bca architecture ./app --propose --format markdown -o architecture.md",
          "bca architecture ./app --propose --write --update-baseline",
          "bca architecture ./app --format json",
          "bca architecture ./app --extract Sales --format markdown -o extract-sales.md"
        ]
      }),
      command({
        id: "refactor.move",
        area: "analyze",
        argv: ["bca", "refactor", "move", "[app-root]"],
        purpose: "Move an AL object to another component: its file goes to the component's folder (cut out of a shared file), its namespace becomes the component's, and referencing files get the using they need.",
        options: {
          object: { ...string("Object to move: codeunit:50100, table:\"Sales Doc\", or a name.", { value: "selector" }), required: true },
          to: string("Target component of the architecture (.bca.json, or the proposal).", { value: "component" }),
          folder: string("Target folder, relative to the project root (default: the component's folder).", { value: "path" }),
          namespace: string("Target namespace (default: the component's namespace).", { value: "namespace" }),
          apply: flag("Write the changes; without it, only show the diff."),
          format: string("Output mode.", { group: OUTPUT, enum: ["text", "json"], default: "text" }),
          paths: pathsOption,
          projectRoot: projectOptions.projectRoot,
          config: projectOptions.config
        },
        output: { type: "json", when: "--format json", schema: "Refactoring" },
        rules: [
          "Without --apply nothing is written; review the diff first.",
          "--apply refuses when a file changed since the analysis.",
          "Work items of bca architecture --format json carry the command for move-extension, move-subscriber, move-object-up, and move-object-down.",
          "Afterwards compile and run bca check."
        ],
        examples: [
          "bca refactor move ./app --object codeunit:50100 --to Sales",
          "bca refactor move ./app --object tableextension:50001 --to Sales --apply"
        ]
      }),
      command({
        id: "refactor.surface",
        area: "analyze",
        argv: ["bca", "refactor", "surface", "[app-root]"],
        purpose: "Lock the public surface of components: objects no other component uses get Access = Internal, and .bca.json lists what others use in exposes.",
        options: {
          component: string("Only this component (default: every component).", { value: "component" }),
          internal: string("Set Access = Internal on codeunits, queries, and enums no other component uses.", { enum: ["true", "false"], default: "true" }),
          exposes: string("Write the de facto API of each component to exposes in .bca.json.", { enum: ["true", "false"], default: "true" }),
          apply: flag("Write the changes; without it, only show the diff."),
          format: string("Output mode.", { group: OUTPUT, enum: ["text", "json"], default: "text" }),
          paths: pathsOption,
          projectRoot: projectOptions.projectRoot,
          config: projectOptions.config
        },
        output: { type: "json", when: "--format json", schema: "Refactoring" },
        rules: [
          "Needs a configured architecture (.bca.json).",
          "Tables, interfaces, extensible enums, and codeunits that publish events stay public: other apps extend, implement, or subscribe to them.",
          "Without --apply nothing is written."
        ],
        examples: [
          "bca refactor surface ./app --component Core",
          "bca refactor surface ./app --apply"
        ]
      }),
      command({
        id: "export",
        area: "export",
        argv: ["bca", "export", "[app-root]"],
        purpose: "Write files: the BC Atlas view as one offline HTML file, the Markdown report, the 3D explorer, the object catalog, or one diagram view.",
        options: exportOptions,
        output: { type: "file", pathOption: "output", default: "bc-atlas.html" },
        rules: [
          "object view requires --object; boundary view requires at least one --scope; workflow view requires --entry",
          "A diagram view with --format json and no --output prints the resolved model to stdout",
          "--history needs Git; without it the explorer replays the build order (dependencies first)",
          "SVG, PNG, and PDF are drawn by BC Atlas itself; every drawing writes its D2 source next to it"
        ],
        examples: [
          "bca export ./app -o atlas.html",
          "bca export ./app --view report",
          "bca export ./app --view report --codegraph -o docs/architecture",
          "bca export ./workspace --view explorer --history -o dependencies.html",
          "bca export ./workspace --view explorer --history-by prs --last 30 -o dependencies.html",
          "bca export ./app --view module -o modules.svg",
          "bca export ./app --view object --object codeunit:50100 -o posting.svg",
          "bca export ./app --view workflow --entry ProcessDocument -o workflow.svg --watch",
          "bca export ./app --view project --format json > model.json",
          "bca export ./app --view catalog -o docs/codegraph"
        ]
      }),
      command({
        id: "view",
        area: "export",
        argv: ["bca", "view", "[app-root]"],
        purpose: "The BC Atlas view without a window: any lens, story, or object of the one graph as text, JSON, CSV, Markdown, SVG, or PNG. What the toolbar of the app does, from the terminal.",
        options: {
          lens: string(`What the graph shows: a part of the one graph (${VIEW_LENSES.join(", ")}, and the lenses of plugins, such as sync). overview is how it works, in columns from who uses it to the data. Without a lens (and without --story), the command lists the lenses and stories of the project.`, { group: SELECTION, value: "id", default: "overview" }),
          inside: string("Go into a node: an object opens to its procedures, triggers, and events and what each does with other objects; an app, a component, or a namespace to its objects. A name, an ID, or a selector such as codeunit:50100 or component:Core.", { group: SELECTION, value: "node" }),
          focus: string("Only this node and what is near it (see --depth). A name, an ID, or a selector such as table:Customer or person:Anna.", { group: SELECTION, value: "node" }),
          depth: string("How many steps from the --focus node.", { group: SELECTION, value: "n", default: "1" }),
          find: string("What Find does: in a picture, the nodes whose name, type, component, namespace, or ID match stand out; a list holds only them.", { group: SELECTION, value: "text" }),
          hide: string("Kinds of node to leave out, as the legend names them (codeunit, table, other apps, ...), comma-separated.", { group: SELECTION, repeatable: true, value: "kinds" }),
          off: string("Kinds of relation to leave out (uses, reads, permits, ...), comma-separated.", { group: SELECTION, repeatable: true, value: "kinds" }),
          check: flag("What Check does: a ring on every node with a finding in a picture; the findings with their fixes below each node in text.", { group: SELECTION }),
          story: string("A story instead of a lens: its steps with their texts. With --step, the nodes of that step in its lens. run:<agent> is the run of the simulation of one person; its picture holds what the run reached at that step.", { group: "Stories", value: "id" }),
          step: string("One step of the --story, from 1: what stands out in it.", { group: "Stories", value: "n" }),
          stories: flag("Every story of the system as one document (text, md, or json).", { group: "Stories" }),
          form: string("The form of a picture: a graph in a plane, boxes in layers in the direction of the relations, or a graph in space. Without it, the form the lens reads best in: a diagram for the overview, processes, people, and components, a plane for the rest.", { group: RENDERING, enum: VIEW_FORMS }),
          color: string("Color the nodes by this instead of what the lens does.", { group: RENDERING, enum: ["type", "component", "namespace", "app", "level", "findings"] }),
          size: string("Size the nodes by this.", { group: RENDERING, enum: ["relations", "usedBy", "uses", "lines", "complexity", "objects", "findings"] }),
          group: string("Hold the nodes together by this instead of what the lens does.", { group: RENDERING, enum: ["component", "namespace", "app", "kind", "none"] }),
          select: string("The selected node of a picture: it and its relations stand out.", { group: RENDERING, value: "node" }),
          theme: string("Colors of a picture.", { group: RENDERING, enum: ["light", "dark"], default: "light" }),
          width: string("Width of a picture in pixels.", { group: RENDERING, value: "px", default: "1440" }),
          height: string("Height of a picture in pixels.", { group: RENDERING, value: "px", default: "900" }),
          format: string("text (default), json, md, csv, svg, png, or link (the address of this view in the app). Inferred from the extension of --output.", { group: OUTPUT, short: "f", enum: VIEW_FORMATS }),
          rows: string("csv: one row per node or per relation.", { group: OUTPUT, enum: ["nodes", "relations"], default: "nodes" }),
          output: string("Write to this file instead of stdout (a PNG always needs it).", { group: OUTPUT, short: "o", value: "path" }),
          projectRoot: projectOptions.projectRoot,
          config: projectOptions.config,
          compiler: projectOptions.compiler,
          compilerLog: projectOptions.compilerLog,
          paths: string("Only analyze AL files below these project-relative folders or globs.", { group: FILTERS, repeatable: true, value: "glob" })
        },
        output: { type: "json", when: "--format json", schema: "bc-atlas.view" },
        rules: [
          "The same graph, lenses, stories, and exports as the app: one implementation draws the page and writes these files.",
          "--format json without a lens, story, or object prints the whole atlas: every node, relation, lens, finding, and story.",
          "A lens with nothing in it does not exist for a project: processes, people, and requirements need documented UI tests, health needs a finding.",
          "The same options give the same picture every time; SVG and PNG are drawn by BC Atlas itself, without a browser."
        ],
        examples: [
          "bca view ./app",
          "bca view ./app --lens data",
          "bca view ./app --lens data --form diagram -o data.svg",
          "bca view ./app --lens components --form diagram --check -o components.png",
          "bca view ./app --inside codeunit:50100 --form diagram -o posting.svg",
          "bca view ./app --focus \"table:Sales Header\" --depth 2 --format json",
          "bca view ./app --lens health --check",
          "bca view ./app --story fix",
          "bca view ./app --stories --format md -o docs/system.md",
          "bca view ./app --lens system --format csv --rows relations -o relations.csv",
          "bca view ./app --format json > atlas.json"
        ]
      }),
      command({
        id: "layers",
        area: "export",
        argv: ["bca", "layers", "[app-root]"],
        purpose: "The layered documentation, in sync with the source: the system explained from the whole down to each procedure, one page per app, component, namespace, and object, each with a picture. For the source as it is now, and for any commit, tag, or release.",
        options: {
          output: string("The folder of the pages (default: layers.outputDir in .bca.json, else docs/layers). States of the past go below history/ in it.", { group: OUTPUT, short: "o", value: "path" }),
          at: string("Record the source as it was at a commit, a tag, or a release, below history/<name>. Repeatable, or comma-separated. Only these states are written, not the working tree.", { group: SELECTION, repeatable: true, value: "ref" }),
          releases: flag("Also record every release (Git tag) the current commit descends from that is not recorded yet.", { group: SELECTION }),
          last: string("With --releases: only the newest n releases.", { group: SELECTION, value: "n" }),
          refresh: flag("Write a state that is already recorded again, for example after an update of BC Atlas.", { group: SELECTION }),
          check: flag("Write nothing; fail (exit code 1) when the pages are not in sync with the source, or an asked state is not recorded.", { group: OUTPUT }),
          pictures: string("Pictures of single objects: auto (up to 400 objects), all, or none (no pictures at all). The system, apps, components, namespaces, and lenses always get one unless none.", { group: OUTPUT, enum: ["auto", "all", "none"], default: "auto" }),
          view: flag("Also write view.html: the BC Atlas view of the working tree as one offline file, next to the pages. A state of the past always has it.", { group: OUTPUT }),
          format: string("What the command reports: text (default) or json.", { group: OUTPUT, short: "f", enum: ["text", "json"], default: "text" }),
          projectRoot: projectOptions.projectRoot,
          config: projectOptions.config,
          compiler: projectOptions.compiler,
          compilerLog: projectOptions.compilerLog,
          paths: string("Only analyze AL files below these project-relative folders or globs.", { group: FILTERS, repeatable: true, value: "glob" })
        },
        output: { type: "json", when: "--format json", schema: "bc-atlas.layers-sync" },
        rules: [
          "Layers: 0 the system, 1 apps, 2 components, 3 namespaces, 4 objects, 5 the procedures, triggers, and events inside each object. Lenses, stories, and findings cut across them.",
          "The same source gives the same files, byte for byte: a run changes only what changed, and removes what it wrote before and no longer writes.",
          "A recorded state never changes; its pages are written once. history/README.md lists every state and what changed from each to the next.",
          "A state of the past is read with the BC Atlas of today from a temporary checkout (git worktree); the working tree is not touched.",
          "As a task of bca run (layers), the pages follow the sync mode of the trigger: verify, stage, commit, or pull request."
        ],
        examples: [
          "bca layers ./app",
          "bca layers ./app -o docs/system",
          "bca layers ./app --check",
          "bca layers ./app --at v1.4.0",
          "bca layers ./app --at 3f2c1ab,v1.3.0",
          "bca layers ./app --releases --last 5"
        ]
      }),
      command({
        id: "bundle",
        area: "export",
        argv: ["bca", "bundle", "[app-root]"],
        purpose: "Everything BC Atlas makes of a project, end to end, as one artifact: validation (the health check), the simulation with a snapshot of every process test, the layered documentation with the view, the narrative pages when a model is set up, and the test results and build outputs it is given. One folder, one ZIP file, one manifest.",
        options: {
          output: string("The folder of the bundle; the ZIP file gets the same name with .zip. The folder is replaced.", { group: OUTPUT, short: "o", value: "path", default: "bc-atlas-bundle" }),
          testResults: string("Results of tests that really ran (JUnit or xUnit XML, as AL-Go and the AL test runner write them): a file or a folder. They are counted, and a failed test fails the bundle. Repeatable.", { group: GENERAL, repeatable: true, value: "path" }),
          include: string("Files or folders that belong to the bundle: the .app file, compiler output, logs. Repeatable.", { group: GENERAL, repeatable: true, value: "path" }),
          noZip: flag("Write the folder only.", { group: OUTPUT }),
          noNarrative: flag("Do not ask the model of the ai plugin for narrative pages, even when one is set up.", { group: GENERAL }),
          pictures: string("Pictures of single objects in the documentation: auto (up to 400 objects), all, or none.", { group: OUTPUT, enum: ["auto", "all", "none"], default: "auto" }),
          title: string("Title of the bundle (default: the name of the app).", { group: OUTPUT, value: "text" }),
          format: string("What the command reports: text (default) or json (the manifest).", { group: OUTPUT, short: "f", enum: ["text", "json"], default: "text" }),
          projectRoot: projectOptions.projectRoot,
          config: projectOptions.config,
          compiler: projectOptions.compiler,
          compilerLog: projectOptions.compilerLog,
          paths: string("Only analyze AL files below these project-relative folders or globs.", { group: FILTERS, repeatable: true, value: "glob" })
        },
        output: { type: "json", when: "--format json", schema: "bc-atlas.bundle" },
        rules: [
          "Steps: validation, simulation, snapshots from the source, documentation, narrative, tests that ran, build outputs. A step that does not apply is skipped and says why.",
          "Exit code 1 means a step failed: the health check, the simulation, or a test that ran. The bundle is written all the same, so a pipeline keeps the evidence.",
          "BC Atlas reads the source and runs no test itself: what ran in Business Central or in a pipeline comes in with --test-results, and as recordings with simulation.recordings.",
          "bundle.json names the commit, every step with its result, and every file with its SHA-256."
        ],
        examples: [
          "bca bundle ./app",
          "bca bundle ./app -o out/atlas --test-results TestResults.xml --include output/MyApp.app",
          "bca bundle ./app --no-zip --format json"
        ]
      }),
      command({
        id: "docs.list",
        area: "export",
        argv: ["bca", "docs", "list", "<test-root>"],
        purpose: "List documented UI-test scenarios.",
        options: { format: docsFormat },
        output: { type: "json", when: "--format json" },
        examples: ["bca docs list ./test/UITest"]
      }),
      command({
        id: "docs.show",
        area: "export",
        argv: ["bca", "docs", "show", "<test-root>"],
        purpose: "Show one scenario, its prerequisites, and its diagnostics.",
        options: { id: { ...string("Stable document ID.", { value: "document-id" }), required: true }, format: docsFormat },
        output: { type: "json", when: "--format json" },
        examples: ["bca docs show ./test/UITest --id partner-create"]
      }),
      command({
        id: "docs.validate",
        area: "export",
        argv: ["bca", "docs", "validate", "<test-root>"],
        purpose: "Validate IDs, tags, links, and prerequisite cycles.",
        options: { strict: flag("Treat warnings as failures."), format: docsFormat },
        output: { type: "json", when: "--format json" },
        examples: ["bca docs validate ./test/UITest --strict"]
      }),
      command({
        id: "docs.generate",
        area: "export",
        argv: ["bca", "docs", "generate", "<test-root>"],
        purpose: "Generate user guides or test cases with flow diagrams as Markdown, HTML, DITA, Azure DevOps CSV, or BPMN.",
        options: {
          export: string("Comma-separated output formats: markdown, html, dita, ado-csv, bpmn.", {
            group: OUTPUT,
            value: "formats",
            default: "markdown"
          }),
          as: string("Document type: a user guide or a test case with an action/expected-result table.", {
            group: OUTPUT,
            enum: ["guide", "testcase"],
            default: "guide"
          }),
          outputDir: string("Output directory.", { group: OUTPUT, value: "path", default: "docs/generated" }),
          title: string("Title of the index, HTML page, and DITA map.", { group: OUTPUT, value: "text" }),
          app: string("AL app source used for real captions, tooltips, and page coverage.", { value: "app-root" }),
          language: string("Language for wording and captions, e.g. de-DE; captions come from the app's .xlf files.", {
            value: "tag",
            default: "en-US"
          }),
          id: string("Generate only this stable document ID (Markdown).", { value: "document-id" }),
          procedure: string("Test procedure; required when a file contains several tests (Markdown).", { value: "name" }),
          format: docsFormat
        },
        output: { type: "directory", pathOption: "outputDir", default: "docs/generated", entry: "index.md" },
        rules: [
          "markdown writes <id>.md per scenario, use-case-<feature>.md, index.md, journey.d2/.svg, and diagrams/*.svg",
          "every scenario shows its clicks as a flow; every use case a process with a lane per permission set",
          "html writes one self-contained index.html; dita writes <id>.dita and documentation.ditamap",
          "ado-csv writes test-cases.csv for the Azure DevOps Test Plans grid import",
          "bpmn writes use-case-<feature>.bpmn: BPMN 2.0 with diagram layout; each scenario is a sub-process with its clicks"
        ],
        examples: [
          "bca docs generate ./test --app ./app --export markdown,html",
          "bca docs generate ./test --app ./app --export markdown,bpmn",
          "bca docs generate ./test --app ./app --as testcase --export ado-csv",
          "bca docs generate ./test --app ./app --language de-DE --export html",
          "bca docs generate ./test --export dita --output-dir docs/dita",
          "bca docs generate ./test/PartnerUITest.Codeunit.al --procedure NewPartner_PersistsFields"
        ]
      }),
      command({
        id: "docs.set",
        area: "export",
        argv: ["bca", "docs", "set", "<test-root>"],
        purpose: "Add or replace documentation metadata in AL source.",
        options: {
          id: { ...string("Stable document ID.", { value: "document-id" }), required: true },
          tag: { ...string("Metadata tag.", { value: "tag" }), required: true },
          value: { ...string("Metadata value.", { value: "text" }), required: true },
          qualifier: string("GIVEN prerequisite type.", { value: "type" }),
          expectedHash: string("Reject the write if the AL file changed (SHA-256).", { value: "hash" }),
          dryRun: flag("Preview without writing."),
          format: docsFormat
        },
        output: { type: "json", when: "--format json" },
        rules: ["Use --dry-run before a write."],
        examples: ["bca docs set ./test/UITest --id partner-create --tag OWNER --value \"Integration Ops\" --dry-run"]
      }),
      command({
        id: "docs.unset",
        area: "export",
        argv: ["bca", "docs", "unset", "<test-root>"],
        purpose: "Remove documentation metadata from AL source.",
        options: {
          id: { ...string("Stable document ID.", { value: "document-id" }), required: true },
          tag: { ...string("Metadata tag.", { value: "tag" }), required: true },
          value: string("Only remove entries with this value.", { value: "text" }),
          qualifier: string("Only remove entries with this qualifier.", { value: "type" }),
          expectedHash: string("Reject the write if the AL file changed (SHA-256).", { value: "hash" }),
          dryRun: flag("Preview without writing."),
          format: docsFormat
        },
        output: { type: "json", when: "--format json" },
        rules: ["Use --dry-run before a write."],
        examples: ["bca docs unset ./test/UITest --id partner-create --tag RELATED --value partner-edit"]
      }),
      command({
        id: "docs.automation",
        area: "export",
        argv: ["bca", "docs", "automation", "<test-root>"],
        purpose: "Print a CI pipeline that keeps generated guides in sync.",
        options: {
          provider: string("Pipeline provider.", { enum: ["github", "azure-devops"], default: "github" }),
          outputDir: string("Markdown directory.", { value: "path", default: "docs/generated" }),
          format: docsFormat
        },
        output: { type: "json", when: "--format json" },
        examples: ["bca docs automation ./test/UITest --provider azure-devops"]
      }),
      command({
        id: "docs.glossary",
        area: "export",
        argv: ["bca", "docs", "glossary"],
        purpose: "List supported documentation tags and prerequisite types.",
        options: { format: docsFormat },
        output: { type: "json", when: "--format json" },
        examples: ["bca docs glossary"]
      }),
      command({
        id: "run",
        area: "integrate",
        argv: ["bca", "run", "[app-root]"],
        purpose: "Run the features configured for a trigger (Git hook, pipeline, schedule) and sync their output.",
        options: {
          trigger: string("Trigger whose tasks and sync mode are used.", {
            enum: ["pre-commit", "pre-push", "ci", "schedule", "manual"],
            default: "manual"
          }),
          tasks: string("Run these features instead: check, simulate, report, docs, codegraph, handbook, diagrams.", { value: "list" }),
          sync: string("Override the sync mode.", { enum: ["none", "verify", "stage", "artifact", "pull-request", "commit"] }),
          config: projectOptions.config,
          format: string("Output mode.", { enum: ["text", "json"], default: "text" })
        },
        output: { type: "json", when: "--format json", schema: "RunResult" },
        rules: [
          "Exit code 1 when a task fails, check fails, or verify finds outdated files.",
          "verify and stage need Git; artifact, pull-request, and commit are performed by the pipeline."
        ],
        examples: [
          "bca run --trigger pre-commit",
          "bca run --trigger ci",
          "bca run --tasks report,docs --sync verify"
        ]
      }),
      command({
        id: "plugins.list",
        area: "integrate",
        argv: ["bca", "plugins", "list", "[app-root]"],
        purpose: "List the plugins of a project: built-in, npm (bc-atlas-plugin-*), .bca.json, and BCA_PLUGINS, with what each contributes.",
        options: { config: projectOptions.config, format: string("Output mode.", { enum: ["text", "json"], default: "text" }) },
        output: { type: "json", when: "--format json", schema: "PluginList" },
        examples: ["bca plugins list", "bca plugins list --format json"]
      }),
      command({
        id: "plugins.show",
        area: "integrate",
        argv: ["bca", "plugins", "show", "<plugin-id>"],
        purpose: "Show one plugin: manifest, commands, tasks, health rules, MCP tools, hooks, and extension points.",
        options: {
          projectRoot: string("Project whose plugins are listed.", { value: "path", default: "." }),
          config: projectOptions.config,
          format: string("Output mode.", { enum: ["text", "json"], default: "text" })
        },
        output: { type: "json", when: "--format json", schema: "PluginManifest" },
        examples: ["bca plugins show sync"]
      }),
      command({
        id: "plugins.doctor",
        area: "integrate",
        argv: ["bca", "plugins", "doctor", "[app-root]"],
        purpose: "Check every plugin: manifest, plugin API version, activation, contributions, and config sections.",
        options: { config: projectOptions.config, format: string("Output mode.", { enum: ["text", "json"], default: "text" }) },
        output: { type: "json", when: "--format json", schema: "PluginDoctor" },
        rules: ["Exit code 1 when a plugin cannot be loaded or activated."],
        examples: ["bca plugins doctor"]
      }),
      command({
        id: "plugins.new",
        area: "integrate",
        argv: ["bca", "plugins", "new", "<plugin-id>"],
        purpose: "Create a plugin from the template: plugin.json, an activate() with a command, a task, a health rule, and a hook, a test, and a README.",
        options: {
          output: string("Folder of the new plugin.", { short: "o", value: "path", default: "plugins/<plugin-id>" }),
          dryRun: flag("List the files without writing them.")
        },
        output: { type: "process" },
        examples: ["bca plugins new telemetry", "bca plugins new my-plugin -o ../bc-atlas-plugin-my"]
      }),
      ...pluginCommands(plugins),
      command({
        id: "update",
        area: "integrate",
        argv: ["bca", "update", "[app-root]"],
        purpose: "Check for a new BC Atlas version, show what changed, and update it together with the generated setup files.",
        options: {
          check: flag("Only report whether an update exists; exit code 1 when it does."),
          yes: flag("Update without asking."),
          dryRun: flag("Show the commands an update would run."),
          format: string("Output mode.", { enum: ["text", "json"], default: "text" })
        },
        output: { type: "json", when: "--format json", schema: "UpdateStatus" },
        rules: [
          "Updates the devDependency in package.json when the project declares bc-atlas, else the global installation.",
          "Afterwards runs bca setup apply --from-config so hooks, tasks, pipelines, and agent commands use the new version."
        ],
        examples: ["bca update", "bca update --check", "bca update --yes"]
      }),
      command({
        id: "mcp",
        area: "integrate",
        argv: ["bca", "mcp"],
        aliases: ["bca-mcp"],
        purpose: "Start the Model Context Protocol server on stdio for AI agents.",
        output: { type: "process", transport: "stdio", termination: "SIGINT" },
        examples: ["bca mcp"]
      })
    ]
  };
}

export function findCommand(capabilities, id) {
  return capabilities.commands.find((item) => item.id === id);
}
