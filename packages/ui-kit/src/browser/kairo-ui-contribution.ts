/**
 * Kairo UI Kit — Frontend Application Contribution
 *
 * Applies the Kairo professional dark theme, inspired by
 * JetBrains IDEs and Zed Editor.
 */

import { injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';

const KAIRO_DARK_VARS: Record<string, string> = {
  '--theia-layout-color0': '#1e1f22',
  '--theia-layout-color1': '#252629',
  '--theia-layout-color2': '#2a2d30',
  '--theia-layout-color3': '#35383d',
  '--theia-layout-color4': '#2a2d30',
  '--theia-layout-color5': '#1e1f22',
  '--theia-layout-color6': '#252629',
  '--theia-ui-font-color0': '#dfe1e5',
  '--theia-ui-font-color1': '#c5c8cc',
  '--theia-ui-font-color2': '#8b8f96',
  '--theia-ui-font-color3': '#5d6166',
  '--theia-disabled-color0': '#45484d',
  '--theia-disabled-color1': '#52565c',
  '--theia-brand-color0': '#7c5cbf',
  '--theia-brand-color1': '#8d6dd0',
  '--theia-brand-color2': '#5e42a6',
  '--theia-brand-color3': '#4a3385',
  '--theia-accent-color0': '#7c5cbf',
  '--theia-accent-color1': '#7c5cbf',
  '--theia-accent-color2': '#35383d',
  '--theia-accent-color3': '#3d2f5f',
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
  '--theia-editor-background': '#1e1f22',
  '--theia-editor-foreground': '#dfe1e5',
  '--theia-editorGutter-background': '#1e1f22',
  '--theia-editor-lineHighlightBorder': 'transparent',
  '--theia-editor-selectionBackground': '#264f78',
  '--theia-editor-selectionHighlightBackground': 'rgba(124,92,191,0.15)',
  '--theia-editor-wordHighlightBackground': 'rgba(255,255,255,0.08)',
  '--theia-editor-wordHighlightStrongBackground': 'rgba(124,92,191,0.2)',
  '--theia-editorCursor-foreground': '#aeafad',
  '--theia-editorWhitespace-foreground': 'rgba(255,255,255,0.1)',
  '--theia-editorLineNumber-foreground': '#5d6166',
  '--theia-editorLineNumber-activeForeground': '#c5c8cc',
  '--theia-editorIndentGuide-background': 'rgba(255,255,255,0.06)',
  '--theia-editorIndentGuide-activeBackground': 'rgba(255,255,255,0.14)',
  '--theia-editorHoverWidget-background': '#252629',
  '--theia-editorHoverWidget-border': '#3d4148',
  '--theia-editorSuggestWidget-background': '#252629',
  '--theia-editorSuggestWidget-border': '#3d4148',
  '--theia-editorSuggestWidget-selectedBackground': '#2a2d3f',
  '--theia-editorWidget-background': '#252629',
  '--theia-editorWidget-border': '#3d4148',
  '--theia-editorWidget-foreground': '#dfe1e5',
  '--theia-peekViewTitle-background': '#2a2d30',
  '--theia-peekView-border': '#3d2f5f',
  '--theia-peekViewResult-background': '#1e1f22',
  '--theia-peekViewEditor-background': '#1a1b1e',
  '--theia-dropdown-background': '#2a2d30',
  '--theia-dropdown-border': '#3d4148',
  '--theia-dropdown-listBackground': '#252629',
  '--theia-button-background': '#7c5cbf',
  '--theia-button-hoverBackground': '#8d6dd0',
  '--theia-button-foreground': '#ffffff',
  '--theia-button-secondaryBackground': '#35383d',
  '--theia-button-secondaryHoverBackground': '#3d4148',
  '--theia-button-secondaryForeground': '#dfe1e5',
  '--theia-button-disabledForeground': '#5d6166',
  '--theia-input-background': '#1a1b1e',
  '--theia-input-foreground': '#dfe1e5',
  '--theia-input-border': '#2e3136',
  '--theia-input-placeholderForeground': '#5d6166',
  '--theia-inputOption-activeBorder': '#7c5cbf',
  '--theia-inputOption-activeBackground': 'rgba(124,92,191,0.2)',
  '--theia-focusBorder': '#7c5cbf',
  '--theia-activeBorder': '#7c5cbf',
  '--theia-selected-text-background': 'rgba(124,92,191,0.25)',
  '--theia-list-activeSelectionBackground': '#2d3040',
  '--theia-list-activeSelectionForeground': '#ffffff',
  '--theia-list-focusBackground': '#2a2d30',
  '--theia-list-focusForeground': '#dfe1e5',
  '--theia-list-hoverBackground': 'rgba(255,255,255,0.04)',
  '--theia-list-hoverForeground': '#dfe1e5',
  '--theia-list-inactiveSelectionBackground': 'rgba(255,255,255,0.06)',
  '--theia-list-inactiveSelectionForeground': '#c5c8cc',
  '--theia-list-highlightForeground': '#8d6dd0',
  '--theia-listFilterWidget-background': '#2a2d30',
  '--theia-listFilterWidget-outline': 'transparent',
  '--theia-listFilterWidget-noMatchesOutline': '#ef4444',
  '--theia-sideBar-background': '#252629',
  '--theia-sideBar-foreground': '#c5c8cc',
  '--theia-sideBar-border': '#2e3136',
  '--theia-sideBarTitle-foreground': '#dfe1e5',
  '--theia-sideBarSectionHeader-background': '#252629',
  '--theia-sideBarSectionHeader-foreground': '#dfe1e5',
  '--theia-sideBarSectionHeader-border': '#2e3136',
  '--theia-activityBar-background': '#252629',
  '--theia-activityBar-foreground': '#8b8f96',
  '--theia-activityBar-inactiveForeground': '#6b7076',
  '--theia-activityBar-activeBorder': '#7c5cbf',
  '--theia-activityBar-border': '#2e3136',
  '--theia-activityBarBadge-background': '#7c5cbf',
  '--theia-activityBarBadge-foreground': '#ffffff',
  '--theia-editorGroup-border': '#2e3136',
  '--theia-editorGroupHeader-tabsBackground': '#252629',
  '--theia-editorGroupHeader-tabsBorder': '#2e3136',
  '--theia-editorGroupHeader-noTabsBackground': '#1e1f22',
  '--theia-tab-activeBackground': '#1e1f22',
  '--theia-tab-activeForeground': '#dfe1e5',
  '--theia-tab-inactiveBackground': '#252629',
  '--theia-tab-inactiveForeground': '#8b8f96',
  '--theia-tab-border': '#2e3136',
  '--theia-tab-activeBorder': '#7c5cbf',
  '--theia-tab-unfocusedActiveBorder': '#45484d',
  '--theia-tab-hoverBackground': '#2a2d30',
  '--theia-tab-hoverForeground': '#c5c8cc',
  '--theia-tab-hoverBorder': 'transparent',
  '--theia-tab-unfocusedActiveBackground': '#252629',
  '--theia-tab-closeButton': '#8b8f96',
  '--theia-editorPane-background': '#1e1f22',
  '--theia-editor-foreground': '#dfe1e5',
  '--theia-editor-background': '#1e1f22',
  '--theia-editorLineNumber-foreground': '#5d6166',
  '--theia-breadcrumb-background': '#1e1f22',
  '--theia-breadcrumb-foreground': '#8b8f96',
  '--theia-breadcrumb-activeForeground': '#c5c8cc',
  '--theia-panel-background': '#1e1f22',
  '--theia-panel-border': '#2e3136',
  '--theia-panelTitle-foreground': '#c5c8cc',
  '--theia-panelTitle-activeForeground': '#dfe1e5',
  '--theia-panelTitle-activeBorder': '#7c5cbf',
  '--theia-panelTitle-inactiveForeground': '#8b8f96',
  '--theia-statusBar-background': 'linear-gradient(135deg,#48346e 0%,#4a3075 30%,#3d3d82 60%,#324e80 100%)',
  '--theia-statusBar-foreground': 'rgba(255,255,255,0.92)',
  '--theia-statusBar-border': 'transparent',
  '--theia-statusBar-noFolderBackground': '#252629',
  '--theia-statusBarItem-activeBackground': 'rgba(255,255,255,0.12)',
  '--theia-statusBarItem-hoverBackground': 'rgba(255,255,255,0.08)',
  '--theia-statusBarItem-prominentBackground': 'rgba(0,0,0,0.25)',
  '--theia-statusBarItem-prominentHoverBackground': 'rgba(0,0,0,0.35)',
  '--theia-statusBarItem-remoteBackground': '#7c5cbf',
  '--theia-statusBarItem-remoteForeground': '#fff',
  '--theia-titleBar-activeBackground': '#1e1f22',
  '--theia-titleBar-activeForeground': '#dfe1e5',
  '--theia-titleBar-inactiveBackground': '#1e1f22',
  '--theia-titleBar-inactiveForeground': '#8b8f96',
  '--theia-menu-background': '#252629',
  '--theia-menu-foreground': '#dfe1e5',
  '--theia-menu-selectionBackground': '#35383d',
  '--theia-menu-selectionForeground': '#ffffff',
  '--theia-menu-separatorBackground': '#2e3136',
  '--theia-menubar-selectionBackground': 'rgba(255,255,255,0.06)',
  '--theia-menubar-selectionForeground': '#ffffff',
  '--theia-menu-border': '#3d4148',
  '--theia-notification-background': '#252629',
  '--theia-notification-foreground': '#dfe1e5',
  '--theia-notification-border': '#3d4148',
  '--theia-notificationHeader-background': '#2a2d30',
  '--theia-badge-background': '#3d4148',
  '--theia-badge-foreground': '#dfe1e5',
  '--theia-scrollbarSlider-background': 'rgba(255,255,255,0.12)',
  '--theia-scrollbarSlider-hoverBackground': 'rgba(255,255,255,0.2)',
  '--theia-scrollbarSlider-activeBackground': 'rgba(255,255,255,0.25)',
  '--theia-welcomePage-background': '#1e1f22',
  '--theia-welcomePage-buttonBackground': '#7c5cbf',
  '--theia-welcomePage-buttonHoverBackground': '#8d6dd0',
  '--theia-widget-shadow': '0 4px 16px rgba(0,0,0,0.4)',
  '--theia-terminal-background': '#1a1b1e',
  '--theia-terminal-foreground': '#d0d2d6',
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
  '--theia-terminalCursor-foreground': '#d0d2d6',
  '--theia-terminalCursor-background': '#d0d2d6',
  '--theia-terminal-selectionBackground': 'rgba(124,92,191,0.25)',
  '--theia-debugToolBar-background': '#252629',
  '--theia-debugToolBar-border': '#3d4148',
  '--theia-debugExceptionWidget-background': '#4a2020',
  '--theia-debugExceptionWidget-border': '#ef4444',
  '--theia-editorMarkerNavigationError-background': '#ef4444',
  '--theia-editorMarkerNavigationWarning-background': '#f59e0b',
  '--theia-editorMarkerNavigationInfo-background': '#60a5fa',
  '--theia-editorOverviewRuler-errorForeground': 'rgba(239,68,68,0.5)',
  '--theia-editorOverviewRuler-warningForeground': 'rgba(245,158,11,0.5)',
  '--theia-editorOverviewRuler-infoForeground': 'rgba(96,165,250,0.5)',
  '--theia-editorError-foreground': '#ef4444',
  '--theia-editorWarning-foreground': '#f59e0b',
  '--theia-editorInfo-foreground': '#60a5fa',
  '--theia-editorHint-foreground': '#8b8f96',
  '--theia-problemsErrorIcon-foreground': '#ef4444',
  '--theia-problemsWarningIcon-foreground': '#f59e0b',
  '--theia-problemsInfoIcon-foreground': '#60a5fa',
  '--theia-diffEditor-insertedTextBackground': 'rgba(34,197,94,0.12)',
  '--theia-diffEditor-removedTextBackground': 'rgba(239,68,68,0.12)',
  '--theia-diffEditor-diagonalFill': 'rgba(255,255,255,0.05)',
  '--theia-minimap-selectionHighlight': 'rgba(124,92,191,0.3)',
  '--theia-minimap-errorHighlight': 'rgba(239,68,68,0.5)',
  '--theia-minimap-warningHighlight': 'rgba(245,158,11,0.5)',
  '--theia-minimap-findMatchHighlight': 'rgba(245,158,11,0.5)',
  '--theia-editor-findMatchBackground': 'rgba(245,158,11,0.35)',
  '--theia-editor-findMatchHighlightBackground': 'rgba(245,158,11,0.2)',
  '--theia-editor-findRangeHighlightBackground': 'rgba(124,92,191,0.12)',
  '--theia-editor-linkedEditingBackground': 'rgba(245,158,11,0.15)',
  '--theia-editorHoverWidget-statusBarBackground': '#2a2d30',
  '--theia-editorInlayHint-foreground': '#8b8f96',
  '--theia-editorInlayHint-background': 'rgba(255,255,255,0.05)',
  '--theia-editorLightBulb-foreground': '#f59e0b',
  '--theia-editorLightBulbAutoFix-foreground': '#60a5fa',
  '--theia-editorCodeLens-foreground': '#6b7076',
  '--theia-editorBracketMatch-border': '#7c5cbf',
  '--theia-editorBracketMatch-background': 'rgba(124,92,191,0.1)',
  '--theia-editorOverviewRuler-bracketMatchForeground': '#7c5cbf',
  '--theia-editorUnicodeHighlight-border': '#d97706',
  '--theia-editorOverviewRuler-rangeHighlightForeground': 'rgba(124,92,191,0.2)',
  '--theia-editorRuler-foreground': '#2e3136',
  '--theia-editor-foldBackground': 'rgba(124,92,191,0.08)',
  '--theia-editorGutter-foldingControlForeground': '#6b7076',
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
  '--theia-tree-indentGuidesStroke': '#2e3136',
  '--theia-tree-inactiveIndentGuidesStroke': 'rgba(255,255,255,0.04)',
  '--theia-tree-tableColumnsBorder': 'transparent',
  '--theia-quickInput-background': '#252629',
  '--theia-quickInput-foreground': '#dfe1e5',
  '--theia-quickInputTitle-background': '#2a2d30',
  '--theia-quickInputList-focusForeground': '#ffffff',
  '--theia-quickInputList-focusBackground': '#2d3040',
  '--theia-keybindingLabel-background': '#2a2d30',
  '--theia-keybindingLabel-foreground': '#c5c8cc',
  '--theia-keybindingLabel-border': '#3d4148',
  '--theia-keybindingLabel-bottomBorder': '#3d4148',
  '--theia-pickerGroup-foreground': '#7c5cbf',
  '--theia-pickerGroup-border': '#3d4148',
  '--theia-progressBar-background': '#7c5cbf',
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
  '--theia-terminalCommandDecoration-defaultBackground': 'rgba(255,255,255,0.12)',
  '--theia-terminalCommandDecoration-successBackground': '#22c55e',
  '--theia-terminalCommandDecoration-errorBackground': '#ef4444',
  '--theia-terminalOverviewRuler-cursorForeground': 'rgba(208,210,214,0.5)',
  '--theia-terminalStickyScroll-background': '#252629',
  '--theia-terminalStickyScrollHover-background': '#2a2d30',
  '--theia-button-border': 'transparent',
  '--theia-contrastBorder': 'transparent',
  '--theia-contrastActiveBorder': 'transparent',
  '--theia-sash-hoverBorder': '#7c5cbf',
  '--theia-widget-border': '#2e3136',
  '--theia-editor-selectionForeground': '#dfe1e5',
  '--theia-foreground': '#dfe1e5',
  '--theia-descriptionForeground': '#8b8f96',
  '--theia-errorForeground': '#ef4444',
  '--theia-icon-foreground': '#c5c8cc',
  '--theia-textLink-foreground': '#8d6dd0',
  '--theia-textLink-activeForeground': '#a78be0',
  '--theia-textPreformat-foreground': '#d0bbff',
  '--theia-textBlockQuote-background': '#252629',
  '--theia-textBlockQuote-border': '#3d4148',
  '--theia-textCodeBlock-background': '#1a1b1e',
  '--theia-textSeparator-foreground': '#2e3136',
  '--theia-shared-frontend-ui-font-family': "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', Roboto, 'Helvetica Neue', sans-serif",
  '--theia-ui-font-family': "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', Roboto, 'Helvetica Neue', sans-serif",
  '--theia-monospace-font-family': "'JetBrains Mono', 'SF Mono', 'Fira Code', Menlo, Consolas, monospace",
  '--theia-content-font-size': '13px',
};

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

::selection {
  background: var(--theia-selected-text-background);
}

/* ====== Scrollbars — thin, modern, Zed/JetBrains style ====== */
::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: var(--theia-scrollbarSlider-background);
  border-radius: 5px;
  border: 2px solid transparent;
  background-clip: padding-box;
  min-height: 30px;
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
::-webkit-scrollbar-corner {
  background: transparent;
}

/* ====== Activity Bar ====== */
.theia-app-left.theia-app-sides,
.theia-app-sidebar-container {
  background: var(--theia-activityBar-background) !important;
}
.theia-app-left.theia-app-sides {
  border-right: 1px solid var(--theia-activityBar-border) !important;
}
.theia-app-sides .lm-TabBar-content {
  padding: 4px 0 !important;
  gap: 2px !important;
}
.theia-app-sides .lm-TabBar-tab {
  color: var(--theia-activityBar-inactiveForeground) !important;
  background: transparent !important;
  height: 36px !important;
  min-height: 36px !important;
  border-radius: 6px !important;
  margin: 0 6px !important;
  padding: 0 !important;
  position: relative;
  transition: color 120ms ease, background 120ms ease;
}
.theia-app-sides .lm-TabBar-tab:hover {
  color: var(--theia-sideBar-foreground) !important;
  background: rgba(255,255,255,0.05) !important;
}
.theia-app-sides .lm-TabBar-tab.lm-mod-current {
  color: var(--theia-activityBar-foreground) !important;
  background: rgba(124,92,191,0.12) !important;
}
.theia-app-sides .lm-TabBar-tab.lm-mod-current::before {
  content: '';
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 2px;
  background: var(--theia-activityBar-activeBorder);
  border-radius: 0 2px 2px 0;
}
.theia-app-sides .lm-TabBar-tab .lm-TabBar-tabIcon,
.theia-app-sides .lm-TabBar-tab .theia-icon {
  font-size: 18px !important;
}
.theia-app-sides .lm-TabBar-tab.lm-mod-current .theia-icon,
.theia-app-sides .lm-TabBar-tab.lm-mod-current .lm-TabBar-tabIcon,
.theia-app-sides .lm-TabBar-tab.lm-mod-current .codicon {
  color: var(--theia-activityBar-foreground) !important;
}
.theia-app-sides .lm-TabBar-tab .codicon {
  color: inherit !important;
  font-size: 20px !important;
}

/* ====== Sidebar / Explorer Panel ====== */
#theia-left-side-panel,
.theia-side-panel {
  background: var(--theia-sideBar-background) !important;
  color: var(--theia-sideBar-foreground) !important;
}
.theia-sidepanel-toolbar {
  background: var(--theia-sideBarSectionHeader-background) !important;
  border-bottom: 1px solid var(--theia-sideBarSectionHeader-border) !important;
  padding: 4px 8px !important;
  font-size: 11px !important;
  font-weight: 600 !important;
  text-transform: uppercase !important;
  letter-spacing: 0.5px !important;
  color: var(--theia-sideBarSectionHeader-foreground) !important;
  min-height: 30px !important;
  display: flex !important;
  align-items: center !important;
}
.theia-sidepanel-title {
  font-size: 11px !important;
  font-weight: 600 !important;
  text-transform: uppercase !important;
  letter-spacing: 0.7px !important;
  color: var(--theia-sideBarTitle-foreground) !important;
}

/* ====== File Tree / Navigator ====== */
.theia-Tree,
.theia-TreeContainer {
  background: var(--theia-sideBar-background) !important;
  color: var(--theia-sideBar-foreground) !important;
  font-size: 13px !important;
  outline: none !important;
}
.theia-TreeNode {
  line-height: 22px !important;
  min-height: 22px !important;
  padding: 0 8px !important;
  border-radius: 3px !important;
  margin: 0 2px !important;
  transition: background 80ms ease;
}
.theia-TreeNode:hover {
  background: var(--theia-list-hoverBackground) !important;
}
.theia-TreeNode.theia-mod-selected {
  background: var(--theia-list-inactiveSelectionBackground) !important;
  color: var(--theia-list-inactiveSelectionForeground) !important;
}
.theia-TreeNode.theia-mod-selected.theia-mod-focus {
  background: var(--theia-list-activeSelectionBackground) !important;
  color: var(--theia-list-activeSelectionForeground) !important;
}
.theia-TreeNodeSegment {
  line-height: 22px !important;
}
.theia-TreeNodeSegmentGrow.name,
.theia-TreeNode .name {
  font-size: 13px !important;
  color: inherit !important;
}
.theia-FileTreeNode,
.theia-DirNode {
  padding: 0 4px !important;
}
.theia-FileTreeNode .file-icon,
.theia-DirNode .folder-icon {
  margin-right: 4px !important;
}
.theia-TreeNode .theia-TreeNodeTail {
  display: flex !important;
  align-items: center !important;
  gap: 2px !important;
}
.theia-TreeNode .theia-TreeNodeTail .codicon {
  opacity: 0;
  transition: opacity 100ms ease;
  font-size: 14px !important;
  padding: 2px !important;
  border-radius: 3px !important;
  color: var(--theia-ui-font-color2) !important;
}
.theia-TreeNode:hover .theia-TreeNodeTail .codicon {
  opacity: 1;
}
.theia-TreeNode .theia-TreeNodeTail .codicon:hover {
  background: rgba(255,255,255,0.08) !important;
  color: var(--theia-ui-font-color0) !important;
}
/* Expansion toggle */
.theia-ExpansionToggle {
  width: 16px !important;
  height: 22px !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  color: var(--theia-ui-font-color2) !important;
  transition: transform 120ms ease;
}
.theia-ExpansionToggle.codicon {
  font-size: 12px !important;
}
.theia-ExpansionToggle.theia-mod-collapsed {
  transform: rotate(-90deg);
}

/* ====== Editor Tabs ====== */
#theia-editor-card-area,
.theia-editor-area,
.theia-app-centers,
#theia-main-content-panel {
  background: var(--theia-editorPane-background) !important;
}
.lm-TabBar.theia-app-centers {
  background: var(--theia-editorGroupHeader-tabsBackground) !important;
}
.lm-TabBar.theia-app-centers .lm-TabBar-content {
  background: var(--theia-editorGroupHeader-tabsBackground) !important;
  padding: 0 !important;
  gap: 0 !important;
}
.lm-TabBar.theia-app-centers .lm-TabBar-tab {
  background: var(--theia-tab-inactiveBackground) !important;
  color: var(--theia-tab-inactiveForeground) !important;
  border-right: 1px solid var(--theia-tab-border) !important;
  border-bottom: 1px solid var(--theia-editorGroupHeader-tabsBorder) !important;
  padding: 0 12px !important;
  min-height: 35px !important;
  height: 35px !important;
  border-top: none !important;
  border-left: none !important;
  border-radius: 0 !important;
  position: relative;
  transition: background 100ms ease, color 100ms ease;
}
.lm-TabBar.theia-app-centers .lm-TabBar-tab:hover {
  background: var(--theia-tab-hoverBackground) !important;
  color: var(--theia-tab-hoverForeground) !important;
}
.lm-TabBar.theia-app-centers .lm-TabBar-tab.lm-mod-current {
  background: var(--theia-tab-activeBackground) !important;
  color: var(--theia-tab-activeForeground) !important;
  border-bottom-color: var(--theia-tab-activeBackground) !important;
}
.lm-TabBar.theia-app-centers .lm-TabBar-tab.lm-mod-current::after {
  content: '';
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: -1px;
  height: 2px;
  background: var(--theia-tab-activeBorder);
  border-radius: 1px 1px 0 0;
}
.lm-TabBar.theia-app-centers .lm-TabBar-tabLabel {
  font-size: 13px !important;
  line-height: 35px !important;
}
.lm-TabBar.theia-app-centers .lm-TabBar-tabIcon,
.lm-TabBar.theia-app-centers .lm-TabBar-tab .theia-file-icons {
  margin-right: 6px !important;
  font-size: 14px !important;
}
.lm-TabBar.theia-app-centers .lm-TabBar-tabCloseIcon {
  margin-left: 6px !important;
  width: 16px !important;
  height: 16px !important;
  border-radius: 3px !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  font-size: 14px !important;
  color: var(--theia-tab-closeButton) !important;
  opacity: 0;
  transition: opacity 80ms ease, background 80ms ease;
}
.lm-TabBar.theia-app-centers .lm-TabBar-tab:hover .lm-TabBar-tabCloseIcon,
.lm-TabBar.theia-app-centers .lm-TabBar-tab.lm-mod-current .lm-TabBar-tabCloseIcon,
.lm-TabBar.theia-app-centers .lm-TabBar-tab.theia-mod-dirty .lm-TabBar-tabCloseIcon {
  opacity: 1;
}
.lm-TabBar.theia-app-centers .lm-TabBar-tabCloseIcon:hover {
  background: rgba(255,255,255,0.1) !important;
  color: var(--theia-ui-font-color0) !important;
}
/* Dirty tab indicator — yellow dot */
.lm-TabBar.theia-app-centers .lm-TabBar-tab.theia-mod-dirty .lm-TabBar-tabIcon.theia-mod-dirty,
.lm-TabBar.theia-app-centers .lm-TabBar-tab.theia-mod-dirty .theia-dirty-dot {
  color: var(--theia-warning-color1) !important;
}
.lm-TabBar.theia-app-centers .lm-TabBar-tab .lm-TabBar-tabCloseIcon.theia-mod-dirty,
.lm-TabBar.theia-app-centers .lm-TabBar-tab.theia-mod-dirty .close-icon {
  display: none !important;
}
/* Tab actions bar */
.theia-editor-crumbbar,
.theia-breadcrumbs {
  background: var(--theia-breadcrumb-background) !important;
  border-bottom: 1px solid var(--theia-editorGroupHeader-tabsBorder) !important;
  padding: 0 12px !important;
  height: 22px !important;
  display: flex !important;
  align-items: center !important;
  font-size: 12px !important;
}
.breadcrumb-item {
  color: var(--theia-breadcrumb-foreground) !important;
  font-size: 12px !important;
  padding: 0 4px !important;
}
.breadcrumb-item:first-child {
  padding-left: 0 !important;
}
.breadcrumb-item:hover {
  color: var(--theia-breadcrumb-activeForeground) !important;
}
.breadcrumb-item.folder,
.breadcrumb-item.file {
  display: inline-flex !important;
  align-items: center !important;
  gap: 3px !important;
}

