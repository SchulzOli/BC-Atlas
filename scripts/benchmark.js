#!/usr/bin/env node
// Times BC Atlas on a synthetic AL app, and catches regressions. Usage:
//
//   node scripts/benchmark.js [--modules 40] [--per-module 15] [--repeat 3]
//     [--tree <BC Atlas folder>] [--json <file>] [--command "check" ...]
//   node scripts/benchmark.js --compare <base.json> <head.json>
//
// Each module is a namespace and folder with tables, codeunits that read,
// write, and call across modules, pages, and an event subscriber, so the
// analysis, the resolver, and the view see realistic coupling.
//
// Every command runs once with an empty cache (cold) and --repeat times with
// a warm one; the median of the warm runs counts, with the peak memory of the
// process. "save" is the loop of the editor (scripts/benchmark-save.mjs): one
// file saved, the view updated. --tree measures another checkout of BC Atlas
// on the same app, so CI can compare a pull request with its base on one
// machine; --compare fails (exit code 1) when the second is clearly slower or
// larger. Numbers vary by machine; compare runs on the same one.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    modules: { type: "string", default: "40" },
    "per-module": { type: "string", default: "15" },
    repeat: { type: "string", default: "3" },
    command: { type: "string", multiple: true },
    tree: { type: "string" },
    json: { type: "string" },
    compare: { type: "boolean", default: false },
    keep: { type: "boolean", default: false }
  }
});

// A regression: slower by more than both of these, or larger by more than both of these.
const SLOWER = { ratio: 1.25, ms: 150 };
const LARGER = { ratio: 1.2, mb: 40 };

if (values.compare) process.exit(compare(...positionals));

const modules = Number(values.modules);
const perModule = Number(values["per-module"]);
const repeat = Number(values.repeat);
const commands = values.command ?? ["check", "layers", "export", "save"];
const here = path.dirname(fileURLToPath(import.meta.url));
const tree = path.resolve(values.tree ?? path.join(here, ".."));
const cli = path.join(tree, "src", "cli.js");
const rssPreload = path.join(here, "benchmark-rss.mjs");

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

const median = (numbers) => [...numbers].sort((a, b) => a - b)[Math.floor(numbers.length / 2)];

/** Runs a node script with the peak-memory hook; returns { ms, mb, stdout }. */
function measure(args, env) {
  const rss = path.join(os.tmpdir(), `bca-benchmark-rss-${process.pid}`);
  const started = performance.now();
  const result = spawnSync(process.execPath, ["--import", rssPreload, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env, BCA_BENCHMARK_RSS: rss, CI: "1" },
    maxBuffer: 256 * 1024 * 1024
  });
  const ms = performance.now() - started;
  // `check` exits 1 when it finds errors; that still measures the run.
  if (result.status !== 0 && result.status !== 1) throw new Error(`${args.join(" ")} failed (${result.status}):\n${result.stderr}`);
  const mb = Number(readFileSync(rss, "utf8")) / 1024;
  rmSync(rss, { force: true });
  return { ms, mb, stdout: result.stdout };
}

function bca(root, cache, command) {
  const [name, ...rest] = command.split(" ");
  const output = path.join(root, "out", name);
  const args = name === "export" ? [...rest, "--output", `${output}.html`] : name === "layers" ? [...rest, "--output", output] : rest;
  return measure([cli, name, root, ...args], { BCA_CACHE_DIR: cache });
}

/** The editor loop: the median time from a save to the updated view. */
function save(root, cache) {
  const file = path.join(root, "src", "Module0", "Codeunit0.Codeunit.al");
  const run = measure([path.join(here, "benchmark-save.mjs"), tree, root, file, String(repeat)], { BCA_CACHE_DIR: cache });
  const steps = JSON.parse(run.stdout);
  return { cold: steps.open, warm: median(steps.saves), mb: run.mb };
}

function benchmark() {
  const root = mkdtempSync(path.join(os.tmpdir(), "bca-benchmark-"));
  const cache = path.join(root, ".cache");
  try {
    const files = generate(root);
    console.log(`Synthetic app: ${modules} modules, ${files} AL files; BC Atlas in ${tree}`);
    console.log(`Node ${process.version}, ${os.cpus().length} CPUs\n`);
    console.log("| Command | Cold | Warm (median) | Peak memory |");
    console.log("|---|---:|---:|---:|");
    const results = { files, node: process.version, commands: {} };
    for (const command of commands) {
      rmSync(cache, { recursive: true, force: true });
      let result;
      if (command === "save") {
        bca(root, cache, "check");
        result = save(root, cache);
      } else {
        const cold = bca(root, cache, command);
        const warm = Array.from({ length: repeat }, () => bca(root, cache, command));
        result = { cold: cold.ms, warm: median(warm.map(({ ms }) => ms)), mb: Math.max(cold.mb, ...warm.map(({ mb }) => mb)) };
      }
      result = { cold: Math.round(result.cold), warm: Math.round(result.warm), mb: Math.round(result.mb) };
      results.commands[command] = result;
      console.log(`| \`${command === "save" ? "a save, until the view is updated" : `bca ${command}`}\` | ${result.cold} ms | ${result.warm} ms | ${result.mb} MB |`);
    }
    if (values.json) writeFileSync(values.json, `${JSON.stringify(results, null, 2)}\n`);
  } finally {
    if (!values.keep) rmSync(root, { recursive: true, force: true });
  }
}

/** Compares two results of --json; returns the exit code. */
function compare(baseFile, headFile) {
  const base = JSON.parse(readFileSync(baseFile, "utf8"));
  const head = JSON.parse(readFileSync(headFile, "utf8"));
  const regressions = [];
  console.log(`| Command | Warm, base | Warm, this | Peak, base | Peak, this |`);
  console.log("|---|---:|---:|---:|---:|");
  for (const [command, now] of Object.entries(head.commands)) {
    const before = base.commands[command];
    if (!before) continue;
    const slower = now.warm > before.warm * SLOWER.ratio && now.warm - before.warm > SLOWER.ms;
    const larger = now.mb > before.mb * LARGER.ratio && now.mb - before.mb > LARGER.mb;
    if (slower) regressions.push(`${command}: ${before.warm} ms -> ${now.warm} ms`);
    if (larger) regressions.push(`${command}: ${before.mb} MB -> ${now.mb} MB`);
    console.log(`| ${command} | ${before.warm} ms | ${now.warm} ms${slower ? " (slower)" : ""} | ${before.mb} MB | ${now.mb} MB${larger ? " (larger)" : ""} |`);
  }
  if (!regressions.length) {
    console.log("\nNo regression.");
    return 0;
  }
  console.error(`\nRegression (slower than ${SLOWER.ratio}x and ${SLOWER.ms} ms, or larger than ${LARGER.ratio}x and ${LARGER.mb} MB):\n${regressions.map((line) => `  ${line}`).join("\n")}`);
  return 1;
}

benchmark();
