# Kairo IDE Frontend Widget UI/UX Inventory Report

**Date:** 2026-07-31  
**Scope:** `git-extension`, `svn-extension`, `search-extension`, `sql-extension`, `test-extension`, `ui-kit` browser widgets  
**Objective:** Audit shared token/CSS class adoption, inline-style usage, ad-hoc class names, and i18n readiness across frontend widgets. Provide a per-file renovation priority matrix.

---

## 1. Executive Summary

| Dimension | Assessment |
|-----------|------------|
| **Shared CSS adoption** | Partial. Git/test widgets use `.kairo-widget`, `.kairo-widget-header`, `.kairo-widget-toolbar`, `.kairo-empty` well. Search and SQL widgets live in their own CSS namespaces; SVN diff and Git History rely heavily on inline styles. |
| **Shared token (`tokens.ts`) adoption** | Poor. No widget imports `tokens` for layout/spacing/colors. Most colors come from `--theia-*` CSS variables or hardcoded hex values. |
| **Inline styles** | High in `git-history-widget.tsx`, `git-stash-widget.tsx`, and `svn-diff-widget.tsx`. Search result rows and test-tree indentation also use inline styles. |
| **i18n readiness** | Inconsistent. Many labels are hardcoded in Chinese or English with no `KairoI18nService` keys. Mixed-language UIs exist in the same widget (e.g., Git History shows "Commits" + "搜索中…"). |
| **Empty/error states** | Fragmented. Empty states use `.kairo-empty` in some widgets, raw `<div>` in others. Errors use `theia-error`, `theia-warning`, custom banners, or inline-styled banners rather than `.kairo-error` / `.kairo-error-banner`. |
| **Icons** | Unicode symbols and emoji are used instead of codicons in Git status, test status, SVN lock indicator, and search symbol-kind icons. |

**Overall priority:** Medium-High. Search and SQL widgets are the most visually disjointed and should be renovated first, followed by Git History/SVN Diff inline-style cleanup, then system-wide i18n consolidation.

---

## 2. Shared Infrastructure Inventory

### 2.1 `packages/ui-kit/src/tokens.ts`
- Defines `spacing`, `type`, `radius`, `button`, and `color` tokens for both dark and light themes.
- Exports `ColorTokens`, `getColors(theme)`, `KAIRO_BRAND`, `KAIRO_HOT_RELOAD_LABELS`.
- **Adoption gap:** No audited widget imports from `@kairo/ui-kit` tokens. Colors/spacing are either from `--theia-*` CSS variables or hardcoded.

### 2.2 `packages/ui-kit/src/browser/kairo-theme.css`
Key shared classes available to widgets:

| Class | Purpose |
|-------|---------|
| `.kairo-widget` | Flex column root, full height, overflow hidden |
| `.kairo-widget-header` | Header bar with title + actions |
| `.kairo-widget-title` | Uppercase section title |
| `.kairo-widget-toolbar` | Horizontal action toolbar |
| `.kairo-widget-section` | Bordered content section |
| `.kairo-section-header` / `.kairo-section-title` | Sub-section headers |
| `.kairo-empty` | Centered empty-state placeholder |
| `.kairo-error` / `.kairo-error-banner` | Error banner with brand colors |
| `.kairo-toolbar` / `.kairo-toolbar-group` / `.kairo-toolbar-label` | Toolbar layouts |

**Adoption gap:** Many widgets do not use these classes or duplicate equivalent rules locally.

### 2.3 `packages/ui-kit/src/browser/virtual-list.tsx`
- Generic virtual-scrolling list with keyboard navigation, overscan, and accessibility.
- Used by `search-center-widget`, `find-file-widget`, `find-symbol-widget`, `find-class-widget`, `find-action-widget`.
- Not used by git/svn/sql/test list views, which render full DOM lists.

---

## 3. Per-File Assessment

Legend:
- **Shared classes:** Does it use `.kairo-widget`, `.kairo-widget-header`, `.kairo-widget-toolbar`, `.kairo-empty`, `.kairo-error`?
- **Inline styles:** Amount of `style={{...}}` usage.
- **Ad-hoc classes:** Custom non-shared CSS classes that could be consolidated.
- **i18n:** Are labels hardcoded or driven by `KairoI18nService`?
- **Priority:** Renovation priority (P1 = highest).

### 3.1 Git Extension