/* ====== Main Editor Area ====== */
.theia-editor,
.monaco-editor,
.monaco-editor .margin,
.monaco-editor .monaco-editor-background {
  background: var(--theia-editor-background) !important;
}
.monaco-editor .line-numbers {
  color: var(--theia-editorLineNumber-foreground) !important;
}
.monaco-editor .current-line {
  background: rgba(255,255,255,0.03) !important;
  border: none !important;
}

/* ====== Status Bar ====== */
#theia-statusBar,
#theia-statusBar .area {
  background: var(--theia-statusBar-background) !important;
  color: var(--theia-statusBar-foreground) !important;
}
#theia-statusBar {
  border-top: none !important;
}
#theia-statusBar .area .element {
  padding: 0 10px !important;
  height: 22px !important;
  line-height: 22px !important;
  font-size: 12px !important;
  transition: background 100ms ease;
  white-space: nowrap;
}
#theia-statusBar .area .element:hover {
  background: var(--theia-statusBarItem-hoverBackground) !important;
}
#theia-statusBar .area .element:active {
  background: var(--theia-statusBarItem-activeBackground) !important;
}
#theia-statusBar .area .element.has-background {
  background: var(--theia-statusBarItem-remoteBackground) !important;
  color: var(--theia-statusBarItem-remoteForeground) !important;
}
#theia-statusBar .area .element.has-background:hover {
  background: rgba(124,92,191,0.85) !important;
}
#theia-statusBar .codicon {
  font-size: 13px !important;
  margin-right: 4px !important;
}

