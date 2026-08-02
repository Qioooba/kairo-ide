import { injectable, inject, optional } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { ThemeService } from '@theia/core/lib/browser/theming';
import { ColorRegistry } from '@theia/core/lib/browser/color-registry';
import { ColorContribution } from '@theia/core/lib/browser/color-application-contribution';
import { WidgetManager } from '@theia/core/lib/browser/widget-manager';
import { KairoDarkTheme } from './kairo-theme';
import { KairoIDEATheme } from './kairo-theme-idea';
import * as monaco from '@theia/monaco-editor-core';

// N-034: Derive Monaco theme and ColorRegistry overrides from the single
// source of truth — the CSS variables in KairoDarkTheme. The activate()
// method writes these to :root as inline styles; we mirror the same
// hex values here for the Monaco editor theme and the ColorRegistry
// defaults so all three layers agree on every color slot.

/** Monaco editor theme backing `KairoDarkTheme.editorTheme`
 * ('kairo-dark'). Without this definition Monaco silently falls
 * back to a stock theme and the editor drifts from the product
 * palette (KAIRO-RC-WEB-004). Colors are derived from the
 * CSS variables in kairo-theme.ts — the single source of truth. */
export const KAIRO_MONACO_THEME: monaco.editor.IStandaloneThemeData = {
    base: 'vs-dark',
    inherit: true,
    rules: [
        // Syntax tokens — mirrored from KairoDarkTheme's editor palette
        { token: 'comment', foreground: '7a7e85', fontStyle: 'italic' },
        { token: 'comment.doc', foreground: '6a9955' },
        { token: 'keyword.doc', foreground: 'c586c0' },
        { token: 'keyword', foreground: 'c586c0' },
        { token: 'string', foreground: 'ce9178' },
        { token: 'string.quote', foreground: 'ce9178' },
        { token: 'string.escape', foreground: 'd7ba7d' },
        { token: 'number', foreground: 'b5cea8' },
        { token: 'number.float', foreground: 'b5cea8' },
        { token: 'number.hex', foreground: 'b5cea8' },
        { token: 'type', foreground: '4ec9b0' },
        { token: 'method', foreground: 'dcdcaa' },
        { token: 'identifier', foreground: 'dfe1e5' },
        { token: 'constant', foreground: '4fc1ff' },
        { token: 'constant.language', foreground: '569cd6' },
        { token: 'predefined', foreground: '4fc1ff' },
        { token: 'annotation', foreground: 'dcdcaa' },
        { token: 'delimiter', foreground: 'a9adb3' },
        { token: 'operator', foreground: 'd4d4d4' },
        { token: 'tag', foreground: '569cd6' },
        { token: 'tag.jsp-directive', foreground: '569cd6' },
        { token: 'tag.jsp-decl', foreground: '569cd6' },
        { token: 'tag.jsp-expr', foreground: '569cd6' },
        { token: 'tag.jsp-scriptlet', foreground: '569cd6' },
        { token: 'tag.jsp-jstl', foreground: '569cd6' },
        { token: 'tag.jsp-taglib', foreground: '569cd6' },
        { token: 'metatag', foreground: '808080' },
        { token: 'metatag.el', foreground: 'b5cea8' },
        { token: 'attribute.name', foreground: '9cdcfe' },
        { token: 'attribute.value', foreground: 'ce9178' },
    ],
    colors: {
        // All editor colors are derived from the single source of truth
        // in KairoDarkTheme's CSS variables (kairo-theme.ts).
        'editor.background': '#1e1f22',            // --theia-editor-background
        'editor.foreground': '#dfe1e5',            // --theia-editor-foreground
        'editor.lineHighlightBackground': '#252629',
        'editorLineNumber.foreground': '#5d6166',   // --theia-editorLineNumber-foreground
        'editorLineNumber.activeForeground': '#c5c8cc', // --theia-editorLineNumber-activeForeground
        'editorCursor.foreground': '#a8d8ff',       // --theia-editorCursor-foreground
        'editor.selectionBackground': '#4a9eff55',
        'editor.inactiveSelectionBackground': '#4a9eff33',
        'editorWidget.background': '#252629',       // --theia-editorWidget-background
        'editorWidget.border': '#3d4148',           // --theia-editorWidget-border
        'editorBracketMatch.border': '#4a9eff',     // --theia-editorBracketMatch-border
        'editorBracketMatch.background': '#4a9eff22',
        'editorIndentGuide.background1': '#2c2e33',
        'editorIndentGuide.activeBackground1': '#4a4d54',
        'editorWhitespace.foreground': '#3a3d42',
        'scrollbarSlider.background': '#4a4d5480',
        'scrollbarSlider.hoverBackground': '#5a5d63a0',
        'scrollbarSlider.activeBackground': '#4a9effa0',
    },
};

/** Monaco editor theme for IntelliJ IDEA-style syntax highlighting —
 * then enhanced for Java Web scanability (methods / types / JSTL /
 * scriptlet kinds) so JSP files are easier to read than stock Darcula. */