| File | Shared Classes | Inline Styles | Ad-hoc Classes | i18n | Priority |
|------|----------------|---------------|----------------|------|----------|
| `git-commit-widget.tsx` | Good (`kairo-widget`, `header`, `section`, `empty`) | Low | `.kairo-git-*`, `.kairo-precommit-*` | Mixed CN/EN hardcoded | P2 |
| `git-history-widget.tsx` | None (entire layout is inline-styled) | **Very High** | `.kairo-history-search-input`, `.kairo-search-highlight` | Mixed CN/EN hardcoded | **P1** |
| `git-stash-widget.tsx` | Partial (`widget`, `header`, `section`, `empty`) | High | None major | Mostly EN hardcoded | P2 |
| `git-diff-widget.tsx` | Good (`widget`, `header`, `empty`) | None | `.kairo-diff-*` | EN hardcoded | P3 |
| `git-changes-widget.tsx` | Good (`widget`, `header`, `toolbar`, `section`, `empty`) | None | `.kairo-git-*` | Mixed CN/EN hardcoded | P2 |

**Git extension findings:**
- `git-commit-widget` uses `theia-success` / `theia-error` / `kairo-warning` instead of `.kairo-error` / `.kairo-error-banner`.
- Pre-commit check icons use unicode (`✓`, `✗`, `⏱`, `!`, `-`) rather than codicons.
- Commit result banners and action button labels lack i18n keys.
- `git-history-widget` is the worst offender: the root container, header, search bar, commit list, and detail panel are all inline-styled with `--theia-*` variables.

### 3.2 SVN Extension

| File | Shared Classes | Inline Styles | Ad-hoc Classes | i18n | Priority |
|------|----------------|---------------|----------------|------|----------|
| `svn-changes-widget.tsx` | Partial (`widget`, `header`, `toolbar`, `section`, `empty`) | Low | `.kairo-svn-*` (many) | EN hardcoded | **P1** |
| `svn-history-widget.tsx` | Partial (`widget`, `header`, `toolbar`, `empty`) | Low | `.kairo-svn-*` (many) | EN hardcoded | **P1** |
| `svn-diff-widget.tsx` | None | **Very High** (`styles` object) | `.kairo-svn-diff-widget-root` only | EN hardcoded | **P1** |

**SVN extension findings:**
- `svn-changes-widget` and `svn-history-widget` embed large `<style>{...}</style>` blocks with duplicated layout rules (file list, context menu, history list) that overlap with `kairo-theme.css`.
- `svn-diff-widget` defines a full `styles: { [k: string]: React.CSSProperties }` object and applies inline styles to every element (toolbar, inputs, buttons, error banner, status bar, editor container).
- Status badge colors rely on `--theia-gitDecoration-*` variables, which is semantically odd for SVN.
- Lock indicator uses emoji (`🔒`).
- Context menu is custom-built rather than using Theia context-menu API or shared menu classes.

### 3.3 Search Extension

| File | Shared Classes | Inline Styles | Ad-hoc Classes | i18n | Priority |
|------|----------------|---------------|----------------|------|----------|
| `search-center-widget.tsx` | None (uses `search-center.css`) | Medium (result row buttons) | `.kairo-idea-*`, `.kairo-search-preview-*` | CN hardcoded | **P1** |
| `search-everywhere-widget.tsx` | None (uses `search-center.css`) | None | `.kairo-everywhere*` | EN hardcoded | P2 |
| `find-symbol-widget.tsx` | None (uses `search-center.css`) | Medium (result row buttons) | `.kairo-find-*` | CN hardcoded | P2 |
| `find-file-widget.tsx` | None (uses `search-center.css`) | Medium (result row buttons) | `.kairo-find-*` | CN hardcoded | P2 |
| `find-class-widget.tsx` | None (uses `search-center.css`) | Medium (result row buttons) | `.kairo-find-*` | CN hardcoded | P2 |
| `find-action-widget.tsx` | None (uses `search-center.css`) | Medium (result row buttons) | `.kairo-find-*` | CN hardcoded | P2 |

