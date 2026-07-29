import { defineConfig } from "@playwright/test";
import path from "node:path";

export default defineConfig({
  testDir: process.env.BC_DOCS_TEST_DIR ?? path.resolve("docs-tests"),
  outputDir: process.env.BC_DOCS_RESULTS ?? path.resolve("test-results/docs"),
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["./src/docs/reporter.js", {
      outputDir: process.env.BC_DOCS_OUTPUT ?? "docs/generated"
    }]
  ],
  use: {
    channel: process.env.BC_DOCS_BROWSER ?? "msedge",
    headless: true,
    ignoreHTTPSErrors: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  }
});
