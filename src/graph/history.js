import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const FIELD = "\u001f";

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (result.error?.code === "ENOENT") throw new Error("--history needs the git executable on PATH");
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

function toPosix(value) {
  return value.replaceAll("\\", "/");
}

/** AL sources and app manifests below the project, as Git pathspecs. */
function pathspecs(prefix) {
  const base = prefix ? `${prefix}/` : "";
  return [`:(glob)${base}**/*.al`, `:(glob)${base}**/app.json`, `:(glob)${base}app.json`];
}

function relevant(prefix, file) {
  if (prefix && !file.startsWith(`${prefix}/`)) return false;
  return /\.al$/iu.test(file) || /(^|\/)app\.json$/iu.test(file);
}

/** Keeps the first and last commit and spreads the rest evenly. */
export function sampleCommits(commits, limit) {
  if (commits.length <= limit) return commits;
  if (limit === 1) return [commits.at(-1)];
  const step = (commits.length - 1) / (limit - 1);
  const indexes = new Set(Array.from({ length: limit }, (_, index) => Math.round(index * step)));
  return [...indexes].sort((a, b) => a - b).map((index) => commits[index]);
}

/** Reads many blobs through one `git cat-file --batch` process. */
function blobReader(cwd) {
  const child = spawn("git", ["cat-file", "--batch"], { cwd, stdio: ["pipe", "pipe", "inherit"] });
  let buffer = Buffer.alloc(0);
  const waiting = [];
  const flush = () => {
    while (waiting.length) {
      const newline = buffer.indexOf(10);
      if (newline < 0) return;
      const header = buffer.subarray(0, newline).toString("utf8");
      if (header.endsWith(" missing")) {
        buffer = buffer.subarray(newline + 1);
        waiting.shift().resolve(undefined);
        continue;
      }
      const size = Number(header.split(" ")[2]);
      if (buffer.length < newline + 1 + size + 1) return;
      const content = buffer.subarray(newline + 1, newline + 1 + size);
      buffer = buffer.subarray(newline + 1 + size + 1);
      waiting.shift().resolve(content);
    }
  };
  child.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    flush();
  });
  child.on("error", (error) => waiting.splice(0).forEach(({ reject }) => reject(error)));
  return {
    read(spec) {
      return new Promise((resolve, reject) => {
        waiting.push({ resolve, reject });
        child.stdin.write(`${spec}\n`);
      });
    },
    close() {
      child.stdin.end();
    }
  };
}

/** Lists commits that touched AL files or app.json below the project root. */
export function projectCommits(projectRoot, { since } = {}) {
  let repository;
  try {
    repository = git(projectRoot, ["rev-parse", "--show-toplevel"]).trim();
  } catch (error) {
    if (/git executable/u.test(error.message)) throw error;
    throw new Error(`--history needs a Git repository; ${projectRoot} is not inside one`);
  }
  const prefix = toPosix(path.relative(repository, projectRoot));
  const args = ["log", "--reverse", `--format=%H${FIELD}%h${FIELD}%aI${FIELD}%an${FIELD}%s`];
  if (since) args.push(`--since=${since}`);
  const commits = git(repository, [...args, "--", ...pathspecs(prefix)])
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, short, date, author, subject] = line.split(FIELD);
      // Git versions print %aI as "Z" or "+00:00"; normalize to UTC for stable output.
      return { sha, short, date: new Date(date).toISOString(), author, subject };
    });
  return { repository, prefix, commits };
}

/**
 * Replays the project's Git history: materializes each sampled commit in a
 * temporary directory (writing only the files that changed) and hands it to
 * `visit`. The working tree becomes a last frame when it has uncommitted
 * AL changes.
 */
export async function replayHistory(projectRoot, { maxCommits = 60, since } = {}, visit) {
  const { repository, prefix, commits: all } = projectCommits(projectRoot, { since });
  const commits = sampleCommits(all, maxCommits);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bca-history-"));
  const reader = blobReader(repository);
  const local = (file) => {
    const relative = prefix ? toPosix(file).slice(prefix.length + 1) : toPosix(file);
    return path.join(directory, ...relative.split("/"));
  };
  try {
    let previous;
    for (const [index, commit] of commits.entries()) {
      const changes = previous
        ? git(repository, ["diff", "--name-status", "--no-renames", "-z", previous.sha, commit.sha])
          .split("\0").filter(Boolean)
          .reduce((items, token, position, tokens) => {
            if (position % 2 === 0) items.push({ status: token, file: tokens[position + 1] });
            return items;
          }, [])
          .filter(({ file }) => relevant(prefix, file))
        : git(repository, ["ls-tree", "-r", "-z", "--name-only", commit.sha])
          .split("\0").filter((file) => file && relevant(prefix, file))
          .map((file) => ({ status: "A", file }));
      for (const { status, file } of changes) {
        const target = local(file);
        if (status.startsWith("D")) {
          await fs.rm(target, { force: true });
          continue;
        }
        const content = await reader.read(`${commit.sha}:${file}`);
        if (content === undefined) continue;
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, content);
      }
      const span = previous ? all.indexOf(commit) - all.indexOf(previous) : all.indexOf(commit) + 1;
      await visit(directory, {
        id: commit.short,
        sha: commit.sha,
        kind: "commit",
        label: commit.subject,
        date: commit.date,
        author: commit.author,
        commits: span,
        changedFiles: new Set(changes.map(({ file }) => toPosix(path.relative(directory, local(file)))))
      }, index);
      previous = commit;
    }
  } finally {
    reader.close();
    await fs.rm(directory, { recursive: true, force: true });
  }

  const dirty = git(repository, ["status", "--porcelain", "-z", "--untracked-files=all"])
    .split("\0").filter(Boolean)
    .map((entry) => entry.slice(3))
    .filter((file) => relevant(prefix, file))
    .map((file) => prefix ? file.slice(prefix.length + 1) : file);
  return { commits: all.length, sampled: commits.length, workingTreeChanges: dirty };
}
