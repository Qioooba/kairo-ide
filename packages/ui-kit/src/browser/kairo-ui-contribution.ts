/**
 * Kairo UI Kit — Frontend Application Contribution
 *
 * Applies the Kairo professional dark theme, inspired by
 * JetBrains IDEs and Zed Editor. Single source of truth for
 * all UI styling.
 *
 * NOTE: there is no companion `kairo-theme.css` — this file
 * is the only place where Kairo styles live. They are injected
 * into a `<style id="kairo-theme-style">` element at app start.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { CommandService } from '@theia/core/lib/common/command';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';

// ============================================================================
// Design tokens (also exported from tokens.ts; the CSS-variable map below
// is the only thing the CSS itself reads)
// ============================================================================

const KAIRO_DARK_VARS: Record<string, string> = {
  // ----- Layout surface (3-tone dark gray) -----
  '--theia-layout-color0': '#1e1f22',       // canvas
  '--theia-layout-color1': '#252629',       // panel
  '--theia-layout-color2': '#2b2c30',       // elevated
  '--theia-layout-color3': '#37393d',       // active
  '--theia-layout-color4': '#2b2c30',
  '--theia-layout-color5': '#1e1f22',
  '--theia-layout-color6': '#252629',

  // ----- Typography -----
  '--theia-ui-font-color0': '#e6e7ea',
  '--theia-ui-font-color1': '#c5c8cc',
  '--theia-ui-font-color2': '#8b8f96',
  '--theia-ui-font-color3': '#5d6166',
  '--theia-disabled-color0': '#45484d',
  '--theia-disabled-color1': '#52565c',
  '--theia-descriptionForeground': '#8b8f96',

  // ----- Brand & accent (Kairo violet) -----
  '--theia-brand-color0': '#7c5cbf',
  '--theia-brand-color1': '#8d6dd0',
  '--theia-brand-color2': '#5e42a6',
  '--theia-brand-color3': '#4a3385',
  '--theia-accent-color0': '#7c5cbf',
  '--theia-accent-color1': '#8d6dd0',
  '--theia-accent-color2': '#37393d',
  '--theia-accent-color3': '#3d2f5f',
  '--theia-focusBorder': '#7c5cbf',
  '--theia-activeBorder': '#7c5cbf',
  '--theia-selected-text-background': 'rgba(124,92,191,0.28)',
  '--theia-textLink-foreground': '#a78be0',
  '--theia-textLink-activeForeground': '#b8a0e8',
  '--theia-icon-foreground': '#c5c8cc',
  '--theia-foreground': '#e6e7ea',
  '--theia-textPreformat-foreground': '#d0bbff',
  '--theia-textSeparator-foreground': '#2e3136',

  // ----- Semantic colors -----
  '--theia-success-color0': '#22c55e',
  '--theia-success-color1': '#4ade80',
  '--theia-success-color2': '#16a34a',
  '--theia-success-color3': '#15803d',
  '--theia-warning-color0': '#f59e0b',
  '--theia-warning-color1': '#fbbf24',
  '--theia-warning-color2': '#d97706',
  '--theia-warning-color3': '#b45309',
  '--theia-error-color0': '#ef4444',
  '--theia-error-color1': '#f87171',
  '--theia-error-color2': '#dc2626',
  '--theia-error-color3': '#b91c1c',
  '--theia-errorForeground': '#ef4444',

  // ----- Editor -----
  '--theia-editor-background': '#1e1f22',
  '--theia-editor-foreground': '#dfe1e5',
  '--theia-editorGutter-background': '#1e1f22',
  '--theia-editor-lineHighlightBorder': 'transparent',
  '--theia-editor-selectionBackground': '#264f78',
  '--theia-editor-selectionHighlightBackground': 'rgba(124,92,191,0.18)',
  '--theia-editor-selectionForeground': '#dfe1e5',
  '--theia-editor-wordHighlightBackground': 'rgba(255,255,255,0.07)',
  '--theia-editor-wordHighlightStrongBackground': 'rgba(124,92,191,0.22)',
  '--theia-editorCursor-foreground': '#c8a8ff',
  '--theia-editorWhitespace-foreground': 'rgba(255,255,255,0.10)',
  '--theia-editorLineNumber-foreground': '#5d6166',
  '--theia-editorLineNumber-activeForeground': '#c5c8cc',
  '--theia-editorIndentGuide-background': 'rgba(255,255,255,0.06)',
  '--theia-editorIndentGuide-activeBackground': 'rgba(255,255,255,0.14)',
  '--theia-editorIndentGuide': 'rgba(255,255,255,0.06)',
  '--theia-editorRuler-foreground': '#2e3136',
  '--theia-editor-foldBackground': 'rgba(124,92,191,0.08)',
  '--theia-editorGutter-foldingControlForeground': '#6b7076',
  '--theia-editorHoverWidget-background': '#252629',
  '--theia-editorHoverWidget-border': '#3d4148',
  '--theia-editorHoverWidget-statusBarBackground': '#2b2c30',
  '--theia-editorSuggestWidget-background': '#252629',
  '--theia-editorSuggestWidget-border': '#3d4148',
  '--theia-editorSuggestWidget-selectedBackground': '#3d2f5f',
  '--theia-editorSuggestWidget-selectedForeground': '#ffffff',
  '--theia-editorWidget-background': '#252629',
  '--theia-editorWidget-border': '#3d4148',
  '--theia-editorWidget-foreground': '#dfe1e5',
  '--theia-editorCodeLens-foreground': '#6b7076',
  '--theia-editorInlayHint-foreground': '#8b8f96',
  '--theia-editorInlayHint-background': 'rgba(255,255,255,0.05)',
  '--theia-editorLightBulb-foreground': '#f59e0b',
  '--theia-editorLightBulbAutoFix-foreground': '#60a5fa',
  '--theia-editorBracketMatch-border': '#7c5cbf',
  '--theia-editorBracketMatch-background': 'rgba(124,92,191,0.10)',
  '--theia-editorOverviewRuler-bracketMatchForeground': '#7c5cbf',
  '--theia-editorOverviewRuler-rangeHighlightForeground': 'rgba(124,92,191,0.20)',
  '--theia-editorOverviewRuler-errorForeground': 'rgba(239,68,68,0.55)',
  '--theia-editorOverviewRuler-warningForeground': 'rgba(245,158,11,0.55)',
  '--theia-editorOverviewRuler-infoForeground': 'rgba(96,165,250,0.55)',
  '--theia-editorUnicodeHighlight-border': '#d97706',
  '--theia-editorError-foreground': '#ef4444',
  '--theia-editorWarning-foreground': '#f59e0b',
  '--theia-editorInfo-foreground': '#60a5fa',
  '--theia-editorHint-foreground': '#8b8f96',
  '--theia-editorMarkerNavigationError-background': '#ef4444',
  '--theia-editorMarkerNavigationWarning-background': '#f59e0b',
  '--theia-editorMarkerNavigationInfo-background': '#60a5fa',
  '--theia-problemsErrorIcon-foreground': '#ef4444',
  '--theia-problemsWarningIcon-foreground': '#f59e0b',
  '--theia-problemsInfoIcon-foreground': '#60a5fa',
  '--theia-editor-findMatchBackground': 'rgba(245,158,11,0.40)',
  '--theia-editor-findMatchHighlightBackground': 'rgba(245,158,11,0.22)',
  '--theia-editor-findRangeHighlightBackground': 'rgba(124,92,191,0.14)',
  '--theia-editor-linkedEditingBackground': 'rgba(245,158,11,0.16)',
  '--theia-diffEditor-insertedTextBackground': 'rgba(34,197,94,0.14)',
  '--theia-diffEditor-removedTextBackground': 'rgba(239,68,68,0.14)',
  '--theia-diffEditor-diagonalFill': 'rgba(255,255,255,0.05)',
  '--theia-minimap-selectionHighlight': 'rgba(124,92,191,0.30)',
  '--theia-minimap-errorHighlight': 'rgba(239,68,68,0.55)',
  '--theia-minimap-warningHighlight': 'rgba(245,158,11,0.55)',
  '--theia-minimap-findMatchHighlight': 'rgba(245,158,11,0.55)',
  '--theia-peekViewTitle-background': '#2b2c30',
  '--theia-peekView-border': '#3d2f5f',
  '--theia-peekViewResult-background': '#1e1f22',
  '--theia-peekViewEditor-background': '#1a1b1e',

  // ----- Lists -----
  '--theia-list-activeSelectionBackground': '#2d3040',
  '--theia-list-activeSelectionForeground': '#ffffff',
  '--theia-list-focusBackground': '#2a2d30',
  '--theia-list-focusForeground': '#dfe1e5',
  '--theia-list-hoverBackground': 'rgba(255,255,255,0.045)',
  '--theia-list-hoverForeground': '#dfe1e5',
  '--theia-list-inactiveSelectionBackground': 'rgba(255,255,255,0.06)',
  '--theia-list-inactiveSelectionForeground': '#c5c8cc',
  '--theia-list-highlightForeground': '#a78be0',
  '--theia-listFilterWidget-background': '#2a2d30',
  '--theia-listFilterWidget-outline': 'transparent',
  '--theia-listFilterWidget-noMatchesOutline': '#ef4444',

  // ----- Inputs -----
  '--theia-input-background': '#1a1b1e',
  '--theia-input-foreground': '#dfe1e5',
  '--theia-input-border': '#2e3136',
  '--theia-input-placeholderForeground': '#5d6166',
  '--theia-inputOption-activeBorder': '#7c5cbf',
  '--theia-inputOption-activeBackground': 'rgba(124,92,191,0.22)',
  '--theia-dropdown-background': '#2b2c30',
  '--theia-dropdown-border': '#3d4148',
  '--theia-dropdown-listBackground': '#252629',
  '--theia-dropdown-foreground': '#dfe1e5',

  // ----- Buttons -----
  '--theia-button-background': '#7c5cbf',
  '--theia-button-hoverBackground': '#8d6dd0',
  '--theia-button-foreground': '#ffffff',
  '--theia-button-secondaryBackground': '#37393d',
  '--theia-button-secondaryHoverBackground': '#44464c',
  '--theia-button-secondaryForeground': '#dfe1e5',
  '--theia-button-disabledForeground': '#5d6166',
  '--theia-button-border': 'transparent',

  // ----- Activity bar (left rail) -----
  '--theia-activityBar-background': '#1f2024',
  '--theia-activityBar-foreground': '#9ba0a8',
  '--theia-activityBar-inactiveForeground': '#6b7076',
  '--theia-activityBar-activeBorder': '#7c5cbf',
  '--theia-activityBar-border': 'rgba(255,255,255,0.06)',
  '--theia-activityBarBadge-background': '#7c5cbf',
  '--theia-activityBarBadge-foreground': '#ffffff',

  // ----- Sidebar (left) -----
  '--theia-sideBar-background': '#252629',
  '--theia-sideBar-foreground': '#c5c8cc',
  '--theia-sideBar-border': 'rgba(255,255,255,0.06)',
  '--theia-sideBarTitle-foreground': '#dfe1e5',
  '--theia-sideBarSectionHeader-background': '#252629',
  '--theia-sideBarSectionHeader-foreground': '#dfe1e5',
  '--theia-sideBarSectionHeader-border': 'rgba(255,255,255,0.06)',

  // ----- Editor group & tabs -----
  '--theia-editorGroup-border': 'rgba(255,255,255,0.06)',
  '--theia-editorGroupHeader-tabsBackground': '#1e1f22',
  '--theia-editorGroupHeader-tabsBorder': 'rgba(255,255,255,0.06)',
  '--theia-editorGroupHeader-noTabsBackground': '#1e1f22',
  '--theia-tab-activeBackground': '#1e1f22',
  '--theia-tab-activeForeground': '#e6e7ea',
  '--theia-tab-inactiveBackground': '#252629',
  '--theia-tab-inactiveForeground': '#8b8f96',
  '--theia-tab-border': 'rgba(255,255,255,0.06)',
  '--theia-tab-activeBorder': '#7c5cbf',
  '--theia-tab-unfocusedActiveBorder': '#5e42a6',
  '--theia-tab-hoverBackground': '#2b2c30',
  '--theia-tab-hoverForeground': '#c5c8cc',
  '--theia-tab-hoverBorder': 'transparent',
  '--theia-tab-unfocusedActiveBackground': '#252629',
  '--theia-tab-closeButton': '#8b8f96',

  // ----- Editor pane & breadcrumb -----
  '--theia-editorPane-background': '#1e1f22',
  '--theia-breadcrumb-background': '#1e1f22',
  '--theia-breadcrumb-foreground': '#8b8f96',
  '--theia-breadcrumb-activeForeground': '#c5c8cc',

  // ----- Bottom panel (terminal / problems / output) -----
  '--theia-panel-background': '#1e1f22',
  '--theia-panel-border': 'rgba(255,255,255,0.06)',
  '--theia-panelTitle-foreground': '#c5c8cc',
  '--theia-panelTitle-activeForeground': '#e6e7ea',
  '--theia-panelTitle-activeBorder': '#7c5cbf',
  '--theia-panelTitle-inactiveForeground': '#8b8f96',

  // ----- Status bar (SOLID dark, not gradient — matches ID/Zed) -----
  '--theia-statusBar-background': '#1a1b1e',
  '--theia-statusBar-foreground': '#c5c8cc',
  '--theia-statusBar-border': 'rgba(255,255,255,0.08)',
  '--theia-statusBar-noFolderBackground': '#1a1b1e',
  '--theia-statusBarItem-activeBackground': 'rgba(255,255,255,0.08)',
  '--theia-statusBarItem-hoverBackground': 'rgba(255,255,255,0.05)',
  '--theia-statusBarItem-prominentBackground': '#7c5cbf',
  '--theia-statusBarItem-prominentHoverBackground': '#8d6dd0',
  '--theia-statusBarItem-remoteBackground': '#7c5cbf',
  '--theia-statusBarItem-remoteForeground': '#ffffff',

  // ----- Title bar (top) -----
  '--theia-titleBar-activeBackground': '#1e1f22',
  '--theia-titleBar-activeForeground': '#dfe1e5',
  '--theia-titleBar-inactiveBackground': '#1e1f22',
  '--theia-titleBar-inactiveForeground': '#8b8f96',

  // ----- Menu & menubar -----
  '--theia-menu-background': '#252629',
  '--theia-menu-foreground': '#dfe1e5',
  '--theia-menu-selectionBackground': '#3d2f5f',
  '--theia-menu-selectionForeground': '#ffffff',
  '--theia-menu-separatorBackground': '#2e3136',
  '--theia-menubar-selectionBackground': 'rgba(255,255,255,0.06)',
  '--theia-menubar-selectionForeground': '#ffffff',
  '--theia-menu-border': '#3d4148',

  // ----- Notifications -----
  '--theia-notification-background': '#252629',
  '--theia-notification-foreground': '#dfe1e5',
  '--theia-notification-border': '#3d4148',
  '--theia-notificationHeader-background': '#2b2c30',
  '--theia-notificationCenterHeader-background': '#252629',
  '--theia-notificationLink-foreground': '#a78be0',

  // ----- Badge -----
  '--theia-badge-background': '#3d4148',
  '--theia-badge-foreground': '#dfe1e5',

  // ----- Scrollbar -----
  '--theia-scrollbarSlider-background': 'rgba(255,255,255,0.12)',
  '--theia-scrollbarSlider-hoverBackground': 'rgba(255,255,255,0.22)',
  '--theia-scrollbarSlider-activeBackground': 'rgba(255,255,255,0.28)',

  // ----- Welcome page -----
  '--theia-welcomePage-background': '#1e1f22',
  '--theia-welcomePage-buttonBackground': '#7c5cbf',
  '--theia-welcomePage-buttonHoverBackground': '#8d6dd0',
  '--theia-welcomePage-tileBackground': '#252629',

  // ----- Widgets -----
  '--theia-widget-shadow': '0 8px 28px rgba(0,0,0,0.45)',
  '--theia-widget-border': 'rgba(255,255,255,0.06)',
  '--theia-sash-hoverBorder': '#7c5cbf',
  '--theia-contrastBorder': 'transparent',
  '--theia-contrastActiveBorder': 'transparent',
  '--theia-progressBar-background': '#7c5cbf',

  // ----- Terminal -----
  '--theia-terminal-background': '#18191c',
  '--theia-terminal-foreground': '#d4d6da',
  '--theia-terminal-ansiBlack': '#1e1f22',
  '--theia-terminal-ansiRed': '#ef4444',
  '--theia-terminal-ansiGreen': '#22c55e',
  '--theia-terminal-ansiYellow': '#f59e0b',
  '--theia-terminal-ansiBlue': '#60a5fa',
  '--theia-terminal-ansiMagenta': '#c084fc',
  '--theia-terminal-ansiCyan': '#22d3ee',
  '--theia-terminal-ansiWhite': '#c5c8cc',
  '--theia-terminal-ansiBrightBlack': '#5d6166',
  '--theia-terminal-ansiBrightRed': '#f87171',
  '--theia-terminal-ansiBrightGreen': '#4ade80',
  '--theia-terminal-ansiBrightYellow': '#fbbf24',
  '--theia-terminal-ansiBrightBlue': '#93c5fd',
  '--theia-terminal-ansiBrightMagenta': '#d8b4fe',
  '--theia-terminal-ansiBrightCyan': '#67e8f9',
  '--theia-terminal-ansiBrightWhite': '#ffffff',
  '--theia-terminalCursor-foreground': '#c8a8ff',
  '--theia-terminalCursor-background': '#c8a8ff',
  '--theia-terminal-selectionBackground': 'rgba(124,92,191,0.28)',
  '--theia-terminalCommandDecoration-defaultBackground': 'rgba(255,255,255,0.14)',
  '--theia-terminalCommandDecoration-successBackground': '#22c55e',
  '--theia-terminalCommandDecoration-errorBackground': '#ef4444',
  '--theia-terminalOverviewRuler-cursorForeground': 'rgba(200,168,255,0.55)',
  '--theia-terminalStickyScroll-background': '#252629',
  '--theia-terminalStickyScrollHover-background': '#2b2c30',

  // ----- Debug -----
  '--theia-debugToolBar-background': '#252629',
  '--theia-debugToolBar-border': '#3d4148',
  '--theia-debugExceptionWidget-background': '#4a2020',
  '--theia-debugExceptionWidget-border': '#ef4444',

  // ----- Quick input / command palette -----
  '--theia-quickInput-background': '#252629',
  '--theia-quickInput-foreground': '#dfe1e5',
  '--theia-quickInputTitle-background': '#2b2c30',
  '--theia-quickInputList-focusBackground': '#3d2f5f',
  '--theia-quickInputList-focusForeground': '#ffffff',
  '--theia-keybindingLabel-background': '#2b2c30',
  '--theia-keybindingLabel-foreground': '#c5c8cc',
  '--theia-keybindingLabel-border': '#3d4148',
  '--theia-keybindingLabel-bottomBorder': '#3d4148',
  '--theia-pickerGroup-foreground': '#a78be0',
  '--theia-pickerGroup-border': '#3d4148',
  '--theia-pickerGroup-background': '#2b2c30',

  // ----- Settings -----
  '--theia-settings-headerForeground': '#dfe1e5',
  '--theia-settings-modifiedItemIndicator': '#7c5cbf',
  '--theia-settings-dropdownBackground': '#1a1b1e',
  '--theia-settings-dropdownForeground': '#dfe1e5',
  '--theia-settings-dropdownBorder': '#2e3136',
  '--theia-settings-checkboxBackground': '#1a1b1e',
  '--theia-settings-checkboxBorder': '#3d4148',
  '--theia-settings-checkboxForeground': '#7c5cbf',
  '--theia-settings-textInputBackground': '#1a1b1e',
  '--theia-settings-textInputForeground': '#dfe1e5',
  '--theia-settings-textInputBorder': '#2e3136',
  '--theia-settings-numberInputBackground': '#1a1b1e',
  '--theia-settings-numberInputForeground': '#dfe1e5',
  '--theia-settings-numberInputBorder': '#2e3136',
  '--theia-settings-focusedRowBackground': '#2a2d30',
  '--theia-settings-rowHoverBackground': 'rgba(255,255,255,0.03)',

  // ----- Block quote & code block (markdown) -----
  '--theia-textBlockQuote-background': '#252629',
  '--theia-textBlockQuote-border': '#3d4148',
  '--theia-textCodeBlock-background': '#1a1b1e',

  // ----- Tree indent guides -----
  '--theia-tree-indentGuidesStroke': 'rgba(255,255,255,0.06)',
  '--theia-tree-inactiveIndentGuidesStroke': 'rgba(255,255,255,0.04)',
  '--theia-tree-tableColumnsBorder': 'transparent',

  // ----- Symbol icons (outline-view colors) -----
  '--theia-symbolIcon-arrayForeground': '#fbbf24',
  '--theia-symbolIcon-booleanForeground': '#fbbf24',
  '--theia-symbolIcon-classForeground': '#ee9d28',
  '--theia-symbolIcon-colorForeground': '#ee9d28',
  '--theia-symbolIcon-constantForeground': '#c084fc',
  '--theia-symbolIcon-constructorForeground': '#60a5fa',
  '--theia-symbolIcon-enumeratorForeground': '#ee9d28',
  '--theia-symbolIcon-enumeratorMemberForeground': '#60a5fa',
  '--theia-symbolIcon-eventForeground': '#c084fc',
  '--theia-symbolIcon-fieldForeground': '#60a5fa',
  '--theia-symbolIcon-fileForeground': '#8b8f96',
  '--theia-symbolIcon-folderForeground': '#dcb67a',
  '--theia-symbolIcon-functionForeground': '#c084fc',
  '--theia-symbolIcon-interfaceForeground': '#60a5fa',
  '--theia-symbolIcon-keyForeground': '#c084fc',
  '--theia-symbolIcon-keywordForeground': '#c084fc',
  '--theia-symbolIcon-methodForeground': '#c084fc',
  '--theia-symbolIcon-moduleForeground': '#dcb67a',
  '--theia-symbolIcon-namespaceForeground': '#dcb67a',
  '--theia-symbolIcon-nullForeground': '#c084fc',
  '--theia-symbolIcon-numberForeground': '#fbbf24',
  '--theia-symbolIcon-objectForeground': '#ee9d28',
  '--theia-symbolIcon-operatorForeground': '#c084fc',
  '--theia-symbolIcon-packageForeground': '#dcb67a',
  '--theia-symbolIcon-propertyForeground': '#60a5fa',
  '--theia-symbolIcon-referenceForeground': '#c084fc',
  '--theia-symbolIcon-snippetForeground': '#60a5fa',
  '--theia-symbolIcon-stringForeground': '#22c55e',
  '--theia-symbolIcon-structForeground': '#ee9d28',
  '--theia-symbolIcon-textForeground': '#22c55e',
  '--theia-symbolIcon-typeParameterForeground': '#60a5fa',
  '--theia-symbolIcon-unitForeground': '#60a5fa',
  '--theia-symbolIcon-variableForeground': '#60a5fa',

  // ----- Font stacks (cross-platform, JetBrains-leaning) -----
  '--theia-shared-frontend-ui-font-family': "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', 'SF Pro Display', system-ui, sans-serif",
  '--theia-ui-font-family': "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', 'SF Pro Display', system-ui, sans-serif",
  '--theia-monospace-font-family': "'JetBrains Mono', 'SF Mono', 'Fira Code', Menlo, Consolas, monospace",
  '--theia-content-font-size': '13px',
};

// ============================================================================
// CSS — the only place UI styling lives for Kairo
// ============================================================================

const KAIRO_CSS = `
* { box-sizing: border-box; }

html, body {
  background: var(--theia-layout-color0);
  color: var(--theia-ui-font-color0);
  font-family: var(--theia-ui-font-family);
  font-size: var(--theia-content-font-size);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}

::selection { background: var(--theia-selected-text-background); }

/* ===== Kairo brand mark (top of menubar) ===== */
body.kairo-ide #theia-top-panel .lm-MenuBar::before {
  content: '◆';
  color: #8d6dd0;
  font-size: 14px;
  line-height: 30px;
  padding: 0 8px 0 12px;
  font-weight: 700;
  text-shadow: 0 0 8px rgba(124,92,191,0.45);
}

