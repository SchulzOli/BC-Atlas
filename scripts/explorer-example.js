// Builds the dependency explorer sample: the multi-app workspace in
// examples/multi-app is committed step by step into a temporary Git
// repository, so `--history` has a story to replay (apps added on top of each
// other, a legacy object removed, an undeclared app dependency introduced).
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createGraphDocument } from "../src/graph/document.js";

const LEGACY_PRICING = `namespace Contoso.Core.Pricing;

using Contoso.Core.Items;

codeunit 50019 "CON Legacy Pricing"
{
    procedure Price(ItemNo: Code[20]): Decimal
    var
        Item: Record "CON Item";
    begin
        Item.Get(ItemNo);
        exit(Item."Unit Price");
    end;
}
`;

const STEPS = [
  ["2026-01-12T09:00:00Z", "Core: items, price groups, and pricing", (copy) => {
    copy(".bca.json");
    copy("core");
  }],
  ["2026-02-02T09:00:00Z", "Core: legacy pricing for imported items", (_copy, write) => write("core/Legacy.al", LEGACY_PRICING)],
  ["2026-03-09T09:00:00Z", "Sales: quotes priced through Contoso Core", (copy) => copy("sales")],
  ["2026-04-13T09:00:00Z", "Integration: export quotes", (copy) => {
    copy("integration/app.json");
    copy("integration/Export.al");
  }],
  ["2026-05-18T09:00:00Z", "Integration: item sync; remove legacy pricing", (copy, _write, remove) => {
    copy("integration/ItemSync.al");
    remove("core/Legacy.al");
  }]
];

export async function createExplorerExample(root) {
  const source = path.join(root, "examples", "multi-app");
  const directory = mkdtempSync(path.join(os.tmpdir(), "bca-explorer-example-"));
  const project = path.join(directory, "contoso-workspace");
  const git = (args, date) => {
    const result = spawnSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Contoso Developer",
        GIT_AUTHOR_EMAIL: "dev@contoso.example",
        GIT_COMMITTER_NAME: "Contoso Developer",
        GIT_COMMITTER_EMAIL: "dev@contoso.example",
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_DATE: date
      }
    });
    if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr}`);
  };
  try {
    mkdirSync(project);
    git(["init", "-q"]);
    git(["config", "commit.gpgsign", "false"]);
    const copy = (relative) => cpSync(path.join(source, relative), path.join(project, relative), { recursive: true });
    const write = (relative, content) => writeFileSync(path.join(project, relative), content);
    const remove = (relative) => rmSync(path.join(project, relative));
    for (const [date, message, apply] of STEPS) {
      mkdirSync(path.join(project, "integration"), { recursive: true });
      apply(copy, write, remove);
      git(["add", "-A"], date);
      git(["commit", "-q", "-m", message], date);
    }
    return await createGraphDocument(project, { history: true, title: "Contoso workspace: dependencies" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
