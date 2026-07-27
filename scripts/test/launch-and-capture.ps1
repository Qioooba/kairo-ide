$env:KAIRO_DESKTOP_LOG_FILE = "g:\spaces\kairo-ide\artifacts\e2e-windows\desktop-main.log"
$env:KAIRO_DEV = "1"
$env:KAIRO_NO_DEVTOOLS = "0"
Remove-Item "g:\spaces\kairo-ide\artifacts\e2e-windows\desktop-main.log" -ErrorAction SilentlyContinue
Remove-Item "g:\spaces\kairo-ide\artifacts\e2e-windows\exe-stderr.log" -ErrorAction SilentlyContinue
Remove-Item "g:\spaces\kairo-ide\artifacts\e2e-windows\exe-stdout.log" -ErrorAction SilentlyContinue
Start-Process -FilePath ".\dist\win-unpacked\Kairo IDE.exe" `
  -ArgumentList "--user-data-dir=g:\spaces\kairo-ide\artifacts\e2e-windows\userdata" `
  -RedirectStandardError "g:\spaces\kairo-ide\artifacts\e2e-windows\exe-stderr.log" `
  -RedirectStandardOutput "g:\spaces\kairo-ide\artifacts\e2e-windows\exe-stdout.log" `
  -NoNewWindow
Start-Sleep -Seconds 25
Get-Process -Name "Kairo IDE" -ErrorAction SilentlyContinue | Format-Table -AutoSize
"--- stdout ---"
Get-Content "g:\spaces\kairo-ide\artifacts\e2e-windows\exe-stdout.log" -ErrorAction SilentlyContinue
"--- stderr ---"
Get-Content "g:\spaces\kairo-ide\artifacts\e2e-windows\exe-stderr.log" -ErrorAction SilentlyContinue
"--- main log ---"
Get-Content "g:\spaces\kairo-ide\artifacts\e2e-windows\desktop-main.log" -ErrorAction SilentlyContinue
"--- END ---"
