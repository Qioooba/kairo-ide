# phase0-fix-wincodesign-7z.ps1
# For each winCodeSign-N.7z in electron-builder cache:
#   1. extract to a temp dir
#   2. delete the symlinks under darwin/ (they are not needed on Windows)
#   3. re-archive into winCodeSign-N.fixed.7z
#   4. replace the original .7z with the fixed one
$cache = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\winCodeSign'
$sevenZip = 'G:\spaces\kairo-ide\node_modules\.pnpm\7zip-bin@5.2.0\node_modules\7zip-bin\win\x64\7za.exe'
$scratch = Join-Path $env:TEMP 'kairo-wcs-fix'

Get-ChildItem -Path $cache -Filter '*.7z' | ForEach-Object {
  $archive = $_.FullName
  $name    = $_.BaseName
  $work    = Join-Path $scratch $name
  $fixed   = Join-Path $cache "$name.fixed.7z"

  if (Test-Path $work)    { mavis-trash $work }
  if (Test-Path $fixed)   { mavis-trash $fixed }
  New-Item -ItemType Directory -Force -Path $work | Out-Null

  # 1. extract without -snl, accepting symlink errors so the rest still extracts
  & $sevenZip x -y -bd "-o$work" $archive 2>&1 | Out-Null

  # 2. delete the two known symlinks
  foreach ($f in 'darwin/10.12/lib/libcrypto.dylib', 'darwin/10.12/lib/libssl.dylib') {
    $p = Join-Path $work $f
    if (Test-Path $p) { Remove-Item -Force $p }
  }

  # 3. re-archive (solid, with LZMA2) so electron-builder still recognises it
  #    use 'a' to add; redirect to stdout then to file via -t7z -mx=5
  Push-Location $work
  & $sevenZip a -t7z -mx=5 -mfb=64 -md=32m -ms=on -bb0 $fixed '*' 2>&1 | Out-Null
  Pop-Location

  # 4. atomically swap
  $origBak = "$archive.bak"
  if (Test-Path $origBak) { mavis-trash $origBak }
  Rename-Item $archive $origBak
  Rename-Item $fixed $archive
  "fixed: $archive (original backed up to $origBak)"
}

mavis-trash $scratch
"done"
