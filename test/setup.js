// Tests run without Microsoft's AL toolchain unless a test opts in, so
// results do not depend on what is installed on the machine.
process.env.BCA_AL_COMPILER ??= "off";
// Caches (parse results, AL compiler results) stay apart from the user's.
process.env.BCA_CACHE_DIR ??= (await import("node:path")).join((await import("node:os")).tmpdir(), "bc-atlas-test-cache");