/* ====== Terminal ====== */
#theia-bottom-split-panel,
.theia-bottom-content-panel {
  background: var(--theia-panel-background) !important;
}
#theia-bottom-side-panel {
  background: var(--theia-panel-background) !important;
}
.xterm,
.xterm-screen,
.xterm-viewport,
.terminal-container,
.terminal-container .xterm {
  background: var(--theia-terminal-background) !important;
}
.xterm .xterm-rows {
  font-family: var(--theia-monospace-font-family) !important;
  font-size: 12.5px !important;
  line-height: 1.5 !important;
}
.terminal-container .xterm-viewport::-webkit-scrollbar {
  width: 8px;
}
.terminal-tab-icon,
.terminal-outer-container {
  background: var(--theia-terminal-background) !important;
}

/* ====== Bottom Panel Tabs ====== */
#theia-bottom-split-panel .lm-TabBar,
#theia-bottom-content-panel .lm-TabBar.theia-app-sides {
  background: var(--theia-panel-background) !important;
  border-top: 1px solid var(--theia-panel-border) !important;
  min-height: 30px !important;
  height: 30px !important;
}
#theia-bottom-split-panel .lm-TabBar .lm-TabBar-tab {
  color: var(--theia-panelTitle-inactiveForeground) !important;
  background: transparent !important;
  padding: 0 12px !important;
  height: 29px !important;
  line-height: 29px !important;
  min-height: 29px !important;
  border-top: none !important;
  border-radius: 0 !important;
  position: relative;
  text-transform: uppercase;
  font-size: 11px !important;
  letter-spacing: 0.5px !important;
  font-weight: 500 !important;
  transition: color 100ms ease;
}
#theia-bottom-split-panel .lm-TabBar .lm-TabBar-tab:hover {
  color: var(--theia-panelTitle-activeForeground) !important;
}
#theia-bottom-split-panel .lm-TabBar .lm-TabBar-tab.lm-mod-current {
  color: var(--theia-panelTitle-activeForeground) !important;
}
#theia-bottom-split-panel .lm-TabBar .lm-TabBar-tab.lm-mod-current::after {
  content: '';
  position: absolute;
  top: 0;
  left: 8px;
  right: 8px;
  height: 1px;
  background: var(--theia-panelTitle-activeBorder);
}

