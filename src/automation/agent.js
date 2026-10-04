// Agent-guided setup. BC Atlas does not talk to an AI service itself; it
// writes a setup command for the agent the user already works with. The agent
// asks the questions from `bca setup plan` and applies the answers through
// `bca setup apply`, so every change goes through the validated CLI.

export const AGENTS = Object.freeze({
  claude: { file: ".claude/commands/bca-setup.md", label: "Claude Code (/bca-setup)" },
  copilot: { file: ".github/prompts/bca-setup.prompt.md", label: "GitHub Copilot in VS Code (/bca-setup)" },
  cursor: { file: ".cursor/commands/bca-setup.md", label: "Cursor (/bca-setup)" },
  generic: { file: undefined, label: "Any agent: paste the printed prompt" }
});

export function agentGuide({ version, appPath = "." }) {
  const bca = `bca (or npx --yes bc-atlas@${version} when bca is not installed)`;
  return `# Set up BC Atlas

You help the user set up BC Atlas for the Business Central AL project in \`${appPath}\`.
Use the BC Atlas CLI, ${bca}, for every step. Do not write .bca.json, Git hooks,
or pipeline files by hand.

## 1. Inspect

Run \`bca setup plan ${appPath} --format json\`. Read \`facts\` (app, Git host,
UI tests, translations, existing hooks and pipelines) and \`questions\`.

## 2. Ask

Summarize in two or three sentences what BC Atlas found. Then ask the
questions in this order, one topic at a time, and always offer the
\`recommended\` answer as the default:

1. Features: which BC Atlas features to automate (check, report, docs, codegraph).
2. Documentation (only if docs is chosen): UI-test folder, formats, guide or test case, language.
3. Git hooks: Husky, plain Git hooks, or none; what runs before commit and before push; how generated files stay in sync.
4. Pipeline: GitHub Actions, Azure Pipelines, or none; what pull requests do with generated files.
5. Schedule: a cron expression (UTC) or none, and what a scheduled run does with regenerated files.

Explain trade-offs briefly when the user is unsure, using the option
descriptions from the plan. Skip questions whose \`when\` condition does not apply.

## 3. Preview

Build the command from \`apply\` in the plan and replace values with the
user's answers. Each question names its \`flag\`; lists are comma-separated and
\`none\` means empty. Run it with \`--dry-run --format json\` and show the user
which files will be created or updated.

## 4. Apply

After the user confirms, run the same command without \`--dry-run\`. Then
follow \`nextSteps\` from the result: for example \`npm install\` for Husky and a
first \`bca run\`. Report what ran and what changed.

## Rules

- Pass each CLI argument separately; check the exit code before reading output.
- Exit code 2 means a wrong option: read the message and correct the command.
- Never commit or push without asking the user.
- To change the setup later, run \`bca setup plan\` again; it reads the current .bca.json.
`;
}

export function agentFile(agent, options) {
  const guide = agentGuide(options);
  if (agent === "copilot") {
    return `---\nmode: agent\ndescription: Set up BC Atlas automation with the bca CLI\n---\n\n${guide}`;
  }
  if (agent === "claude") {
    return `---\ndescription: Set up BC Atlas automation with the bca CLI\n---\n\n${guide}`;
  }
  return guide;
}
