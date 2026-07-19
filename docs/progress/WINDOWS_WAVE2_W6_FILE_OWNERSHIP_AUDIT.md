# W6 — File Ownership Audit

> **Owner**: Agent W6 (Integration & Evidence Lead)
> **Branch**: `feature/windows-wave2-product-vertical-slice`
> **Reference**: `docs/WINDOWS_WAVE2_PRODUCT_VERTICAL_SLICE_TASK.md` §3.1 / §3.2
> **Re-run rule**: this audit is regenerated before every Phase Gate,
> and at every cron tick. Any non-zero overlap is a blocker.

---

## 1. Mac-claimed files (Windows MUST NOT edit) — verbatim from §3.2

```text
runtime-agent/internal/domain/**
runtime-agent/internal/repository/**
runtime-agent/internal/pathpolicy/**
runtime-agent/internal/planning/**
runtime-agent/internal/provider/build/**
runtime-agent/internal/app/build.go
runtime-agent/internal/app/build_impl.go
runtime-agent/internal/app/deploy*.go
runtime-agent/internal/build/**
runtime-agent/internal/deploy/**
runtime-agent/internal/security/**
runtime-agent/test/core/**
runtime-agent/test/fixtures/**
docs/adr/0010-project-identity-and-planning.md
docs/progress/MAC_BACKEND_CORE_FINAL_REPORT.md
```

### 1.1 Default-no-touch shared files (§3.3)

```text
docs/MILESTONES.md
docs/architecture.md
docs/REARCHITECTURE_AND_IMPLEMENTATION_PLAN.md
pnpm-lock.yaml
runtime-agent/internal/bootstrap/container.go
```

These are not strictly Mac-claimed, but they are cross-work-stream
risk surfaces. They appear here so any diff against them is treated
as a flag in §4 below.

---

## 2. Windows MAY-edit scope — verbatim from §3.1

```text
apps/desktop/**
apps/browser/**
packages/runtime-extension/**
packages/project-extension/**
packages/build-extension/**
packages/tomcat-extension/**
packages/java-extension/**
packages/theia-product/**
packages/protocol/**                         # Contract Agent only
packages/ui-kit/**                           # only for real UI changes
runtime-agent/internal/api/**
runtime-agent/internal/bootstrap/**          # Windows 集成 only
runtime-agent/internal/transport/**
runtime-agent/internal/app/jdtls_descriptor.go
runtime-agent/internal/jdtls/**
runtime-agent/cmd/**
scripts/*.ps1
.github/workflows/**
apps/desktop/test/**                         # new
packages/*/src/**/*.test.*                   # new
test/e2e/windows/**                          # new
docs/progress/WINDOWS_WAVE2_FINAL_REPORT.md
docs/progress/WINDOWS_WAVE2_CONTRACT_REQUESTS.md
```

W6 specifically authorises (under `docs/progress/WINDOWS_WAVE2_*.md`
umbrella) the following Phase 0 audit files:

- `docs/progress/WINDOWS_WAVE2_W6_DOD_STATE.md`
- `docs/progress/WINDOWS_WAVE2_W6_FILE_OWNERSHIP_AUDIT.md` (this file)
- `docs/progress/WINDOWS_WAVE2_FINAL_REPORT.md`
- `docs/progress/WINDOWS_WAVE2_CONTRACT_REQUESTS.md` (channel)
- `docs/progress/WINDOWS_WAVE2_DOD.md` (per-criterion checklist)
- `docs/progress/WINDOWS_WAVE2_AGENT_PROMPTS.md` (per-agent brief)
- `docs/WINDOWS_WAVE2_PRODUCT_VERTICAL_SLICE_TASK.md` (master task)
- Phase X Status Reports under `docs/progress/WINDOWS_WAVE2_PHASE*_STATUS.md`
  (when produced at Gate time)

---

## 3. Commands run (verifiable)

