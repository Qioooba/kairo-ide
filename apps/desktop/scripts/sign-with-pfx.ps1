# Sign an exe with a .pfx (OPT-002 smoke). Run via Windows PowerShell 5.1:
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File sign-with-pfx.ps1 -ExePath ... -PfxPath ... -Password ...
param(
  [Parameter(Mandatory = $true)][string]$ExePath,
  [Parameter(Mandatory = $true)][string]$PfxPath,
  [Parameter(Mandatory = $true)][string]$Password,
  [string]$TimestampServer = ''
)
$ErrorActionPreference = 'Stop'
Import-Module Microsoft.PowerShell.Security -ErrorAction Stop
$pass = ConvertTo-SecureString -String $Password -AsPlainText -Force
$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2(
  $PfxPath,
  $pass,
  [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::Exportable
)
$params = @{ FilePath = $ExePath; Certificate = $cert; HashAlgorithm = 'SHA256' }
if ($TimestampServer) { $params['TimestampServer'] = $TimestampServer }
$sig = Set-AuthenticodeSignature @params
Write-Host "Status=$($sig.Status) HasSigner=$([bool]$sig.SignerCertificate)"
if (-not $sig.SignerCertificate) {
  throw "Signing failed: $($sig.Status) $($sig.StatusMessage)"
}