**Search extension findings:**
- Search widgets do not use `kairo-theme.css` widget classes; they import `search-center.css`, creating a parallel design system.
- `search-everywhere-widget` uses raw `<div>` for loading/idle/empty/error states instead of `.kairo-empty` or `.kairo-error-banner`.
- Category tabs are generated by string slicing (`category[0].toUpperCase() + category.slice(1)`) with no i18n.
- Symbol/class/action icons are unicode characters instead of codicons.
- `find-*` result item buttons carry inline flex/gap/padding styles that could move to `.kairo-find-item`.

### 3.4 SQL Extension

| File | Shared Classes | Inline Styles | Ad-hoc Classes | i18n | Priority |
|------|----------------|---------------|----------------|------|----------|
| `sql-results-widget.tsx` | None (`.sql-results-widget`) | None | `.sql-results-*` | EN hardcoded | **P1** |
| `sql-editor-widget.tsx` | None (`.sql-editor-widget`) | None | `.sql-editor-*`, `.sql-history-*` | EN hardcoded | **P1** |
| `sql-connection-widget.tsx` | None (`.sql-connection-widget`) | Low (status dot color) | `.sql-connection-*` | EN hardcoded | **P1** |

**SQL extension findings:**
- All SQL widgets use a completely separate `.sql-*` class namespace, ignoring `kairo-theme.css`.
- `sql-connection-widget` hardcodes connection-status colors (`#5cb85c`, `#d9534f`, etc.) instead of tokens.
- Uses browser `window.confirm` and `alert()` for delete/import confirmations.
- Empty/error states are custom rather than `.kairo-empty` / `.kairo-error`.

### 3.5 Test Extension

| File | Shared Classes | Inline Styles | Ad-hoc Classes | i18n | Priority |
|------|----------------|---------------|----------------|------|----------|
| `test-tree-widget.tsx` | Good (`widget`, `header`, `toolbar`, `empty`) | Medium (tree indentation) | `.kairo-test-*` | EN hardcoded | P2 |
| `test-output-widget.tsx` | Good (`widget`, `header`, `toolbar`, `empty`, `section-title`) | None | `.kairo-test-*` | EN hardcoded | P3 |

**Test extension findings:**
- Tree indentation uses inline `paddingLeft: `${depth * 16 + 4}px``, which is functional but not token-driven.
- Status icons use unicode (`○`, `◐`, `✓`, `✗`, `⦸`, `⚠`) instead of codicons.
- Uses `theia-error` instead of `.kairo-error`.
- Otherwise consistent with the shared widget model.

### 3.6 UI Kit

| File | Shared Classes | Inline Styles | Ad-hoc Classes | i18n | Priority |
|------|----------------|---------------|----------------|------|----------|
| `virtual-list.tsx` | N/A | Low (necessary absolute positioning) | N/A | N/A | P3 |
| `tokens.ts` | N/A | N/A | N/A | N/A | P3 |
| `kairo-theme.css` | N/A | N/A | N/A | N/A | P3 |

---

## 4. Common Anti-Patterns

| Anti-Pattern | Examples | Impact |
|--------------|----------|--------|
| **Inline style bloat** | `git-history-widget.tsx`, `svn-diff-widget.tsx`, `git-stash-widget.tsx` | Breaks theme consistency, hard to override, increases bundle size |
| **Parallel CSS namespaces** | `search-center.css`, `.sql-*` classes | Prevents global theme updates, duplicates rules |
| **Embedded `<style>` blocks** | `svn-changes-widget.tsx`, `svn-history-widget.tsx` | Same as above; scoped styles are not reused |
| **Theia variables over Kairo tokens** | Most widgets use `--theia-*` | Ties UI to Theia internals, bypasses Kairo design system |
| **Hardcoded colors** | `sql-connection-widget.tsx` status dots | Breaks dark/light theme support |
| **Unicode/emoji icons** | Git status, test status, SVN lock, search symbol icons | Inconsistent with IDE icon language; accessibility issues |
| **Browser native dialogs** | `sql-connection-widget.tsx` (`confirm`, `alert`) | Inconsistent UX, poor testability |
| **Mixed-language labels** | Git History, Git Commit | Unprofessional, blocks full localization |
| **Raw `<div>` status states** | `search-everywhere-widget.tsx` | No shared empty/error styling |

---

## 5. Renovation Priority Matrix

### P1 — Must Renovate First

