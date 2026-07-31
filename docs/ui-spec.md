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

Empty states must use the standard `.kairo-empty-state` structure:

```html
<div class="kairo-empty-state" role="status">
  <div class="kairo-empty-state-glyph">
    <i class="codicon codicon-rocket" aria-hidden="true"></i>
  </div>
  <h3 class="kairo-empty-state-title">No deployments yet</h3>
  <p class="kairo-empty-state-reason">Build and deploy your project to see deployment history here.</p>
  <div class="kairo-empty-state-action">
    <button class="theia-button">Build & Deploy</button>
  </div>
</div>
```

The glyph is decorative and must be a `@vscode/codicons` icon (`<i class="codicon codicon-<name>"></i>`), the title is a short
label, the reason explains the next step, and the CTA executes the
primary action that produces data. Empty states are always centered
and vertically distributed by `.kairo-empty-state`.

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

## 11. Activity bar feedback

The left activity bar must provide visible hover and active states so
users can see which tool is selected and which icon is being pressed.

| State | Rule |
|-------|------|
| Hover  | Slight background lift (`rgba(255,255,255,0.08)` in dark). |
| Active | Left accent border using `--theia-activityBar-activeBorder` (fallback to Kairo primary) and a stronger background lift. |
| Focus  | Visible focus ring (`1px solid --theia-focusBorder`). |
| Icon   | Icons at 85 % opacity by default, 100 % on hover/active. |

These rules are implemented in `packages/ui-kit/src/browser/kairo-theme.css`
with selectors that cover the common Theia activity-bar class variants.

## 12. Debug tool window layout

The IDEA-style Debug Tool Window follows a fixed chrome:

1. **Toolbar** — IDEA-style debug actions (rerun, resume, pause, stop,
   step over/into/out, mute breakpoints, etc.).
2. **Status bar** — one-line session state (`No debug session`,
   `Suspended`, `Running`) with color coding.
3. **Tab bar** — `Debugger` / `Console`.
4. **Content area**:
   - **Debugger tab**: left panel (Frames + Breakpoints, vertically
     split), right panel (Variables + Watches, horizontally split).
   - **Console tab**: placeholder pointing to the bottom-panel Debug
     Console with an `Open Console` CTA.

When no debug session is active the content area shows the standard
`.kairo-empty-state` with a bug glyph, the `No debug session` title,
a reason sentence, and a CTA to open the debug view.

All chrome text is localized via `KairoI18nService` keys under
`debug.toolWindow.*`.

## 13. Internationalization (i18n)

All user-facing strings in Kairo-specific widgets, commands, and status
bar entries must be localized. The source of truth is
`packages/i18n/src/locales/en.ts`; every key defined there must also
appear in `packages/i18n/src/locales/zh-CN.ts`.

Rule of thumb:

- Add new keys to `en.ts` first.
- Add matching translations to `zh-CN.ts`.
- Use `KairoI18nService.t(key, params?)` in TypeScript widgets.
- React components receive the service as a prop and call `t()`; they
  subscribe to `i18n.onDidChangeLanguage` to re-render on language
  switches.
- Plain `Widget` subclasses may inject `KairoI18nService` as a property
  and fall back to English strings when the service is unavailable
  (e.g., in unit tests that instantiate the widget directly).

Never hardcode Chinese or English strings in widget JSX/TSX, status
bar fallbacks, or accessibility labels.

## 15. Menu hierarchy and spacing

Kairo uses the standard Theia menu bar. Kairo-specific commands are
injected into existing top-level menus; there is no dedicated **Kairo**
menu.

### 15.1 Top-level order

```
File  Edit  View  Selection  Go  Run  Terminal  Window  Help
```

### 15.2 Kairo command placement

| Menu | Entry | Icon |
|------|-------|------|
| File | Import Kairo Project… | `codicon-folder-opened` |
| Run | Start Server / Stop Server / Debug Server | `codicon-play` / `codicon-debug-stop` / `codicon-debug-alt` |
| Run | Run Configurations | `codicon-run-all` |
| View | Servers / Run and Debug / Deployments | `codicon-server` / `codicon-bug` / `codicon-cloud-upload` |

### 15.3 Visual rules

- Every menu item that opens a Kairo view or executes a Kairo command
  carries a `@vscode/codicons` icon on its left.
- Icon + label spacing is `8 px`.
- Use menu separators to group related actions; no group exceeds 12
  items without a divider.
- Disabled items are shown at `50 %` opacity with the standard Theia
  disabled cursor.

## 16. Tool window panel layout (Servers / Build / Deploy / Log)

