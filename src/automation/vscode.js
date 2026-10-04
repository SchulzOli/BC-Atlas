// VS Code tasks for the local development loop. They call the same bca
// commands as the Git hooks, so "try the pre-push hook" in the editor and the
// real hook behave identically. Health-check findings appear in the Problems
// panel with a link to the AL file and line.
import { GENERATED_MARKER } from "./pipelines.js";

export const TASK_PREFIX = "BC Atlas: ";

/** Removes // and /* *\/ comments and trailing commas outside strings (JSONC). */
export function parseJsonc(text) {
  let output = "";
  let inString = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const next = text[index + 1];
    if (inString) {
      output += char;
      if (char === "\\") output += text[++index] ?? "";
      else if (char === "\"") inString = false;
    } else if (char === "\"") {
      inString = true;
      output += char;
    } else if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") index++;
      output += "\n";
    } else if (char === "/" && next === "*") {
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) index++;
      index++;
    } else {
      output += char;
    }
  }
  return JSON.parse(output.replace(/,(\s*[}\]])/gu, "$1"));
}

export function hasJsonComments(text) {
  try {
    JSON.parse(text);
    return false;
  } catch {
    return true;
  }
}

function matcher(severity, label, location) {
  return {
    owner: "bc-atlas",
    source: "BC Atlas",
    severity,
    fileLocation: location,
    pattern: {
      regexp: `^\\s+${label}\\s+(.*) \\(([^()]+?):(\\d+)\\)$`,
      message: 1,
      file: 2,
      line: 3
    }
  };
}

/**
 * @param options { appPath (relative to the workspace folder), command, features, triggers }
 */
export function vscodeTasks({ appPath, command, features, triggers }) {
  const [executable, ...prefix] = command;
  const location = ["relative", appPath === "." ? "${workspaceFolder}" : `\${workspaceFolder}/${appPath}`];
  const task = (label, args, extra = {}) => ({
    label: `${TASK_PREFIX}${label}`,
    detail: GENERATED_MARKER,
    type: "process",
    command: executable,
    args: [...prefix, ...args],
    options: { cwd: "${workspaceFolder}" },
    problemMatcher: [],
    ...extra
  });
  const tasks = [
    task("Health check", ["check", appPath], {
      group: "test",
      problemMatcher: [
        matcher("error", "ERROR", location),
        matcher("warning", "WARN", location),
        matcher("info", "INFO", location)
      ]
    })
  ];
  if (features.includes("report")) tasks.push(task("Architecture report", ["run", appPath, "--tasks", "report"]));
  if (features.includes("docs")) tasks.push(task("User documentation", ["run", appPath, "--tasks", "docs"]));
  if (features.includes("codegraph")) tasks.push(task("Code graph", ["run", appPath, "--tasks", "codegraph"]));
  for (const hook of ["pre-commit", "pre-push"]) {
    if (triggers[hook]) tasks.push(task(`Run ${hook} hook`, ["run", appPath, "--trigger", hook]));
  }
  tasks.push(
    task("Live architecture diagram", [
      "watch", appPath, "--output", `${appPath === "." ? "" : `${appPath}/`}.bca/live/architecture.svg`
    ], {
      isBackground: true,
      problemMatcher: {
        owner: "bc-atlas",
        pattern: { regexp: "^bca: (rebuild failed): (.*)$", message: 2 },
        background: { activeBegins: "^Analyzed ", activeEnds: "^Watching |^Wrote .*\\.d2$" }
      }
    }),
    task("Set up automation", ["setup", appPath], { presentation: { focus: true, panel: "dedicated" } })
  );
  return tasks;
}

/** Replaces earlier BC Atlas tasks and keeps every other task and setting. */
export function mergeTasks(existingText, tasks) {
  const existing = existingText ? parseJsonc(existingText) : {};
  const others = (existing.tasks ?? []).filter(({ label }) => !String(label ?? "").startsWith(TASK_PREFIX));
  return `${JSON.stringify({ ...existing, version: existing.version ?? "2.0.0", tasks: [...others, ...tasks] }, null, 2)}\n`;
}
