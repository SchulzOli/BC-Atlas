// The BC Atlas engine as seen from the extension: where it is installed,
// which Node runs it, and a worker process that analyzes one project and
// answers requests (src/app/worker.js in the bc-atlas package).
"use strict";

const { fork, spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");

/** The bc-atlas package: bundled with the extension, or the repository when run from source. */
function engineRoot() {
  try {
    return path.dirname(require.resolve("bc-atlas/package.json"));
  } catch {
    const repository = path.resolve(__dirname, "..", "..");
    if (existsSync(path.join(repository, "src", "app", "worker.js"))) return repository;
    throw new Error("the BC Atlas engine is missing; reinstall the extension");
  }
}

/**
 * Node for the engine: the configured executable, or the editor's own
 * runtime (Electron run as Node), which needs no separate installation.
 */
function runtime(nodePath) {
  if (nodePath) return { command: nodePath, env: {} };
  return { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: "1" } };
}

const enginePath = (...parts) => path.join(engineRoot(), ...parts);

class Engine {
  /**
   * @param project folder to analyze
   * @param options { paths, projectRoot, config } for the workspace
   * @param settings { nodePath, log, onEvent } onEvent receives messages the
   *   worker sends on its own, such as { event: "changed" } after the AL compiler
   */
  constructor(project, options, { nodePath, log = () => {}, onEvent = () => {} } = {}) {
    this.project = project;
    this.options = options;
    this.nodePath = nodePath;
    this.log = log;
    this.onEvent = onEvent;
    this.pending = new Map();
    this.nextId = 0;
    this.child = undefined;
    this.ready = undefined;
  }

  start() {
    if (this.ready) return this.ready;
    const { command, env } = runtime(this.nodePath);
    const child = fork(enginePath("src", "app", "worker.js"), [this.project, JSON.stringify(this.options)], {
      execPath: command,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe", "ipc"]
    });
    this.child = child;
    child.stdout.on("data", (chunk) => this.log(String(chunk).trimEnd()));
    child.stderr.on("data", (chunk) => this.log(String(chunk).trimEnd()));
    this.ready = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => reject(new Error(`the BC Atlas engine stopped (exit code ${code}); see the BC Atlas output`)));
      child.once("message", (message) => (message?.ready ? resolve() : reject(new Error("the BC Atlas engine did not start"))));
    });
    child.on("message", (message) => {
      if (message?.event) {
        this.onEvent(message);
        return;
      }
      const waiting = this.pending.get(message?.id);
      if (!waiting) return;
      this.pending.delete(message.id);
      if (message.error) waiting.reject(new Error(message.error));
      else waiting.resolve(message.result);
    });
    child.on("exit", (code, signal) => {
      if (this.child !== child) return;
      this.log(`BC Atlas engine exited (${signal ?? code}).`);
      for (const { reject } of this.pending.values()) reject(new Error("the BC Atlas engine stopped; run \"BC Atlas: Analyze Again\""));
      this.pending.clear();
      this.child = undefined;
      this.ready = undefined;
    });
    return this.ready;
  }

  async request(method, params = {}) {
    await this.start();
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve, reject });
      this.child.send({ id, method, params });
    });
  }

  stop() {
    const child = this.child;
    this.child = undefined;
    this.ready = undefined;
    if (child?.connected) child.disconnect();
    child?.kill();
  }
}

/** Runs a bca command (export, docs, ...) to completion; resolves with its output. */
function runCli(args, { cwd, nodePath, log = () => {} } = {}) {
  const { command, env } = runtime(nodePath);
  return new Promise((resolve, reject) => {
    const child = spawn(command, [enginePath("src", "cli.js"), ...args], { cwd, env: { ...process.env, ...env, BCA_NO_UPDATE_CHECK: "1" } });
    let output = "";
    const collect = (chunk) => {
      output += chunk;
      log(String(chunk).trimEnd());
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve(output) : reject(Object.assign(new Error(output.trim().split("\n").at(-1) || `bca exited with code ${code}`), { code }))));
  });
}

module.exports = { Engine, engineRoot, enginePath, runCli, runtime };
