// Loaded with `node --import` by scripts/benchmark.js: when the process ends,
// it writes its peak memory (resident set size, in kilobytes) to the file
// BCA_BENCHMARK_RSS names.
import { writeFileSync } from "node:fs";

process.on("exit", () => {
  if (process.env.BCA_BENCHMARK_RSS) writeFileSync(process.env.BCA_BENCHMARK_RSS, String(process.resourceUsage().maxRSS));
});
