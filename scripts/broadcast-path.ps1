# broadcast-path.ps1 - 通知系统环境变量变更
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Env {
  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Auto)]
  public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);
}
"@

$HWND_BROADCAST = [IntPtr]0xffff
$WM_SETTINGCHANGE = 0x001A
$SMTO_ABORTIFHUNG = 0x0002

$result = [UIntPtr]::Zero
[void][Env]::SendMessageTimeout($HWND_BROADCAST, $WM_SETTINGCHANGE, [UIntPtr]::Zero, "Environment", $SMTO_ABORTIFHUNG, 5000, [ref]$result)
Write-Host "broadcast done, result=$result"
