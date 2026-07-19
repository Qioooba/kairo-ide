# phase0-prebuild-wincodesign.ps1
# Pre-extract electron-builder winCodeSign with -snl (store symlinks as links, no system call)
# so the 7za invocation that electron-builder uses does not need SeCreateSymbolicLinkPrivilege.
param([string]$Version = '258610267')
$cache = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\winCodeSign'
$sevenZip = 'G:\spaces\kairo-ide\node_modules\.pnpm\7zip-bin@5.2.0\node_modules\7zip-bin\win\x64\7za.exe'

$archive = Join-Path $cache "$Version.7z"
$target  = Join-Path $cache $Version
if (-not (Test-Path $archive)) {
  Write-Host "missing archive: $archive" -ForegroundColor Red
  exit 2
}
# Wipe the previous broken extraction (it has half-symlink junk)
if (Test-Path $target) { mavis-trash $target }
New-Item -ItemType Directory -Force -Path $target | Out-Null

# Extract with -snl: store symlinks as links, do not try to create them on the filesystem
# -y auto-replace existing files from the previous failed extraction
& $sevenZip x -snl -y -bd "-o$target" $archive
$rc = $LASTEXITCODE
"7za exit=$rc target=$target"
# electron-builder also wants a small marker — the original archive name alongside
# the extracted dir, which is already there because we did NOT delete the .7z.
exit $rc