All Kairo tool windows share one chrome so users learn one layout:

1. **Header** — widget title on the left, status badge or line count on
   the right. The header never contains action buttons.
2. **Toolbar** — directly below the header, left aligned. Uses
   `.theia-button.toolbar` for icon+text actions. Contains at most one
   `.main` button.
3. **Content area** — tree, list, log viewer, or the standard empty
   state.
4. **Inline banner** — history errors or connection warnings appear as a
   `.kairo-error-banner` inside the content area, never appended to the
   status bar sentence.

Toolbar action order within a panel:

1. Primary action (`.main`)
2. Secondary actions (`.secondary`)
3. Icon+text utility actions (`.toolbar`)
4. Destructive action (`.danger`, rightmost)

### 16.1 Servers

See §13.2 for the server view specification.

### 16.2 Build

- Toolbar: **Build** (`.main`), **Clean** (`.secondary`), **Stop**
  (`.toolbar`), **Show Output** (`.toolbar`).
- Empty state uses `codicon-tools`, the title *No build history*, and a
  CTA to run the first build.

### 16.3 Deployments

- Toolbar: **Deploy** (`.main`), **Refresh** (`.secondary`).
- Each deployment row shows timestamp, target, status pill, and an
  overflow menu for details.

### 16.4 Log viewer

See §13.3 for the log viewer specification.

## 17. CSS source of truth

The canonical implementation lives in
`packages/ui-kit/src/browser/kairo-theme.css`. Widgets must reuse these
classes instead of inventing local styles:

| Class | Purpose |
|-------|---------|
| `.kairo-empty-state` | Empty state container |
| `.kairo-empty-state-glyph` | Decorative codicon wrapper |
| `.kairo-empty-state-title` | Title |
| `.kairo-empty-state-reason` | One-sentence explanation |
| `.kairo-empty-state-action` | CTA button wrapper |
| `.kairo-server-status` | Server status pill |
| `.kairo-toolbar` | Toolbar wrapper |
| `.kairo-status-bar-group` | Status bar logical group |
| `.kairo-status-bar-separator` | Vertical separator between groups |
| `.kairo-hot-reload-banner` | One-line hot reload indicator |
| `.kairo-error-banner` | Inline error/history banner |

Color tokens are defined in `kairo-theme.ts` and applied through
`kairo-theme-contribution.ts`. The canonical accent is `#4a9eff` for
both dark and light themes.

## 18. Browser / Desktop parity

The same CSS, React widgets, and i18n keys are used for the browser
(`apps/browser`) and desktop (`apps/desktop`) products. The only
permitted differences are:

- Desktop uses the Electron main process for window lifecycle and
  process cleanup.
- Browser binds the backend to `127.0.0.1`.

No layout, color, icon, or spacing may diverge between the two targets.

## 19. Verification checklist

Every UI change must leave the following artifacts:

1. `pnpm tsc --noEmit` passes with 0 errors.
2. `pnpm build` passes for all affected packages.
3. Regression screenshots in `docs/screenshots/current-ui/` covering
   the changed view in both English and, if i18n is touched, Chinese.
4. Accessibility spot check: every icon-only button has both
   `aria-label` and `title`; color is not the only state signal.

## 20. UI/UX optimization guidelines (Session 13)

This section captures the unified redesign decisions that came out of
analyzing the `docs/screenshots/current-ui/` baseline. The goal is a
consistent, calm, professional IDE surface for both the Windows EXE and
browser editions.

### 20.1 Color and surface consistency

- The canonical Kairo accent is `--kairo-primary` `#4a9eff` (blue) in
  dark mode and `#1a73e8` in light mode. No widget may use purple or
  magenta tints for branding, titles, buttons, or panel backgrounds.
- Panel chrome (headers, toolbars, sidebars) uses `--kairo-bg-secondary`
  (`#252629` dark / `#ffffff` light). Content areas use `--kairo-bg`
  (`#1e1f22` dark / `#fafafa` light).
- Performance cards, log viewers, and server lists must not introduce
  their own tinted surfaces; they reuse the standard panel/content
  backgrounds above.
- Empty-state glyphs use `--kairo-text-secondary` at ~70 % opacity; they
  are decorative and must never be colored with accent or status colors.

### 20.2 Panel header deduplication

When a Kairo widget lives inside a Theia view container, Theia renders a
part header with the view title. The widget's own `.kairo-widget-header`
is the single source of truth; the Theia part header must be hidden.

Implementation: strengthen the override in `kairo-theme.css` so it wins
over Theia's current selectors regardless of DOM nesting:

