# Kairo IDE — Windows Desktop E2E (Layer A)

Real-click, real-keystroke, real-screenshot automation of the
Kairo IDE desktop application. This is the in-app layer: it
operates the *rendered* Theia UI through a real Electron
BrowserWindow, exactly as a human would.

## Why this layer

The existing `tests/e2e/theia-smoke.cjs` runs against the
*browser* form (port 3000) and never opens a real desktop
window. That is fine for CI, but it doesn't prove that the
packaged `.exe` actually paints a usable Theia shell, that
the Electron ↔ Go Agent IPC is healthy, or that the rendered
DOM responds to real input. This script does all of that.

## How it works

```
Playwright _electron.launch()
        │
        ▼
Kairo IDE.exe  ── real Chromium + Theia + Go agent
        │
        ▼
firstWindow()  ──  the BrowserWindow
        │
        ▼
page.click / page.keyboard / page.screenshot
        │
        ▼
docs/screenshots/windows-e2e/*.png
```

Real mouse clicks, real keyboard events, real `page.screenshot`
of the rendered window. The only thing the script does *not*
do is pixel-diff (that's a separate verification pass; see
`docs/testing.md`).

## Run

From the repo root:

```powershell
# 1. Build the desktop app (one time)
pnpm --filter @kairo/desktop dist:win

# 2. Run automation against the packaged .exe
node tests/e2e-windows/desktop-real.cjs

# Or: target a custom .exe
node tests/e2e-windows/desktop-real.cjs --exe "G:\path\to\Kairo IDE.exe"

# Or: dev mode (uses electron + lib/main.js)
node tests/e2e-windows/desktop-real.cjs
```

Useful flags:

| Flag | Effect |
|------|--------|
| `--list` | Print all available steps and exit |
| `--step <name>` | Run only the named step (great for debugging) |
| `--record` | Enable CDP screencast (saves artifacts/e2e-windows/recording.webm) |
| `--slow` | 250 ms pause between major actions (visual debugging) |

## Steps (in order)

| # | Step | What it does |
|---|------|--------------|
| 1 | `boot` | Wait for Theia status bar + Monaco; screenshot |
| 2 | `windowInfo` | Dump BrowserWindow metadata + Electron version to `artifacts/e2e-windows/window-info.json` |
| 3 | `activityBar` | Probe left activity bar items |
| 4 | `openExplorer` | Click Explorer icon |
| 5 | `openCommandPalette` | F1 |
| 6 | `searchKairo` | Type "Kairo" in palette |
| 7 | `revealServers` | Execute `kairo.view.servers` command |
| 8 | `typeInEditor` | Click Monaco editor, type a comment line |
| 9 | `openSettings` | Ctrl+, |
| 10 | `toggleTheme` | Open "Color Theme" picker |
| 11 | `captureFullScreen` | Full-page screenshot |

## Outputs

| Path | What |
|------|------|
| `docs/screenshots/windows-e2e/*.png` | Per-step screenshots, 0-padded |
| `artifacts/e2e-windows/desktop-main.log` | Electron main-process log mirror |
| `artifacts/e2e-windows/summary.json` | Pass/fail + console-error report |
| `artifacts/e2e-windows/window-info.json` | BrowserWindow dimensions + URLs |

## Layer B (whole-desktop automation, optional)

If you also need to interact with things *outside* the Kairo
window — system file dialogs, the Windows Start menu, the
taskbar — pair this script with a Python harness using
`pywinauto` (for UIA-driven control) or `pyautogui + mss` (for
coordinate-driven control). The Layer A script's
`docs/screenshots/windows-e2e/` output is the ground truth
that Layer B can verify against via image diff.
