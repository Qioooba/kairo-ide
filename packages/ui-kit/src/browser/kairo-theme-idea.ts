import { Theme, ThemeType } from '@theia/core/lib/common/theme';

// ============================================================================
// Kairo IDEA Theme — IntelliJ IDEA Darcula-style syntax highlighting
//
// Reuses the same UI chrome (CSS variables) as KairoDarkTheme but
// points to a different Monaco editor theme ('kairo-idea-dark')
// whose syntax token colors mirror IntelliJ IDEA's Darcula scheme.
// ============================================================================

// Same UI CSS variables as KairoDarkTheme — single source of truth
// shared between both themes. Only the editorTheme differs.
const KAIRO_DARK_VARS: Record<string, string> = {
  // ----- Layout surface (3-tone dark gray) -----
  '--theia-layout-color0': '#1e1f22',
  '--theia-layout-color1': '#252629',
  '--theia-layout-color2': '#2b2c30',
  '--theia-layout-color3': '#37393d',
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
  '--theia-brand-color0': '#7C3AED',
  '--theia-brand-color1': '#8d6dd0',
  '--theia-brand-color2': '#5e42a6',
  '--theia-brand-color3': '#4a3385',
  '--theia-accent-color0': '#7C3AED',
  '--theia-accent-color1': '#8d6dd0',
  '--theia-accent-color2': '#37393d',
  '--theia-accent-color3': '#3d2f5f',
  '--theia-focusBorder': '#7C3AED',
  '--theia-activeBorder': '#7C3AED',
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
  '--theia-editorBracketMatch-border': '#7C3AED',
  '--theia-editorBracketMatch-background': 'rgba(124,92,191,0.10)',
  '--theia-editorOverviewRuler-bracketMatchForeground': '#7C3AED',
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
  '--theia-inputOption-activeBorder': '#7C3AED',
  '--theia-inputOption-activeBackground': 'rgba(124,92,191,0.22)',
  '--theia-dropdown-background': '#2b2c30',
  '--theia-dropdown-border': '#3d4148',
  '--theia-dropdown-listBackground': '#252629',
  '--theia-dropdown-foreground': '#dfe1e5',

  // ----- Buttons -----
  '--theia-button-background': '#7C3AED',
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
  '--theia-activityBar-activeBorder': '#7C3AED',
  '--theia-activityBar-border': 'rgba(255,255,255,0.06)',
  '--theia-activityBarBadge-background': '#7C3AED',
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
  '--theia-tab-activeBorder': '#7C3AED',
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

  // ----- Bottom panel -----
  '--theia-panel-background': '#1e1f22',
  '--theia-panel-border': 'rgba(255,255,255,0.06)',
  '--theia-panelTitle-foreground': '#c5c8cc',
  '--theia-panelTitle-activeForeground': '#e6e7ea',
  '--theia-panelTitle-activeBorder': '#7C3AED',
  '--theia-panelTitle-inactiveForeground': '#8b8f96',

  // ----- Status bar -----
  '--theia-statusBar-background': '#1a1b1e',
  '--theia-statusBar-foreground': '#c5c8cc',
  '--theia-statusBar-border': 'rgba(255,255,255,0.08)',
  '--theia-statusBar-noFolderBackground': '#1a1b1e',
  '--theia-statusBarItem-activeBackground': 'rgba(255,255,255,0.08)',
  '--theia-statusBarItem-hoverBackground': 'rgba(255,255,255,0.05)',
  '--theia-statusBarItem-prominentBackground': '#7C3AED',
  '--theia-statusBarItem-prominentHoverBackground': '#8d6dd0',
  '--theia-statusBarItem-remoteBackground': '#7C3AED',
  '--theia-statusBarItem-remoteForeground': '#ffffff',

  // ----- Title bar -----
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
  '--theia-welcomePage-buttonBackground': '#7C3AED',
  '--theia-welcomePage-buttonHoverBackground': '#8d6dd0',
  '--theia-welcomePage-tileBackground': '#252629',

  // ----- Widgets -----
  '--theia-widget-shadow': '0 8px 28px rgba(0,0,0,0.45)',
  '--theia-widget-border': 'rgba(255,255,255,0.06)',
  '--theia-sash-hoverBorder': '#7C3AED',
  '--theia-contrastBorder': 'transparent',
  '--theia-contrastActiveBorder': 'transparent',
  '--theia-progressBar-background': '#7C3AED',

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
  '--theia-settings-modifiedItemIndicator': '#7C3AED',
  '--theia-settings-dropdownBackground': '#1a1b1e',
  '--theia-settings-dropdownForeground': '#dfe1e5',
  '--theia-settings-dropdownBorder': '#2e3136',
  '--theia-settings-checkboxBackground': '#1a1b1e',
  '--theia-settings-checkboxBorder': '#3d4148',
  '--theia-settings-checkboxForeground': '#7C3AED',
  '--theia-settings-textInputBackground': '#1a1b1e',
  '--theia-settings-textInputForeground': '#dfe1e5',
  '--theia-settings-textInputBorder': '#2e3136',
  '--theia-settings-numberInputBackground': '#1a1b1e',
  '--theia-settings-numberInputForeground': '#dfe1e5',
  '--theia-settings-numberInputBorder': '#2e3136',
  '--theia-settings-focusedRowBackground': '#2a2d30',
  '--theia-settings-rowHoverBackground': 'rgba(255,255,255,0.03)',

  // ----- Block quote & code block -----
  '--theia-textBlockQuote-background': '#252629',
  '--theia-textBlockQuote-border': '#3d4148',
  '--theia-textCodeBlock-background': '#1a1b1e',

  // ----- Tree indent guides -----
  '--theia-tree-indentGuidesStroke': 'rgba(255,255,255,0.06)',
  '--theia-tree-inactiveIndentGuidesStroke': 'rgba(255,255,255,0.04)',
  '--theia-tree-tableColumnsBorder': 'transparent',

  // ----- Symbol icons -----
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

  // ----- Font stacks -----
  '--theia-shared-frontend-ui-font-family': "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', 'SF Pro Display', system-ui, sans-serif",
  '--theia-ui-font-family': "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', 'SF Pro Display', system-ui, sans-serif",
  '--theia-monospace-font-family': "'JetBrains Mono', 'SF Mono', 'Fira Code', Menlo, Consolas, monospace",
  '--theia-content-font-size': '13px',
};