/* ===== Scrollbars (thin, JetBrains-style) ===== */
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: var(--theia-scrollbarSlider-background);
  border-radius: 5px;
  border: 2px solid transparent;
  background-clip: padding-box;
  min-height: 36px;
  transition: background 150ms ease;
}
::-webkit-scrollbar-thumb:hover {
  background: var(--theia-scrollbarSlider-hoverBackground);
  background-clip: padding-box;
  border: 2px solid transparent;
}
::-webkit-scrollbar-thumb:active {
  background: var(--theia-scrollbarSlider-activeBackground);
  background-clip: padding-box;
  border: 2px solid transparent;
}
::-webkit-scrollbar-corner { background: transparent; }

/* ===== Activity bar (left rail) — Zed-style minimal ===== */
.theia-app-left.theia-app-sides,
.theia-app-right.theia-app-sides {
  background: var(--theia-activityBar-background) !important;
  width: 48px !important;
  flex: 0 0 48px !important;
}
.theia-app-left.theia-app-sides {
  border-right: 1px solid var(--theia-activityBar-border) !important;
}
.theia-app-right.theia-app-sides {
  border-left: 1px solid var(--theia-activityBar-border) !important;
}

.theia-app-sides .lm-TabBar-content {
  padding: 6px 0 !important;
  gap: 2px !important;
}

