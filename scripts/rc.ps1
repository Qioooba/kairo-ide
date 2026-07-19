# rc.ps1 — small wrapper around run-and-capture that uses $args
# so we never have to fight PowerShell's parameter parser.
# Usage (when called from another PowerShell session):
#   powershell -Command "& scripts/rc.ps1 -Name pnpm.install -CmdArgs @('install','--frozen-lockfile') -Cmd pnpm"
# OR set $args manually before calling.

[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Name,
  [Parameter(Mandatory=$true)][string]$Cmd,
  [string[]]$CmdArgs = @()
)

$here = Split-Path -Parent $MyInvocation.MyCommand.Definition
& (Join-Path $here "run-and-capture.ps1") `
    -Name $Name `
    -Cmd  $Cmd `
    -CmdArgs $CmdArgs `
    -OutDir (Join-Path (Split-Path -Parent $here) "artifacts\windows-wave2\commands") `
    -RepoRoot (Split-Path -Parent $here)
