# AL toolchain: compiler, analyzers, and AL settings

BC Atlas works with Microsoft's AL toolchain. When the AL compiler is
installed, BC Atlas uses it wherever the compiler knows better than a
source-level analysis, and keeps its own analysis as the fallback:

| What | With the AL compiler | Without it |
| --- | --- | --- |
| Calls (call and workflow views, explorer, dependencies) | The compiler's call graph: overloads, variables, interfaces, and built-in methods resolved exactly | Resolved by name and number of arguments |
| Built-in methods (`Rec.FindFirst`, `Message`, `TestPage` methods) | Recognized as platform calls, not unresolved references | Listed as unresolved calls |
| Syntax | Compiler errors (`AL0xxx`) | tree-sitter parse errors |
| Diagnostics in `bca check` | Compiler errors and warnings plus CodeCop, UICop, AppSourceCop, and PerTenantExtensionCop findings | BC Atlas rules only |
| Symbols | `.alpackages` and every `al.packageCachePath` | The same |

BC Atlas compiles a copy of the workspace in a temporary folder, so `alc` never
writes report layouts, translation files, or `.app` files into the repository.
Results are cached until a file, setting, or symbol package changes.

## Which AL compiler BC Atlas uses

`al.compiler` in `.bca.json`, `--compiler`, or the VS Code setting
`bcAtlas.alCompiler`:

| Value | Meaning |
| --- | --- |
| `auto` (default) | The AL Language extension VS Code runs, else the newest installed one (`ms-dynamics-smb.al-*` in `~/.vscode`, `~/.vscode-insiders`, `~/.vscode-server`, `~/.cursor`), else the AL Development Tools (`al` from `dotnet tool install --global Microsoft.Dynamics.BusinessCentral.Development.Tools`). Nothing installed: the source-level analysis. |
| `off` | Never use the AL toolchain. |
| a path | `alc`, `alc.exe`, `alc.dll`, `al`, `altool`, or an AL Language extension folder. |

`BCA_AL_COMPILER` overrides all of them, for example `BCA_AL_COMPILER=off` in
a job without .NET.

Both layouts of the AL Language extension work: `bin/alc` with the analyzers
next to it (2026 release wave 2 and later), and `bin/<platform>/alc` with
`bin/Analyzers` (earlier versions). The call graph needs ALTool with the
`graph` command (AL Development Tools or the AL Language extension, 2026
release wave 2 or later); with an older compiler, BC Atlas still uses its
diagnostics.

Check what BC Atlas found: the `AL compiler` line of `bca check`, or the BC
Atlas output channel in VS Code.

```text
$ bca check ./app --analyzers CodeCop
  ...
  AL compiler    AL Development Tools (.NET tool) 18.1.43.24897: 1 project(s) compiled; 6 call(s) resolved by the compiler; 11 compiler diagnostic(s)

Findings
  WARN   AA0137: Variable 'WarehouseRequest' is unused in 'ValidateRequest'. (Inventory.al:51)
  ...
```

## AL settings BC Atlas reads

BC Atlas reads an AL workspace the way the AL Language extension does:
`app.json` per project, `.vscode/settings.json` per project folder, and the
`folders` and `settings` of a `.code-workspace` file at the analyzed root
(`al.workspaceFile` picks one when there are several). Folder settings win over
workspace settings; relative paths resolve against the project folder. In VS
Code, BC Atlas uses the effective `al.*` settings of the editor.

| Setting | Used for |
| --- | --- |
| `al.packageCachePath` | Symbol packages (string or list); default `.alpackages` |
| `al.enableCodeAnalysis`, `al.codeAnalyzers` | Analyzers for the compile: `${CodeCop}`, `${UICop}`, `${AppSourceCop}`, `${PerTenantExtensionCop}`, `${AnalyzerFolder}/Custom.dll` |
| `al.ruleSetPath` | The rule set passed to the compiler |
| `al.assemblyProbingPaths` | .NET assemblies referenced from AL |

`--analyzers CodeCop,UICop` (or `al.analyzers` in `.bca.json`) chooses
analyzers for BC Atlas only, regardless of `al.enableCodeAnalysis`.

Projects compile in dependency order; each project's `.app` becomes a symbol
package for the projects that depend on it, so a multi-app workspace needs
only the Microsoft symbols (**AL: Download Symbols**). Missing Microsoft
symbols show up as compiler errors such as `AL0185: Table 'Customer' is
missing`.

## Import an error log instead of compiling

A pipeline that already builds the app (AL-Go, BcContainerHelper, `al
workspace compile --errorlogdirectory`, or `alc /errorlog:<file>`) writes AL
error logs. `bca check` reads them without a compiler on the machine:

```sh
bca check ./app --compiler off --compiler-log .output/errorlogs
```

`--compiler-log` (or `al.errorLog` in `.bca.json`) takes a file or a folder of
`*.json` logs. File paths in the log are matched to the analyzed project.

## Code scanning (SARIF)

`--format sarif` writes SARIF 2.1.0 with BC Atlas findings and AL compiler and
analyzer findings, their rules and help links:

```yaml
- run: npx --yes bc-atlas check app --format sarif -o bca.sarif --fail-on never
- uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: bca.sarif
```

In Azure DevOps, publish `bca.sarif` as a build artifact named `CodeAnalysisLogs`
for the SARIF SAST Scans tab.

## In VS Code

The BC Atlas extension uses the compiler of the AL Language extension and the
editor's `al.*` settings. The compile runs in the background after each change;
the BC Atlas panel shows the last results at once and refreshes when the
compiler is done. Data for a file that changed since it was compiled falls back
to the source-level analysis until the next compile, so nothing is ever out of
step with the code.

- Downloaded symbols, built apps (`*.app`), and changed `al.*` settings trigger
  a new analysis.
- Compiler and analyzer findings are shown on the Health page; in the Problems
  panel they are left to the AL Language extension, which reports them itself.
- `bcAtlas.alCompiler` (`auto`, `off`, or a path) and `bcAtlas.alAnalyzers`
  configure it.

## In pipelines

`bca setup` adds a step that installs the AL Development Tools to the GitHub
Actions workflow or Azure Pipeline it generates, so CI resolves calls and runs
analyzers like a developer machine. Set `"al": { "compiler": "off" }` in
`.bca.json` to leave it out. The BC Atlas GitHub Action installs them unless
`al-compiler: false`.

Git hooks: `bca run --trigger pre-commit` leaves the compiler out so commits
stay fast, unless `al.compiler` is set in `.bca.json`; the pre-push hook,
pipelines, and schedules use it.

On Linux and macOS the AL Development Tools need the .NET 8 runtime or later.
GitHub-hosted and Microsoft-hosted Linux agents have it.
