import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

function run(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: options.input === undefined ? "inherit" : ["pipe", "inherit", "inherit"]
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) reject(new Error(`${executable} terminated by ${signal}`));
      else if (code === 0) resolve();
      else reject(new Error(`${executable} exited with code ${code}`));
    });
    if (options.input !== undefined) child.stdin.end(options.input);
  });
}

export async function runCodex(prompt, {
  cwd = process.cwd(),
  executable = process.env.CODEX_BIN || "codex",
  sandbox = "workspace-write"
} = {}) {
  await run(executable, [
    "exec",
    "--ephemeral",
    "--sandbox",
    sandbox,
    "--cd",
    cwd,
    "-"
  ], { cwd, env: process.env, input: prompt });
}

export async function runPlaywright(testPath, {
  cwd = process.cwd(),
  config,
  bcUrl,
  headed = false
} = {}) {
  const cli = fileURLToPath(new URL("../../node_modules/@playwright/test/cli.js", import.meta.url));
  const absoluteTestPath = path.resolve(testPath);
  const configPath = config
    ? path.resolve(config)
    : fileURLToPath(new URL("../../playwright.docs.config.js", import.meta.url));
  const args = [cli, "test", path.basename(absoluteTestPath), "--config", configPath];
  if (headed) args.push("--headed");
  await run(process.execPath, args, {
    cwd,
    env: {
      ...process.env,
      BC_DOCS_TEST_DIR: path.dirname(absoluteTestPath),
      ...(bcUrl ? { BC_URL: bcUrl } : {})
    }
  });
}