| File | Primary Issue | Recommended Action |
|------|---------------|-------------------|
| `svn-diff-widget.tsx` | Entire UI inline-styled | Extract CSS to `kairo-theme.css` or a scoped CSS file; adopt `.kairo-widget`, `.kairo-toolbar`, `.kairo-error-banner` |
| `git-history-widget.tsx` | Entire UI inline-styled | Move layout/styles to shared classes; add `VirtualList` for large commit lists |
| `search-center-widget.tsx` | Parallel `search-center.css` design system | Reconcile with `kairo-theme.css`; replace inline result-row styles; i18n labels |
| `sql-results-widget.tsx` | Separate `.sql-*` namespace | Migrate to `.kairo-widget`, `.kairo-empty`, `.kairo-error`; adopt tokens |
| `sql-editor-widget.tsx` | Separate `.sql-*` namespace | Same as above; replace `window.confirm` with shared confirm dialog |
| `sql-connection-widget.tsx` | Separate namespace + hardcoded colors | Same as above; use `tokens.color.dark/light` for status dots |

### P2 — Should Renovate Next

| File | Primary Issue | Recommended Action |
|------|---------------|-------------------|
| `git-commit-widget.tsx` | `theia-*` banners, mixed i18n, unicode icons | Switch to `.kairo-error-banner`; codicons; add i18n keys |
| `git-stash-widget.tsx` | Inline input/list styles | Move to shared form/list classes |
| `git-changes-widget.tsx` | `theia-error`, mixed i18n | Use `.kairo-error`; add i18n keys |
| `svn-changes-widget.tsx` | Embedded `<style>` block | Extract CSS; use shared empty/error states |
| `svn-history-widget.tsx` | Embedded `<style>` block | Extract CSS; replace emoji lock icon |
| `search-everywhere-widget.tsx` | Raw status `<div>`s, non-i18n tabs | Use `.kairo-empty`/`.kairo-error`; i18n category labels |
| `find-symbol/file/class/action-widget.tsx` | Inline result-row styles, unicode icons | Move row styles to CSS; codicons for symbol kinds |
| `test-tree-widget.tsx` | Inline indentation, unicode icons | Tokenize indentation; codicons |

### P3 — Polish / Low Priority

| File | Primary Issue | Recommended Action |
|------|---------------|-------------------|
| `git-diff-widget.tsx` | Custom `.kairo-diff-*` classes | Fine if kept; ensure they reference tokens |
| `test-output-widget.tsx` | Mostly clean | Add i18n keys, codicons |
| `virtual-list.tsx` | Inline positioning necessary | Keep as-is; document |

---

## 6. Recommended Next Steps

1. **Create shared component primitives** (in `ui-kit`) for:
   - `KairoEmptyState` (replaces raw empty `<div>` / `.kairo-empty`)
   - `KairoErrorBanner` (replaces `theia-error`, inline error banners)
   - `KairoToolbar` / `KairoToolbarButton`
   - `KairoStatusBadge` (with token-driven colors)
2. **Codicon mapping** for:
   - Git file status
   - SVN file status + lock
   - Test status
   - LSP symbol kinds
3. **i18n key sweep** for all widgets in this report; consolidate under `@kairo/i18n`.
4. **CSS migration sprints**:
   - Phase A: `svn-diff-widget.tsx` + `git-history-widget.tsx` (highest inline-style debt)
   - Phase B: `search-center.css` → `kairo-theme.css`
   - Phase C: `.sql-*` namespace → `.kairo-*`
5. **Lint rule:** prohibit inline `style={{...}}` in new widget code except for dynamic values; enforce `@kairo/ui-kit` token usage.

---

## 7. Appendix — Token/Class Quick Reference

**Tokens to promote:**
- `tokens.spacing.*`
- `tokens.type.*`
- `tokens.color.dark/light.*`
- `tokens.button.*`

**Classes to promote:**
- `.kairo-widget`, `.kairo-widget-header`, `.kairo-widget-title`, `.kairo-widget-toolbar`, `.kairo-widget-section`
- `.kairo-section-header`, `.kairo-section-title`
- `.kairo-empty`
- `.kairo-error`, `.kairo-error-banner`
- `.kairo-toolbar`, `.kairo-toolbar-group`, `.kairo-toolbar-label`, `.kairo-toolbar-actions`

**Classes to deprecate/avoid:**
- `theia-error`, `theia-warning`, `theia-success` (use `.kairo-error` / `.kairo-error-banner`)
- Inline `style={{...}}` layout objects
- Widget-local `<style>` blocks
