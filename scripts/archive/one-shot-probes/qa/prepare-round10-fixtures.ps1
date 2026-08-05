# Round 10 — prepare 8 workspace copies + optional SVN seed for A6
$ErrorActionPreference = 'Continue'
$root = 'G:\spaces\kairo-ide'
Set-Location $root

$targets = @(
  'artifacts\qa\a1\workspace',
  'artifacts\qa\a2\workspace',
  'artifacts\qa\a3\workspace',
  'artifacts\qa\a4\workspace',
  'artifacts\qa\a5\workspace',
  'artifacts\qa\a7\workspace',
  'artifacts\qa\a8\workspace',
  'artifacts\qa\b1\workspace',
  'artifacts\qa\round-10\final\scenario-a\workspace',
  'artifacts\qa\round-10\final\scenario-b\workspace'
)

foreach ($rel in $targets) {
  $ws = Join-Path $root $rel
  Write-Host "Seeding $ws"
  if (Test-Path $ws) {
    # Keep existing if already has build.xml / .kairo — refresh yaml only via helper
  }
  New-Item -ItemType Directory -Force -Path (Split-Path $ws) | Out-Null
  node -e "const h=require('./scripts/test/qa/_helpers.cjs'); const fs=require('fs'); const p=process.argv[1]; if(!fs.existsSync(require('path').join(p,'build.xml')) && !fs.existsSync(require('path').join(p,'web'))) { try{fs.rmSync(p,{recursive:true,force:true});}catch(_){} } h.copyLegacySample(p);" $ws
}

# A6 SVN workspace is created by a6 script itself; ensure parent dirs exist
New-Item -ItemType Directory -Force -Path (Join-Path $root 'artifacts\qa\a6') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $root 'artifacts\qa\round-10\metrics') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $root 'artifacts\qa\round-10\loop-1') | Out-Null

Write-Host 'Fixtures ready'
svn --version --quiet 2>$null
if ($LASTEXITCODE -eq 0) { Write-Host 'svn: OK' } else { Write-Host 'svn: MISSING' }
svnadmin help 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { Write-Host 'svnadmin: OK' } else { Write-Host 'svnadmin: MISSING' }
