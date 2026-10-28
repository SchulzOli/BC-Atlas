import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const FIELD = "\u001f";
const RECORD = "\u001e";

/** What one timeline frame stands for. */
export const HISTORY_MODES = Object.freeze(["commits", "prs", "releases"]);

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

function relevant(prefix, file, fileFilter) {
  if (prefix && !file.startsWith(`${prefix}/`)) return false;
  if (/(^|\/)app\.json$/iu.test(file)) return true;
  return /\.al$/iu.test(file) && (!fileFilter || fileFilter(prefix ? file.slice(prefix.length + 1) : file));
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

/**
 * Recognizes a merged pull request from a commit message: GitHub merge
 * commits ("Merge pull request #12 from ..."; the title is the first body
 * line), squash merges ("Title (#12)"), Azure DevOps ("Merged PR 12: Title"),
 * and GitLab merge commits ("See merge request group/project!12").
 */
export function pullRequestOf(subject = "", body = "") {
  const firstLine = body.split("\n").map((line) => line.trim()).find(Boolean);
  let match = /^Merge pull request #(\d+)\b/u.exec(subject);
  if (match) return { number: Number(match[1]), id: `#${match[1]}`, title: firstLine ?? subject };
  match = /^Merged PR (\d+):\s*(.+)$/u.exec(subject);
  if (match) return { number: Number(match[1]), id: `#${match[1]}`, title: match[2] };
  match = /See merge request \S*!(\d+)/u.exec(body);
  if (match) return { number: Number(match[1]), id: `!${match[1]}`, title: firstLine && !firstLine.startsWith("See merge request") ? firstLine : subject };
  match = /^(.*\S)\s+\(#(\d+)\)$/u.exec(subject);
  if (match) return { number: Number(match[2]), id: `#${match[2]}`, title: match[1] };
  return undefined;
}

function repositoryOf(projectRoot) {
  let repository;
  try {
    repository = git(projectRoot, ["rev-parse", "--show-toplevel"]).trim();
  } catch (error) {
    if (/git executable/u.test(error.message)) throw error;
    throw new Error(`--history needs a Git repository; ${projectRoot} is not inside one`);
  }
  // Ask Git for the prefix: paths like C:\Users\RUNNER~1 and C:/Users/runneradmin
  // name the same folder but do not compare equal.
  const prefix = git(projectRoot, ["rev-parse", "--show-prefix"]).trim().replace(/\/$/u, "");
  return { repository, prefix };
}

function readLog(repository, args) {
  return git(repository, ["log", `--format=%H${FIELD}%h${FIELD}%aI${FIELD}%an${FIELD}%s${FIELD}%b${RECORD}`, ...args])
    .split(RECORD)
    .map((record) => record.replace(/^\n/u, ""))
    .filter(Boolean)
    .map((record) => {
      const [sha, short, date, author, subject, body = ""] = record.split(FIELD);
      // Git versions print %aI as "Z" or "+00:00"; normalize to UTC for stable output.
      return { sha, short, date: new Date(date).toISOString(), author, subject, body };
    });
}

const count = (repository, args) => Number(git(repository, ["rev-list", "--count", ...args]).trim());

/** One step per merged pull request on the first-parent line; direct commits stay commits. */
function pullRequestSteps(repository, prefix, { since }) {
  const args = ["--first-parent", "--reverse"];
  if (since) args.push(`--since=${since}`);
  return readLog(repository, [...args, "--", ...pathspecs(prefix)]).map((commit) => {
    const pull = pullRequestOf(commit.subject, commit.body);
    if (!pull) return { ...commit, kind: "commit", id: commit.short, label: commit.subject, commits: 1 };
    const merge = git(repository, ["rev-list", "--parents", "-n", "1", commit.sha]).trim().split(" ").length > 2;
    return {
      ...commit,
      kind: "pull-request",
      id: pull.id,
      label: pull.title,
      number: pull.number,
      commits: merge ? count(repository, ["--no-merges", `${commit.sha}^1..${commit.sha}`]) : 1
    };
  });
}

/** One step per release tag reachable from HEAD, plus the commits after the last one. */
function releaseSteps(repository, prefix, { since }) {
  const tags = git(repository, [
    "for-each-ref", "--merged", "HEAD", "--sort=creatordate",
    `--format=%(refname:short)${FIELD}%(objectname)${FIELD}%(*objectname)${FIELD}%(creatordate:iso-strict)${FIELD}%(taggername)${FIELD}%(contents:subject)`,
    "refs/tags"
  ]).split("\n").filter(Boolean).map((line) => {
    const [name, object, peeled, date, tagger, subject] = line.split(FIELD);
    return { name, sha: peeled || object, date: new Date(date).toISOString(), tagger, subject };
  });
  const specs = pathspecs(prefix);
  // --since takes anything git log accepts, so Git decides which releases are recent.
  const recent = since ? new Set(git(repository, ["rev-list", `--since=${since}`, "HEAD"]).split("\n").filter(Boolean)) : undefined;
  const steps = [];
  let previous;
  for (const tag of tags) {
    if (recent && !recent.has(tag.sha)) {
      previous = tag.sha;
      continue;
    }
    const [commit] = readLog(repository, ["-1", tag.sha]);
    steps.push({
      ...commit,
      sha: commit.sha,
      kind: "release",
      id: tag.name,
      label: tag.subject && tag.subject !== commit.subject ? `${tag.name}: ${tag.subject}` : tag.name,
      author: tag.tagger || commit.author,
      date: tag.date,
      commits: count(repository, [previous ? `${previous}..${tag.sha}` : tag.sha, "--", ...specs])
    });
    previous = tag.sha;
  }
  const unreleased = count(repository, [previous ? `${previous}..HEAD` : "HEAD", "--", ...specs]);
  if (unreleased && previous) {
    const [head] = readLog(repository, ["-1", "HEAD"]);
    steps.push({ ...head, kind: "unreleased", id: "unreleased", label: `Unreleased: ${head.subject}`, commits: unreleased });
  }
  return steps;
}

/** Lists commits that touched AL files or app.json below the project root. */
export function projectCommits(projectRoot, { since } = {}) {
  const { repository, prefix } = repositoryOf(projectRoot);
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
export async function replayHistory(projectRoot, { by = "commits", maxCommits = 60, last, since, fileFilter } = {}, visit) {
  if (!HISTORY_MODES.includes(by)) throw new Error(`history steps must be one of: ${HISTORY_MODES.join(", ")}`);
  const { repository, prefix, commits: all } = projectCommits(projectRoot, { since });
  let steps = by === "prs"
    ? pullRequestSteps(repository, prefix, { since })
    : by === "releases"
      ? releaseSteps(repository, prefix, { since })
      : all.map((commit) => ({ ...commit, kind: "commit", id: commit.short, label: commit.subject }));
  if (by === "releases" && !steps.length) throw new Error("no release tags reachable from HEAD; use --history-by commits or prs");
  if (last) steps = steps.slice(-last);
  const commits = sampleCommits(steps, maxCommits);
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
          .filter(({ file }) => relevant(prefix, file, fileFilter))
        : git(repository, ["ls-tree", "-r", "-z", "--name-only", commit.sha])
          .split("\0").filter((file) => file && relevant(prefix, file, fileFilter))
          .map((file) => ({ status: "A", file }));
      // Releases or pull requests from before the project existed have nothing to show.
      if (!previous && !changes.length) continue;
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
      // A step stands for every commit since the previous one; sampled steps
      // add up the ones they skip.
      const skipped = steps.slice(previous ? steps.indexOf(previous) + 1 : 0, steps.indexOf(commit) + 1);
      const span = skipped.reduce((sum, step) => sum + (step.commits ?? 1), 0);
      await visit(directory, {
        id: commit.id,
        sha: commit.sha,
        kind: commit.kind,
        label: commit.label,
        date: commit.date,
        author: commit.author,
        commits: span,
        ...(commit.number ? { number: commit.number } : {}),
        ...(skipped.length > 1 && by !== "commits" ? { includes: skipped.length } : {}),
        changedFiles: new Set(changes.map(({ file }) => toPosix(path.relative(directory, local(file)))))
      }, index, commits.length);
      previous = commit;
    }
  } finally {
    reader.close();
    await fs.rm(directory, { recursive: true, force: true });
  }

  const dirty = git(repository, ["status", "--porcelain", "-z", "--untracked-files=all"])
    .split("\0").filter(Boolean)
    .map((entry) => entry.slice(3))
    .filter((file) => relevant(prefix, file, fileFilter))
    .map((file) => prefix ? file.slice(prefix.length + 1) : file);
  return { by, commits: all.length, steps: steps.length, sampled: commits.length, workingTreeChanges: dirty };
}