/* ====== Buttons ====== */
.theia-button {
  background: var(--theia-button-background) !important;
  color: var(--theia-button-foreground) !important;
  border: none !important;
  border-radius: 5px !important;
  padding: 5px 14px !important;
  font-size: 12.5px !important;
  font-weight: 500 !important;
  cursor: pointer !important;
  transition: background 120ms ease, transform 60ms ease;
  font-family: var(--theia-ui-font-family) !important;
  outline: none !important;
  min-width: 65px !important;
  line-height: 1.4 !important;
}
.theia-button:hover {
  background: var(--theia-button-hoverBackground) !important;
}
.theia-button:active {
  transform: scale(0.97);
}
.theia-button.secondary {
  background: var(--theia-button-secondaryBackground) !important;
  color: var(--theia-button-secondaryForeground) !important;
}
.theia-button.secondary:hover {
  background: var(--theia-button-secondaryHoverBackground) !important;
}
.theia-button[disabled] {
  opacity: 0.5 !important;
  cursor: default !important;
  pointer-events: none !important;
}

/* ====== Inputs & Controls ====== */
.theia-input,
input[type="text"],
input[type="search"],
input[type="number"],
textarea,
select {
  background: var(--theia-input-background) !important;
  color: var(--theia-input-foreground) !important;
  border: 1px solid var(--theia-input-border) !important;
  border-radius: 4px !important;
  padding: 4px 8px !important;
  font-size: 12.5px !important;
  font-family: var(--theia-ui-font-family) !important;
  outline: none !important;
  transition: border-color 120ms ease;
  line-height: 1.4 !important;
}
.theia-input:focus,
input[type="text"]:focus,
input[type="search"]:focus,
input[type="number"]:focus,
textarea:focus,
select:focus {
  border-color: var(--theia-focusBorder) !important;
}
.theia-input::placeholder,
input::placeholder,
textarea::placeholder {
  color: var(--theia-input-placeholderForeground) !important;
}

