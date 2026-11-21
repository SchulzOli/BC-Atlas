// The loop of the editor, for scripts/benchmark.js: a live workspace opens a
// project, one file is saved again and again, and each time the view asks
// for the atlas. Prints the milliseconds of each step as JSON.
//
//   node scripts/benchmark-save.mjs <bc-atlas folder> <project> <file of the project> <saves>
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [tree, project, file, saves = "3"] = process.argv.slice(2);
const { Workspace } = await import(pathToFileURL(path.join(tree, "src", "app", "workspace.js")).href);
const original = readFileSync(file, "utf8");
const workspace = new Workspace(project, {}, { live: true });
const timed = async (step) => {
  const started = performance.now();
  await step();
  return Math.round(performance.now() - started);
};

const result = { open: await timed(() => workspace.atlas()), saves: [] };
try {
  for (let save = 1; save <= Number(saves); save++) {
    // A procedure more, as one types and saves.
    writeFileSync(file, original.replace(/\n\}\s*$/u, `\n    procedure Saved${save}()\n    begin\n    end;\n}\n`));
    workspace.reset();
    result.saves.push(await timed(() => workspace.atlas()));
  }
} finally {
  writeFileSync(file, original);
  await workspace.flush?.();
}
process.stdout.write(`${JSON.stringify(result)}\n`);
