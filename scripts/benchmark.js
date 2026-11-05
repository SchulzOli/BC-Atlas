#!/usr/bin/env node
// Generates a synthetic AL app and times BC Atlas commands on it, cold
// (empty cache folder) and warm (second run with the same cache). Usage:
//
//   node scripts/benchmark.js [--modules 30] [--per-module 12] [--keep]
//     [--command "check" --command "export --view report"]
//
// Each module is a namespace and folder with tables, codeunits that read,
// write, and call across modules, pages, and an event subscriber, so the
// analysis, the resolver, and the diagrams see realistic coupling. The
// numbers vary by machine; compare runs on the same one.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    modules: { type: "string", default: "30" },
    "per-module": { type: "string", default: "12" },
    command: { type: "string", multiple: true },
    keep: { type: "boolean", default: false }
  }
});
const modules = Number(values.modules);
const perModule = Number(values["per-module"]);
const commands = values.command ?? ["check", "export --view report", "export --view project --format svg"];
const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));

/** One file per object, as AL projects usually are; IDs from 50000. */
function generate(root) {
  writeFileSync(path.join(root, "app.json"), JSON.stringify({
    id: "00000000-0000-0000-0000-0000000be4c4",
    name: "BC Atlas Benchmark",
    publisher: "BC Atlas contributors",
    version: "1.0.0.0",
    runtime: "13.0",
    dependencies: []
  }, null, 2));
  let id = 50000;
  let files = 0;
  const table = (m, i) => `"M${m} Table ${i}"`;
  const codeunit = (m, i) => `"M${m} Codeunit ${i}"`;
  for (let m = 0; m < modules; m++) {
    const folder = path.join(root, "src", `Module${m}`);
    mkdirSync(folder, { recursive: true });
    const namespace = `namespace BCA.Benchmark.Module${m};\n\n`;
    const usings = [...new Set([(m + 1) % modules, (m + 7) % modules])].filter((other) => other !== m)
      .map((other) => `using BCA.Benchmark.Module${other};\n`).join("");
    const tables = Math.max(1, Math.round(perModule * 0.4));
    const codeunits = Math.max(1, Math.round(perModule * 0.4));
    const pages = Math.max(1, perModule - tables - codeunits);
    for (let i = 0; i < tables; i++) {
      writeFileSync(path.join(folder, `Table${i}.Table.al`), `${namespace}table ${id++} ${table(m, i)}
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { }
        field(2; Description; Text[100]) { }
        field(3; Amount; Decimal) { }
        field(4; "Parent No."; Integer) { TableRelation = ${table(m, (i + 1) % tables)}."Entry No."; }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
    }
}
`);
      files++;
    }
    for (let i = 0; i < codeunits; i++) {
      const own = table(m, i % tables);
      const next = codeunit(m, (i + 1) % codeunits);
      const foreign = i === 0 ? codeunit((m + 1) % modules, 0) : null;
      writeFileSync(path.join(folder, `Codeunit${i}.Codeunit.al`), `${namespace}${usings}
codeunit ${id++} ${codeunit(m, i)}
{
    Permissions = tabledata ${own} = RIMD;

    procedure Run(EntryNo: Integer)
    var
        Rec: Record ${own};
        Next: Codeunit ${next};
${foreign ? `        Foreign: Codeunit ${foreign};\n` : ""}    begin
        if not Rec.Get(EntryNo) then begin
            Rec.Init();
            Rec."Entry No." := EntryNo;
            Rec.Insert(true);
        end;
        Rec.Amount += 1;
        Rec.Modify(true);
        OnAfterRun(EntryNo);
${i < codeunits - 1 ? "        Next.Run(EntryNo);\n" : ""}${foreign ? "        Foreign.Run(EntryNo);\n" : ""}    end;

    procedure Total(): Decimal
    var
        Rec: Record ${own};
    begin
        Rec.CalcSums(Amount);
        exit(Rec.Amount);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterRun(EntryNo: Integer)
    begin
    end;
}
`);
      files++;
    }
    writeFileSync(path.join(folder, "Subscriber.Codeunit.al"), `${namespace}
codeunit ${id++} "M${m} Subscriber"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::${codeunit(m, 0)}, 'OnAfterRun', '', false, false)]
    local procedure HandleAfterRun(EntryNo: Integer)
    var
        Rec: Record ${table(m, 0)};
    begin
        if Rec.Get(EntryNo) then
            Rec.Delete(true);
    end;
}
`);
    files++;
    for (let i = 0; i < pages; i++) {
      writeFileSync(path.join(folder, `Page${i}.Page.al`), `${namespace}
page ${id++} "M${m} Page ${i}"
{
    PageType = List;
    SourceTable = ${table(m, i % tables)};
    ApplicationArea = All;
    UsageCategory = Lists;

    layout
    {
        area(Content)
        {
            repeater(Lines)
            {
                field("Entry No."; Rec."Entry No.") { }
                field(Description; Rec.Description) { }
                field(Amount; Rec.Amount) { }
            }
        }
    }

    actions
    {
        area(Processing)
        {
            action(Run)
            {
                trigger OnAction()
                var
                    Worker: Codeunit ${codeunit(m, i % codeunits)};
                begin
                    Worker.Run(Rec."Entry No.");
                end;
            }
        }
    }
}
`);
      files++;
    }
  }
  return files;
}

function run(root, cache, command) {
  const output = path.join(root, "out");
  const args = command.split(" ");
  const withOutput = args[0] === "export" ? [...args, "--output", path.join(output, `${args.join("-").replace(/[^a-z0-9-]/giu, "")}.out`)] : args;
  const started = performance.now();
  const result = spawnSync(process.execPath, [cli, withOutput[0], root, ...withOutput.slice(1)], {
    encoding: "utf8",
    env: { ...process.env, BCA_CACHE_DIR: cache, CI: "1" },
    maxBuffer: 256 * 1024 * 1024
  });
  const ms = performance.now() - started;
  // `check` exits 1 when it finds errors; that still measures the run.
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`bca ${command} failed (${result.status}):\n${result.stderr}`);
  }
  return ms;
}

const root = mkdtempSync(path.join(os.tmpdir(), "bca-benchmark-"));
const cache = path.join(root, ".cache");
try {
  const files = generate(root);
  console.log(`Synthetic app: ${modules} modules, ${files} AL files in ${root}`);
  console.log(`Node ${process.version}, ${os.cpus().length} CPUs\n`);
  console.log("| Command | Cold | Warm |");
  console.log("|---|---:|---:|");
  for (const command of commands) {
    rmSync(cache, { recursive: true, force: true });
    const cold = run(root, cache, command);
    const warm = run(root, cache, command);
    console.log(`| \`bca ${command}\` | ${Math.round(cold)} ms | ${Math.round(warm)} ms |`);
  }
} finally {
  if (!values.keep) rmSync(root, { recursive: true, force: true });
}
