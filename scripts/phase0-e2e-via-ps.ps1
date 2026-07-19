# phase0-e2e-via-ps.ps1 - launches phase0-e2e-install-launch.ps1 elevated
$target = 'G:\spaces\kairo-ide\scripts\phase0-e2e-install-launch.ps1'
$out    = 'G:\spaces\kairo-ide\artifacts\windows-wave2\commands\phase0-e2e-via-ps.out.log'
$err    = 'G:\spaces\kairo-ide\artifacts\windows-wave2\commands\phase0-e2e-via-ps.err.log'
$proc = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
  '-NoProfile','-ExecutionPolicy','Bypass','-File',$target
) -Verb RunAs -WindowStyle Hidden -PassThru
"admin e2e shell pid=$($proc.Id) launched" | Out-File $out -Encoding UTF8
