# dump-env-fresh.ps1 — runs every version probe under the fresh PATH
# (HKCU + HKLM) so all child processes see the same toolchain the
# verify-e2e.ps1 path sees. Writes to artifacts/windows-wave2/environment.txt.

[CmdletBinding()]
param(
  [string]$Out = "artifacts\windows-wave2\environment.txt"
)

$ErrorActionPreference = "Stop"

# 1. Reload PATH from registry (mirror of check-env-fresh.ps1)
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

# 2. Append machine / OS facts
Add-Content -Path $Out -Value ""
Add-Content -Path $Out -Value "--- machine / OS facts ---"
Add-Content -Path $Out -Value ("OS:                 {0}" -f (Get-CimInstance Win32_OperatingSystem).Caption)
Add-Content -Path $Out -Value ("OSVersion:          {0}" -f (Get-CimInstance Win32_OperatingSystem).Version)
Add-Content -Path $Out -Value ("Build:              {0}" -f (Get-CimInstance Win32_OperatingSystem).BuildNumber)
Add-Content -Path $Out -Value ("Architecture:       {0}" -f $env:PROCESSOR_ARCHITECTURE)
Add-Content -Path $Out -Value ("PSVersion:          {0}" -f $PSVersionTable.PSVersion)
Add-Content -Path $Out -Value ("User:               {0}\{1}" -f $env:USERDOMAIN, $env:USERNAME)
Add-Content -Path $Out -Value ("PATH entries:       {0}" -f ($merged -split ";").Count)
Add-Content -Path $Out -Value ("PATH length:        {0}" -f $merged.Length)

# 3. Tool versions (each gets its own section)
function Probe {
  param([string]$Cmd, [string[]]$CmdArgs = @())
  # Use Get-Command to resolve the .exe path first, since some shims
  # (.CMD / .ps1) on this host don't behave under the `&` call operator.
  $resolved = (Get-Command $Cmd -ErrorAction SilentlyContinue).Source
  if (-not $resolved) { return "(not on PATH)" }
  try {
    if ($CmdArgs.Count -eq 0) {
      $line = & $resolved 2>&1 | Out-String
    } else {
      $line = & $resolved $CmdArgs 2>&1 | Out-String
    }
  } catch {
    $line = $_.Exception.Message
  }
  # Reset $LASTEXITCODE so PowerShell does not raise a NativeCommandError
  # for tools that legitimately print to stderr (e.g. `java -version`).
  $global:LASTEXITCODE = 0
  return $line.Trim()
}

Add-Content -Path $Out -Value ""
Add-Content -Path $Out -Value "--- tool versions (fresh PATH) ---"
Add-Content -Path $Out -Value ("node:               {0}" -f (Probe -Cmd "node" -CmdArgs @("--version")))
Add-Content -Path $Out -Value ("pnpm:               {0}" -f (Probe -Cmd "pnpm" -CmdArgs @("--version")))
Add-Content -Path $Out -Value ("npm:                {0}" -f (Probe -Cmd "npm" -CmdArgs @("--version")))
Add-Content -Path $Out -Value ("yarn:               (skipped — yarn.ps1 shim hits corepack 0.29 deprecation; not required)")
# yarn probe intentionally skipped: the yarn.ps1 shim on this host
# calls corepack, which Node 20.18 deprecated. We do not need yarn
# for the Wave 2 contract.
Add-Content -Path $Out -Value ("go:                 {0}" -f (Probe -Cmd "go" -CmdArgs @("version")))
Add-Content -Path $Out -Value ("git:                {0}" -f (Probe -Cmd "git" -CmdArgs @("--version")))
Add-Content -Path $Out -Value ("java:               {0}" -f (Probe -Cmd "java" -CmdArgs @("-version")))
Add-Content -Path $Out -Value ("javac:              {0}" -f (Probe -Cmd "javac" -CmdArgs @("-version")))
Add-Content -Path $Out -Value ("ant:                {0}" -f (Probe -Cmd "ant" -CmdArgs @("-version")))
Add-Content -Path $Out -Value ("makensis:           {0}" -f (Probe -Cmd "makensis" -CmdArgs @("/VERSION")))

# 4. Environment variables we care about
Add-Content -Path $Out -Value ""
Add-Content -Path $Out -Value "--- relevant env vars ---"
foreach ($name in @("KAIRO_TOMCAT6_HOME", "KAIRO_JRE17_HOME", "KAIRO_DATA_DIR", "KAIRO_BUNDLED_DIR", "JAVA_HOME", "GOPATH", "GOROOT")) {
  $v = [Environment]::GetEnvironmentVariable($name, "User")
  $vm = [Environment]::GetEnvironmentVariable($name, "Machine")
  $p = [Environment]::GetEnvironmentVariable($name, "Process")
  Add-Content -Path $Out -Value ("  {0,-22} user='{1}' machine='{2}' process='{3}'" -f $name, $v, $vm, $p)
}

# 5. Workspace and git state
Add-Content -Path $Out -Value ""
Add-Content -Path $Out -Value "--- git state ---"
Push-Location $PSScriptRoot\..
try {
  Add-Content -Path $Out -Value ("branch:             {0}" -f (Probe -Cmd "git" -CmdArgs @("rev-parse","--abbrev-ref","HEAD")))
  Add-Content -Path $Out -Value ("HEAD:               {0}" -f (Probe -Cmd "git" -CmdArgs @("rev-parse","HEAD")))
  Add-Content -Path $Out -Value ("status --short:")
  $status = Probe -Cmd "git" -CmdArgs @("status","--short")
  if ($status) {
    Add-Content -Path $Out -Value $status
  } else {
    Add-Content -Path $Out -Value "  (clean)"
  }
  Add-Content -Path $Out -Value ("log --oneline -8:")
  Add-Content -Path $Out -Value (Probe -Cmd "git" -CmdArgs @("log","--oneline","-8"))
} finally {
  Pop-Location
}

# 6. Disk and memory (headroom for build)
Add-Content -Path $Out -Value ""
Add-Content -Path $Out -Value "--- disk / memory ---"
$drives = Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Used -gt 0 -or $_.Free -gt 0 }
foreach ($d in $drives) {
  $free = [math]::Round($d.Free / 1GB, 2)
  $used = [math]::Round($d.Used / 1GB, 2)
  Add-Content -Path $Out -Value ("  {0,-3} used={1,8}GB  free={2,8}GB  root={3}" -f $d.Name, $used, $free, $d.Root)
}
$mem = Get-CimInstance Win32_ComputerSystem
Add-Content -Path $Out -Value ("  TotalPhysicalMemory: {0} GB" -f ([math]::Round($mem.TotalPhysicalMemory / 1GB, 2)))
Add-Content -Path $Out -Value ("  FreePhysicalMemory:  {0} GB" -f ([math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB, 2)))

Write-Host "Environment evidence appended to $Out" -ForegroundColor Green