export const KAIRO_IDEA_MONACO_THEME: monaco.editor.IStandaloneThemeData = {
    base: 'vs-dark',
    inherit: true,
    rules: [
        // --- Comments ---
        { token: 'comment', foreground: '808080' },
        { token: 'comment.doc', foreground: '629755' },
        { token: 'keyword.doc', foreground: '8A653B' },

        // --- Keywords / language literals ---
        { token: 'keyword', foreground: 'CC7832' },
        { token: 'constant.language', foreground: 'CC7832' },

        // --- Strings ---
        { token: 'string', foreground: '6A8759' },
        { token: 'string.quote', foreground: '6A8759' },
        { token: 'string.escape', foreground: 'CC7832' },
        { token: 'string.escape.invalid', foreground: 'FF6B68' },

        // --- Numbers ---
        { token: 'number', foreground: '6897BB' },
        { token: 'number.float', foreground: '6897BB' },
        { token: 'number.hex', foreground: '6897BB' },
        { token: 'number.octal', foreground: '6897BB' },
        { token: 'number.binary', foreground: '6897BB' },

        // --- Heuristic semantic (usable without JDT LS) ---
        { token: 'type', foreground: 'B5B6E3' },
        { token: 'type.identifier', foreground: 'B5B6E3' },
        { token: 'method', foreground: 'FFC66D' },
        { token: 'identifier', foreground: 'A9B7C6' },
        // UPPER_SNAKE fields / enums
        { token: 'constant', foreground: '9876AA' },
        { token: 'constant.character', foreground: '6A8759' },
        // EL / JSP implicit objects
        { token: 'predefined', foreground: '9876AA' },

        // --- Annotations ---
        { token: 'annotation', foreground: 'BBB529' },

        // --- Operators & delimiters ---
        { token: 'delimiter', foreground: 'A9B7C6' },
        { token: 'delimiter.angle', foreground: 'A9B7C6' },
        { token: 'delimiter.bracket', foreground: 'A9B7C6' },
        { token: 'delimiter.square', foreground: 'A9B7C6' },
        { token: 'delimiter.parenthesis', foreground: 'A9B7C6' },
        { token: 'delimiter.curly', foreground: 'A9B7C6' },
        { token: 'delimiter.html', foreground: 'E8BF6A' },
        { token: 'operator', foreground: 'A9B7C6' },

        { token: 'support', foreground: 'A9B7C6' },
        { token: 'support.class', foreground: 'B5B6E3' },
        { token: 'support.type', foreground: 'B5B6E3' },
        { token: 'support.function', foreground: 'FFC66D' },

        // --- Markup: HTML gold; JSP delimiters magenta; JSTL cyan-gold ---
        { token: 'tag', foreground: 'E8BF6A' },
        { token: 'tag.jsp-directive', foreground: 'D896FF' },
        { token: 'tag.jsp-decl', foreground: 'D896FF' },
        { token: 'tag.jsp-expr', foreground: 'D896FF' },
        { token: 'tag.jsp-scriptlet', foreground: 'D896FF' },
        { token: 'tag.jsp-jstl', foreground: '79B8FF' },
        { token: 'tag.jsp-taglib', foreground: '79B8FF' },

        { token: 'metatag', foreground: '808080' },
        { token: 'metatag.delimiter', foreground: 'D896FF' },
        { token: 'metatag.el', foreground: '6897BB' },

        { token: 'attribute.name', foreground: 'BABABA' },
        { token: 'attribute.value', foreground: '6A8759' },
    ],
    colors: {
        'editor.background': '#1e1f22',
        'editor.foreground': '#A9B7C6',
        'editor.lineHighlightBackground': '#252629',
        'editorLineNumber.foreground': '#5d6166',
        'editorLineNumber.activeForeground': '#c5c8cc',
        'editorCursor.foreground': '#a8d8ff',
        'editor.selectionBackground': '#4a9eff55',
        'editor.inactiveSelectionBackground': '#4a9eff33',
        'editorWidget.background': '#252629',
        'editorWidget.border': '#3d4148',
        'editorBracketMatch.border': '#4a9eff',
        'editorBracketMatch.background': '#4a9eff22',
        'editorIndentGuide.background1': '#2c2e33',
        'editorIndentGuide.activeBackground1': '#4a4d54',
        'editorWhitespace.foreground': '#3a3d42',
        'scrollbarSlider.background': '#4a4d5480',
        'scrollbarSlider.hoverBackground': '#5a5d63a0',
        'scrollbarSlider.activeBackground': '#4a9effa0',
    },
};

/** CSS variable overrides for the Kairo dark theme. These win
 * over the Theia defaults because ColorRegistry writes them as
 * inline `style` on `:root` and `ColorApplicationContribution.updateWindow`
 * runs after `KairoDarkTheme.activate()`. The Theia defaults for
 * these slots are VSCode blue (#007acc) and would otherwise
 * leak through. All values are derived from the single source of
 * truth in kairo-theme.ts (N-034). */
