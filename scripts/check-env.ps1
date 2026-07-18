$machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
$user = [Environment]::GetEnvironmentVariable('Path', 'User')
Write-Host "=== MACHINE PATH (first 300 chars) ==="
Write-Host $machine.Substring(0, [Math]::Min(300, $machine.Length))
Write-Host ""
Write-Host "=== USER PATH ==="
Write-Host $user
Write-Host ""
Write-Host "=== env:Path in this shell (first 500 chars) ==="
Write-Host $env:Path.Substring(0, [Math]::Min(500, $env:Path.Length))
Write-Host ""
Write-Host "=== Resolved commands ==="
Write-Host "java: " (Get-Command java -ErrorAction SilentlyContinue).Source
Write-Host "go:   " (Get-Command go -ErrorAction SilentlyContinue).Source
Write-Host "node: " (Get-Command node -ErrorAction SilentlyContinue).Source
