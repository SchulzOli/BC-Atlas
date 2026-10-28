// Single source of truth for every BC Atlas command. The CLI parser, the
// built-in help, the generated documentation, and the machine-readable
// `bca help --format json` contract are all derived from this catalog.

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
  ["workflow", "Calls, events, and data mutations traced from entry points"]
]);

export const FORMATS = Object.freeze(["d2", "json", "svg", "png", "pdf"]);
// What `bca export` can write besides the diagram views.
export const EXPORTS = Object.freeze([
  ["app", "The BC Atlas pages as one offline HTML file to share: every page, the diagrams, the 3D explorer, and the docs"],
  ["report", "Markdown report (README.md) with health, diagrams, and an optional object catalog"],
  ["explorer", "Interactive 3D dependency explorer (HTML), replayable over Git history, or its graph as JSON"],
  ["catalog", "One linked Markdown page per AL object"]
]);
export const SEVERITIES = Object.freeze(["error", "warning", "info"]);
export const FAIL_LEVELS = Object.freeze(["error", "warning", "info", "never"]);
export const REPORT_VIEWS = Object.freeze(["project", "module", "data", "contracts", "events", "ui"]);

export const FEATURE_AREAS = Object.freeze([
  {
    id: "start",
    title: "Get started",
    summary: "Set up a project; in VS Code, the BC Atlas extension shows everything in the editor."
  },
  {
    id: "analyze",
    title: "Analyze",
    summary: "Gate CI on architecture health and keep a target architecture in place."
  },
  {
    id: "export",
    title: "Export",
    summary: "Write what the app shows as files, and user guides from AL UI tests."
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
  focus: string("Name fragment for the contracts, events, or ui view.", { group: SELECTION, value: "text" }),
  groupBy: string("Diagram views: role, namespace, folder, or type (default: role for project, else namespace). Proposed architecture: auto, namespace, folder, module, or app.", {
    group: SELECTION,
    enum: ["auto", "namespace", "folder", "module", "app", "type", "role"]
  }),
  moduleDepth: string("Namespace segments in the module view, or auto.", { group: SELECTION, value: "n", default: "auto" }),
  folderDepth: string("Folder segments in a folder-grouped module view.", { group: SELECTION, value: "n", default: "1" }),
  ...filterOptions,
  includeUnresolvedCalls: flag("Include unresolved and isolated calls.", { group: CALLS }),
  rootProcedure: string("Call root procedure selector.", { group: CALLS, repeatable: true, value: "selector" }),
  callDepth: string("Call traversal depth from each root.", { group: CALLS, value: "n", default: "3" }),
  callDirection: string("Call traversal direction.", { group: CALLS, enum: ["incoming", "outgoing", "both"], default: "outgoing" }),
  expandProcedures: flag("Show procedures instead of owning-object aggregates.", { group: CALLS }),
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

const exportOptions = {
  view: string("What to write: app, report, explorer, catalog, or a diagram view.", {
    group: OUTPUT,
    enum: [...EXPORTS.map(([id]) => id), ...VIEWS.map(([id]) => id)],
    default: "app"
  }),
  output: string("Output file or folder (default: bc-atlas.html, docs/atlas, bc-atlas-explorer.html, docs/codegraph, or bc-atlas-<view>.svg); - writes JSON to stdout.", {
    group: OUTPUT,
    short: "o",
    value: "path"
  }),
  format: string("app: html; explorer: html or json; report: svg or d2 diagrams; diagram views: svg, d2, json, png, or pdf. Inferred from the output extension when omitted.", {
    group: OUTPUT,
    short: "f",
    enum: ["html", ...FORMATS]
  }),
  title: string("Title of the report, explorer, or diagram.", { group: OUTPUT, value: "text" }),
  watch: flag("Write again whenever AL source, app.json, or .bca.json changes.", { group: OUTPUT }),
  debounce: string("Delay before writing again with --watch, in milliseconds.", { group: OUTPUT, value: "ms", default: "250" }),
  views: string("Report: comma-separated diagram views.", { group: "Report", value: "list", default: REPORT_VIEWS.join(",") }),
  codegraph: flag("Report: also write the object catalog.", { group: "Report" }),
  json: flag("Report: also write the resolved model as model.json.", { group: "Report" }),
  history: flag("Explorer and app: replay Git history, one frame per step (see --history-by) that changed AL files or app.json.", { group: "Timeline" }),
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
  groupBy: string("How the proposal groups objects into components; auto: modules or apps, too large ones split by namespace.", {
    group: "Proposal",
    enum: ["auto", "namespace", "folder", "module", "app"],
    default: "auto"
  }),
  depth: string("Namespace or folder segments per component; default: split until no component is too large.", { group: "Proposal", value: "n" }),
  minObjects: string("Merge smaller groups into the component they depend on most.", { group: "Proposal", value: "n", default: "1" }),
  extract: string("Plan extracting this component as an app of its own: blockers, dependencies, app.json, table moves, and steps.", { group: "Extraction", value: "component" }),
  write: flag("Save the architecture to .bca.json (architecture section).", { group: "Enforcement" }),
  updateBaseline: flag("Accept today's violations in the baseline file; only new ones fail afterwards.", { group: "Enforcement" }),
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

export function createCapabilities(version) {
  return {
    schemaVersion: 1,
    name: "bc-atlas",
    version,
    transport: {
      stdout: "json",
      encoding: "utf-8",
      rule: "For machine reads, use check, architecture, docs, or export (a diagram view, -o -) with --format json, and help --format json for this contract. Parse stdout only after exit code 0."
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
        rules: ["Exit code 1 means at least one finding reached --fail-on."],
        examples: [
          "bca check ./app",
          "bca check ./app --fail-on warning",
          "bca check ./app --format markdown -o health.md"
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
          "Without an architecture section in .bca.json, the command proposes one from today's dependencies.",
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
        id: "export",
        area: "export",
        argv: ["bca", "export", "[app-root]"],
        purpose: "Write files: the BC Atlas pages as one offline HTML file, the Markdown report, the 3D explorer, the object catalog, or one diagram view.",
        options: exportOptions,
        output: { type: "file", pathOption: "output", default: "bc-atlas.html" },
        rules: [
          "object view requires --object; boundary view requires at least one --scope; workflow view requires --entry",
          "A diagram view with --format json and no --output prints the resolved model to stdout",
          "--history needs Git; without it the explorer replays the build order (dependencies first)",
          "PNG and PDF need the d2 executable on PATH; SVG uses the bundled renderer"
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
          tasks: string("Run these features instead: check, report, docs, codegraph, diagrams.", { value: "list" }),
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
