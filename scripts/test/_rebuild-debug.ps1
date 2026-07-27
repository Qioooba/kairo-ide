$env:KEEP_ASAR_STAGE='1'
cd g:\spaces\kairo-ide
node scripts/test/rebuild-asar.cjs
Write-Host '---STAGE---'
Get-ChildItem dist\win-unpacked\asar-stage | Select-Object Name
Write-Host '---STAGE/apps---'
Get-ChildItem dist\win-unpacked\asar-stage\apps -ErrorAction SilentlyContinue | Select-Object Name
Write-Host '---STAGE/apps/desktop---'
Get-ChildItem dist\win-unpacked\asar-stage\apps\desktop -ErrorAction SilentlyContinue | Select-Object Name