/* Search box */
.theia-search-box,
.theia-filterinput,
.search-input {
  background: var(--theia-input-background) !important;
  border: 1px solid var(--theia-input-border) !important;
  border-radius: 4px !important;
  padding: 4px 8px 4px 28px !important;
  color: var(--theia-input-foreground) !important;
  font-size: 12.5px !important;
  outline: none !important;
}

/* ====== Dialogs & Modals ====== */
.theia-Dialog,
.dialogBlock {
  background: var(--theia-notification-background) !important;
  color: var(--theia-notification-foreground) !important;
  border: 1px solid var(--theia-notification-border) !important;
  border-radius: 10px !important;
  box-shadow: 0 12px 48px rgba(0,0,0,0.6) !important;
  font-family: var(--theia-ui-font-family) !important;
}
.theia-Dialog .dialogTitle,
.dialogBlock .dialogTitle {
  background: transparent !important;
  border-bottom: 1px solid var(--theia-widget-border) !important;
  padding: 14px 20px 12px !important;
  font-size: 14px !important;
  font-weight: 600 !important;
  color: var(--theia-foreground) !important;
  border-radius: 10px 10px 0 0 !important;
}
.theia-Dialog .dialogContent,
.dialogBlock .dialogContent {
  padding: 16px 20px !important;
}
.theia-Dialog .dialogControl,
.dialogBlock .dialogControl {
  padding: 12px 20px !important;
  border-top: 1px solid var(--theia-widget-border) !important;
  display: flex !important;
  gap: 8px !important;
  justify-content: flex-end !important;
  background: rgba(0,0,0,0.15) !important;
  border-radius: 0 0 10px 10px !important;
}
.dialogBlock .dialogContent .dialogSection {
  margin-bottom: 12px !important;
}
.dialogBlock .dialogContent label {
  color: var(--theia-descriptionForeground) !important;
  font-size: 12px !important;
  margin-bottom: 4px !important;
  display: block !important;
}

/* ====== Quick Open / Command Palette ====== */
.quick-input-widget,
.quick-open-widget,
.monaco-quick-open-widget {
  background: var(--theia-quickInput-background) !important;
  border: 1px solid var(--theia-menu-border) !important;
  border-radius: 8px !important;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5) !important;
  padding: 0 !important;
}
.quick-input-titlebar,
.quick-open-widget .monaco-list .monaco-list-title {
  background: var(--theia-quickInputTitle-background) !important;
  border-bottom: 1px solid var(--theia-widget-border) !important;
  border-radius: 8px 8px 0 0 !important;
  padding: 8px 14px !important;
  font-size: 11px !important;
  font-weight: 600 !important;
  text-transform: uppercase !important;
  letter-spacing: 0.5px !important;
}
.quick-input-widget .quick-input-filter,
.quick-open-widget .monaco-inputbox {
  padding: 10px 14px !important;
  border-bottom: 1px solid var(--theia-widget-border) !important;
}
.quick-input-widget .quick-input-list,
.quick-open-widget .monaco-list {
  padding: 4px !important;
}
.quick-input-list .monaco-list-row,
.quick-open-widget .monaco-list .monaco-list-row {
  border-radius: 4px !important;
  padding: 5px 8px !important;
  line-height: 1.4 !important;
  font-size: 13px !important;
}
.quick-input-list .monaco-list-row.focused,
.quick-open-widget .monaco-list .monaco-list-row.focused {
  background: var(--theia-quickInputList-focusBackground) !important;
  color: var(--theia-quickInputList-focusForeground) !important;
}
.quick-input-list .label,
.quick-open-widget .monaco-list .monaco-list-row .label .name,
.quick-open-widget .monaco-highlighted-label {
  font-size: 13px !important;
}
.quick-input-list .label .monaco-icon-label,
.quick-input-list .quick-input-list-entry .quick-input-list-entry-keybinding,
.keybinding-label {
  font-size: 11px !important;
}

