# run-and-capture.ps1 — run a command under fresh PATH, capture
# exit code, elapsed ms, stdout+stderr, and append a machine-
# readable JSONL line + a human section to the manifest.
#
# Usage:
#   pwsh -File scripts/run-and-capture.ps1 `
#        -Name "pnpm.install" `
#        -Cmd "pnpm" `
#        -Args @("install","--frozen-lockfile") `
#        -OutDir "artifacts/windows-wave2/commands" `
#        -RepoRoot "G:/spaces/kairo-ide" `
#        -MaxSeconds 1800
#
# Writes:
#   <OutDir>/<name>.log   — full stdout+stderr
#   <OutDir>/<name>.json  — { name, cmd, args, exitCode, elapsedMs, logFile }
#
# Exits with the captured command's exit code, so a CI runner
# can chain `if (run-and-capture ... ) { throw }`.

[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Name,
  [Parameter(Mandatory=$true)][string]$Cmd,
  [string[]]$CmdArgs = @(),
  [Parameter(Mandatory=$true)][string]$OutDir,
  [string]$RepoRoot = (Resolve-Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Definition) "..")).Path,
  [int]$MaxSeconds = 1800,
  [string]$EnvJson   = $null
)

$ErrorActionPreference = "Stop"

# Reload PATH so the captured command sees the same toolchain
# the developer would.
$userPath = & reg.exe query 'HKCU\Environment' /v Path 2>$null |
  Select-String -Pattern 'REG_(SZ|EXPAND_SZ)\s+(.+)$' |
  ForEach-Object { $_.Matches.Groups[2].Value } |
  Select-Object -First 1
$sysPath = & reg.exe query 'HKLM\System\CurrentControlSet\Control\Session Manager\Environment' /v Path 2>$null |
  Select-String -Pattern 'REG_(SZ|EXPAND_SZ)\s+(.+)$' |
  ForEach-Object { $_.Matches.Groups[2].Value } |
  Select-Object -First 1
$sysPath = [Environment]::ExpandEnvironmentVariables($sysPath)
$merged = if ($userPath) { "$userPath;$sysPath" } else { $sysPath }
$env:Path = $merged

# Persist registry-set env vars into the process scope (this
# matters for variables like KAIRO_TOMCAT6_HOME which the
# developer set permanently but a fresh child PowerShell
# does not see).
foreach ($envName in @("KAIRO_TOMCAT6_HOME","KAIRO_JRE17_HOME","JAVA_HOME","GOROOT")) {
  $val = (Get-ItemProperty -Path "HKCU:\Environment" -Name $envName -ErrorAction SilentlyContinue).$envName
  if ($val) {
    [Environment]::SetEnvironmentVariable($envName, $val, "Process")
  }
}

# Apply caller-supplied extra env vars.
if ($EnvJson) {
  $extra = $EnvJson | ConvertFrom-Json
  foreach ($p in $extra.PSObject.Properties) {
    [Environment]::SetEnvironmentVariable($p.Name, $p.Value, "Process")
  }
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$logFile = Join-Path $OutDir ($Name + ".log")
$jsonFile = Join-Path $OutDir ($Name + ".json")

$resolved = (Get-Command $Cmd -ErrorAction SilentlyContinue).Source
if (-not $resolved) {
  @{ name=$Name; cmd=$Cmd; args=$CmdArgs; exitCode=127; elapsedMs=0; logFile=$logFile; error="command not on PATH" } |
    ConvertTo-Json -Depth 4 | Set-Content -Path $jsonFile -Encoding UTF8
  exit 127
}

Push-Location $RepoRoot
try {
  $argList = @($resolved) + $CmdArgs
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $resolved
  if ($psi.ArgumentList) {
    foreach ($a in $CmdArgs) { [void]$psi.ArgumentList.Add($a) }
  } else {
    # Fallback for older .NET runtimes that lack ArgumentList
    $psi.Arguments = ($CmdArgs | ForEach-Object { if ($_ -match '\s') { '"' + ($_ -replace '"','\\"') + '"' } else { $_ } }) -join ' '
  }
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError  = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow  = $true
  $psi.WorkingDirectory = $RepoRoot
  foreach ($k in @("Path","KAIRO_TOMCAT6_HOME","KAIRO_JRE17_HOME","JAVA_HOME","GOROOT","GOPATH","USERPROFILE","TEMP","TMP","SystemRoot")) {
    $v = [Environment]::GetEnvironmentVariable($k)
    if ($v) { $psi.Environment[$k] = $v }
  }

  $proc = [System.Diagnostics.Process]::Start($psi)
  $stdoutTask = $proc.StandardOutput.ReadToEndAsync()
  $stderrTask = $proc.StandardError.ReadToEndAsync()
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  if (-not $proc.WaitForExit($MaxSeconds * 1000)) {
    try { $proc.Kill($true) } catch {}
    $sw.Stop()
    "TIMEOUT after $MaxSeconds seconds" | Out-File -FilePath $logFile -Encoding UTF8
    @{ name=$Name; cmd=$Cmd; args=$CmdArgs; exitCode=124; elapsedMs=$sw.ElapsedMilliseconds; logFile=$logFile; error="timeout" } |
      ConvertTo-Json -Depth 4 | Set-Content -Path $jsonFile -Encoding UTF8
    Pop-Location
    exit 124
  }
  $sw.Stop()
  $stdout = $stdoutTask.GetAwaiter().GetResult()
  $stderr = $stderrTask.GetAwaiter().GetResult()
  $exit = $proc.ExitCode

  $content = "--- stdout ---`n" + $stdout + "`n--- stderr ---`n" + $stderr
  $content | Out-File -FilePath $logFile -Encoding UTF8

  $record = @{
    name      = $Name
    cmd       = $Cmd
    args      = $CmdArgs
    exitCode  = $exit
    elapsedMs = $sw.ElapsedMilliseconds
    logFile   = $logFile
    capturedAt = (Get-Date -Format "o")
  }
  $record | ConvertTo-Json -Depth 4 | Set-Content -Path $jsonFile -Encoding UTF8

  Write-Host ("[{0}] exit={1} elapsed={2}ms" -f $Name, $exit, $sw.ElapsedMilliseconds) -ForegroundColor Cyan
  Pop-Location
  exit $exit
} catch {
  Pop-Location
  throw
}
