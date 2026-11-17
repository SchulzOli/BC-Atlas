// The pipeline of a flow that runs on triggers of your own (bca flow export). A trigger says
// what starts it (automation/config.js): events with their branches, paths, and tags, or a
// cron. The file starts on all of them, finds out which trigger it was, runs the flow as that
// trigger, and delivers what the flow saved the way that trigger says.
//
// A run that writes back (pull-request, commit) needs a branch to write to: a trigger that a
// pull request, a tag, or a release starts uploads an artifact instead.
import { FLOW_MARKER } from "../automation/pipelines.js";

const quote = (value) => (/^[\w./-]+$/u.test(value) ? value : `"${value.replaceAll("\"", "\\\"")}"`);
const yaml = (items) => `[${items.map((item) => JSON.stringify(item)).join(", ")}]`;
const AL_TOOLS = "dotnet tool install --global Microsoft.Dynamics.BusinessCentral.Development.Tools";
const WRITES = ["pull-request", "commit"];

/**
 * What starts the flow, one entry per trigger a pipeline can start.
 * @param when the triggers of the flow, in its order
 * @param triggers automationConfig(config).triggers
 * @param to "github" | "azure-devops"
 * @returns { starts: [{ name, on: [event], branches?, paths?, tags?, cron?, sync }], skipped: [{ name, why }] }
 */
export function flowStarts(when, triggers, { to, defaultCron }) {
  const starts = [];
  const skipped = [];
  for (const name of when) {
    const trigger = triggers[name];
    const custom = trigger?.custom;
    let start;
    if (name === "ci") start = { name, on: ["pull-request", "push"], branches: ["main"] };
    else if (name === "schedule") start = { name, on: [], cron: trigger?.cron ?? defaultCron };
    else if (name === "manual") start = { name, on: ["manual"] };
    else if (custom?.hook) skipped.push({ name, why: `it is the Git hook ${custom.hook}: bca setup apply --from-config installs it` });
    else if (!custom?.on?.length && !custom?.cron) skipped.push({ name, why: `nothing starts it but its name: bca run --trigger ${name}` });
    else start = { name, on: custom.on ?? [], ...(custom.branches ? { branches: custom.branches } : {}), ...(custom.paths ? { paths: custom.paths } : {}), ...(custom.tags ? { tags: custom.tags } : {}), ...(custom.cron ? { cron: custom.cron } : {}) };
    if (!start) continue;
    if (to === "azure-devops" && start.on.includes("release")) {
      start.on = start.on.filter((event) => event !== "release");
      if (!start.on.length && !start.cron) {
        skipped.push({ name, why: "Azure Pipelines has no event for a published release" });
        continue;
      }
    }
    // What the trigger asks for, and what a pipeline can do with it.
    const asked = trigger?.sync && trigger.sync !== "none" ? trigger.sync : "artifact";
    const detached = start.on.some((event) => ["pull-request", "tag", "release"].includes(event)) || name === "ci";
    const sync = WRITES.includes(asked) && (detached || (to === "azure-devops" && asked === "pull-request")) ? "artifact" : asked === "stage" ? "artifact" : asked;
    starts.push({ ...start, sync });
  }
  // By hand, a file always starts: as the trigger that says so, else as manual.
  if (!starts.some(({ on }) => on.includes("manual"))) starts.push({ name: "manual", on: ["manual"], sync: "artifact", implied: true });
  return { starts, skipped };
}

/** The events of the starts as words, for the terminal. */
export function startEvents(starts) {
  return starts.flatMap((start) => [
    ...start.on.filter((event) => !(event === "manual" && start.implied)).map((event) => `${start.name}: ${{
      push: `push${start.branches ? ` to ${start.branches.join(", ")}` : ""}${start.paths ? ` (${start.paths.join(", ")})` : ""}`,
      "pull-request": `pull request${start.branches ? ` into ${start.branches.join(", ")}` : ""}${start.paths ? ` (${start.paths.join(", ")})` : ""}`,
      tag: `tag${start.tags ? ` ${start.tags.join(", ")}` : ""}`,
      release: "release published",
      manual: "by hand"
    }[event]}`),
    ...(start.cron ? [`${start.name}: schedule (${start.cron})`] : [])
  ]).concat("by hand");
}