/* ====== Context Menus ====== */
.lm-Menu,
.lm-ContextMenu,
.theia-context-menu,
.p-Widget.lm-Menu,
.monaco-menu .monaco-menu-container {
  background: var(--theia-menu-background) !important;
  border: 1px solid var(--theia-menu-border) !important;
  border-radius: 8px !important;
  padding: 5px !important;
  box-shadow: 0 8px 32px rgba(0,0,0,0.55) !important;
}
.lm-Menu-item,
.monaco-menu .action-item,
.monaco-menu .monaco-action-bar .action-item {
  color: var(--theia-menu-foreground) !important;
  padding: 6px 28px 6px 10px !important;
  border-radius: 4px !important;
  font-size: 12.5px !important;
  margin: 1px 3px !important;
  transition: background 70ms ease;
}
.lm-Menu-item:hover,
.lm-Menu-item.lm-mod-active,
.monaco-menu .action-item.focused,
.monaco-menu .monaco-action-bar .action-item:focus {
  background: var(--theia-menu-selectionBackground) !important;
  color: var(--theia-menu-selectionForeground) !important;
}
.lm-Menu-item.lm-mod-disabled {
  color: var(--theia-disabled-color0) !important;
  pointer-events: none !important;
}
.lm-Menu-item.lm-mod-separator,
.monaco-menu .menu-separator {
  border-top: 1px solid var(--theia-menu-separatorBackground) !important;
  margin: 4px 6px !important;
  padding: 0 !important;
  height: 0 !important;
}
.lm-Menu-itemShortcut,
.monaco-keybinding {
  color: var(--theia-ui-font-color2) !important;
  font-size: 11px !important;
  font-family: var(--theia-monospace-font-family) !important;
}
.lm-Menu-itemSubmenuIcon {
  color: var(--theia-ui-font-color2) !important;
  font-size: 11px !important;
}

/* ====== Menu Bar ====== */
.lm-MenuBar,
#theia-menubar,
#theia-top-panel .lm-MenuBar {
  background: var(--theia-titleBar-activeBackground) !important;
}
.lm-MenuBar-content {
  padding: 0 6px !important;
  height: 30px !important;
  display: flex !important;
  align-items: center !important;
}
.lm-MenuBar-item {
  color: var(--theia-titleBar-activeForeground) !important;
  padding: 0 10px !important;
  height: 26px !important;
  line-height: 26px !important;
  font-size: 12.5px !important;
  border-radius: 4px !important;
  margin: 0 1px !important;
  transition: background 100ms ease;
}
.lm-MenuBar-item:hover,
.lm-MenuBar-item.lm-mod-active {
  background: var(--theia-menubar-selectionBackground) !important;
  color: var(--theia-menubar-selectionForeground) !important;
}

/* ====== Notifications / Toast ====== */
.theia-notification,
.theia-NotificationContainer .theia-notification {
  background: var(--theia-notification-background) !important;
  border: 1px solid var(--theia-notification-border) !important;
  border-radius: 8px !important;
  box-shadow: 0 8px 24px rgba(0,0,0,0.4) !important;
  padding: 12px 16px !important;
}
.theia-notification-message {
  font-size: 13px !important;
  color: var(--theia-notification-foreground) !important;
}
.theia-notification-item {
  padding: 10px 14px !important;
  border-radius: 6px !important;
  font-size: 12px !important;
  background: var(--theia-button-secondaryBackground) !important;
  color: var(--theia-button-secondaryForeground) !important;
  border: none !important;
  margin: 0 2px !important;
  transition: background 100ms ease;
  cursor: pointer !important;
}
.theia-notification-item:hover {
  background: var(--theia-button-secondaryHoverBackground) !important;
}

/* ====== Tooltips ====== */
.theia-tooltip,
.lm-Widget .p-Tip,
.lm-Tip {
  background: #2a2d30 !important;
  color: #dfe1e5 !important;
  border: 1px solid #3d4148 !important;
  border-radius: 5px !important;
  padding: 5px 9px !important;
  font-size: 12px !important;
  box-shadow: 0 4px 12px rgba(0,0,0,0.4) !important;
  z-index: 50000 !important;
}

/* ====== Toolbars & Icon Buttons ====== */
.theia-button .codicon,
.button .codicon,
.theia-Icon {
  font-size: 14px !important;
}
.theia-sidebar-toolbar,
.theia-view-container .theia-TreeContainer .theia-TreeContainer-ToolBar,
.theia-sidepanel-toolbar .codicon {
  color: var(--theia-ui-font-color2) !important;
}
.theia-sidebar-toolbar .codicon:hover,
.theia-sidepanel-toolbar .codicon:hover {
  color: var(--theia-ui-font-color0) !important;
  background: rgba(255,255,255,0.06) !important;
  border-radius: 3px !important;
}
.codicon {
  font-family: 'codicon' !important;
}

/* ====== Splitter / Sash Handles ====== */
.lm-SplitPanel-handle {
  background: transparent !important;
  transition: background 120ms ease;
}
.lm-SplitPanel-handle:hover {
  background: var(--theia-sash-hoverBorder) !important;
}
.lm-SplitPanel-handle::after {
  background: transparent !important;
}

/* ====== Monaco Overrides ====== */
.monaco-editor,
.monaco-editor .mtk1 {
  color: #d4d4d4 !important;
}
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
.monaco-editor .margin-view-overlays .line-numbers {
  color: #5d6166 !important;
}
.monaco-editor .current-line {
  background: rgba(255,255,255,0.03) !important;
}
.monaco-editor .cursors-layer .cursor {
  border-left: 2px solid #aeafad !important;
}
.monaco-editor .core-guide,
.monaco-editor .indent-guide {
  border-color: rgba(255,255,255,0.08) !important;
}
.monaco-editor .core-guide.active,
.monaco-editor .indent-guide.active {
  border-color: rgba(255,255,255,0.15) !important;
}
.monaco-editor .selected-text {
  background: #264f78 !important;
}
.monaco-editor .focused .selected-text {
  background: #264f78 !important;
}
/* Minimap */
.monaco-editor .minimap {
  opacity: 0.7;
}
/* Overview ruler */
.monaco-editor .decorationsOverviewRuler {
  opacity: 0.6;
}

