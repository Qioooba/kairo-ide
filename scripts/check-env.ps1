# check-env.ps1 — pre-flight for the Kairo IDE dev workflow.
# Prints whether each required tool is present and on what version.

[CmdletBinding()]
param([switch]$Json)

function Probe($name) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if ($cmd) {
    $version = $null
    try { $version = & $name --version 2>$null | Select-Object -First 1 } catch {}
    return @{ tool = $name; found = $true; path = $cmd.Source; version = $version }
  }
  return @{ tool = $name; found = $false }
}

$checks = @()
$checks += Probe "node"
$checks += Probe "pnpm"
$checks += Probe "go"
$checks += Probe "java"
$checks += Probe "javac"

if ($env:KAIRO_TOMCAT6_HOME) {
  $checks += @{ tool = "KAIRO_TOMCAT6_HOME"; found = $true; path = $env:KAIRO_TOMCAT6_HOME }
} else {
  $checks += @{ tool = "KAIRO_TOMCAT6_HOME"; found = $false }
}
if ($env:KAIRO_JRE17_HOME) {
  $checks += @{ tool = "KAIRO_JRE17_HOME"; found = $true; path = $env:KAIRO_JRE17_HOME }
} else {
  $checks += @{ tool = "KAIRO_JRE17_HOME"; found = $false }
}

if ($Json) {
  $checks | ConvertTo-Json -Depth 4
} else {
  foreach ($c in $checks) {
    if ($c.found) {
      Write-Host ("  OK    {0,-22} {1}" -f $c.tool, $c.path) -ForegroundColor Green
    } else {
      Write-Host ("  MISS  {0,-22}" -f $c.tool) -ForegroundColor Red
    }
  }
}