const union = (starts, key) => (starts.length && starts.every((start) => start[key]?.length) ? [...new Set(starts.flatMap((start) => start[key]))] : undefined);

/** The workflow for GitHub Actions. */
export function githubFlowWorkflow({ appPath, version, starts, outputs, nodeVersion = 24, local = false, alTools = false, flow }) {
  const pushes = starts.filter(({ on }) => on.includes("push"));
  const pulls = starts.filter(({ on }) => on.includes("pull-request"));
  const tags = starts.filter(({ on }) => on.includes("tag"));
  const crons = starts.filter(({ cron }) => cron);
  const on = [];
  if (pulls.length) {
    on.push("  pull_request:");
    if (union(pulls, "branches")) on.push(`    branches: ${yaml(union(pulls, "branches"))}`);
    if (union(pulls, "paths")) on.push(`    paths: ${yaml(union(pulls, "paths"))}`);
  }
  if (pushes.length || tags.length) {
    on.push("  push:");
    // With tags named, GitHub starts on a branch only when branches are named too.
    if (pushes.length) on.push(`    branches: ${yaml(union(pushes, "branches") ?? ["**"])}`);
    if (tags.length) on.push(`    tags: ${yaml(union(tags, "tags") ?? ["**"])}`);
    if (pushes.length && union(pushes, "paths")) on.push(`    paths: ${yaml(union(pushes, "paths"))}`);
  }
  if (starts.some((start) => start.on.includes("release"))) on.push("  release:", "    types: [published]");
  if (crons.length) on.push("  schedule:", ...crons.map(({ cron }) => `    - cron: "${cron}"`));
  on.push("  workflow_dispatch:");

  // Which trigger it was: the first of the flow that the event fits.
  const first = (event) => starts.find((start) => start.on.includes(event))?.name;
  const cases = [];
  if (crons.length) cases.push("            schedule)", "              case \"$BCA_CRON\" in", ...crons.map(({ cron, name }) => `                "${cron}") trigger=${name} ;;`), `                *) trigger=${crons[0].name} ;;`, "              esac ;;");
  if (pulls.length) cases.push(`            pull_request) trigger=${first("pull-request")} ;;`);
  if (pushes.length || tags.length) cases.push(`            push) case "$GITHUB_REF" in refs/tags/*) trigger=${first("tag") ?? first("push")} ;; *) trigger=${first("push") ?? first("tag")} ;; esac ;;`);
  if (first("release")) cases.push(`            release) trigger=${first("release")} ;;`);
  cases.push(`            *) trigger=${first("manual")} ;;`);

  const suffix = `-${flow.id}`;
  const was = (names) => names.map((name) => `steps.trigger.outputs.name == '${name}'`).join(" || ");
  const by = (sync) => starts.filter((start) => start.sync === sync).map(({ name }) => name);
  const steps = [
    "      - uses: actions/checkout@v7",
    "      - uses: actions/setup-node@v7",
    "        with:",
    `          node-version: ${nodeVersion}`,
    "      - name: Cache BC Atlas analysis",
    "        uses: actions/cache@v6",
    "        with:",
    "          path: ${{ runner.temp }}/bc-atlas-cache",
    "          key: bc-atlas-${{ runner.os }}-${{ github.sha }}",
    "          restore-keys: bc-atlas-${{ runner.os }}-",
    ...(local ? ["      - name: Install BC Atlas from package.json", "        run: if [ -f package-lock.json ]; then npm ci; else npm install --no-audit --no-fund; fi"] : []),
    ...(alTools ? ["      - name: Install the AL compiler (AL Development Tools)", `        run: ${AL_TOOLS}`] : []),
    "      - name: Which trigger",
    "        id: trigger",
    "        env:",
    "          BCA_CRON: ${{ github.event.schedule }}",
    "        run: |",
    "          case \"$GITHUB_EVENT_NAME\" in",
    ...cases,
    "          esac",
    "          echo \"name=$trigger\" >> \"$GITHUB_OUTPUT\"",
    "      - name: Run BC Atlas",
    "        env:",
    "          BCA_TRIGGER: ${{ steps.trigger.outputs.name }}",
    "          BCA_CACHE_DIR: ${{ runner.temp }}/bc-atlas-cache",
    `        run: ${local ? "npx --no-install bca" : `npx --yes bc-atlas@${version}`} run ${quote(appPath)} --trigger "$BCA_TRIGGER" --flow ${quote(flow.id)}`
  ];
  if (outputs.length && by("artifact").length) {
    steps.push(
      `      - name: Upload bc-atlas${suffix}`,
      `        if: always() && (${was(by("artifact"))})`,
      "        uses: actions/upload-artifact@v7",
      "        with:",
      `          name: bc-atlas${suffix}`,
      "          if-no-files-found: ignore",
      "          path: |",
      ...outputs.map((output) => `            ${output}`)
    );
  }
  if (outputs.length && by("pull-request").length) {
    steps.push(
      "      - name: Open a pull request with updated output",
      `        if: ${was(by("pull-request"))}`,
      "        uses: peter-evans/create-pull-request@v7",
      "        with:",
      `          branch: bc-atlas/${flow.id}`,
      "          delete-branch: true",
      "          commit-message: \"docs: update BC Atlas output\"",
      "          title: Update BC Atlas output",
      `          body: Generated by the flow ${flow.id} of BC Atlas.`,
      "          add-paths: |",
      ...outputs.map((output) => `            ${output}`)
    );
  }
  if (outputs.length && by("commit").length) {
    steps.push(
      "      - name: Commit updated output",
      `        if: ${was(by("commit"))}`,
      "        run: |",
      "          git config user.name \"github-actions[bot]\"",
      "          git config user.email \"41898282+github-actions[bot]@users.noreply.github.com\"",
      `          git add --all -- ${outputs.map(quote).join(" ")}`,
      "          git diff --cached --quiet || git commit -m \"docs: update BC Atlas output\"",
      "          git push"
    );
  }
  const writes = starts.some(({ sync }) => WRITES.includes(sync));
  return [
    `# ${FLOW_MARKER}: the flow "${flow.id}" of .bca.json. Change the flow and export it again instead of editing.`,
    `name: ${JSON.stringify(`BC Atlas: ${flow.title || flow.id}`)}`,
    "",
    "on:",
    ...on,
    "",
    "permissions:",
    `  contents: ${writes ? "write" : "read"}`,
    ...(by("pull-request").length ? ["  pull-requests: write"] : []),
    "",
    "concurrency:",
    `  group: bc-atlas${suffix}-\${{ github.ref }}`,
    "  cancel-in-progress: true",
    "",
    "jobs:",
    "  bc-atlas:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    ...steps,
    ""
  ].join("\n");
}