/* ====== Monaco Find Widget ====== */
.monaco-editor .find-widget {
  background: var(--theia-editorWidget-background) !important;
  border: 1px solid var(--theia-editorWidget-border) !important;
  border-radius: 6px !important;
  box-shadow: 0 4px 16px rgba(0,0,0,0.4) !important;
  padding: 4px !important;
}
.monaco-editor .find-widget input {
  background: var(--theia-input-background) !important;
  border: 1px solid var(--theia-input-border) !important;
  border-radius: 4px !important;
  color: var(--theia-input-foreground) !important;
  padding: 3px 6px !important;
  font-size: 12.5px !important;
}
.monaco-editor .find-widget .codicon {
  color: var(--theia-icon-foreground) !important;
  border-radius: 3px !important;
  padding: 3px !important;
}
.monaco-editor .find-widget .codicon:hover {
  background: rgba(255,255,255,0.08) !important;
}

/* ====== Progress Bar ====== */
.theia-progress-bar {
  background: var(--theia-progressBar-background) !important;
  height: 2px !important;
  z-index: 1000;
}

/* ====== Badge ====== */
.theia-badge,
.badge {
  background: var(--theia-activityBarBadge-background) !important;
  color: var(--theia-activityBarBadge-foreground) !important;
  border-radius: 10px !important;
  font-size: 10px !important;
  font-weight: 600 !important;
  padding: 1px 6px !important;
  min-width: 18px !important;
  height: 16px !important;
  line-height: 14px !important;
  text-align: center;
}

/* ====== Settings ====== */
.theia-settings-container {
  background: var(--theia-editor-background) !important;
  color: var(--theia-ui-font-color1) !important;
}
.settings-header {
  background: var(--theia-sideBarSectionHeader-background) !important;
  border-bottom: 1px solid var(--theia-widget-border) !important;
  padding: 12px 20px !important;
}
.settings-section-title {
  color: var(--theia-foreground) !important;
  font-weight: 600 !important;
  font-size: 16px !important;
  padding-bottom: 8px !important;
  border-bottom: 1px solid var(--theia-widget-border) !important;
}
.pref-input {
  background: var(--theia-settings-textInputBackground) !important;
  border: 1px solid var(--theia-settings-textInputBorder) !important;
  border-radius: 4px !important;
  color: var(--theia-settings-textInputForeground) !important;
  padding: 4px 8px !important;
}

/* ====== Open Editors section ====== */
.theia-open-editors-widget .theia-TreeNode {
  font-size: 13px !important;
}

/* ====== Command Center / Top bar ====== */
#theia-top-panel {
  background: var(--theia-titleBar-activeBackground) !important;
  border-bottom: 1px solid var(--theia-sideBar-border) !important;
}

/* ====== Command palette trigger ====== */
.theia-command-palette-key {
  background: var(--theia-keybindingLabel-background) !important;
  color: var(--theia-keybindingLabel-foreground) !important;
  border: 1px solid var(--theia-keybindingLabel-border) !important;
  border-bottom-width: 2px !important;
  border-radius: 3px !important;
  padding: 1px 5px !important;
  font-size: 11px !important;
  font-family: var(--theia-monospace-font-family) !important;
  min-width: 18px !important;
  text-align: center !important;
}

/* ====== Tree indent guides ====== */
.theia-TreeContainer .theia-TreeNodeIndent {
  border-left: 1px solid transparent;
}
.theia-TreeContainer.alwaysIndentGuides .theia-TreeNodeIndent,
.theia-TreeContainer.onDepthIndentGuides .theia-TreeNodeIndent.has-indent-guide {
  border-left-color: var(--theia-tree-indentGuidesStroke) !important;
}

/* ====== Resize cursor ====== */
.lm-SplitPanel-handle {
  cursor: col-resize;
}
.lm-SplitPanel[data-orientation='vertical'] .lm-SplitPanel-handle {
  cursor: row-resize;
}

/* ====== Focus outline ====== */
.lm-Widget:focus,
.theia-TreeNode.theia-mod-focus {
  outline: none !important;
}

/* ====== Monaco Editor Suggest Widget ====== */
.monaco-editor .suggest-widget {
  background: var(--theia-editorSuggestWidget-background) !important;
  border: 1px solid var(--theia-editorSuggestWidget-border) !important;
  border-radius: 6px !important;
  box-shadow: 0 6px 20px rgba(0,0,0,0.4) !important;
}
.monaco-editor .suggest-widget .monaco-list .monaco-list-row {
  border-radius: 3px !important;
  padding: 2px 6px !important;
}
.monaco-editor .suggest-widget .monaco-list .monaco-list-row.focused {
  background: var(--theia-editorSuggestWidget-selectedBackground) !important;
}
.monaco-editor .suggest-widget .monaco-list .monaco-list-row .monaco-icon-label,
.monaco-editor .suggest-widget .monaco-list .monaco-list-row .label,
.monaco-editor .suggest-widget .monaco-list .monaco-list-row .monaco-highlighted-label {
  font-size: 13px !important;
}

/* ====== Dialog message/confirm ====== */
.theia-confirm-Dialog .dialogContent,
.theia-message-Dialog .dialogContent {
  font-size: 13px !important;
  line-height: 1.5 !important;
  color: var(--theia-notification-foreground) !important;
}

/* ====== Outline / Symbols panel ====== */
.theia-outline-view,
.theia-outline-view .theia-TreeContainer {
  background: var(--theia-sideBar-background) !important;
}

/* ====== Problems / Marker panel ====== */
.theia-marker-container,
.problem-widget,
#problems-view-container {
  background: var(--theia-panel-background) !important;
  color: var(--theia-ui-font-color1) !important;
}
.problem-widget .problem-count {
  font-size: 12px !important;
}
.theia-marker-container .marker-icon {
  font-size: 12px !important;
}
.theia-marker-container .theia-TreeNode {
  font-size: 12.5px !important;
  line-height: 20px !important;
}

/* ====== Output / Log panel ====== */
.theia-output,
.theia-output-component,
.output-view-container {
  background: var(--theia-terminal-background) !important;
  color: var(--theia-ui-font-color1) !important;
  font-family: var(--theia-monospace-font-family) !important;
  font-size: 12.5px !important;
  padding: 8px 12px !important;
}

/* ====== Welcome Page ====== */
.welcomePage,
.theia-welcomePage {
  background: var(--theia-welcomePage-background) !important;
}
.theia-welcomePage h1,
.welcomePage h1 {
  color: var(--theia-foreground) !important;
  font-weight: 300 !important;
}
.welcomePage .theia-button {
  background: var(--theia-welcomePage-buttonBackground) !important;
}
.welcomePage .theia-button:hover {
  background: var(--theia-welcomePage-buttonHoverBackground) !important;
}