.theia-app-sides .lm-TabBar-tab {
  color: var(--theia-activityBar-inactiveForeground) !important;
  background: transparent !important;
  border-radius: 6px !important;
  margin: 0 6px !important;
  padding: 0 !important;
  height: 38px !important;
  position: relative;
  transition: color 140ms cubic-bezier(.4,0,.2,1), background 140ms cubic-bezier(.4,0,.2,1);
}
.theia-app-sides .lm-TabBar-tab:hover {
  color: var(--theia-sideBar-foreground) !important;
  background: rgba(255,255,255,0.06) !important;
}
.theia-app-sides .lm-TabBar-tab.lm-mod-current {
  color: var(--theia-brand-color1) !important;
  background: rgba(124,92,191,0.16) !important;
}
.theia-app-left.theia-app-sides .lm-TabBar-tab.lm-mod-current::before {
  content: '';
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 2px;
  background: var(--theia-brand-color1);
  border-radius: 0 2px 2px 0;
  box-shadow: 0 0 8px rgba(124,92,191,0.55);
}
.theia-app-sides .lm-TabBar-tab .codicon {
  color: inherit !important;
  font-size: 20px !important;
}
.theia-app-sides .lm-TabBar-tab .lm-TabBar-tabIcon,
.theia-app-sides .lm-TabBar-tab .theia-icon {
  font-size: 20px !important;
}
.theia-app-sides .lm-TabBar-tab.lm-mod-current .theia-icon,
.theia-app-sides .lm-TabBar-tab.lm-mod-current .codicon {
  color: var(--theia-brand-color1) !important;
}
.theia-app-sides .lm-TabBar-tab .lm-TabBar-tabLabel,
.theia-app-sides .lm-TabBar-tab .lm-TabBar-tabCloseIcon {
  display: none !important;
}
.theia-app-sides .theia-activity-bar-badge,
.theia-app-sides .lm-TabBar-tab .badge {
  background: var(--theia-activityBarBadge-background) !important;
  color: #fff !important;
  font-size: 10px !important;
  font-weight: 600 !important;
  min-width: 16px !important;
  height: 16px !important;
  line-height: 16px !important;
  padding: 0 4px !important;
  border-radius: 8px !important;
  position: absolute !important;
  top: 4px !important;
  right: 4px !important;
  box-sizing: border-box !important;
}

/* Hide empty right activity bar */
.theia-app-right.theia-app-sides:not(:has(.lm-TabBar-tab:not(.lm-mod-hidden))) {
  display: none !important;
}

/* ===== Sidebar / Explorer panel ===== */
#theia-left-content-panel,
#theia-right-content-panel {
  background: var(--theia-sideBar-background) !important;
}
#theia-left-content-panel {
  border-right: 1px solid var(--theia-sideBar-border) !important;
}
#theia-right-content-panel {
  border-left: 1px solid var(--theia-sideBar-border) !important;
}