/**
 * IntelliJ IDEA-style dark theme — same UI chrome as Kairo Dark,
 * but with IntelliJ IDEA Darcula syntax highlighting colors.
 */
export const KairoIDEATheme: Theme = {
    id: 'kairo-idea-dark',
    type: 'dark' as ThemeType,
    label: 'Kairo IDEA Dark',
    description: 'Kairo IDE dark theme with IntelliJ IDEA-style syntax highlighting',
    editorTheme: 'kairo-idea-dark',
    activate(): void {
        if (typeof document === 'undefined') return;
        const root = document.documentElement;
        for (const [key, value] of Object.entries(KAIRO_DARK_VARS)) {
            root.style.setProperty(key, value);
        }
        // Re-assert on next frame to cover race conditions (same as KairoDarkTheme)
        const reassert = () => {
            for (const [key, value] of Object.entries(KAIRO_DARK_VARS)) {
                root.style.setProperty(key, value);
            }
        };
        requestAnimationFrame(reassert);
        setTimeout(reassert, 50);
        setTimeout(reassert, 250);

        // Override Theia 1.73 hard-coded button colors
        const styleId = 'kairo-theme-overrides';
        if (!document.getElementById(styleId)) {
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = `
                .theia-button {
                    background: var(--theia-button-background, #7C3AED) !important;
                    color: var(--theia-button-foreground, #ffffff) !important;
                }
                .theia-button:hover {
                    background: var(--theia-button-hoverBackground, #8d6dd0) !important;
                }
                .theia-button.secondary {
                    background: var(--theia-button-secondaryBackground, #37393d) !important;
                    color: var(--theia-button-secondaryForeground, #dfe1e5) !important;
                }
                .theia-button.secondary:hover {
                    background: var(--theia-button-secondaryHoverBackground, #44464c) !important;
                }
            `;
            document.head.appendChild(style);
        }
    },
    deactivate(): void {
        // No-op for static theme
    },
};