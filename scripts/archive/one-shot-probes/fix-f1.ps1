$path = "g:\spaces\kairo-ide\scripts\test\full-test-driver.cjs"
$content = Get-Content $path -Raw
# Replace `await page.keyboard.press('F1');` with `await openCommandPalette(page);` everywhere
$content = $content -replace "await page\.keyboard\.press\('F1'\);", "await openCommandPalette(page);"
Set-Content $path -Value $content -NoNewline
Write-Host "OK"
# Show a sample of replacements
Select-String -Path $path -Pattern "openCommandPalette" | Select-Object -First 5 | ForEach-Object { $_.LineNumber.ToString() + ": " + $_.Line.Trim() }