```css
.theia-view-container .theia-header,
.p-Widget.theia-view-container > .theia-header,
.theia-view-container > div > .theia-header,
.theia-view-container > .p-Panel > .theia-header {
    display: none !important;
}
```

### 20.3 Button hierarchy

Each toolbar, widget, and dialog has exactly one primary (`.main`) CTA
unless two primary actions are semantically equal and equally frequent.

| Variant | Use |
|---------|-----|
| `.theia-button.main` | The single primary action in the area (New, Save, Start, Deploy). |
| `.theia-button.secondary` | Non-destructive alternatives (Cancel, Refresh, Browse). |
| `.theia-button.toolbar` | Icon+text utilities inside widget toolbars (Clear, Stop, Show Output). |
| `.theia-button.danger` | Destructive actions (Delete, Remove). |

Specific rules:

- Run Configurations toolbar: **New Configuration** is primary; **Refresh**
  is secondary; **Run** and **Debug** are secondary and disabled until a
  configuration exists and is selected.
- Debug tool window toolbar: icon-only buttons (`.kairo-debug-toolbar-btn`),
  no primary fill.
- Empty-state CTAs use `.main` when they create the missing object.

### 20.4 Empty / offline states

Every Kairo view must use the standard `.kairo-empty-state` structure
from §5. Plain text fallbacks are not acceptable.

| View | Glyph | Title | CTA |
|------|-------|-------|-----|
| Variables | `codicon-debug-variables` | No variables | Start Debugging |
| Call Stack | `codicon-debug-stackframe` | No call stack | Start Debugging |
| Breakpoints | `codicon-debug-breakpoint` | No breakpoints | Open a File |
| Watches | `codicon-eye` | No watches | Add Watch |
| Tests | `codicon-beaker` | No tests | Run Tests |
| Deployments | `codicon-rocket` | No deployments yet | Build & Deploy |
| Build | `codicon-tools` | No build history | Run Build |
| Servers (offline) | `codicon-plug` | Disconnected | Reconnect |
| Log viewer | `codicon-output` | No log output | (none when filtered) |

Offline states keep the same glyph + title + reason pattern; the CTA is
**Reconnect** or **Retry now**.

### 20.5 Status bar

- The status bar is monospaced-friendly, 12 px, and organized in logical
  groups separated by a subtle vertical rule.
- Placeholder / non-critical values (e.g., `Build: no record`,
  `SVN: not found`, `Debug: unknown`) are dimmed via
  `.kairo-statusbar-placeholder` and collapsed to a compact label when
  space is constrained.
- All status-bar strings are localized; the bar must not mix languages
  when the UI language is switched.
- Severe states (`JDK crashed`, `Server disconnected`) keep full opacity
  and an error/warning glyph so they remain scannable.

### 20.6 Tool window chrome (Servers / Build / Deploy / Log)

All four tool windows share one chrome:

1. **Header** — widget title left, status badge / count right. No buttons.
2. **Toolbar** — left aligned, one primary button maximum, secondary and
   `.toolbar` icon buttons to the right.
3. **Inline banner** — connection errors use `.kairo-error-banner` with an
   icon, one-line reason, and optional CTA. Banners are compact and do
   not dominate the view.
4. **Content** — tree, list, log viewer, or standard empty state.

### 20.7 Debug tool window

- Toolbar: 30 px icon buttons with clear hover/active states and visible
  focus rings.
- Status bar: one-line state, color-coded by session status.
- Tab bar: `Debugger` / `Console`, underlined active tab.
- Empty state uses the bug glyph + **Open Debug View** CTA.
- Variables and call-stack empty states in the side panel follow §20.4.

### 20.8 Welcome page

- Title is `--kairo-primary-light` (#6db3ff), 32 px, no subtitle under it.
- GET STARTED actions are stacked, one primary and two secondary buttons.
- The error banner is dismissible and does not push the quick-start guide
  below the fold.
- Quick-start cards use the standard card surface with hover lift.

### 20.9 Menus and command palette

- All Kairo commands are localized; the command palette must not show a
  mix of English and Chinese commands.
- Menu items carry a codicon on the left and maintain 8 px icon-label
  spacing.
- Disabled items use 50 % opacity.

### 20.10 Preferences

- Search placeholder meets WCAG contrast.
- Settings tree items have comfortable 4 px vertical padding and 4 px
  border radius.
- The Kairo language dropdown shows human-readable labels only
  (e.g., `English`, `简体中文`), not raw locale codes.

### 20.11 Browser / desktop parity

No layout, color, icon, or spacing may diverge between the browser and
 desktop builds. The same CSS and i18n keys apply to both.
