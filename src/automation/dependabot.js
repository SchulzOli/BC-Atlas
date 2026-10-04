// Adds a Dependabot entry so new bc-atlas (and Husky) versions arrive as pull
// requests. Without a YAML parser, an existing file is only extended when the
// change is unambiguous; anything else is left to the user.
import { GENERATED_MARKER } from "./pipelines.js";

const ENTRY = [
  "  - package-ecosystem: npm",
  "    directory: \"/\"",
  "    schedule:",
  "      interval: weekly",
  "    allow:",
  "      - dependency-name: bc-atlas",
  "      - dependency-name: husky",
  "    commit-message:",
  "      prefix: \"chore(deps)\""
];

export function mergeDependabot(existing) {
  if (existing === undefined) {
    return {
      content: [`# ${GENERATED_MARKER}: proposes BC Atlas updates as pull requests.`, "version: 2", "updates:", ...ENTRY, ""].join("\n")
    };
  }
  if (/dependency-name:\s*["']?bc-atlas/u.test(existing)) {
    return { skip: true, unchanged: true, reason: "already proposes bc-atlas updates" };
  }
  if (/package-ecosystem:\s*["']?npm/u.test(existing)) {
    return { skip: true, reason: "has an npm entry; it already covers bc-atlas unless an allow list excludes it" };
  }
  const lines = existing.replace(/\s+$/u, "").split("\n");
  const topLevel = lines.filter((line) => /^[A-Za-z]/u.test(line));
  if (!/^updates:\s*$/u.test(topLevel.at(-1) ?? "")) {
    return { skip: true, reason: "could not find the updates list; add an npm entry for bc-atlas by hand" };
  }
  return { content: `${[...lines, ...ENTRY].join("\n")}\n` };
}
