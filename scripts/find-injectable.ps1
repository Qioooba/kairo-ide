$content = [System.IO.File]::ReadAllText("g:\spaces\kairo-ide\apps\browser\lib\frontend\bundle.js")

# Search for hasOwnMetadata followed by return (patched) or throw (unpatched)
$pattern = 'hasOwnMetadata\([^)]+\)[,;]?\s*(throw|return)'
$regex = [regex]::new($pattern)
$matches = $regex.Matches($content)
Write-Output "Found $($matches.Count) matches for hasOwnMetadata pattern"
foreach ($m in $matches) {
    $start = [Math]::Max(0, $m.Index - 200)
    $len = [Math]::Min(700, $content.Length - $start)
    Write-Output "--- Match at $($m.Index) ---"
    Write-Output $content.Substring($start, $len)
    Write-Output ""
}

# Also search for the Kt function (injectable in ESM version)
Write-Output "=== Searching for injectable function export ==="
$pattern2 = 'Kt.*injectable'
$regex2 = [regex]::new($pattern2)
$matches2 = $regex2.Matches($content)
foreach ($m in $matches2) {
    $start = [Math]::Max(0, $m.Index - 100)
    $len = [Math]::Min(300, $content.Length - $start)
    Write-Output "--- Match at $($m.Index) ---"
    Write-Output $content.Substring($start, $len)
}