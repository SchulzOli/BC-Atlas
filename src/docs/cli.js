import path from "node:path";
import { parseArgs } from "node:util";
import { writeDocumentation } from "./markdown.js";
import { loadAlUiTest } from "./al-ui-source.js";

const HELP = `BC Atlas docs - generate Markdown from an AL UI test

Usage:
  bca docs generate [options] <ui-test.al>

Options:
      --procedure <name>     [Test] procedure to document
      --output-dir <path>    Markdown output directory (default: docs/generated)
  -h, --help                 Show help
`;

const OPTIONS = {
  procedure: { type: "string" },
  "output-dir": { type: "string" },
  help: { type: "boolean", short: "h" }
};

export async function docsMain(args) {
  if (args[0] === "--help" || args[0] === "-h") return console.log(HELP);
  const command = args[0];
  const { values, positionals } = parseArgs({
    args: args.slice(1),
    allowPositionals: true,
    strict: true,
    options: OPTIONS
  });
  if (values.help || !command) return console.log(HELP);
  if (command !== "generate") throw new Error(`unknown docs command: ${command}`);
  if (positionals.length !== 1) {
    throw new Error("docs generate expects one AL UI-test file");
  }

  const source = await loadAlUiTest(positionals[0], {
    procedure: values.procedure
  });
  const filename = await writeDocumentation(source, values["output-dir"]);
  console.log(`wrote ${path.relative(process.cwd(), filename).replaceAll("\\", "/")}`);
}

export { HELP as DOCS_HELP };
