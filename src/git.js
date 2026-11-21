import fs from "node:fs/promises";
import path from "node:path";

export async function findGitRoot(start) {
  let directory = path.resolve(start);
  for (;;) {
    const marker = await fs.stat(path.join(directory, ".git")).catch(() => undefined);
    if (marker) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}
