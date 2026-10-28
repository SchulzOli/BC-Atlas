// Tests run without Microsoft's AL toolchain unless a test opts in, so
// results do not depend on what is installed on the machine.
process.env.BCA_AL_COMPILER ??= "off";
