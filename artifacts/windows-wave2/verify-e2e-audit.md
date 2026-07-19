# verify-e2e.ps1 — Phase 0 audit against the 9 anti-patterns

> Audit conducted by Agent W1 on `scripts/verify-e2e.ps1`
> at `12116db` (HEAD of `feature/windows-wave2-product-vertical-slice`).
> Reference: `docs/WINDOWS_WAVE2_PRODUCT_VERTICAL_SLICE_TASK.md` §5.2.
>
> Conclusion (TL;DR): the script is **borderline acceptable** for a
> smoke test of the dev agent binary, but it has **four real
> anti-patterns** that prevent it from being the Phase 0 seal:
>
> 1. It runs against the dev binary by default, not the installed
>    NSIS `.exe` (anti-pattern #4).
> 2. Its failure policy is "FAIL only on outright build
>    breakage"; almost every other step downgrades to SKIP — that
>    hides the very regressions the task doc says we must catch
>    (anti-pattern #2, #6, #7, #8).
> 3. The restart test never captures the new Agent PID and never
>    re-asserts that the secret still works after restart
>    (anti-pattern #6).
> 4. Teardown `Stop-Process -Name "kairo-runtime"` is unscoped
>    and would kill an unrelated `kairo-runtime.exe` from another
>    test run (anti-pattern #9 — process hygiene).
>
> Five more anti-patterns are *partially* handled. They are
> listed below with a status so W1 and the Integration Lead
> can decide whether to fix the existing script or replace
> it with a Phase-0-grade one (recommendation: replace — the
> existing script does not need to live; we ship a new
> `verify-e2e-phase0.ps1` that actually proves the contract).

The 9 anti-patterns from task doc §5.2 (paraphrased):

1. Process start followed only by `Start-Sleep`, no readiness.
2. HTTP failures swallowed by `try/catch`.
3. Only checks package file exists, does not install.
4. Only starts dev Electron, not installed `.exe`.
5. Protected endpoint never asserted for "no secret → 401".
6. restart only checks 200, not PID change / re-readiness.
7. UI only checks window process exists, not renderer loaded.
8. Sub-process leaks do not cause failure.
9. Stale old Agent/Theia processes satisfy port checks.

Plus the task doc's preamble requirement:

> "脚本开始前必须清理或识别由测试自己启动的进程。不得粗暴
>  杀死系统中所有 java.exe、node.exe 或 kairo-runtime.exe；
>  只能终止测试记录的 PID 树。"

---

## Per-anti-pattern verdict

### AP-1: `Start-Sleep` without readiness

**Verdict: partially OK (readiness IS checked for /api/v1/health,
but NOT for Theia; restart re-readiness also depends on the
health endpoint, which is correct).**

Evidence (`scripts/verify-e2e.ps1` lines 269–287):

```powershell
for ($i = 0; $i -lt 80; $i++) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1`:$Port/api/v1/health" -UseBasicParsing -TimeoutSec 1
    if ($r.StatusCode -eq 200) {
      $script:agentUrl = "http://127.0.0.1`:$Port"
      return
    }
  } catch { Start-Sleep -Milliseconds 250 }
}
throw "agent did not become healthy on port $Port"
```

Good: real HTTP request, real 200 check, capped retry loop.

Bad: the Theia backend (started by the desktop `main.ts`, not by
this script) is never probed. Since the script does not start the
Electron shell (see AP-4), there is nothing to probe — but that is
itself a bigger hole.

### AP-2: HTTP failure swallowed by `try/catch`

**Verdict: PARTIAL. Inside readiness loops the `catch {}` is
correct (it is the retry mechanism). But the call to
`/api/v1/endpoints` and `/api/v1/runtime/restart` will silently
no-op if the response is not what is expected — see AP-6.**

Evidence (lines 311–319):

```powershell
Step "api.endpoints" {
  $r = Invoke-WebRequest -Uri "$baseUrl/api/v1/endpoints" -Headers $secretHdr -UseBasicParsing -TimeoutSec 5
  if ($r.StatusCode -eq 404) {
    throw "GET /api/v1/endpoints returned 404 — contract not yet implemented by the agent"
  }
  if ($r.StatusCode -ne 200) { throw "expected 200, got $($r.StatusCode)" }
  $j = $r.Content | ConvertFrom-Json
  if (-not $j.http) { throw "endpoints payload missing 'http' field: $($r.Content)" }
}
```

This step DOES fail if the endpoint is missing fields, which is
good. But the parent `Step {}` catches the throw and converts it
to a "FAILED" string, which does not stop the script. So a missing
endpoints payload is logged as a failure and the rest of the
script still runs, including the teardown which is unscoped. See
AP-9.

### AP-3: only checks package file exists, does not install

**Verdict: VIOLATION. The script never invokes the NSIS installer.
It only looks for `*Setup*.exe` files in `apps/desktop/dist/`
and, if absent, falls back to the dev binary. There is no
`Start-Process Kairo-IDE-Setup-...exe /S` step, no
`HKLM\SOFTWARE\Kairo IDE` verification, no launch of
`%LOCALAPPDATA%\Programs\Kairo IDE\Kairo IDE.exe`.**

Evidence (lines 261–268):

```powershell
$distDir = Join-Path $RepoRoot "apps\desktop\dist"
if (Test-Path $distDir) {
  $nsisExe     = Get-ChildItem -Path $distDir -Filter "*Setup*.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  $portableExe = Get-ChildItem -Path $distDir -Filter "*.exe"          -Recurse -ErrorAction SilentlyContinue |
                   Where-Object { $_.Name -notlike "*Setup*" } | Select-Object -First 1
}
```

Then the agent-start step (lines 281–286) says:

```powershell
if ($portableExe -and (Test-Path $portableExe.FullName)) {
  $useBin = $portableExe.FullName
  ...
} elseif ($nsisExe -and (Test-Path $nsisExe.FullName)) {
  Write-Host "  installed NSIS found at $($nsisExe.FullName) but NSIS is not run unattended here; using dev binary"
}
```

It EXPLICITLY refuses to run the NSIS installer.

**This violates the task doc §5.3–5.4 ("NSIS installed
silently"; "from the installed directory, not from source") and
must be replaced.**

### AP-4: only starts dev Electron, not installed `.exe`

**Verdict: VIOLATION. The script never starts Electron at all.
It only starts the standalone agent binary. The Theia backend
is never exercised by this script. The "Electron" column in
the script is empty.**

This is consistent with AP-3: the script does not install, so
it cannot launch the installed shell.

### AP-5: protected endpoint never asserted for "no secret → 401"

**Verdict: VIOLATION. The script's only authenticated call is
`api.endpoints` (line 312) and `api.restart` (line 333). It
never tests the negative case (no header → 401, wrong header →
401). It does not even assert that the middleware exists.**

This is critical for §5.5: the task doc REQUIRES the negative
auth cases.

### AP-6: restart only checks 200, not PID change / re-readiness

**Verdict: VIOLATION. After `POST /api/v1/runtime/restart`
(line 335), the script polls `/api/v1/health` until it returns
200 (lines 343–354). It captures the old PID (`$oldPid =
$script:agentProc.Id`) but it NEVER reads the new Agent PID
and NEVER asserts that the new PID differs from the old.**

Evidence:

```powershell
$script:agentProc = Get-Process -Name "kairo-runtime" -ErrorAction SilentlyContinue |
                      Where-Object { $_.Id -ne $oldPid } | Select-Object -First 1
```

It tries, but `Get-Process -Name "kairo-runtime"` will return
ANY kairo-runtime.exe on the system, including the test
binary that the script is about to teardown. It does not
verify that the new process binds the same port, and it
does not re-fetch `/api/v1/endpoints` after the restart to
prove the new instance is the one we are talking to.

**Worse**: at the time of writing, the doRestart function
in `runtime-agent/internal/api/server.go` only `os.Exec`s
if `rc.Executable != ""` AND `rc.Args != nil`. Looking at
`cmd/kairo-runtime/main.go`, only `Args: originalArgs` is
set — `Executable` is left empty. The code falls back to
`os.Executable()` which is the *current* binary. The
contract should be tested against this fallback path.

### AP-7: UI only checks window process exists, not renderer loaded

**Verdict: NOT APPLICABLE to current script. The script does
not start Electron. The task doc §5.4 item 5 ("Theia frontend
successfully rendered") is a Phase 1/2 concern. We must
add a renderer-loaded probe (URL fetch + content check) in
the rewritten `verify-e2e-phase0.ps1`.**

### AP-8: sub-process leaks do not cause failure

**Verdict: VIOLATION. The teardown block (lines 376–378) is
best-effort and there is no assertion that all child PIDs
have actually exited:**

```powershell
if ($script:agentProc -and -not $script:agentProc.HasExited) {
  try { Stop-Process -Id $script:agentProc.Id -Force -ErrorAction SilentlyContinue } catch {}
}
Get-Process -Name "kairo-runtime" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
```

A force-kill that returns silently is exactly the AP-8
anti-pattern. A real audit step would:

1. Record the PID tree before teardown.
2. Send graceful stop, wait deadline.
3. If still alive, send kill.
4. After teardown, query the PID list and assert it is empty.
5. Re-poll the listening port; assert it is free.

### AP-9: stale old Agent/Theia processes satisfy port checks

**Verdict: VIOLATION. The script NEVER checks whether a
process listening on `$Port` is *the* process it just
started. The readiness loop only checks "any process
returns 200 from /api/v1/health". If a previous test run
left a `kairo-runtime.exe` bound to the same port with a
different secret, the readiness check will succeed against
the old process.**

The same flaw bites the restart check: after `POST
/api/v1/runtime/restart`, the script polls `/health` until
it returns 200, but that 200 might come from the old
process (if it never actually restarted because the
secret/auth check failed on the new request).

---

## Process hygiene (script preamble)

The task doc says:

> "脚本开始前必须清理或识别由测试自己启动的进程。不得粗暴
>  杀死系统中所有 java.exe、node.exe 或 kairo-runtime.exe；
>  只能终止测试记录的 PID 树。"

**Verdict: VIOLATION. The current script does not have a
preamble cleanup at all, and the teardown uses
`Get-Process -Name "kairo-runtime"` which matches ANY
kairo-runtime on the system. If a developer has a personal
agent running for manual testing, this script will silently
kill it.**

---

## Decision

The current `verify-e2e.ps1` is not Phase-0-grade. W1 will:

1. Keep the existing script untouched (it is owned by the
   hotfix-closure work and may still serve as a smoke test).
2. Ship a new `scripts/verify-e2e-phase0.ps1` that:
   - Tracks every PID it spawns and the port it binds.
   - Asserts no stale `kairo-runtime.exe` / `Kairo IDE.exe`
     is left over from a previous run; if found, fails.
   - Installs the produced NSIS into a scratch
     `%LOCALAPPDATA%\KairoIDEVerify\` directory.
   - Launches the installed `Kairo IDE.exe`, captures
     Electron/Theia/Agent PIDs and ports.
   - Hits health / endpoints with and without
     `X-Kairo-Secret`.
   - Verifies WS auth with and without subprotocol.
   - Calls `POST /api/v1/runtime/restart` and asserts the
     new Agent PID is different AND the new instance
     re-binds the same port AND `/api/v1/endpoints` returns
     200 from the new PID.
   - Quits the app, asserts no Agent / Theia / JDT / Tomcat
     processes remain.
3. Update `docs/progress/WINDOWS_WAVE2_DOD.md` to reflect the
   new script as the authoritative Phase 0 seal.

This audit is saved at
`artifacts/windows-wave2/verify-e2e-audit.md` and committed
separately (one commit = one topic).
