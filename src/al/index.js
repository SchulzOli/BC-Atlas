// Connects Microsoft's AL toolchain to the BC Atlas model. Where the AL tools
// know better, their answer replaces BC Atlas's own:
//
//   calls        resolved by the compiler's call graph (overloads, variables,
//                interfaces, built-in methods) instead of by name and arity
//   diagnostics  compiler and analyzer findings replace tree-sitter parse
//                errors for every file the compiler read
//
// Without the toolchain (or with al.compiler "off") the source-level
// analysis stays as it is.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { readCachedAlTools, readErrorLogs, runAlTools } from "./compiler.js";
import { describeToolchain, findAlToolchain } from "./toolchain.js";

const toPosix = (value) => String(value ?? "").replaceAll("\\", "/");

/** AL options from .bca.json (`al` section) and CLI values. */
export function alOptions(options = {}) {
  const config = options.al && typeof options.al === "object" ? options.al : {};
  const list = (value) => (value === undefined ? undefined : [value].flat().flatMap((item) => String(item).split(",")).map((item) => item.trim()).filter(Boolean));
  return {
    compiler: options.compiler ?? config.compiler ?? "auto",
    errorLog: options.compilerLog ?? config.errorLog,
    analyzers: list(options.analyzers ?? config.analyzers),
    graph: config.callGraph !== false,
    workspaceFile: config.workspaceFile,
    settings: options.alSettings,
    extensionPath: options.alExtensionPath
  };
}

const running = new Map();

/**
 * Runs the AL toolchain and/or imports error logs for a project root.
 * Returns undefined when neither applies.
 *
 * With `onUpdate` (editors), it does not wait for the compiler: it returns
 * the last result at once, compiles in the background, and calls `onUpdate`
 * when a newer result is ready.
 */
export async function loadAlResults(root, options = {}, { onProgress, onUpdate } = {}) {
  const al = alOptions(options);
  let result;
  const toolchain = await findAlToolchain({ compiler: al.compiler, extensionPath: al.extensionPath });
  if (toolchain) {
    const run = () => runAlTools(root, {
      toolchain,
      al: { workspaceFile: al.workspaceFile, settings: al.settings },
      analyzers: al.analyzers,
      graph: al.graph,
      onProgress
    });
    if (onUpdate) {
      result = await readCachedAlTools(root);
      const key = path.resolve(root);
      if (!running.has(key)) {
        const known = result?.key;
        const job = run()
          .then((fresh) => {
            if (fresh && fresh.key !== known) onUpdate(fresh);
          }, (error) => onProgress?.(`AL compiler failed: ${error.message}`))
          .finally(() => running.delete(key));
        running.set(key, job);
      }
    } else {
      result = await run();
    }
  }
  if (al.errorLog) {
    const imported = await readErrorLogs(al.errorLog, { root });
    result = { ...(result ?? {}), diagnostics: [...(result?.diagnostics ?? []), ...imported], imported: true };
  }
  return result;
}

async function contentHash(root, file, cache) {
  if (!cache.has(file)) {
    cache.set(file, fs.readFile(path.join(root, file)).then(
      (content) => createHash("sha256").update(content).digest("hex"),
      () => undefined
    ));
  }
  return cache.get(file);
}

function memberName(value) {
  return String(value ?? "").replace(/^"|"$/gu, "").toLowerCase();
}

/**
 * Applies AL results to an analyzed model (before resolveModel): annotates
 * calls with the compiler's targets and merges diagnostics. Data for a file
 * that changed since it was compiled is ignored.
 */
export async function applyAlResults(model, result) {
  if (!result) return model;
  const root = (await fs.stat(model.root)).isDirectory() ? model.root : path.dirname(model.root);
  const hashes = new Map();
  // True when a file is as the compiler saw it (or the compiler did not read it).
  const current = async (file) => {
    const expected = file ? result.files?.[toPosix(file)] : undefined;
    return expected === undefined || (await contentHash(root, toPosix(file), hashes)) === expected;
  };

  // Diagnostics: the compiler is the authority on syntax for the files it read.
  const compiledFiles = new Set(Object.keys(result.files ?? {}));
  const kept = [];
  for (const diagnostic of model.diagnostics) {
    if (diagnostic.code === "parse-error" && compiledFiles.has(toPosix(diagnostic.file)) && await current(diagnostic.file)) continue;
    kept.push(diagnostic);
  }
  for (const diagnostic of result.diagnostics ?? []) {
    if (result.imported || !diagnostic.file || await current(diagnostic.file)) kept.push(diagnostic);
  }
  model.diagnostics = kept;

  // Calls: the compiler's call graph, matched by file, line, and member name.
  let resolved = 0;
  let builtin = 0;
  if (result.graph) {
    const { nodes, edges } = result.graph;
    // The graph keeps one edge per caller and callee (at its first line), so
    // a repeated call is matched by its procedure and member name instead.
    const atLine = new Map();
    const inCaller = new Map();
    const add = (map, key, edge) => {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(edge);
    };
    for (const edge of edges) {
      if (!edge.file || !edge.line || !["Direct", "Run"].includes(edge.kind)) continue;
      add(atLine, `${edge.file}:${edge.line}`, edge);
      add(inCaller, `${edge.file}:${memberName(nodes.get(edge.caller)?.member)}`, edge);
    }
    const unique = (candidates, call) => {
      const matches = candidates
        .map((edge) => ({ edge, node: nodes.get(edge.callee) }))
        .filter(({ node }) => node && memberName(node.member) === memberName(call.name));
      const targets = [...new Map(matches.map((item) => [item.node.id, item])).values()];
      return targets.length === 1 ? targets[0] : undefined;
    };
    const annotate = async (call, caller) => {
      const file = toPosix(call.location?.file);
      if (!file || !call.location?.line || !await current(file)) return;
      const target = unique(atLine.get(`${file}:${call.location.line}`) ?? [], call) ??
        unique(inCaller.get(`${file}:${memberName(caller)}`) ?? [], call);
      if (!target) return;
      const targets = [target];
      const { node, edge } = targets[0];
      call.compiled = {
        type: node.type,
        objectId: node.objectId || undefined,
        objectName: node.objectName,
        member: node.member,
        line: node.line,
        file: node.file,
        builtin: node.type === "builtin" || node.kind === "BuiltInMethod",
        confidence: edge.confidence
      };
      if (call.compiled.builtin) builtin++;
      else resolved++;
    };
    for (const object of model.objects) {
      if (object.externalSymbol) continue;
      for (const member of [...(object.procedures ?? []), ...(object.actions ?? [])]) {
        for (const call of member.calls ?? []) await annotate(call, member.name);
      }
    }
  }

  model.al = {
    toolchain: result.toolchain,
    // Without the install path: reports are committed and shared.
    description: result.toolchain ? describeToolchain(result.toolchain, { location: false }) : undefined,
    projects: result.projects,
    imported: Boolean(result.imported),
    diagnostics: (result.diagnostics ?? []).length,
    calls: result.graph ? { resolved, builtin } : undefined
  };
  return model;
}