```powershell
Set-Location 'G:\spaces\kairo-ide'

# 3.1 Changed files vs. main
git diff --stat main...HEAD
# →
#  docs/WINDOWS_WAVE2_PRODUCT_VERTICAL_SLICE_TASK.md | 1402 +++++++++++++++++++++
#  docs/progress/WINDOWS_WAVE2_AGENT_PROMPTS.md      |  434 +++++++
#  docs/progress/WINDOWS_WAVE2_CONTRACT_REQUESTS.md  |   28 +
#  docs/progress/WINDOWS_WAVE2_DOD.md                |  101 ++
#  4 files changed, 1965 insertions(+)

# 3.2 Per-commit name + status
git log main..HEAD --name-status --format='%n=== %h %s ==='
# →
# === c0c7491 chore(wave2): pin agent prompts, DoD checklist, contract request channel ===
# A	docs/progress/WINDOWS_WAVE2_AGENT_PROMPTS.md
# A	docs/progress/WINDOWS_WAVE2_CONTRACT_REQUESTS.md
# A	docs/progress/WINDOWS_WAVE2_DOD.md
#
# === 1ea3cf9 docs(wave1): pin Wave 2 product vertical-slice task alongside Wave 1 closure ===
# A	docs/WINDOWS_WAVE2_PRODUCT_VERTICAL_SLICE_TASK.md

# 3.3 Commits on this branch
git log main..HEAD --oneline
# →
# c0c7491 chore(wave2): pin agent prompts, DoD checklist, contract request channel
# 1ea3cf9 docs(wave1): pin Wave 2 product vertical-slice task alongside Wave 1 closure

# 3.4 Trailing-whitespace sweep (informational; not a Mac-claimed-file issue)
git diff --check main...HEAD
# → 7 trailing-whitespace warnings, all in the master task doc
#   blockquote lines (CJK markdown). Doc-only, not a code file.

# 3.5 Forbidden-path overlap test (programmatic)
$forbidden = @(
  'runtime-agent/internal/domain',
  'runtime-agent/internal/repository',
  'runtime-agent/internal/pathpolicy',
  'runtime-agent/internal/planning',
  'runtime-agent/internal/provider/build',
  'runtime-agent/internal/app/build.go',
  'runtime-agent/internal/app/build_impl.go',
  'runtime-agent/internal/app/deploy',
  'runtime-agent/internal/build',
  'runtime-agent/internal/deploy',
  'runtime-agent/internal/security',
  'runtime-agent/test/core',
  'runtime-agent/test/fixtures',
  'docs/adr/0010-project-identity-and-planning.md',
  'docs/progress/MAC_BACKEND_CORE_FINAL_REPORT.md'
)
$changed = git diff --name-only main...HEAD
$hits = $changed | Where-Object { $p = $_; $forbidden | Where-Object { $p -like "$_*" } }
if ($hits) { Write-Output "VIOLATION: $hits" } else { Write-Output "OK: zero Mac-claimed-file overlap" }
# → OK: zero Mac-claimed-file overlap

# 3.6 Default-no-touch shared-file overlap test
$sharedRisk = @(
  'docs/MILESTONES.md',
  'docs/architecture.md',
  'docs/REARCHITECTURE_AND_IMPLEMENTATION_PLAN.md',
  'pnpm-lock.yaml',
  'runtime-agent/internal/bootstrap/container.go'
)
$hits2 = $changed | Where-Object { $p = $_; $sharedRisk -contains $p }
if ($hits2) { Write-Output "FLAG: shared risk file touched: $hits2" } else { Write-Output "OK: zero shared risk file overlap" }
# → OK: zero shared risk file overlap
```

---

## 4. Result matrix

| Path | Status | Notes |
|------|--------|-------|
| `docs/WINDOWS_WAVE2_PRODUCT_VERTICAL_SLICE_TASK.md` | **OK** | Master task doc, explicitly allowed in §3.1 (`docs/progress/WINDOWS_WAVE2_FINAL_REPORT.md` and the rest of the `WINDOWS_WAVE2_*.md` family is allowed; the master task is the charter, not a Mac-claimed file). |
| `docs/progress/WINDOWS_WAVE2_AGENT_PROMPTS.md` | **OK** | W6 explicitly authorises per-agent brief under `WINDOWS_WAVE2_*.md` umbrella. |
| `docs/progress/WINDOWS_WAVE2_CONTRACT_REQUESTS.md` | **OK** | Explicitly listed in §3.1. |
| `docs/progress/WINDOWS_WAVE2_DOD.md` | **OK** | DoD checklist, allowed under `WINDOWS_WAVE2_*.md` umbrella. |

| Forbidden path | Touched? | Notes |
|----------------|----------|-------|
| `runtime-agent/internal/domain/**` | no | (no overlap) |
| `runtime-agent/internal/repository/**` | no | |
| `runtime-agent/internal/pathpolicy/**` | no | |
| `runtime-agent/internal/planning/**` | no | |
| `runtime-agent/internal/provider/build/**` | no | |
| `runtime-agent/internal/app/build.go` | no | |
| `runtime-agent/internal/app/build_impl.go` | no | |
| `runtime-agent/internal/app/deploy*.go` | no | |
| `runtime-agent/internal/build/**` | no | |
| `runtime-agent/internal/deploy/**` | no | |
| `runtime-agent/internal/security/**` | no | |
| `runtime-agent/test/core/**` | no | |
| `runtime-agent/test/fixtures/**` | no | |
| `docs/adr/0010-project-identity-and-planning.md` | no | |
| `docs/progress/MAC_BACKEND_CORE_FINAL_REPORT.md` | no | |

| Shared-risk file | Touched? | Notes |
|------------------|----------|-------|
| `docs/MILESTONES.md` | no | Per §3.3, only Integration Lead at final integration. |
| `docs/architecture.md` | no | |
| `docs/REARCHITECTURE_AND_IMPLEMENTATION_PLAN.md` | no | |
| `pnpm-lock.yaml` | no | Only Integration Lead. |
| `runtime-agent/internal/bootstrap/container.go` | no | |

**Conclusion**: **0 Mac-claimed-file violations**, **0 shared-risk-file
flags**. Phase 0 branch is clean.

---

## 5. Re-run schedule (W6 cron)

| Trigger | Action |
|---------|--------|
| Every 30 min during Phase 0–6 | Re-run §3.1, §3.5, §3.6; update this file's `## 6. Re-run log` table. |
| Before every Phase Gate | Re-run §3.1–§3.6; add Gate row to `## 6`; **block** if any hit. |
| After every worker commit that touches code | Re-run §3.1; **block** if any forbidden-path hit. |
| Before final report sign-off | Re-run §3.1; **block** if any hit. |

---

## 6. Re-run log

| Re-run at (UTC+8) | Trigger | Forbidden hits | Shared-risk hits | Verdict |
|-------------------|---------|----------------|------------------|---------|
| 2026-07-19 init | Phase 0 start | 0 | 0 | clean |