export const KAIRO_THEME_COLOR_OVERRIDES = [
    { id: 'editor.background', defaults: { dark: '#1e1f22', light: '#fafafa' }, description: 'Editor background' },
    { id: 'editor.foreground', defaults: { dark: '#dfe1e5', light: '#1f1f1f' }, description: 'Editor foreground' },
    { id: 'editorWidget.background', defaults: { dark: '#252629', light: '#ffffff' }, description: 'Editor widget background' },
    { id: 'input.background', defaults: { dark: '#1a1b1e', light: '#ffffff' }, description: 'Input background' },
    { id: 'button.background', defaults: { dark: '#4a9eff', light: '#1a73e8' }, description: 'Button background' },
    { id: 'button.foreground', defaults: { dark: '#ffffff', light: '#ffffff' }, description: 'Button foreground' },
    { id: 'statusBar.background', defaults: { dark: '#1a1b1e', light: '#fafafa' }, description: 'Status bar background' },
    { id: 'statusBar.foreground', defaults: { dark: '#c5c8cc', light: '#1f1f1f' }, description: 'Status bar foreground' },
];

@injectable()
export class KairoThemeContribution implements FrontendApplicationContribution, ColorContribution {
    @inject(ThemeService)
    protected readonly themeService!: ThemeService;

    @inject(ColorRegistry)
    protected readonly colorRegistry!: ColorRegistry;

    @inject(WidgetManager)
    @optional()
    protected readonly widgetManager?: WidgetManager;

    /** Implementation of `ColorContribution` — the Theia color
     * system calls this on startup before the theme service is
     * fully initialized. The actual inline-style writing happens
     * inside `ColorApplicationContribution.updateWindow` after the
     * `onDidColorThemeChange` event fires, so by the time the user
     * sees the IDE, our defaults are applied. */
    registerColors(colors: ColorRegistry): void {
        colors.register(...KAIRO_THEME_COLOR_OVERRIDES);
    }

    onStart(): void {
        // Define the Monaco editor themes BEFORE editors can be
        // created; KairoDarkTheme.editorTheme references this id.
        monaco.editor.defineTheme('kairo-dark', KAIRO_MONACO_THEME);
        monaco.editor.defineTheme('kairo-idea-dark', KAIRO_IDEA_MONACO_THEME);
        this.themeService.register(KairoDarkTheme);
        this.themeService.register(KairoIDEATheme);
        // Default to IDEA Darcula-style tokens — Kairo targets Java Web
        // developers coming from IntelliJ. Users can still switch to
        // "Kairo Dark" (VS Code-ish) via Color Theme.
        this.themeService.setCurrentTheme(KairoIDEATheme.id);

        // IDEA Darcula does not rainbow-color brackets. Preference schema
        // default is false, but existing user settings may still have
        // Theia's true — force the editor options to match IDEA.
        const disableRainbowBrackets = (): void => {
            for (const ed of monaco.editor.getEditors()) {
                ed.updateOptions({ bracketPairColorization: { enabled: false } });
            }
        };
        disableRainbowBrackets();
        monaco.editor.onDidCreateEditor(ed => {
            ed.updateOptions({ bracketPairColorization: { enabled: false } });
        });

        // Theia 1.73 caches `WidgetManager.factories` lazily on the
        // first access, and the cache lives in `_cachedFactories`
        // and inside `factoryProvider.services`. Both caches are
        // populated when WidgetManager is first asked for factories
        // — which usually happens before KairoProductFrontend loads
        // and registers its `WidgetFactory` bindings. The result
        // is that the four Kairo widget factories (server / build /
        // deployments / log) are present in the contribution
        // provider but not in `WidgetManager.factories`, so
        // `kairo.view.*` commands throw "No widget factory …" at
        // runtime. We clear both caches here so the next read
        // rebuilds the map with Kairo included.
        if (this.widgetManager) {
            const wm = this.widgetManager as unknown as { _cachedFactories?: Map<string, unknown>; factories: Map<string, unknown> };
            // Only the WidgetManager's own cache is safe to clear.
            // Clearing the factoryProvider's service cache would
            // force a re-walk of the container chain, which can
            // miss Kairo factories if they live in a sibling
            // module that was loaded but not in the active
            // container's own scope (we keep the factoryProvider
            // cache intact on purpose).
            if (wm._cachedFactories) {
                wm._cachedFactories = undefined;
            }
            // Touch the getter to force a rebuild — the
            // factoryProvider already contains the Kairo
            // contributions, so this picks them up.
            void wm.factories.size;
            console.log('[kairo] WidgetManager cache reset; factories:',
                Array.from(wm.factories.keys() as IterableIterator<string>).filter((k: string) => k.startsWith('kairo-')).join(','));
        }
    }
}