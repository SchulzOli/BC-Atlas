// Finds Microsoft's AL toolchain: the AL Language extension for VS Code
// (alc and altool in its bin folder) or the AL Development Tools .NET tool
// (`al`). BC Atlas uses it to compile and to read the compiler's call graph
// instead of its own source-level approximations.
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const TOOL_PACKAGE = "microsoft.dynamics.businesscentral.development.tools";
export const EXTENSION_PREFIX = "ms-dynamics-smb.al-";
export const COMPILER_MODES = Object.freeze(["auto", "off"]);

const ANALYZERS = Object.freeze({
  codecop: "Microsoft.Dynamics.Nav.CodeCop.dll",
  uicop: "Microsoft.Dynamics.Nav.UICop.dll",
  appsourcecop: "Microsoft.Dynamics.Nav.AppSourceCop.dll",
  pertenantextensioncop: "Microsoft.Dynamics.Nav.PerTenantExtensionCop.dll",
  ptecop: "Microsoft.Dynamics.Nav.PerTenantExtensionCop.dll"
});

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(directory) {
  try {
    return (await fs.stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

function compareVersions(left, right) {
  const a = String(left).split(/[.-]/u).map((part) => Number.parseInt(part, 10) || 0);
  const b = String(right).split(/[.-]/u).map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) - (b[index] ?? 0);
  }
  return 0;
}

function executable(name, platform) {
  return platform === "win32" ? `${name}.exe` : name;
}

const PLATFORM_FOLDERS = { win32: "win32", linux: "linux", darwin: "darwin" };

/** Folders where VS Code and its forks keep extensions. */
export function extensionFolders({ env = process.env, home = os.homedir() } = {}) {
  const folders = env.VSCODE_EXTENSIONS ? [env.VSCODE_EXTENSIONS] : [];
  for (const name of [".vscode", ".vscode-insiders", ".vscode-server", ".vscode-server-insiders", ".vscode-oss", ".cursor", ".windsurf"]) {
    folders.push(path.join(home, name, "extensions"));
  }
  return folders;
}

/** The newest installed AL Language extension (ms-dynamics-smb.al-<version>). */
export async function findAlExtension(options = {}) {
  const found = [];
  for (const folder of extensionFolders(options)) {
    let names;
    try {
      names = await fs.readdir(folder);
    } catch {
      continue;
    }
    for (const name of names) {
      const match = name.toLowerCase().startsWith(EXTENSION_PREFIX) && name.slice(EXTENSION_PREFIX.length).match(/^(\d+(?:\.\d+)*)/u);
      if (match) found.push({ path: path.join(folder, name), version: match[1] });
    }
  }
  return found.sort((left, right) => compareVersions(right.version, left.version))[0];
}

/**
 * Tools of an AL Language extension folder. Since 2026 release wave 2 they
 * sit directly in bin/; older versions use bin/<platform>/ and bin/Analyzers/.
 */
export async function fromExtension(extensionPath, { platform = process.platform, version } = {}) {
  const bin = path.join(extensionPath, "bin");
  for (const folder of [bin, path.join(bin, PLATFORM_FOLDERS[platform] ?? platform)]) {
    const alc = path.join(folder, executable("alc", platform));
    if (!await exists(alc)) continue;
    const altool = path.join(folder, executable("altool", platform));
    const analyzerFolder = await exists(path.join(folder, ANALYZERS.codecop)) ? folder : path.join(bin, "Analyzers");
    return {
      source: "vscode-extension",
      location: extensionPath,
      version: version ?? path.basename(extensionPath).slice(EXTENSION_PREFIX.length),
      alc: { command: alc, args: [] },
      altool: await exists(altool) ? { command: altool, args: [] } : undefined,
      analyzerFolder
    };
  }
  return undefined;
}

async function onPath(names, env, platform) {
  const separator = platform === "win32" ? ";" : ":";
  for (const folder of String(env.PATH ?? env.Path ?? "").split(separator).filter(Boolean)) {
    for (const name of names) {
      const candidate = path.join(folder, name);
      if (await exists(candidate)) return candidate;
    }
  }
  return undefined;
}

/** The AL Development Tools .NET tool: `al`, with alc and the analyzers in its store folder. */
export async function findDotnetTool({ env = process.env, home = os.homedir(), platform = process.platform } = {}) {
  const names = [executable("al", platform)];
  const al = await onPath(names, env, platform) ??
    (await exists(path.join(home, ".dotnet", "tools", names[0])) ? path.join(home, ".dotnet", "tools", names[0]) : undefined);
  if (!al) return undefined;
  const store = path.join(path.dirname(await fs.realpath(al).catch(() => al)), ".store", TOOL_PACKAGE);
  let version;
  let analyzerFolder;
  try {
    version = (await fs.readdir(store)).sort(compareVersions).at(-1);
    const tools = path.join(store, version, TOOL_PACKAGE, version, "tools");
    const frameworks = (await fs.readdir(tools)).sort(compareVersions);
    for (const framework of frameworks) {
      const folder = path.join(tools, framework, "any");
      if (await exists(path.join(folder, ANALYZERS.codecop))) analyzerFolder = folder;
    }
  } catch {
    // An `al` without the usual store layout still compiles; analyzers then need paths.
  }
  return {
    source: "dotnet-tool",
    location: al,
    version,
    // `al compile` passes its arguments to the alc that ships with it.
    alc: { command: al, args: ["compile", "--"] },
    altool: { command: al, args: [] },
    analyzerFolder
  };
}

/** A path from configuration: an extension folder, a tool folder, alc, alc.dll, or al/altool. */
export async function fromPath(target, { platform = process.platform } = {}) {
  const resolved = path.resolve(target);
  if (await isDirectory(resolved)) {
    if (await isDirectory(path.join(resolved, "bin"))) {
      const tools = await fromExtension(resolved, { platform });
      if (tools) return { ...tools, source: "config" };
    }
    for (const name of [executable("alc", platform), "alc.dll"]) {
      if (await exists(path.join(resolved, name))) return fromPath(path.join(resolved, name), { platform });
    }
    return undefined;
  }
  if (!await exists(resolved)) return undefined;
  const base = path.basename(resolved).toLowerCase().replace(/\.exe$/u, "");
  const folder = path.dirname(resolved);
  if (base === "al" || base === "altool") {
    return { source: "config", location: resolved, alc: { command: resolved, args: ["compile", "--"] }, altool: { command: resolved, args: [] }, analyzerFolder: folder };
  }
  const alc = base === "alc.dll" ? { command: "dotnet", args: [resolved] } : { command: resolved, args: [] };
  const altoolPath = path.join(folder, path.basename(resolved).replace(/alc/iu, "altool"));
  const altool = await exists(altoolPath)
    ? (altoolPath.endsWith(".dll") ? { command: "dotnet", args: [altoolPath] } : { command: altoolPath, args: [] })
    : undefined;
  return { source: "config", location: resolved, alc, altool, analyzerFolder: folder };
}

/**
 * Resolves the toolchain for a compiler setting: "off", "auto" (the AL
 * extension VS Code reports or the newest installed one, then the .NET
 * tool), or a path. BCA_AL_COMPILER overrides the setting.
 * @param options { compiler, extensionPath, env, home, platform }
 */
export async function findAlToolchain({ compiler = "auto", extensionPath, env = process.env, home = os.homedir(), platform = process.platform } = {}) {
  const setting = env.BCA_AL_COMPILER || compiler || "auto";
  if (setting === "off") return undefined;
  if (setting !== "auto") {
    const tools = await fromPath(setting, { platform });
    if (!tools) throw new Error(`AL compiler not found: ${setting}`);
    return tools;
  }
  if (extensionPath) {
    const tools = await fromExtension(extensionPath, { platform });
    if (tools) return tools;
  }
  const extension = await findAlExtension({ env, home });
  if (extension) {
    const tools = await fromExtension(extension.path, { platform, version: extension.version });
    if (tools) return tools;
  }
  return findDotnetTool({ env, home, platform });
}

/** Analyzer DLL paths for `${CodeCop}`, `CodeCop`, `${AnalyzerFolder}/X.dll`, or a path. */
export function analyzerPaths(values, toolchain, base = process.cwd()) {
  const folder = toolchain?.analyzerFolder;
  return values.map((value) => {
    const name = String(value).trim().replace(/^\$\{(.*)\}$/u, "$1").toLowerCase();
    if (ANALYZERS[name]) {
      if (!folder) throw new Error(`cannot locate ${value}: the AL toolchain has no analyzer folder`);
      return path.join(folder, ANALYZERS[name]);
    }
    const expanded = String(value).replace(/\$\{AnalyzerFolder\}/giu, folder ?? "");
    return path.resolve(base, expanded);
  });
}

/** "AL Language extension 18.1.1960000", with `location` also where it is installed. */
export function describeToolchain(toolchain, { location = true } = {}) {
  if (!toolchain) return "not found";
  const what = { "vscode-extension": "AL Language extension", "dotnet-tool": "AL Development Tools (.NET tool)", config: "configured AL compiler" }[toolchain.source];
  return `${what}${toolchain.version ? ` ${toolchain.version}` : ""}${location ? ` (${toolchain.location})` : ""}`;
}

/** Runs a toolchain command; resolves with { code, stdout, stderr } and never rejects on exit codes. */
export function runTool(tool, args, { cwd, timeout = 30 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(tool.command, [...tool.args, ...args], {
      cwd,
      timeout,
      maxBuffer: 256 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1" }
    }, (error, stdout, stderr) => {
      if (error && typeof error.code !== "number") reject(error);
      else resolve({ code: error?.code ?? 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}
