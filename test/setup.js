// The cache of parse results stays apart from the user's.
process.env.BCA_CACHE_DIR ??= (await import("node:path")).join((await import("node:os")).tmpdir(), "bc-atlas-test-cache");
// Parse results are shared between runs; nothing may write into them (src/analyzer.js, copyResult).
process.env.BCA_FREEZE_PARSE ??= "1";