.theia-sidepanel-toolbar {
  background: var(--theia-sideBarSectionHeader-background) !important;
  border-bottom: 1px solid var(--theia-sideBarSectionHeader-border) !important;
  padding: 8px 10px 8px 14px !important;
  font-size: 11px !important;
  font-weight: 600 !important;
  text-transform: uppercase !important;
  letter-spacing: 0.7px !important;
  color: var(--theia-ui-font-color2) !important;
  display: flex !important;
  align-items: center !important;
  gap: 4px;
}
.theia-sidepanel-title {
  font-size: 11px !important;
  font-weight: 600 !important;
  text-transform: uppercase !important;
  letter-spacing: 0.7px !important;
  color: var(--theia-ui-font-color2) !important;
  flex: 1;
  cursor: pointer;
}
.theia-sidebar-menu-item {
  color: var(--theia-activityBar-inactiveForeground) !important;
  background: transparent !important;
  border-radius: 0 !important;
  transition: color 140ms ease, background 140ms ease;
}
.theia-sidebar-menu-item:hover {
  background: rgba(255,255,255,0.06) !important;
  color: var(--theia-sideBar-foreground) !important;
}
.theia-sidebar-menu-item .codicon {
  color: inherit !important;
  font-size: 20px !important;
}

/* ===== File tree (JetBrains compact) ===== */
.theia-Tree,
.theia-TreeContainer,
.theia-FileTree,
.theia-Files,
.theia-open-editors-widget {
  background: var(--theia-sideBar-background) !important;
  color: var(--theia-sideBar-foreground) !important;
  font-size: 13px !important;
  outline: none !important;
}
.theia-Tree {
  padding: 4px 0 !important;
}
.theia-TreeNode {
  line-height: 24px !important;
  height: 24px !important;
  padding: 0 8px 0 6px !important;
  border-radius: 5px !important;
  margin: 0 6px !important;
  color: var(--theia-sideBar-foreground) !important;
  transition: background 80ms ease, color 80ms ease;
  position: relative;
}
.theia-TreeNode:hover {
  background: rgba(255,255,255,0.05) !important;
  color: #e6e7ea !important;
}
.theia-TreeNode.theia-mod-selected {
  background: rgba(255,255,255,0.07) !important;
  color: #e6e7ea !important;
}
.theia-TreeNode.theia-mod-selected.theia-mod-focus {
  background: rgba(124,92,191,0.22) !important;
  color: #ffffff !important;
  box-shadow: inset 2px 0 0 var(--theia-brand-color1);
}
.theia-TreeNodeSegment,
.theia-TreeNodeSegmentGrow.name,
.theia-TreeNode .name {
  line-height: 24px !important;
  font-size: 13px !important;
  color: inherit !important;
}
.theia-FileTreeNode,
.theia-DirNode {
  padding: 0 4px 0 2px !important;
}
.theia-FileTreeNode .file-icon,
.theia-DirNode .folder-icon {
  margin-right: 6px !important;
  font-size: 14px !important;
}
.theia-TreeNode .theia-FileTreeNode-tail,
.theia-TreeNode .theia-TreeNodeTail {
  color: var(--theia-ui-font-color2) !important;
  font-size: 11px !important;
  display: flex;
  align-items: center;
  gap: 2px;
}
.theia-TreeNode .theia-FileTreeNode-tail .codicon,
.theia-TreeNode .theia-TreeNodeTail .codicon {
  opacity: 0;
  transition: opacity 120ms ease, background 120ms ease, color 120ms ease;
  font-size: 13px !important;
  padding: 3px !important;
  border-radius: 4px !important;
  color: var(--theia-ui-font-color2) !important;
}
.theia-TreeNode:hover .theia-FileTreeNode-tail .codicon,
.theia-TreeNode:hover .theia-TreeNodeTail .codicon {
  opacity: 1;
}
.theia-TreeNode .theia-FileTreeNode-tail .codicon:hover,
.theia-TreeNode .theia-TreeNodeTail .codicon:hover {
  background: rgba(255,255,255,0.10) !important;
  color: #e6e7ea !important;
}
.theia-ExpansionToggle {
  width: 18px !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  color: var(--theia-ui-font-color2) !important;
  transition: transform 150ms cubic-bezier(.4,0,.2,1), color 120ms ease;
  border-radius: 3px !important;
  font-size: 11px !important;
}
.theia-ExpansionToggle:hover {
  color: var(--theia-ui-font-color0) !important;
  background: rgba(255,255,255,0.06) !important;
}
.theia-ExpansionToggle.theia-mod-collapsed {
  transform: rotate(-90deg);
}