/** The pipeline for Azure Pipelines. */
export function azureFlowPipeline({ appPath, version, starts, outputs, nodeVersion = 24, local = false, alTools = false, flow }) {
  const pushes = starts.filter(({ on }) => on.includes("push"));
  const pulls = starts.filter(({ on }) => on.includes("pull-request"));
  const tags = starts.filter(({ on }) => on.includes("tag"));
  const crons = starts.filter(({ cron }) => cron);
  const include = (key, items) => [`  ${key}:`, `    include: ${yaml(items)}`];
  const lines = [`# ${FLOW_MARKER}: the flow "${flow.id}" of .bca.json. Change the flow and export it again instead of editing.`];
  if (pushes.length || tags.length) {
    lines.push("trigger:");
    // With tags named, Azure Pipelines starts on a branch only when branches are named too.
    if (pushes.length) lines.push(...include("branches", union(pushes, "branches") ?? ["*"]));
    else lines.push("  branches:", "    exclude: ['*']");
    if (tags.length) lines.push(...include("tags", union(tags, "tags") ?? ["*"]));
    if (pushes.length && union(pushes, "paths")) lines.push(...include("paths", union(pushes, "paths")));
    lines.push("");
  } else lines.push("trigger: none");
  if (pulls.length) {
    lines.push("pr:", ...include("branches", union(pulls, "branches") ?? ["*"]));
    if (union(pulls, "paths")) lines.push(...include("paths", union(pulls, "paths")));
    lines.push("");
  } else lines.push("pr: none", "");
  if (crons.length) {
    lines.push("schedules:");
    for (const { cron, name } of crons) lines.push(`  - cron: "${cron}"`, `    displayName: BC Atlas ${flow.id}, ${name}`, "    branches:", "      include: [main]", "    always: true");
    lines.push("");
  }
  const first = (event) => starts.find((start) => start.on.includes(event))?.name;
  const commits = starts.filter(({ sync }) => sync === "commit").map(({ name }) => name);
  const was = (names) => (names.length === 1 ? `eq(variables['bcaTrigger'], '${names[0]}')` : `in(variables['bcaTrigger'], ${names.map((name) => `'${name}'`).join(", ")})`);
  lines.push(
    "pool:",
    "  vmImage: ubuntu-latest",
    "",
    "steps:",
    "  - checkout: self",
    ...(commits.length ? ["    persistCredentials: true"] : []),
    "  - task: NodeTool@0",
    "    inputs:",
    `      versionSpec: ${nodeVersion}.x`,
    "  - task: Cache@2",
    "    inputs:",
    "      key: 'bc-atlas | \"$(Agent.OS)\" | $(Build.SourceVersion)'",
    "      restoreKeys: 'bc-atlas | \"$(Agent.OS)\"'",
    "      path: $(Pipeline.Workspace)/bc-atlas-cache",
    "    displayName: Cache BC Atlas analysis",
    ...(local ? ["  - bash: if [ -f package-lock.json ]; then npm ci; else npm install --no-audit --no-fund; fi", "    displayName: Install BC Atlas from package.json"] : []),
    ...(alTools ? [`  - bash: ${AL_TOOLS} && echo "##vso[task.prependpath]$HOME/.dotnet/tools"`, "    displayName: Install the AL compiler (AL Development Tools)"] : []),
    "  - bash: |",
    "      case \"$BUILD_REASON\" in",
    // Azure Pipelines does not say which schedule it was: the first one of the flow.
    ...(crons.length ? [`        Schedule) trigger=${crons[0].name} ;;`] : []),
    ...(pulls.length ? [`        PullRequest) trigger=${first("pull-request")} ;;`] : []),
    ...(pushes.length || tags.length ? [`        IndividualCI|BatchedCI) case "$BUILD_SOURCEBRANCH" in refs/tags/*) trigger=${first("tag") ?? first("push")} ;; *) trigger=${first("push") ?? first("tag")} ;; esac ;;`] : []),
    `        *) trigger=${first("manual")} ;;`,
    "      esac",
    "      echo \"##vso[task.setvariable variable=bcaTrigger]$trigger\"",
    `      ${local ? "npx --no-install bca" : `npx --yes bc-atlas@${version}`} run ${quote(appPath)} --trigger "$trigger" --flow ${quote(flow.id)}`,
    "    displayName: Run BC Atlas",
    "    env:",
    "      BCA_CACHE_DIR: $(Pipeline.Workspace)/bc-atlas-cache"
  );
  const artifacts = starts.filter(({ sync }) => sync === "artifact").map(({ name }) => name);
  if (artifacts.length) {
    for (const output of outputs) {
      lines.push(`  - publish: ${output}`, `    artifact: bc-atlas-${flow.id}-${output.replace(/[^A-Za-z0-9]+/gu, "-").replace(/^-|-$/gu, "")}`, `    condition: and(succeededOrFailed(), ${was(artifacts)})`);
    }
  }
  if (commits.length && outputs.length) {
    lines.push(
      "  - bash: |",
      "      git config user.name \"BC Atlas\"",
      "      git config user.email \"bc-atlas@users.noreply.dev.azure.com\"",
      `      git add --all -- ${outputs.map(quote).join(" ")}`,
      "      git diff --cached --quiet || git commit -m \"docs: update BC Atlas output [skip ci]\"",
      "      git push origin \"HEAD:$BUILD_SOURCEBRANCH\"",
      "    displayName: Commit updated output",
      `    condition: and(succeeded(), ${was(commits)})`
    );
  }
  lines.push("");
  return lines.join("\n");
}
