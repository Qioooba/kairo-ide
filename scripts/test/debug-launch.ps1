$env:KAIRO_DESKTOP_LOG_FILE = "g:\spaces\kairo-ide\artifacts\debug\desktop-main.log"
$env:KAIRO_DEV = "1"
$env:KAIRO_NO_DEVTOOLS = "0"
New-Item -ItemType Directory -Force -Path "artifacts\debug" | Out-Null
New-Item -ItemType Directory -Force -Path "artifacts\debug\userdata" | Out-Null
Remove-Item "g:\spaces\kairo-ide\artifacts\debug\desktop-main.log" -ErrorAction SilentlyContinue
Start-Process -FilePath ".\dist\win-unpacked\Kairo IDE.exe" `
  -ArgumentList "--user-data-dir=g:\spaces\kairo-ide\artifacts\debug\userdata" `
  -RedirectStandardError "g:\spaces\kairo-ide\artifacts\debug\exe-stderr.log" `
  -RedirectStandardOutput "g:\spaces\kairo-ide\artifacts\debug\exe-stdout.log" `
  -NoNewWindow
Start-Sleep -Seconds 30
"--- proc info ---"
Get-Process -Name "Kairo IDE" -ErrorAction SilentlyContinue | Format-Table Id, MainWindowTitle, StartTime, CPU -AutoSize
"--- stdout ---"
Get-Content "g:\spaces\kairo-ide\artifacts\debug\exe-stdout.log" -ErrorAction SilentlyContinue
"--- stderr ---"
Get-Content "g:\spaces\kairo-ide\artifacts\debug\exe-stderr.log" -ErrorAction SilentlyContinue
"--- main log size ---"
(Get-Item "g:\spaces\kairo-ide\artifacts\debug\desktop-main.log" -ErrorAction SilentlyContinue).Length
"--- main log ---"
Get-Content "g:\spaces\kairo-ide\artifacts\debug\desktop-main.log" -ErrorAction SilentlyContinue
"--- userdata ---"
Get-ChildItem "g:\spaces\kairo-ide\artifacts\debug\userdata" -Recurse -ErrorAction SilentlyContinue | Select-Object FullName, Length
"--- end ---"
