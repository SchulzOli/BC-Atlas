// A unified diff of two texts, for previews of refactorings. Changes are
// local (a namespace line, a using, a cut-out object), so the common start
// and end are skipped and only the middle is compared line by line.

const CONTEXT = 3;
const MAX_CELLS = 4_000_000;

function editScript(before, after) {
  // Longest common subsequence on the middle part.
  const rows = before.length + 1;
  const columns = after.length + 1;
  if (rows * columns > MAX_CELLS) {
    return [...before.map((line) => ["-", line]), ...after.map((line) => ["+", line])];
  }
  const table = Array.from({ length: rows }, () => new Uint32Array(columns));
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      table[i][j] = before[i] === after[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const script = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      script.push([" ", before[i++]]);
      j++;
    } else if (j < after.length && (i === before.length || table[i][j + 1] > table[i + 1][j])) {
      script.push(["+", after[j++]]);
    } else {
      script.push(["-", before[i++]]);
    }
  }
  return script;
}

/** Unified diff from `fromPath` to `toPath`; empty when nothing changed. */
export function lineDiff(fromPath, toPath, before, after) {
  if (before === after && fromPath === toPath) return "";
  const a = before ? before.split(/\r?\n/u) : [];
  const b = after ? after.split(/\r?\n/u) : [];
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const script = [
    ...a.slice(0, prefix).map((line) => [" ", line]),
    ...editScript(a.slice(prefix, a.length - suffix), b.slice(prefix, b.length - suffix)),
    ...a.slice(a.length - suffix).map((line) => [" ", line])
  ];

  // Hunks: changed lines with up to CONTEXT unchanged lines around them.
  const lines = [`--- ${before ? `a/${fromPath}` : "/dev/null"}`, `+++ b/${toPath}`];
  if (fromPath !== toPath && before === after) return `${lines.join("\n")}\n`;
  const changed = script.map(([kind], index) => (kind === " " ? -1 : index)).filter((index) => index >= 0);
  let index = 0;
  while (index < changed.length) {
    const start = Math.max(0, changed[index] - CONTEXT);
    let end = changed[index];
    while (index + 1 < changed.length && changed[index + 1] - end <= CONTEXT * 2) end = changed[++index];
    end = Math.min(script.length - 1, end + CONTEXT);
    index++;
    const oldStart = script.slice(0, start).filter(([kind]) => kind !== "+").length + 1;
    const newStart = script.slice(0, start).filter(([kind]) => kind !== "-").length + 1;
    const hunk = script.slice(start, end + 1);
    const oldCount = hunk.filter(([kind]) => kind !== "+").length;
    const newCount = hunk.filter(([kind]) => kind !== "-").length;
    lines.push(`@@ -${oldCount ? oldStart : oldStart - 1},${oldCount} +${newCount ? newStart : newStart - 1},${newCount} @@`);
    for (const [kind, line] of hunk) lines.push(`${kind}${line}`);
  }
  return `${lines.join("\n")}\n`;
}
