// Regressions for the CodeQL findings: Markdown cell escaping and inputs that would make a
// backtracking regex slow.
import assert from "node:assert/strict";
import test from "node:test";
import { documentType } from "../src/sources/fact-snapshots.js";
import { kebabId, markdownCell } from "../src/util.js";

test("markdownCell escapes backslashes before pipes and flattens line breaks", () => {
  assert.equal(markdownCell("a|b"), "a\\|b");
  assert.equal(markdownCell("a\\|b"), "a\\\\\\|b");
  assert.equal(markdownCell("C:\\temp"), "C:\\\\temp");
  assert.equal(markdownCell("one\r\ntwo\nthree"), "one two three");
  assert.equal(markdownCell(undefined), "");
});

test("kebabId trims one hyphen per end and stays fast on hostile input", () => {
  assert.equal(kebabId("--Sales Order--"), "sales-order");
  assert.equal(kebabId("Post   Sales / Invoice"), "post-sales-invoice");
  assert.equal(kebabId("!!!"), "process");
  assert.equal(kebabId(`${"a".repeat(79)} b`), "a".repeat(79));
  const started = performance.now();
  kebabId(`${"-".repeat(100_000)}x${"-".repeat(100_000)}`);
  kebabId("-a".repeat(100_000));
  assert.ok(performance.now() - started < 1000, "kebabId must be linear");
});

test("documentType uses the last -S<no>- marker and stays fast on hostile input", () => {
  assert.deepEqual(documentType("Sales-Order-S3-Layered-Documentation.md"), { type: "layered", file: "layered.md" });
  assert.deepEqual(documentType("docs/Run-S2-Batch-S12-Json-Fact-Sheet.json"), { type: "facts", file: "facts.json" });
  assert.deepEqual(documentType("Order-S1-Custom-Report.TXT"), { type: "custom-report", file: "custom-report.txt" });
  assert.equal(documentType("Order-S1-.md"), undefined);
  assert.equal(documentType("Order-Layered.md"), undefined);
  assert.equal(documentType(".md"), undefined);
  assert.equal(documentType("Order-S1-Layered.m d"), undefined);
  const started = performance.now();
  documentType(`${"-S1".repeat(50_000)}.md`);
  documentType(`${"-S".repeat(100_000)}1.md`);
  assert.ok(performance.now() - started < 1000, "documentType must be linear");
});
