# phase0-build-win-via-ps.ps1
# Internal launcher: re-execs as admin via Start-Process -Verb RunAs.
# Used by the orchestrator agent; you should NOT call this directly.

$target = 'G:\spaces\kairo-ide\scripts\phase0-build-win-admin.ps1'
$out    = 'G:\spaces\kairo-ide\artifacts\windows-wave2\commands\phase0-build-win-admin.out.log'
$err    = 'G:\spaces\kairo-ide\artifacts\windows-wave2\commands\phase0-build-win-admin.err.log'

# Launch elevated
$proc = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
  '-NoProfile','-ExecutionPolicy','Bypass','-File',$target
) -Verb RunAs -WindowStyle Hidden -PassThru

# Just log and exit
"admin shell pid=$($proc.Id) launched" | Out-File $out -Encoding UTF8