/* File decorations (git status) */
.theia-TreeNode.theia-mod-dirty .theia-FileTreeNode-label,
.theia-TreeNode.theia-mod-modified .theia-FileTreeNode-label,
.file-modified { color: #f59e0b !important; }
.theia-TreeNode.theia-mod-added .theia-FileTreeNode-label,
.file-added { color: #22c55e !important; }
.theia-TreeNode.theia-mod-conflict .theia-FileTreeNode-label,
.file-conflict { color: #ef4444 !important; }

/* ===== View container part header ===== */
.theia-view-container .part-header,
.theia-view-container .theia-view-container-part-title {
  background: var(--theia-sideBarSectionHeader-background) !important;
  color: var(--theia-ui-font-color2) !important;
  height: 32px !important;
  line-height: 32px !important;
  padding: 0 10px 0 14px !important;
  font-size: 11px !important;
  font-weight: 600 !important;
  text-transform: uppercase !important;
  letter-spacing: 0.7px !important;
  border: none !important;
  border-bottom: 1px solid var(--theia-sideBarSectionHeader-border) !important;
  user-select: none !important;
  transition: color 100ms ease;
}
.theia-view-container .part-header .codicon,
.theia-view-container .part-header .fa-chevron-down,
.theia-view-container .part-header .fa-chevron-right {
  color: var(--theia-ui-font-color2) !important;
  font-size: 11px !important;
  margin-right: 4px !important;
}
.theia-view-container .lm-TabBar-toolbar { background: transparent !important; }
.theia-view-container .lm-TabBar-toolbar .item,
.theia-view-container .theia-view-container-part-title .codicon {
  color: var(--theia-ui-font-color2) !important;
  transition: color 100ms ease, background 100ms ease;
  border-radius: 4px !important;
  padding: 4px !important;
}
.theia-view-container .lm-TabBar-toolbar .item:hover {
  color: var(--theia-ui-font-color0) !important;
  background: rgba(255,255,255,0.08) !important;
}
.theia-view-container .part.collapsed .part-body { display: none !important; }
.theia-view-container .part .body { background: var(--theia-sideBar-background) !important; }

/* ===== Editor tabs (Zed/VS Code modern) ===== */
#theia-editor-card-area,
.theia-editor-area,
.theia-app-centers,
#theia-main-content-panel {
  background: var(--theia-editorPane-background) !important;
}
.lm-TabBar.theia-app-centers {
  background: var(--theia-editorGroupHeader-tabsBackground) !important;
  height: 36px !important;
}
.lm-TabBar.theia-app-centers .lm-TabBar-content {
  background: var(--theia-editorGroupHeader-tabsBackground) !important;
  padding: 0 !important;
  gap: 0 !important;
  align-items: stretch !important;
}
.lm-TabBar.theia-app-centers .lm-TabBar-tab {
  background: var(--theia-tab-inactiveBackground) !important;
  color: var(--theia-tab-inactiveForeground) !important;
  border: none !important;
  border-right: 1px solid var(--theia-tab-border) !important;
  padding: 0 12px !important;
  border-radius: 0 !important;
  position: relative;
  height: 36px !important;
  transition: background 120ms ease, color 120ms ease;
}
.lm-TabBar.theia-app-centers .lm-TabBar-tab:hover {
  background: var(--theia-tab-hoverBackground) !important;
  color: var(--theia-tab-hoverForeground) !important;
}
.lm-TabBar.theia-app-centers .lm-TabBar-tab.lm-mod-current {
  background: var(--theia-tab-activeBackground) !important;
  color: var(--theia-tab-activeForeground) !important;
}
.lm-TabBar.theia-app-centers .lm-TabBar-tab.lm-mod-current::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: var(--theia-brand-color1);
  box-shadow: 0 0 6px rgba(124,92,191,0.55);
}
.lm-TabBar.theia-app-centers .lm-TabBar-tabLabel {
  font-size: 13px !important;
  line-height: 36px !important;
  color: inherit !important;
}
.lm-TabBar.theia-app-centers .lm-TabBar-tabIcon,
.lm-TabBar.theia-app-centers .lm-TabBar-tab .theia-file-icons {
  margin-right: 7px !important;
  font-size: 14px !important;
}
.lm-TabBar.theia-app-centers .lm-TabBar-tabCloseIcon {
  margin-left: 8px !important;
  width: 18px !important;
  height: 18px !important;
  border-radius: 4px !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  font-size: 13px !important;
  color: var(--theia-tab-closeButton) !important;
  opacity: 0;
  transition: opacity 100ms ease, background 100ms ease, color 100ms ease;
}
.lm-TabBar.theia-app-centers .lm-TabBar-tab:hover .lm-TabBar-tabCloseIcon,
.lm-TabBar.theia-app-centers .lm-TabBar-tab.lm-mod-current .lm-TabBar-tabCloseIcon {
  opacity: 1;
}
.lm-TabBar.theia-app-centers .lm-TabBar-tabCloseIcon:hover {
  background: rgba(239,68,68,0.20) !important;
  color: #f87171 !important;
}
.lm-TabBar.theia-app-centers .lm-TabBar-tab.theia-mod-dirty .lm-TabBar-tabCloseIcon {
  opacity: 1;
  color: var(--theia-warning-color1) !important;
  background: transparent !important;
}
.lm-TabBar.theia-app-centers .lm-TabBar-tab.theia-mod-dirty .lm-TabBar-tabCloseIcon:hover {
  color: var(--theia-ui-font-color0) !important;
  background: rgba(239,68,68,0.20) !important;
}

/* ===== Breadcrumbs ===== */
.theia-editor-crumbbar,
.theia-breadcrumbs,
.monaco-breadcrumbs {
  background: var(--theia-breadcrumb-background) !important;
  border-bottom: 1px solid var(--theia-tab-border) !important;
  padding: 0 14px !important;
  display: flex !important;
  align-items: center !important;
  height: 24px !important;
  font-size: 12px !important;
}
.breadcrumb-item,
.theia-breadcrumbs .crumb,
.monaco-breadcrumb-item {
  color: var(--theia-breadcrumb-foreground) !important;
  font-size: 12px !important;
  padding: 0 6px !important;
  border-radius: 4px !important;
  transition: color 100ms ease, background 100ms ease;
  display: inline-flex !important;
  align-items: center !important;
  gap: 4px !important;
  height: 18px !important;
}
.breadcrumb-item:first-child,
.theia-breadcrumbs .crumb:first-child { padding-left: 0 !important; }
.breadcrumb-item:hover,
.theia-breadcrumbs .crumb:hover,
.monaco-breadcrumb-item:hover {
  color: var(--theia-breadcrumb-activeForeground) !important;
  background: rgba(255,255,255,0.05) !important;
}
.breadcrumb-item .codicon { font-size: 12px !important; }

/* ===== Editor (Monaco) ===== */
.theia-editor,
.monaco-editor,
.monaco-editor .margin,
.monaco-editor .monaco-editor-background {
  background: var(--theia-editor-background) !important;
}
.monaco-editor .line-numbers {
  color: var(--theia-editorLineNumber-foreground) !important;
  font-size: 12px !important;
  font-family: var(--theia-monospace-font-family) !important;
}
.monaco-editor .current-line {
  background: rgba(255,255,255,0.035) !important;
  border: none !important;
}
.monaco-editor .current-line ~ .line-numbers {
  color: var(--theia-editorLineNumber-activeForeground) !important;
}
.monaco-editor .glyph-margin { background: var(--theia-editor-background) !important; }
.monaco-editor .cursors-layer .cursor {
  border-left: 2px solid var(--theia-editorCursor-foreground) !important;
  border-color: var(--theia-editorCursor-foreground) !important;
}
.monaco-editor .selected-text { background: #264f78 !important; }
.monaco-editor .focused .selected-text { background: #264f78 !important; }
.monaco-editor .bracket-match {
  background: rgba(124,92,191,0.10) !important;
  border: 1px solid var(--theia-editorBracketMatch-border) !important;
  border-radius: 2px !important;
}
.monaco-editor .word-highlight,
.monaco-editor .word-highlight-strong {
  background: rgba(124,92,191,0.18) !important;
  border-radius: 2px !important;
}
.monaco-editor .scroll-decoration { box-shadow: none !important; }
.monaco-editor .minimap {
  background: var(--theia-editor-background) !important;
  opacity: 0.7;
}
.monaco-editor .overview-ruler { background: var(--theia-editor-background) !important; }
.monaco-editor .folding { color: var(--theia-disabled-color0) !important; }
.monaco-editor .indent-guide { border-left: 1px solid rgba(255,255,255,0.07) !important; }
.monaco-editor .active-indent-guide { border-left: 1px solid rgba(255,255,255,0.14) !important; }
.monaco-editor .findMatch {
  background: var(--theia-editor-findMatchBackground) !important;
  border: 1px solid rgba(245,158,11,0.6) !important;
  border-radius: 2px !important;
}
.monaco-editor .currentFindMatch {
  background: rgba(245,158,11,0.55) !important;
  border: 1px solid #fbbf24 !important;
  border-radius: 2px !important;
}

/* Monaco syntax */
.monaco-editor .mtk1 { color: #d4d4d4 !important; }
.monaco-editor .mtk5 { color: #569cd6 !important; }
.monaco-editor .mtk6 { color: #4ec9b0 !important; }
.monaco-editor .mtk7 { color: #ce9178 !important; }
.monaco-editor .mtk8 { color: #dcdcaa !important; }
.monaco-editor .mtk9 { color: #c586c0 !important; }
.monaco-editor .mtk10 { color: #9cdcfe !important; }
.monaco-editor .mtk12 { color: #d7ba7d !important; }
.monaco-editor .mtk15 { color: #b5cea8 !important; }
.monaco-editor .mtk18 { color: #f44747 !important; }
.monaco-editor .mtk24 { color: #608b4e !important; }

/* Monaco find widget */
.monaco-editor .find-widget {
  background: var(--theia-editorWidget-background) !important;
  border: 1px solid var(--theia-editorWidget-border) !important;
  border-radius: 8px !important;
  box-shadow: var(--theia-widget-shadow) !important;
  padding: 6px !important;
}
.monaco-editor .find-widget input {
  background: var(--theia-input-background) !important;
  border: 1px solid var(--theia-input-border) !important;
  border-radius: 5px !important;
  color: var(--theia-input-foreground) !important;
  padding: 4px 8px !important;
  font-size: 13px !important;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.monaco-editor .find-widget input:focus {
  border-color: var(--theia-focusBorder) !important;
  box-shadow: 0 0 0 2px rgba(124,92,191,0.20);
}
.monaco-editor .find-widget .codicon {
  color: var(--theia-icon-foreground) !important;
  border-radius: 4px !important;
  padding: 4px !important;
  transition: background 100ms ease, color 100ms ease;
}
.monaco-editor .find-widget .codicon:hover { background: rgba(255,255,255,0.08) !important; }

/* Monaco suggest widget */
.monaco-editor .suggest-widget {
  background: var(--theia-editorSuggestWidget-background) !important;
  border: 1px solid var(--theia-editorSuggestWidget-border) !important;
  border-radius: 8px !important;
  box-shadow: var(--theia-widget-shadow) !important;
  overflow: hidden !important;
}
.monaco-editor .suggest-widget .monaco-list .monaco-list-row {
  border-radius: 4px !important;
  padding: 5px 8px !important;
  font-size: 13px !important;
  transition: background 80ms ease;
}
.monaco-editor .suggest-widget .monaco-list .monaco-list-row.focused {
  background: var(--theia-editorSuggestWidget-selectedBackground) !important;
  color: var(--theia-editorSuggestWidget-selectedForeground) !important;
}

/* Monaco hover */
.monaco-editor .monaco-hover,
.monaco-hover {
  background: var(--theia-editorHoverWidget-background) !important;
  border: 1px solid var(--theia-editorHoverWidget-border) !important;
  border-radius: 8px !important;
  box-shadow: var(--theia-widget-shadow) !important;
  padding: 8px 10px !important;
}
.monaco-hover .monaco-hover-content {
  font-size: 12.5px !important;
  line-height: 1.55 !important;
  color: var(--theia-editor-foreground) !important;
}
.monaco-hover .monaco-tokenized-source {
  font-family: var(--theia-monospace-font-family) !important;
  font-size: 12.5px !important;
}

/* ===== Bottom panel (terminal / problems / output) ===== */
#theia-bottom-content-panel,
.theia-bottom-content-panel {
  background: var(--theia-panel-background) !important;
  border-top: 1px solid var(--theia-panel-border) !important;
}
#theia-bottom-content-panel .lm-DockPanel-tabBar,
#theia-bottom-content-panel .lm-TabBar {
  background: var(--theia-panel-background) !important;
  height: 32px !important;
  border-bottom: 1px solid var(--theia-panel-border) !important;
  padding: 0 8px !important;
}
#theia-bottom-content-panel .lm-TabBar-content {
  background: transparent !important;
  gap: 0 !important;
  height: 32px !important;
  align-items: center !important;
}
#theia-bottom-content-panel .lm-TabBar-tab {
  background: transparent !important;
  color: var(--theia-panelTitle-inactiveForeground) !important;
  height: 32px !important;
  padding: 0 14px !important;
  border: none !important;
  border-radius: 5px 5px 0 0 !important;
  font-size: 11px !important;
  letter-spacing: 0.5px !important;
  font-weight: 500 !important;
  text-transform: uppercase;
  position: relative !important;
  transition: color 100ms ease, background 100ms ease;
}
#theia-bottom-content-panel .lm-TabBar-tab:hover {
  color: var(--theia-panelTitle-activeForeground) !important;
  background: rgba(255,255,255,0.04) !important;
}
#theia-bottom-content-panel .lm-TabBar-tab.lm-mod-current {
  color: var(--theia-panelTitle-activeForeground) !important;
  background: transparent !important;
}
#theia-bottom-content-panel .lm-TabBar-tab.lm-mod-current::after {
  content: '';
  position: absolute !important;
  bottom: -1px !important;
  left: 8px !important;
  right: 8px !important;
  height: 2px !important;
  background: var(--theia-brand-color1) !important;
  border-radius: 2px 2px 0 0 !important;
}
#theia-bottom-content-panel .lm-DockPanel-widget { background: var(--theia-panel-background) !important; }

/* Terminal */
.theia-terminal,
.terminal-container,
.xterm,
.xterm .xterm-screen,
.xterm .xterm-viewport { background: var(--theia-terminal-background) !important; }
.xterm .xterm-rows > div {
  color: #d4d6da !important;
  font-family: var(--theia-monospace-font-family) !important;
  font-size: 13px !important;
  line-height: 1.55 !important;
}
.xterm .xterm-cursor-layer .xterm-cursor {
  background: var(--theia-editorCursor-foreground) !important;
  border-color: var(--theia-editorCursor-foreground) !important;
}
.terminal-tabs-bar { background: var(--theia-panel-background) !important; }
.terminal-tab {
  background: transparent !important;
  color: var(--theia-ui-font-color2) !important;
}

/* Problems */
.theia-marker-container,
.marker-container,
#problems-view-container {
  background: var(--theia-panel-background) !important;
  color: var(--theia-ui-font-color1) !important;
}
.problem-widget,
.theia-marker {
  padding: 4px 14px !important;
  font-size: 12.5px !important;
  line-height: 22px !important;
  border-radius: 0 !important;
  transition: background 80ms ease;
}
.problem-widget:hover, .theia-marker:hover { background: rgba(255,255,255,0.04) !important; }
.theia-marker.theia-marker-error .codicon { color: var(--theia-error-color0) !important; }
.theia-marker.theia-marker-warning .codicon { color: var(--theia-warning-color0) !important; }
.theia-marker.theia-marker-info .codicon { color: #60a5fa !important; }

/* Output */
.theia-output,
.theia-output-component,
.output-view-container {
  background: var(--theia-terminal-background) !important;
  color: var(--theia-ui-font-color1) !important;
  font-family: var(--theia-monospace-font-family) !important;
  font-size: 12.5px !important;
  padding: 10px 14px !important;
  line-height: 1.55 !important;
}

/* Outline */
.theia-outline-view,
.theia-outline-view .theia-TreeContainer { background: var(--theia-sideBar-background) !important; }

/* ===== Status bar (solid dark, ID/Zed style) ===== */
#theia-statusBar,
.theia-statusBar {
  background: var(--theia-statusBar-background) !important;
  color: var(--theia-statusBar-foreground) !important;
  height: 24px !important;
  border-top: 1px solid var(--theia-statusBar-border) !important;
  font-size: 12px !important;
  padding: 0 !important;
}
#theia-statusBar .area,
.theia-statusBar .area { background: transparent !important; }
#theia-statusBar .element,
.theia-statusBar .element {
  color: var(--theia-statusBar-foreground) !important;
  height: 24px !important;
  line-height: 24px !important;
  padding: 0 10px !important;
  font-size: 12px !important;
  transition: background 80ms ease, color 80ms ease;
  white-space: nowrap;
}
#theia-statusBar .element:hover,
.theia-statusBar .element:hover {
  background: var(--theia-statusBarItem-hoverBackground) !important;
  color: #ffffff !important;
}
#theia-statusBar .element.hasCommand { cursor: pointer !important; }
#theia-statusBar .codicon {
  font-size: 13px !important;
  margin-right: 5px !important;
  vertical-align: middle;
}
.theia-statusBar .element.error { color: #fca5a5 !important; }
.theia-statusBar .element.warning { color: #fcd34d !important; }
.theia-statusBar .element.has-background {
  background: var(--theia-statusBarItem-prominentBackground) !important;
  color: #fff !important;
  border-radius: 0 !important;
}
.theia-statusBar .element.has-background:hover {
  background: var(--theia-statusBarItem-prominentHoverBackground) !important;
}

/* ===== Menu bar (top) ===== */
.lm-MenuBar,
#theia-menubar,
#theia-top-panel .lm-MenuBar {
  background: var(--theia-titleBar-activeBackground) !important;
  height: 30px !important;
}
.lm-MenuBar-content {
  padding: 0 8px !important;
  display: flex !important;
  align-items: center !important;
  height: 30px !important;
}
.lm-MenuBar-item {
  color: var(--theia-titleBar-activeForeground) !important;
  padding: 0 10px !important;
  font-size: 13px !important;
  height: 22px !important;
  line-height: 22px !important;
  border-radius: 5px !important;
  margin: 0 1px !important;
  transition: background 120ms ease, color 120ms ease;
}
.lm-MenuBar-item:hover,
.lm-MenuBar-item.lm-mod-active {
  background: var(--theia-menubar-selectionBackground) !important;
  color: var(--theia-menubar-selectionForeground) !important;
}

/* Dropdown menu (File / Edit / …) */
.lm-Menu,
.lm-ContextMenu,
.theia-context-menu,
.monaco-menu .monaco-menu-container {
  background: var(--theia-menu-background) !important;
  border: 1px solid var(--theia-menu-border) !important;
  border-radius: 10px !important;
  padding: 6px !important;
  box-shadow: 0 12px 40px rgba(0,0,0,0.50), 0 0 0 1px rgba(255,255,255,0.04) !important;
  min-width: 240px !important;
}
.lm-Menu-item,
.monaco-menu .action-item,
.monaco-menu .monaco-action-bar .action-item {
  color: var(--theia-menu-foreground) !important;
  padding: 6px 30px 6px 12px !important;
  border-radius: 5px !important;
  font-size: 13px !important;
  margin: 1px 2px !important;
  transition: background 80ms ease, color 80ms ease;
}
.lm-Menu-item:hover,
.lm-Menu-item.lm-mod-active,
.monaco-menu .action-item.focused,
.monaco-menu .monaco-action-bar .action-item:focus {
  background: var(--theia-menu-selectionBackground) !important;
  color: var(--theia-menu-selectionForeground) !important;
}
.lm-Menu-item.lm-mod-disabled,
.monaco-menu .action-item.disabled .action-label {
  color: var(--theia-disabled-color0) !important;
  pointer-events: none !important;
}
.lm-Menu-item.lm-mod-separator,
.monaco-menu .menu-separator {
  border-top: 1px solid var(--theia-menu-separatorBackground) !important;
  margin: 5px 8px !important;
  padding: 0 !important;
  height: 0 !important;
}
.lm-Menu-itemShortcut,
.monaco-keybinding {
  color: var(--theia-ui-font-color2) !important;
  font-size: 11px !important;
  font-family: var(--theia-monospace-font-family) !important;
  opacity: 0.85;
}
.lm-Menu-itemSubmenuIcon { color: var(--theia-ui-font-color2) !important; font-size: 11px !important; }
.lm-Menu-itemIcon { color: var(--theia-ui-font-color2) !important; }

/* ===== Dialogs (ID-style rounded) ===== */
.theia-Dialog,
.dialogBlock {
  background: var(--theia-editorPane-background) !important;
  color: var(--theia-ui-font-color0) !important;
  border: 1px solid var(--theia-widget-border) !important;
  border-radius: 12px !important;
  box-shadow: 0 20px 60px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04) !important;
  font-family: var(--theia-ui-font-family) !important;
  overflow: hidden !important;
  min-width: 420px !important;
}
.theia-Dialog .dialogTitle,
.dialogBlock .dialogTitle {
  background: linear-gradient(180deg, rgba(255,255,255,0.025) 0%, transparent 100%) !important;
  border-bottom: 1px solid var(--theia-widget-border) !important;
  padding: 16px 20px 14px !important;
  font-size: 14px !important;
  font-weight: 600 !important;
  color: #ffffff !important;
  letter-spacing: -0.1px !important;
}
.theia-Dialog .dialogContent,
.dialogBlock .dialogContent {
  padding: 18px 20px !important;
  font-size: 13px !important;
  line-height: 1.5 !important;
  color: var(--theia-ui-font-color1) !important;
}
.theia-Dialog .dialogControl,
.dialogBlock .dialogControl {
  padding: 14px 20px !important;
  border-top: 1px solid var(--theia-widget-border) !important;
  display: flex !important;
  gap: 8px !important;
  justify-content: flex-end !important;
  background: rgba(0,0,0,0.18) !important;
}
.dialogBlock .dialogContent label {
  color: var(--theia-descriptionForeground) !important;
  font-size: 12px !important;
  margin-bottom: 6px !important;
  display: block !important;
  font-weight: 500 !important;
}

/* ===== Quick open / command palette (Zed-style) ===== */
.quick-input-widget,
.quick-open-widget,
.monaco-quick-open-widget {
  background: var(--theia-quickInput-background) !important;
  border: 1px solid var(--theia-menu-border) !important;
  border-radius: 12px !important;
  box-shadow: 0 12px 40px rgba(0,0,0,0.50), 0 0 0 1px rgba(255,255,255,0.04) !important;
  padding: 0 !important;
  overflow: hidden !important;
  top: 60px !important;
}
.quick-input-titlebar,
.quick-open-widget .monaco-list .monaco-list-title {
  background: var(--theia-quickInputTitle-background) !important;
  border-bottom: 1px solid var(--theia-widget-border) !important;
  padding: 10px 16px !important;
  font-size: 11px !important;
  font-weight: 600 !important;
  text-transform: uppercase !important;
  letter-spacing: 0.6px !important;
  color: var(--theia-ui-font-color2) !important;
}
.quick-input-widget .quick-input-filter,
.quick-open-widget .monaco-inputbox {
  padding: 12px 16px !important;
  border-bottom: 1px solid var(--theia-widget-border) !important;
  font-size: 14px !important;
}
.quick-input-list,
.quick-open-widget .monaco-list { padding: 6px !important; }
.quick-input-list .monaco-list-row,
.quick-open-widget .monaco-list .monaco-list-row {
  border-radius: 5px !important;
  padding: 7px 10px !important;
  line-height: 1.4 !important;
  font-size: 13px !important;
  transition: background 80ms ease;
}
.quick-input-list .monaco-list-row.focused,
.quick-open-widget .monaco-list .monaco-list-row.focused {
  background: var(--theia-quickInputList-focusBackground) !important;
  color: var(--theia-quickInputList-focusForeground) !important;
}
.quick-input-list .label,
.quick-open-widget .monaco-list .monaco-list-row .label .name,
.quick-open-widget .monaco-highlighted-label { font-size: 13px !important; }
.quick-input-list .label .monaco-icon-label,
.quick-input-list .quick-input-list-entry .quick-input-list-entry-keybinding,
.keybinding-label { font-size: 11px !important; }

/* ===== Buttons (ID-style modern) ===== */
.theia-button {
  background: var(--theia-button-background) !important;
  color: var(--theia-button-foreground) !important;
  border: 1px solid transparent !important;
  border-radius: 6px !important;
  padding: 5px 14px !important;
  font-size: 13px !important;
  font-weight: 500 !important;
  cursor: pointer !important;
  transition: background 150ms cubic-bezier(.4,0,.2,1), transform 80ms ease, box-shadow 150ms ease;
  font-family: var(--theia-ui-font-family) !important;
  outline: none !important;
  line-height: 1.4 !important;
  min-height: 28px !important;
  box-shadow: 0 1px 2px rgba(0,0,0,0.20);
}
.theia-button:hover {
  background: var(--theia-button-hoverBackground) !important;
  box-shadow: 0 2px 8px rgba(124,92,191,0.30);
}
.theia-button:active {
  transform: scale(0.97);
  box-shadow: 0 1px 2px rgba(0,0,0,0.20);
}
.theia-button.secondary {
  background: var(--theia-button-secondaryBackground) !important;
  color: var(--theia-button-secondaryForeground) !important;
  box-shadow: none;
}
.theia-button.secondary:hover {
  background: var(--theia-button-secondaryHoverBackground) !important;
  box-shadow: 0 1px 3px rgba(0,0,0,0.20);
}
.theia-button[disabled], .theia-button.disabled {
  opacity: 0.45 !important;
  cursor: default !important;
  pointer-events: none !important;
  box-shadow: none !important;
}
.theia-button .codicon { font-size: 14px !important; }

/* ===== Inputs ===== */
.theia-input,
input[type="text"],
input[type="search"],
input[type="number"],
input[type="email"],
input[type="password"],
input[type="url"],
textarea,
select {
  background: var(--theia-input-background) !important;
  color: var(--theia-input-foreground) !important;
  border: 1px solid var(--theia-input-border) !important;
  border-radius: 6px !important;
  padding: 5px 10px !important;
  font-size: 13px !important;
  font-family: var(--theia-ui-font-family) !important;
  outline: none !important;
  transition: border-color 150ms cubic-bezier(.4,0,.2,1), box-shadow 150ms ease;
  line-height: 1.4 !important;
}
.theia-input:hover,
input[type="text"]:hover,
input[type="search"]:hover,
input[type="number"]:hover,
input[type="email"]:hover,
input[type="password"]:hover,
textarea:hover,
select:hover { border-color: #45484d !important; }
.theia-input:focus,
input[type="text"]:focus,
input[type="search"]:focus,
input[type="number"]:focus,
input[type="email"]:focus,
input[type="password"]:focus,
textarea:focus,
select:focus {
  border-color: var(--theia-focusBorder) !important;
  box-shadow: 0 0 0 3px rgba(124,92,191,0.18) !important;
}
.theia-input::placeholder,
input::placeholder,
textarea::placeholder { color: var(--theia-input-placeholderForeground) !important; }

input[type="checkbox"], input[type="radio"] {
  accent-color: var(--theia-brand-color1);
  width: 14px;
  height: 14px;
}

/* Search box (sidebar) */
.theia-search-box,
.theia-filterinput,
.search-input {
  background: var(--theia-input-background) !important;
  border: 1px solid var(--theia-input-border) !important;
  border-radius: 6px !important;
  padding: 5px 10px 5px 30px !important;
  color: var(--theia-input-foreground) !important;
  font-size: 13px !important;
  outline: none !important;
  transition: border-color 150ms ease, box-shadow 150ms ease;
}
.theia-search-box:focus,
.theia-filterinput:focus,
.search-input:focus {
  border-color: var(--theia-focusBorder) !important;
  box-shadow: 0 0 0 3px rgba(124,92,191,0.15);
}

/* ===== Notifications / Toast ===== */
.theia-notification,
.theia-NotificationContainer .theia-notification {
  background: var(--theia-notification-background) !important;
  border: 1px solid var(--theia-notification-border) !important;
  border-radius: 10px !important;
  box-shadow: 0 12px 32px rgba(0,0,0,0.45) !important;
  padding: 14px 18px !important;
  font-size: 13px !important;
  color: var(--theia-notification-foreground) !important;
  line-height: 1.5 !important;
}
.theia-notification .notification-icon.codicon-error { color: var(--theia-error-color0) !important; }
.theia-notification .notification-icon.codicon-warning { color: var(--theia-warning-color0) !important; }
.theia-notification .notification-icon.codicon-info { color: var(--theia-accent-color0) !important; }
.theia-notification-item {
  padding: 8px 16px !important;
  border-radius: 6px !important;
  font-size: 12px !important;
  background: var(--theia-button-secondaryBackground) !important;
  color: var(--theia-button-secondaryForeground) !important;
  border: none !important;
  margin: 0 4px !important;
  transition: background 120ms ease, transform 80ms ease;
  cursor: pointer !important;
  font-weight: 500 !important;
}
.theia-notification-item:hover { background: var(--theia-button-secondaryHoverBackground) !important; }
.theia-notification-item:active { transform: scale(0.97); }

/* ===== Tooltips ===== */
.theia-tooltip,
.lm-Widget .p-Tip,
.lm-Tip {
  background: #2b2c30 !important;
  color: #e8eaed !important;
  border: 1px solid #3d4148 !important;
  border-radius: 6px !important;
  padding: 6px 10px !important;
  font-size: 12px !important;
  box-shadow: 0 6px 20px rgba(0,0,0,0.40) !important;
  z-index: 50000 !important;
  line-height: 1.4 !important;
}

/* ===== Toolbars & Icon buttons ===== */
.theia-sidebar-toolbar,
.theia-TreeContainer-ToolBar {
  display: flex !important;
  align-items: center !important;
  gap: 1px !important;
  padding: 0 4px !important;
}
.theia-sidebar-toolbar .codicon,
.theia-sidepanel-toolbar .codicon,
.theia-TreeContainer-ToolBar .codicon,
.theia-view-container .codicon {
  color: var(--theia-ui-font-color2) !important;
  padding: 4px !important;
  border-radius: 4px !important;
  transition: color 120ms ease, background 120ms ease;
  font-size: 14px !important;
}
.theia-sidebar-toolbar .codicon:hover,
.theia-sidepanel-toolbar .codicon:hover,
.theia-TreeContainer-ToolBar .codicon:hover,
.theia-view-container .codicon:hover {
  color: var(--theia-ui-font-color0) !important;
  background: rgba(255,255,255,0.08) !important;
}
.codicon { font-family: 'codicon' !important; transition: color 120ms ease; }

/* ===== Splitter / Sash Handles ===== */
.lm-SplitPanel-handle {
  background: transparent !important;
  transition: background 150ms ease;
}
.lm-SplitPanel-handle:hover { background: var(--theia-sash-hoverBorder) !important; }
.lm-SplitPanel-handle::after { background: transparent !important; }
.lm-SplitPanel-handle { cursor: col-resize; }
.lm-SplitPanel[data-orientation='vertical'] .lm-SplitPanel-handle { cursor: row-resize; }
.lm-SplitPanel[data-orientation='horizontal'] > .lm-SplitPanel-handle { width: 1px !important; }
.lm-SplitPanel[data-orientation='vertical'] > .lm-SplitPanel-handle { height: 1px !important; }

/* ===== Settings ===== */
.theia-settings-container,
.settings-editor {
  background: var(--theia-editor-background) !important;
  color: var(--theia-ui-font-color1) !important;
}
.settings-header {
  background: var(--theia-sideBarSectionHeader-background) !important;
  border-bottom: 1px solid var(--theia-widget-border) !important;
  padding: 18px 24px !important;
}
.settings-section-title {
  color: #ffffff !important;
  font-weight: 600 !important;
  font-size: 16px !important;
  padding-bottom: 10px !important;
  border-bottom: 1px solid rgba(255,255,255,0.06) !important;
  letter-spacing: -0.2px !important;
}
.setting-item { padding: 14px 0 !important; border-bottom: 1px solid rgba(255,255,255,0.05) !important; }
.setting-item .setting-item-name { color: #e6e7ea !important; font-size: 13px !important; font-weight: 500 !important; }
.setting-item .setting-item-description { color: var(--theia-descriptionForeground) !important; font-size: 12px !important; margin-top: 4px !important; }
.pref-input {
  background: var(--theia-settings-textInputBackground) !important;
  border: 1px solid var(--theia-settings-textInputBorder) !important;
  border-radius: 6px !important;
  color: var(--theia-settings-textInputForeground) !important;
  padding: 5px 10px !important;
  font-size: 13px !important;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.pref-input:focus {
  border-color: var(--theia-focusBorder) !important;
  box-shadow: 0 0 0 3px rgba(124,92,191,0.18);
}

/* ===== Welcome Page ===== */
.welcomePage,
.theia-welcomePage {
  background: var(--theia-welcomePage-background) !important;
  color: var(--theia-ui-font-color1) !important;
}
.theia-welcomePage h1,
.welcomePage h1 {
  color: #ffffff !important;
  font-weight: 300 !important;
  letter-spacing: -0.5px !important;
  font-size: 28px !important;
}
.theia-welcomePage h2,
.welcomePage h2 {
  color: #e6e7ea !important;
  font-weight: 500 !important;
  font-size: 18px !important;
  letter-spacing: -0.2px !important;
}
.welcomePage .theia-Welcome-RecentFolders,
.welcomePage .section {
  background: var(--theia-welcomePage-tileBackground) !important;
  border: 1px solid var(--theia-widget-border) !important;
  border-radius: 10px !important;
  margin: 12px !important;
  padding: 20px !important;
}
.welcomePage a { color: var(--theia-textLink-foreground) !important; }
.welcomePage a:hover { color: var(--theia-textLink-activeForeground) !important; text-decoration: underline !important; }
.welcomePage .theia-button { background: var(--theia-welcomePage-buttonBackground) !important; }
.welcomePage .theia-button:hover { background: var(--theia-welcomePage-buttonHoverBackground) !important; }

/* ===== Debug Toolbar ===== */
.theia-debug-toolbar,
.debug-toolbar {
  background: var(--theia-debugToolBar-background) !important;
  border: 1px solid var(--theia-debugToolBar-border) !important;
  border-radius: 8px !important;
  box-shadow: 0 6px 20px rgba(0,0,0,0.45) !important;
  padding: 5px 8px !important;
  gap: 2px !important;
}
.theia-debug-toolbar .debug-action,
.debug-toolbar .debug-action {
  color: var(--theia-icon-foreground) !important;
  border-radius: 5px !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 28px !important;
  height: 28px !important;
  transition: background 100ms ease, color 100ms ease;
}
.theia-debug-toolbar .debug-action:hover,
.debug-toolbar .debug-action:hover {
  background: rgba(255,255,255,0.08) !important;
  color: #e6e7ea !important;
}
.theia-debug-toolbar .debug-action.codicon-debug-start,
.debug-toolbar .codicon-debug-start { color: var(--theia-success-color0) !important; }
.theia-debug-toolbar .debug-action.codicon-debug-stop,
.debug-toolbar .codicon-debug-stop { color: var(--theia-error-color0) !important; }

/* ===== SCM / Source Control ===== */
.theia-scm,
.scm-view {
  background: var(--theia-sideBar-background) !important;
  color: var(--theia-sideBar-foreground) !important;
}
.scm-provider { padding: 8px 12px !important; }
.scm-input {
  background: var(--theia-input-background) !important;
  border: 1px solid var(--theia-input-border) !important;
  border-radius: 6px !important;
  color: var(--theia-input-foreground) !important;
  padding: 8px !important;
  font-size: 13px !important;
  resize: none !important;
  min-height: 36px !important;
  transition: border-color 150ms ease, box-shadow 150ms ease;
}
.scm-input:focus {
  border-color: var(--theia-focusBorder) !important;
  box-shadow: 0 0 0 3px rgba(124,92,191,0.15);
  outline: none;
}

/* ===== Keybinding labels (chiclet) ===== */
.theia-command-palette-key,
.monaco-keybinding-key {
  background: var(--theia-keybindingLabel-background) !important;
  color: var(--theia-keybindingLabel-foreground) !important;
  border: 1px solid var(--theia-keybindingLabel-border) !important;
  border-bottom-width: 2px !important;
  border-radius: 4px !important;
  padding: 2px 6px !important;
  font-size: 11px !important;
  font-family: var(--theia-monospace-font-family) !important;
  min-width: 20px !important;
  text-align: center !important;
  box-shadow: 0 1px 2px rgba(0,0,0,0.20);
}

/* ===== Progress bar (top) ===== */
.theia-progress-bar {
  background: linear-gradient(90deg, var(--theia-brand-color0), #a78be0) !important;
  height: 2px !important;
  z-index: 1000;
  box-shadow: 0 0 8px rgba(124,92,191,0.50);
}
.theia-progress-bar-container {
  background: var(--theia-layout-color0) !important;
  height: 2px !important;
}

/* ===== Badge ===== */
.theia-badge,
.badge {
  background: var(--theia-activityBarBadge-background) !important;
  color: var(--theia-activityBarBadge-foreground) !important;
  border-radius: 10px !important;
  font-size: 10px !important;
  font-weight: 600 !important;
  padding: 1px 7px !important;
  min-width: 18px !important;
  height: 16px !important;
  line-height: 14px !important;
  text-align: center;
}

/* ===== Tree indent guides ===== */
.theia-TreeContainer .theia-TreeNodeIndent { border-left: 1px solid transparent; }
.theia-TreeContainer.alwaysIndentGuides .theia-TreeNodeIndent,
.theia-TreeContainer.onDepthIndentGuides .theia-TreeNodeIndent.has-indent-guide {
  border-left-color: rgba(255,255,255,0.07) !important;
}

/* ===== Focus outline ===== */
.lm-Widget:focus,
.theia-TreeNode.theia-mod-focus { outline: none !important; }
*:focus-visible {
  outline: 2px solid var(--theia-focusBorder) !important;
  outline-offset: 1px !important;
  border-radius: 3px;
}

/* ===== Global interactive: prevent text selection on UI chrome ===== */
.theia-button,
.theia-input,
.lm-TabBar-tab,
.lm-MenuBar-item,
.lm-Menu-item,
.theia-TreeNode,
.codicon,
.theia-sidebar-toolbar,
.theia-sidepanel-toolbar,
.theia-badge,
.badge,
.lm-Menu,
.lm-ContextMenu,
.theia-ExpansionToggle,
.breadcrumb-item {
  -webkit-user-select: none;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}

/* ===== Editor area backdrop ===== */
.theia-main-content-panel .lm-DockPanel-widget:not(.lm-mod-hidden) ~ .lm-DockPanel-drop-zone {
  background: var(--theia-editor-background) !important;
}

/* ===== Drop indicator ===== */
.theia-TreeContainer .theia-TreeNodeDropTarget {
  background: rgba(124,92,191,0.20) !important;
  outline: 1px solid var(--theia-brand-color1) !important;
  border-radius: 4px !important;
}
`;

// ============================================================================
// Runtime — apply once at startup
// ============================================================================

function injectKairoCSSNow(): void {
  if (typeof document === 'undefined') return;
  let style = document.getElementById('kairo-theme-style') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'kairo-theme-style';
  }
  style.textContent = KAIRO_CSS;
  if (document.head) {
    if (style.parentNode !== document.head || document.head.lastElementChild !== style) {
      document.head.appendChild(style);
    }
  } else if (document.documentElement) {
    document.documentElement.appendChild(style);
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectKairoCSSNow);
  } else {
    injectKairoCSSNow();
  }
}

@injectable()
export class KairoUiContribution implements FrontendApplicationContribution {
  private observer: MutationObserver | null = null;

  constructor(
    @inject(CommandService) protected readonly commandService: CommandService,
    @inject(WorkspaceService) protected readonly workspaceService: WorkspaceService
  ) {}

  initialize(): void {
    injectKairoCSSNow();
    this.applyBodyClass();
  }

  onStart(): void {
    injectKairoCSSNow();
    this.applyBodyClass();
    this.observeThemeChanges();
    // After the workspace is loaded and trusted, open the Explorer
    // view by default. Theia ships with all side panels hidden until
    // the user explicitly opens them — for a focused IDE, that's a
    // bad first impression.
    this.maybeOpenExplorerOnTrust();
  }

  /**
   * Open the Explorer view once a workspace is ready. We deliberately
   * do not touch layout, sashes, or any other DOM — just dispatching
   * a single command keeps the user's saved layout intact if they
   * later close the panel themselves.
   */
  private maybeOpenExplorerOnTrust(): void {
    const tryOpen = () => {
      const ws = this.workspaceService.workspace;
      if (!ws) return;
      // workspace.isTrusted is a sync getter on the latest root
      const trusted = (ws as unknown as { isTrusted?: boolean }).isTrusted;
      if (trusted === false) return;
      // Theia's command id is `workbench.view.explorer`
      this.commandService.executeCommand('workbench.view.explorer').catch(() => undefined);
    };
    // Try once on start (in case the workspace is already trusted),
    // and again on workspace change (the post-trust state).
    setTimeout(tryOpen, 1500);
    this.workspaceService.onWorkspaceChanged?.(() => setTimeout(tryOpen, 800));
  }

  /**
   * Apply Kairo body class + CSS variables. Replaces the
   * `theia-light`/`vs` classes Theia puts on body when the user
   * has the "auto" theme selected, so the dark Kairo palette
   * always wins. We only set variables on the root <html>
   * (not both html + body) — setting them in two places caused
   * a flash on the first paint.
   */
  private applyBodyClass(): void {
    const body = document.body;
    if (!body) return;
    body.classList.remove('theia-light', 'light-theia', 'vs', 'vs-light', 'hc-black', 'hc-light');
    if (!body.classList.contains('kairo-dark')) {
      body.classList.add('kairo-dark', 'kairo-ide', 'theia-dark');
    }
    const root = document.documentElement;
    for (const [key, value] of Object.entries(KAIRO_DARK_VARS)) {
      root.style.setProperty(key, value);
    }
    body.style.backgroundColor = '#1e1f22';
    body.style.color = '#dfe1e5';
    const monacoShell = document.querySelector('.monaco-workbench');
    if (monacoShell) {
      monacoShell.classList.remove('vs', 'vs-light', 'hc-black', 'hc-light');
      monacoShell.classList.add('vs-dark');
    }
  }

  /**
   * Re-apply if something else (a user theme switch, a hot reload)
   * removes the kairo-dark class. We do NOT re-apply on
   * attribute changes caused by ourselves — that created a loop
   * where every forceApply would trigger another observer fire.
   */
  private observeThemeChanges(): void {
    if (this.observer) return;
    this.observer = new MutationObserver(() => {
      const body = document.body;
      if (
        body.classList.contains('theia-light') ||
        body.classList.contains('light-theia') ||
        body.classList.contains('vs-light') ||
        !body.classList.contains('kairo-dark')
      ) {
        this.applyBodyClass();
      }
    });
    this.observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
      subtree: false,
    });
  }
}

export default KairoUiContribution;
