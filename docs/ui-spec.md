# Kairo IDE — UI Specification

> Source of truth for **how the IDE looks and feels**. Any UI change
> touches this file or the design tokens in `packages/ui-kit/`.

## 1. Information architecture (canonical layout)

```
┌──────────────────────────────────────────────────────────────────────┐
│ Title Bar    [≡ Kairo]  ▸ workspace ▸ project ▸ server: ●tomcat-18080│
├──────────────────────────────────────────────────────────────────────┤
│ Menu Bar     File  Edit  View  Selection  Run  Terminal  Help        │
│ Tool Bar     [Project▾] [Run▾] [▶ Start] [⚙ Debug] [■] [⟳] [⤴ Publish]│
├──────┬──────────────────────────────────────────────┬────────────────┤
│      │                                              │                │
│  A   │                                              │   Outline      │
│  c   │            Editor Area                       │   Java         │
│  t   │       (tabs · splits · breadcrumb)           │   Type         │
│  i   │                                              │   Hierarchy    │
│  v   │                                              │                │
│  i   │                                              │   ── optional ─│
│  t   │                                              │                │
│  y   │                                              │                │
│      │                                              │                │
│  ▢   │                                              │                │
│  Ex  │                                              │                │
│  ▢   │                                              │                │
│  Sr  │                                              │                │
│  ▢   │                                              │                │
│  Ja  │                                              │                │
│  ▢   │                                              │                │
│  Sv  │                                              │                │
│  ▢   │                                              │                │
│  Rn  │                                              │                │
│  ▢   │                                              │                │
│  Dg  │                                              │                │
│  ▢   │                                              │                │
│  Ex  │                                              │                │
│  tn  │                                              │                │
│  •   │                                              │                │
│  Mo  │                                              │                │
│  re  │                                              │                │
├──────┴──────────────────────────────────────────────┴────────────────┤
│ Bottom Panel:  [Problems] [Output] [Tomcat] [Debug Console]          │
│                [Terminal]  [Deployment]                              │
├──────────────────────────────────────────────────────────────────────┤
│ Status Bar:  ⎇ main  •  JDK 6  •  Java 6  •  GBK  •  LF  •  ●Tomcat6 │
│              18080  •  ●Connected  •  ⓘ                            │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.1 Activity Bar (left rail)

Default entries, in this order:

1. **Explorer** (`Ctrl+Shift+E`) — file tree, multi-root, recent.
2. **Search** (`Ctrl+Shift+F`) — workspace-wide search/replace.
3. **Java** (`Ctrl+Shift+J`) — JDT packages, type hierarchy, call
   hierarchy.
4. **Servers** — runtime tree, deployments, ports, logs.
5. **Run and Debug** — configurations, call stack, variables, watch.
6. **Extensions** — installed Theia + LegacyFlow plugins.

Anything else goes into **More** (the `…` menu). The rail must never
be more than 6 default icons wide.

### 1.2 Tool Bar (top)

Slim, only **most-used** actions, in this fixed order:

1. Project selector.
2. Run configuration selector.
3. **Start** server.
4. **Debug** start.
5. **Stop** server.
6. **Rebuild**.
7. **Publish** (deploy).
8. **Hot-reload** status indicator (last reload time).

We do **not** put 30 icons here. The full action set lives in the
menu and command palette.

### 1.3 Status Bar (bottom)

Always visible, monospaced-friendly. From left to right:

```
⎇ branch · ☕ JDK 6 (1.6.0_45) · ☕ Source 6 · ABC encoding · LF · ●Tomcat:18080 · ●Connected · ⓘ
```

Each segment is a click target. Encoding opens "Save with encoding".
Server opens Servers view. Connected opens connection panel.

## 2. Design tokens (packages/ui-kit/tokens)

Two themes out of the box, both with WCAG AA contrast minimum
**4.5:1** on body text.

### 2.1 Spacing scale

4, 8, 12, 16, 20, 24, 32, 48 px. Use the scale; do not invent.

### 2.2 Type scale

| Token | Size / Line | Use |
|-------|-------------|-----|
| `text.xs`   | 11 / 16 | tooltips, status bar |
| `text.sm`   | 12 / 18 | secondary text, lists |
| `text.base` | 13 / 20 | body, default |
| `text.md`   | 14 / 22 | titles |
| `text.lg`   | 16 / 24 | dialog titles |
| `text.xl`   | 20 / 28 | welcome screen |

Tabular numbers in numeric columns. Source Code Pro / JetBrains Mono
for code; system UI font for chrome.

### 2.3 Color — `dark` (default)

```
bg.canvas        #1e1f22   // background
bg.panel         #252628
bg.elevated      #2b2c2f
bg.active        #37393c
fg.primary       #dfe1e5
fg.secondary     #9aa0a6
fg.muted         #6e747a
border.subtle    #3a3b3e
border.strong    #4a4c50
accent.primary   #4a9eff   // selection, links
accent.danger    #f04757
accent.warning   #fbbc04
accent.success   #3dcc91
server.running   #3dcc91
server.stopped   #6e747a
server.error     #f04757
hotreload.green   #3dcc91   // Static Sync applied
hotreload.amber  #fbbc04   // Compile-only
hotreload.red    #f04757   // Context Reload required
```

### 2.4 Color — `light`

```
bg.canvas        #fafafa
bg.panel         #ffffff
bg.elevated      #f3f3f3
bg.active        #e8eaed
fg.primary       #1f1f1f
fg.secondary     #5f6368
fg.muted         #80868b
border.subtle    #e0e0e0
border.strong    #c0c0c0
accent.primary   #1a73e8
accent.danger    #d93025
accent.warning   #f29900
accent.success   #188038
server.running   #188038
server.stopped   #5f6368
server.error     #d93025
hotreload.*      same as dark
```

## 3. Components in `packages/ui-kit`

These are wrappers around Theia + React that other extensions
consume. Naming convention: `Kairo<Thing>`, e.g. `KairoPane`,
`KairoToolbar`, `KairoServerStatusBadge`, `KairoDeploymentTimeline`.

| Component | Purpose |
|-----------|---------|
| `KairoLayout`         | Top-level grid: activity bar / sidebar / editor / aux / panel / status |
| `KairoServerStatusBadge` | Status pill used in tool bar and Servers view |
| `KairoDeploymentTimeline` | Compact list view of past publishes |
| `KairoHotReloadBanner` | One-line banner explaining the current hot-reload mode |
| `KairoEncodingIndicator` | Encoding + EOL in status bar |
| `KairoProblemsList`    | Standard problems table |
| `KairoSearchResults`   | Search results with preview pane |
| `KairoDebugConsole`    | DAP REPL with `> ` prompt, history, completion |
| `KairoWelcomePanel`    | First-run / empty-workspace experience |
| `KairoConfirm`         | Standard confirmation dialog (used for destructive ops) |

All components have `data-testid` and ARIA roles. Tests in
`tests/e2e/ui/` rely on them.

## 4. Keyboard model

### 4.1 Cross-platform bindings

| Action | Win/Linux | macOS |
|--------|-----------|-------|
| Quick open file | `Ctrl+P` | `Cmd+P` |
| Command palette | `Ctrl+Shift+P` | `Cmd+Shift+P` |
| Find in file | `Ctrl+F` | `Cmd+F` |
| Replace in file | `Ctrl+H` | `Cmd+Option+F` |
| Find in workspace | `Ctrl+Shift+F` | `Cmd+Shift+F` |
| Replace in workspace | `Ctrl+Shift+H` | `Cmd+Shift+H` |
| Go to definition | `F12` | `F12` |
| Peek definition | `Alt+F12` | `Option+F12` |
| Find references | `Shift+F12` | `Shift+F12` |
| Open symbol (file) | `Ctrl+O` | `Cmd+O` |
| Open symbol (workspace) | `Ctrl+T` | `Cmd+T` |
| Rename | `F2` | `F2` |
| Trigger suggestion | `Ctrl+Space` | `Cmd+Space` (configurable; macOS conflict) |
| Start debug | `F5` | `F5` |
| Stop debug | `Shift+F5` | `Shift+F5` |
| Toggle breakpoint | `F9` | `F9` |
| Step over | `F10` | `F10` |
| Step into | `F11` | `F11` |
| Step out | `Shift+F11` | `Shift+F11` |

macOS uses `Cmd` for the OS-level shortcuts; we also accept `Ctrl` as
a fallback for muscle memory from Windows keyboards.

### 4.2 Focus order

- Activity bar → sidebar tree → editor area → bottom panel → status
  bar. `F6` cycles focus regions.
- `Tab` inside a tree expands/collapses; arrow keys navigate.

## 5. Empty / loading / error / offline states

Every view must handle four states explicitly. We do not ship blank
or unstyled fallbacks.

| State | Visual rule |
|-------|-------------|
| Empty     | Centered glyph + 1-sentence reason + 1 CTA button |
| Loading   | Skeleton with progressive reveal; never a spinner alone |
| Error     | Error code (machine) + plain-language cause + 1 suggested next action |
| Offline   | "Connection lost — retrying…" with a "Retry now" button |

In server mode the bottom-right of the status bar shows the
connection state: `●Connected`, `◌Reconnecting…`, `✕Disconnected`.

## 6. Accessibility

- All interactive elements reachable by `Tab`, in a sensible order.
- Visible focus ring (2 px accent, 3:1 contrast on every background).
- All icons have a tooltip AND an `aria-label`.
- Color is **never** the only signal — server status has a glyph and
  text label, not just a green dot.
- Minimum target size 24 × 24 px for buttons, 32 × 32 for primary
  actions in tool bar.
- Respects `prefers-reduced-motion`: animations ≤ 150 ms, no parallax.

## 7. Anti-patterns (rejected designs)

- **No splash-of-logo welcome.** The Welcome page is functional: recent
  projects + new project + import.
- **No modal stacking.** Max 1 modal at a time. Settings open in a side
  drawer, not a dialog over the editor.
- **No unsolicited toasts.** Confirmations only for state-changing
  actions.
- **No "AI" surface area in v1.** v1 has no AI panel.
- **No infinite-scroll log views.** Logs are paged with a load-more
  button. We do not render 10 000 lines in the DOM.

## 8. Welcome / first-run flow

Four steps, no more:

1. **Pick a folder** or **import a sample**.
2. **Detect project layout** (read-only scan; user reviews results).
3. **Choose toolchain** (JDK) and **server runtime** (Tomcat 6.0.53
   bundled, or import your own).
4. **Open workspace**.

The user can skip step 3 and come back. Nothing destructive happens
during these four steps.

## 9. Iconography

- Use `@vscode/codicons` (already part of Theia) for common icons.
- Custom icons live in `packages/ui-kit/icons/` as SVG, single
  stroke, 16 / 20 / 24 px.
- Server status: filled circle `●`, hollow circle `◌`, cross `✕`.
- Hot-reload mode colors map exactly to the tokens in §2.

## 10. Theme switch

- File → Preferences → Color Theme.
- `Ctrl+K Ctrl+T` (Win/Linux) / `Cmd+K Cmd+T` (macOS).
- The active theme persists per user, not per workspace.
