@echo off
setlocal
set AGENT_PORT=18080
set KAIRO_AGENT_URL=http://127.0.0.1:18080
set THEIA_PORT=18301
set THEIA_URL=http://127.0.0.1:18301
set TOMCAT_PORT=18302
if not defined PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH (
  if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
    set "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
  ) else if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
    set "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
  )
)
cd /d G:\spaces\kairo-ide
if "%~1"=="full" (
  npx playwright test tests/e2e/regression/shard-06b-debug-deep.spec.ts --config tests/e2e/playwright.config.ts --workers=1 --reporter=list,json --output=test-results/debug-deep-artifacts
) else if "%~1"=="p0" (
  npx playwright test tests/e2e/regression/shard-06b-debug-deep.spec.ts --config tests/e2e/playwright.config.ts --workers=1 --grep "DBG-DEEP-0[0-4]|DBG-DEEP-1[0-2]|DBG-DEEP-20|DBG-DEEP-23|DBG-DEEP-30|DBG-DEEP-40" --reporter=list,json --output=test-results/debug-deep-artifacts
) else if "%~1"=="phase-b" (
  set KAIRO_DEBUG_PHASE_B=1
  set KAIRO_REQUIRE_DEBUG_ADAPTER=1
  npx playwright test tests/e2e/regression/shard-06b-debug-deep.spec.ts --config tests/e2e/playwright.config.ts --workers=1 --grep "DBG-DEEP-80|DBG-DEEP-81|DBG-DEEP-00|DBG-DEEP-03|DBG-DEEP-12|DBG-DEEP-20|DBG-DEEP-30|DBG-DEEP-40" --reporter=list,json --output=test-results/debug-deep-artifacts
) else (
  npx playwright test tests/e2e/regression/shard-06b-debug-deep.spec.ts --config tests/e2e/playwright.config.ts --workers=1 --grep "%~1" --reporter=list,json --output=test-results/debug-deep-artifacts
)
set EXITCODE=%ERRORLEVEL%
echo PLAYWRIGHT_EXIT=%EXITCODE%
if exist tests\e2e\test-results\results.json (
  node scripts/test/summarize-debug-deep-results.cjs tests/e2e/test-results/results.json test-results/debug-deep-phase-a-pass-fail.md
)
if exist test-results\results.json (
  node scripts/test/summarize-debug-deep-results.cjs test-results/results.json test-results/debug-deep-phase-a-pass-fail.md
)
exit /b %EXITCODE%
