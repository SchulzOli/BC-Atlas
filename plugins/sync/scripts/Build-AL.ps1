<#
.SYNOPSIS
  Reproducible build of the BC Atlas Sync AL apps (al/app + al/test) with a version build snapshot.

.DESCRIPTION
  1. Finds the AL compiler of the installed VS Code AL extension (or -AlcPath).
  2. Ensures the Business Central symbol packages in al/app/.alpackages. Missing packages are
     downloaded from Microsoft's public symbols feed (MSSymbols) in the requested versions.
  3. Compiles al/app/ and al/test/ with CodeCop, UICop and PerTenantExtensionCop.
  4. Writes build/version-snapshot.json and build/version-snapshot.md: compiler version,
     symbol packages (version + SHA-256), source fingerprints (per file and aggregate),
     analyzer diagnostics per rule and the SHA-256 of each built .app.
  Two builds with equal source and symbol fingerprints are the same build; the snapshot
  is what you keep next to a release to recreate it.

.EXAMPLE
  pwsh ./scripts/Build-AL.ps1
  pwsh ./scripts/Build-AL.ps1 -SymbolVersion 26.5 -PlatformVersion 26.0 -SkipTests
#>
[CmdletBinding()]
param(
    [string] $SymbolVersion = '26.5',
    [string] $PlatformVersion = '26.0',
    [string] $AlcPath,
    [switch] $SkipTests,
    [switch] $NoDownload
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$AppDir = Join-Path $Root (Join-Path 'al' 'app')
$TestDir = Join-Path $Root (Join-Path 'al' 'test')
$OutDir = Join-Path $Root 'build'
$Feed = 'https://dynamicssmb2.pkgs.visualstudio.com/571e802d-b44b-45fc-bd41-4cfddec73b44/_packaging/b656b10c-3de0-440c-900c-bc2e4e86d84c/nuget/v3/flat2/'
$SymbolPackages = [ordered]@{
    'microsoft.application.symbols'                                            = $SymbolVersion
    'microsoft.baseapplication.symbols.437dbf0e-84ff-417a-965d-ed2bb9650972'   = $SymbolVersion
    'microsoft.systemapplication.symbols.63ca2fa4-4f03-4f2b-a480-172fef340d3f' = $SymbolVersion
    'microsoft.businessfoundation.symbols.f3552374-a1f2-4356-848e-196002525837' = $SymbolVersion
    'microsoft.platform.symbols'                                               = $PlatformVersion
}

function Find-Alc {
    if ($AlcPath) { return (Resolve-Path $AlcPath).Path }
    $ext = Get-ChildItem (Join-Path $HOME '.vscode/extensions') -Directory -Filter 'ms-dynamics-smb.al-*' -ErrorAction SilentlyContinue |
        Sort-Object { [version](($_.Name -replace '^ms-dynamics-smb\.al-', '') -replace '[^0-9.].*$', '') } | Select-Object -Last 1
    if (-not $ext) { throw 'AL extension not found. Install the AL Language extension or pass -AlcPath.' }
    $alc = Get-ChildItem $ext.FullName -Recurse -Filter 'alc.exe' | Select-Object -First 1
    if (-not $alc) { $alc = Get-ChildItem $ext.FullName -Recurse -Filter 'alc' | Select-Object -First 1 }
    return $alc.FullName
}

function Get-Analyzers([string] $alc) {
    $bin = Split-Path -Parent $alc
    $names = 'Microsoft.Dynamics.Nav.CodeCop.dll', 'Microsoft.Dynamics.Nav.UICop.dll', 'Microsoft.Dynamics.Nav.PerTenantExtensionCop.dll'
    foreach ($n in $names) {
        $f = Get-ChildItem (Split-Path -Parent $bin) -Recurse -Filter $n | Select-Object -First 1
        if ($f) { "/analyzer:$($f.FullName)" }
    }
}

function Sync-Symbols([string] $packageDir) {
    New-Item -ItemType Directory -Force $packageDir | Out-Null
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    foreach ($id in $SymbolPackages.Keys) {
        $prefix = $SymbolPackages[$id] + '.'
        $short = ($id -replace '^microsoft\.', '' -replace '\.symbols.*$', '')
        $present = Get-ChildItem $packageDir -Filter '*.app' | Where-Object {
            ($short -eq 'platform' -and $_.Name -eq 'System.app') -or
            ($_.Name -replace '[ _]', '' -match "^Microsoft$([regex]::Escape($short))$([regex]::Escape($SymbolPackages[$id]))" )
        }
        if ($present) { continue }
        if ($NoDownload) { throw "Symbol package $id $($SymbolPackages[$id]) missing and -NoDownload set." }
        $versions = (Invoke-RestMethod "$Feed$id/index.json").versions | Where-Object { $_.StartsWith($prefix) }
        $version = $versions | Sort-Object { [version]$_ } | Select-Object -Last 1
        if (-not $version) { throw "No version $($SymbolPackages[$id]).x of $id on the feed." }
        $tmp = Join-Path ([IO.Path]::GetTempPath()) "$id.$version.nupkg"
        Write-Host "Downloading $id $version"
        Invoke-WebRequest "$Feed$id/$version/$id.$version.nupkg" -OutFile $tmp
        $zip = [IO.Compression.ZipFile]::OpenRead($tmp)
        try {
            $zip.Entries | Where-Object { $_.Name -like '*.app' } | ForEach-Object {
                [IO.Compression.ZipFileExtensions]::ExtractToFile($_, (Join-Path $packageDir $_.Name), $true)
            }
        } finally { $zip.Dispose() }
        Remove-Item $tmp
    }
}

function Get-SourceFingerprint([string] $dir) {
    $files = Get-ChildItem $dir -Recurse -File -Include '*.al', 'app.json' |
        Where-Object { $_.FullName -notmatch '[\\/]\.alpackages[\\/]' } |
        Sort-Object { $_.FullName.Substring($dir.Length).Replace('\', '/') }
    $lines = foreach ($f in $files) {
        $rel = $f.FullName.Substring($dir.Length + 1).Replace('\', '/')
        # Normalise line endings so the fingerprint does not depend on git autocrlf.
        $text = [IO.File]::ReadAllText($f.FullName).Replace("`r`n", "`n")
        $hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($text))).ToLower()
        [pscustomobject]@{ path = $rel; sha256 = $hash }
    }
    $aggregate = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData(
            [Text.Encoding]::UTF8.GetBytes((($lines | ForEach-Object { "$($_.path):$($_.sha256)" }) -join "`n")))).ToLower()
    [pscustomobject]@{ files = $lines.Count; sha256 = $aggregate; perFile = $lines }
}

function Invoke-Compile([string] $alc, [string] $projectDir, [string] $packageDir, [string[]] $analyzers) {
    $manifest = Get-Content (Join-Path $projectDir 'app.json') -Raw | ConvertFrom-Json
    New-Item -ItemType Directory -Force $OutDir | Out-Null
    $outFile = Join-Path $OutDir ("{0}_{1}_{2}.app" -f $manifest.publisher, $manifest.name, $manifest.version)
    $log = & $alc "/project:$projectDir" "/packagecachepath:$packageDir" "/out:$outFile" @analyzers 2>&1 | ForEach-Object { "$_" }
    $exit = $LASTEXITCODE
    $diagnostics = $log | Where-Object { $_ -match ': (error|warning|info) (\w+):' } | ForEach-Object {
        $m = [regex]::Match($_, ': (error|warning|info) (\w+): (.*)$')
        [pscustomobject]@{ severity = $m.Groups[1].Value; rule = $m.Groups[2].Value; line = $_.Replace($projectDir, '.') }
    }
    $byRule = [ordered]@{}
    $diagnostics | Group-Object rule | Sort-Object Name | ForEach-Object { $byRule[$_.Name] = $_.Count }
    $result = [pscustomobject]@{
        name        = $manifest.name
        id          = $manifest.id
        version     = $manifest.version
        file        = if (Test-Path $outFile) { Split-Path -Leaf $outFile } else { $null }
        sha256      = if (Test-Path $outFile) { (Get-FileHash $outFile -Algorithm SHA256).Hash.ToLower() } else { $null }
        succeeded   = ($exit -eq 0)
        errors      = @($diagnostics | Where-Object severity -eq 'error').Count
        warnings    = @($diagnostics | Where-Object severity -eq 'warning').Count
        infos       = @($diagnostics | Where-Object severity -eq 'info').Count
        byRule      = $byRule
        problems    = @($diagnostics | Where-Object { $_.severity -ne 'info' } | ForEach-Object line)
        source      = Get-SourceFingerprint $projectDir
    }
    Write-Host ("{0}: {1} ({2} errors, {3} warnings, {4} info)" -f $manifest.name, ($(if ($result.succeeded) { 'OK' } else { 'FAILED' })), $result.errors, $result.warnings, $result.infos)
    $result.problems | ForEach-Object { Write-Host "  $_" }
    return $result
}

# ------------------------------------------------------------------ build
$alc = Find-Alc
$compilerVersion = ((& $alc 2>&1 | Select-Object -First 1) -replace '^.*version\s+', '').Trim()
$analyzers = @(Get-Analyzers $alc)
$appPackages = Join-Path $AppDir '.alpackages'
Sync-Symbols $appPackages

$apps = @(Invoke-Compile $alc $AppDir $appPackages $analyzers)
if (-not $SkipTests -and $apps[0].succeeded) {
    $testPackages = Join-Path $TestDir '.alpackages'
    New-Item -ItemType Directory -Force $testPackages | Out-Null
    # Drop copies of earlier builds of the main app (e.g. under a former app name) so only one app with its id is in the cache.
    Get-ChildItem $testPackages -Filter "$($apps[0].file.Split('_')[0])_*.app" | Remove-Item -Force
    Copy-Item (Join-Path $appPackages '*.app') $testPackages -Force
    Copy-Item (Join-Path $OutDir $apps[0].file) $testPackages -Force
    $apps += Invoke-Compile $alc $TestDir $testPackages $analyzers
}

# ------------------------------------------------------------------ version build snapshot
$symbols = Get-ChildItem $appPackages -Filter '*.app' | Sort-Object Name | ForEach-Object {
    [pscustomobject]@{ file = $_.Name; bytes = $_.Length; sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower() }
}
$docTypes = Select-String -Path (Join-Path $AppDir 'src/Docs/BASDocType.Enum.al') -Pattern 'value\((\d+); "([^"]+)"\)' |
    ForEach-Object { $_.Matches[0].Groups[2].Value }
$snapshot = [ordered]@{
    schema         = 'bc-atlas-sync.version-build-snapshot/1'
    builtAt        = (Get-Date).ToUniversalTime().ToString('o')
    compiler       = [ordered]@{ name = 'AL Compiler (alc)'; version = $compilerVersion; analyzers = @($analyzers | ForEach-Object { Split-Path -Leaf ($_ -replace '^/analyzer:', '') }) }
    requested      = [ordered]@{ symbolVersion = $SymbolVersion; platformVersion = $PlatformVersion; feed = 'MSSymbols (dynamicssmb2 DynamicsBCPublicFeeds)' }
    symbols        = $symbols
    apps           = $apps
    documentation  = [ordered]@{ types = $docTypes }
    tools          = [ordered]@{ node = (& node --version 2>$null); powershell = $PSVersionTable.PSVersion.ToString() }
    reproduce      = @(
        "pwsh ./scripts/Build-AL.ps1 -SymbolVersion $SymbolVersion -PlatformVersion $PlatformVersion",
        'Publish build/*.app to a sandbox (app first, then tests); Atlas Sync Recordings > Create Demo Data',
        'Atlas Sync Self-Test > Run All Tests',
        'cd e2e; npm install; npx playwright install chromium; npm run login; npm run video'
    )
}
$jsonPath = Join-Path $OutDir 'version-snapshot.json'
$snapshot | ConvertTo-Json -Depth 8 | Set-Content $jsonPath -Encoding utf8

$md = [System.Collections.Generic.List[string]]::new()
$md.Add('# BC Atlas Sync - version build snapshot')
$md.Add('')
$md.Add("Built $($snapshot.builtAt) with AL compiler $compilerVersion against Business Central symbols $SymbolVersion (platform $PlatformVersion).")
$md.Add('')
$md.Add('| App | Version | Result | Errors | Warnings | Info | Source fingerprint | .app SHA-256 |')
$md.Add('|---|---|---|---:|---:|---:|---|---|')
foreach ($a in $apps) {
    $md.Add("| $($a.name) | $($a.version) | $(if ($a.succeeded) { 'compiled' } else { 'FAILED' }) | $($a.errors) | $($a.warnings) | $($a.infos) | ``$($a.source.sha256.Substring(0, 16))`` ($($a.source.files) files) | ``$(if ($a.sha256) { $a.sha256.Substring(0, 16) })`` |")
}
$md.Add('')
$md.Add('## Symbol packages')
$md.Add('')
$md.Add('| File | Bytes | SHA-256 |')
$md.Add('|---|---:|---|')
foreach ($s in $symbols) { $md.Add("| $($s.file) | $($s.bytes) | ``$($s.sha256.Substring(0, 16))`` |") }
$md.Add('')
$md.Add('## Analyzer diagnostics by rule')
$md.Add('')
foreach ($a in $apps) { $md.Add("- **$($a.name):** " + (($a.byRule.GetEnumerator() | ForEach-Object { "$($_.Key) x$($_.Value)" }) -join ', ')) }
$md.Add('')
$md.Add('## Documentation types in this build')
$md.Add('')
foreach ($d in $docTypes) { $md.Add("- $d") }
$md.Add('')
$md.Add('## Recreate this build and session')
$md.Add('')
$i = 1; foreach ($r in $snapshot.reproduce) { $md.Add("$i. ``$r``"); $i++ }
Set-Content (Join-Path $OutDir 'version-snapshot.md') $md -Encoding utf8
Write-Host "Version build snapshot: $jsonPath"

if (@($apps | Where-Object { -not $_.succeeded }).Count -gt 0) { exit 1 }