/* ====== Debug Toolbar ====== */
.theia-debug-toolbar,
.debug-toolbar {
  background: var(--theia-debugToolBar-background) !important;
  border: 1px solid var(--theia-debugToolBar-border) !important;
  border-radius: 7px !important;
  box-shadow: 0 4px 16px rgba(0,0,0,0.4) !important;
  padding: 4px 6px !important;
}
.theia-debug-toolbar .debug-action,
.debug-toolbar .debug-action {
  color: var(--theia-icon-foreground) !important;
  width: 28px !important;
  height: 24px !important;
  border-radius: 4px !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  transition: background 80ms ease;
}
.theia-debug-toolbar .debug-action:hover,
.debug-toolbar .debug-action:hover {
  background: rgba(255,255,255,0.08) !important;
}
.theia-debug-toolbar .debug-action.codicon-debug-start,
.debug-toolbar .codicon-debug-start {
  color: var(--theia-success-color0) !important;
}
.theia-debug-toolbar .debug-action.codicon-debug-stop,
.debug-toolbar .codicon-debug-stop {
  color: var(--theia-error-color0) !important;
}

/* ====== Hover Widgets (tooltips over code) ====== */
.monaco-editor .monaco-hover,
.monaco-hover {
  background: var(--theia-editorHoverWidget-background) !important;
  border: 1px solid var(--theia-editorHoverWidget-border) !important;
  border-radius: 6px !important;
  box-shadow: 0 4px 16px rgba(0,0,0,0.4) !important;
  padding: 4px 8px !important;
}
.monaco-hover .monaco-hover-content,
.monaco-hover-content {
  font-size: 12.5px !important;
  line-height: 1.5 !important;
}
.monaco-hover .markdown-hover .hover-contents,
.monaco-hover-content .hover-contents {
  padding: 4px !important;
  color: var(--theia-editor-foreground) !important;
}
.monaco-hover .monaco-tokenized-source {
  font-family: var(--theia-monospace-font-family) !important;
  font-size: 12.5px !important;
}

/* ====== Keybindings in context menus/quickpick ====== */
.monaco-keybinding-key {
  background: var(--theia-keybindingLabel-background) !important;
  color: var(--theia-keybindingLabel-foreground) !important;
  border: 1px solid var(--theia-keybindingLabel-border) !important;
  border-bottom-width: 2px !important;
  border-radius: 3px !important;
  padding: 1px 5px !important;
  font-size: 10px !important;
  font-family: var(--theia-monospace-font-family) !important;
}

/* ====== File icons colors ====== */
.theia-file-icons-js .file-icon,
.theia-file-icons-js .folder-icon {
  font-size: 14px !important;
}

/* ====== Breadcrumb icons ====== */
.breadcrumb-item .codicon {
  font-size: 12px !important;
}

/* ====== Panel icons ====== */
#theia-bottom-split-panel .lm-TabBar-tab .codicon,
#theia-bottom-split-panel .lm-TabBar-tab .theia-icon {
  font-size: 14px !important;
  margin-right: 5px !important;
}

/* ====== Misc: chevrons, disclosure triangles ====== */
.codicon-chevron-down,
.codicon-chevron-right,
.codicon-tree-item-expanded,
.codicon-tree-item-collapsed {
  font-size: 12px !important;
}

/* ====== Search in files widget ====== */
.theia-search-box .theia-input,
.search-in-workspace .theia-input,
.search-box .theia-input {
  background: var(--theia-input-background) !important;
  border: 1px solid var(--theia-input-border) !important;
  border-radius: 4px !important;
}

/* ====== Monaco inline editor / suggest ====== */
.monaco-editor .lines-content .cigra {
  background: rgba(124,92,191,0.3) !important;
}

/* ====== Selection highlight ====== */
.monaco-editor .wordHighlight {
  background: var(--theia-editor-wordHighlightBackground) !important;
}
.monaco-editor .wordHighlightStrong {
  background: var(--theia-editor-wordHighlightStrongBackground) !important;
}

/* ====== Global transition for interactive elements ====== */
.theia-button,
.theia-input,
.codicon,
.lm-TabBar-tab,
.lm-MenuBar-item,
.lm-Menu-item,
.theia-TreeNode {
  -webkit-user-select: none;
  user-select: none;
}

/* ====== Editor area backdrop (when no tabs open) ====== */
.theia-main-content-panel .lm-DockPanel-widget:not(.lm-mod-hidden) ~ .lm-DockPanel-drop-zone {
  background: var(--theia-editor-background) !important;
}

/* ====== Hidden scrollbars on sidebar (JetBrains/Zed style: only show on hover) ====== */
.theia-TreeContainer::-webkit-scrollbar,
.theia-side-panel::-webkit-scrollbar {
  width: 8px !important;
  height: 8px !important;
}
`;

function injectKairoCSSNow(): void {
  try {
    if (typeof document === 'undefined') return;
    if (document.getElementById('kairo-theme-style')) return;
    const style = document.createElement('style');
    style.id = 'kairo-theme-style';
    style.textContent = KAIRO_CSS;
    if (document.head) {
      document.head.appendChild(style);
    } else if (document.documentElement) {
      document.documentElement.appendChild(style);
    }
  } catch (e) {
    console.error('[Kairo] Failed to inject CSS:', e);
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

  initialize(): void {
    injectKairoCSSNow();
    this.forceApplyKairoTheme();
  }

  onStart(): void {
    injectKairoCSSNow();
    this.forceApplyKairoTheme();
    this.observeThemeChanges();
    this.fixTerminalBackground();

    setTimeout(() => {
      injectKairoCSSNow();
      this.forceApplyKairoTheme();
    }, 300);
    setTimeout(() => {
      injectKairoCSSNow();
      this.forceApplyKairoTheme();
      this.fixTerminalBackground();
    }, 1000);
    setTimeout(() => {
      this.forceApplyKairoTheme();
      this.fixTerminalBackground();
    }, 3000);
  }

  private forceApplyKairoTheme(): void {
    const body = document.body;
    if (!body) return;

    body.classList.remove('theia-light', 'light-theia', 'vs', 'vs-dark', 'hc-black', 'hc-light', 'vs-light');
    body.classList.add('kairo-dark', 'kairo-ide', 'theia-dark');

    const root = document.documentElement;
    Object.entries(KAIRO_DARK_VARS).forEach(([key, value]) => {
      root.style.setProperty(key, value);
      body.style.setProperty(key, value);
    });

    body.style.backgroundColor = '#1e1f22';
    body.style.color = '#dfe1e5';

    const monacoShell = document.querySelector('.monaco-workbench') as HTMLElement | null;
    if (monacoShell) {
      monacoShell.classList.remove('vs', 'vs-light', 'hc-black', 'hc-light');
      monacoShell.classList.add('vs-dark');
    }
  }

  private fixTerminalBackground(): void {
    const terminals = document.querySelectorAll('.xterm, .terminal-container, .xterm-screen, .xterm-viewport');
    terminals.forEach(term => {
      (term as HTMLElement).style.background = 'var(--theia-terminal-background)';
    });
  }

  private observeThemeChanges(): void {
    if (this.observer) return;

    this.observer = new MutationObserver(() => {
      const body = document.body;
      if (
        body.classList.contains('theia-light') ||
        body.classList.contains('light-theia') ||
        body.classList.contains('vs') ||
        body.classList.contains('vs-light') ||
        !body.classList.contains('kairo-dark')
      ) {
        this.forceApplyKairoTheme();
      }
    });

    this.observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
      subtree: false,
    });

    const resizeObserver = new MutationObserver(() => {
      this.fixTerminalBackground();
    });
    resizeObserver.observe(document.body, { childList: true, subtree: true });
  }
}

export default KairoUiContribution;
