@echo off
setlocal
set PLAYWRIGHT_BROWSERS_PATH=
cd /d G:\spaces\kairo-ide
call scripts\test\run-debug-deep.cmd "DBG-DEEP-1[0-2]|DBG-DEEP-30"
exit /b %ERRORLEVEL%
