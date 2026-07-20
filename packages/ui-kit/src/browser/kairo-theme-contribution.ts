import { injectable, inject, optional } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { ThemeService } from '@theia/core/lib/browser/theming';
import { ColorRegistry } from '@theia/core/lib/browser/color-registry';
import { ColorContribution } from '@theia/core/lib/browser/color-application-contribution';
import { WidgetManager } from '@theia/core/lib/browser/widget-manager';
import { KairoDarkTheme } from './kairo-theme';

/** CSS variable overrides for the Kairo dark theme. These win
 * over the Theia defaults because ColorRegistry writes them as
 * inline `style` on `:root` and `ColorApplicationContribution.updateWindow`
 * runs after `KairoDarkTheme.activate()`. The Theia defaults for
 * these slots are VSCode blue (#007acc) and would otherwise
 * leak through. See N-034. */
export const KAIRO_THEME_COLOR_OVERRIDES = [
    { id: 'editor.background', defaults: { dark: '#1e1f22', light: '#fafafa' }, description: 'Editor background' },
    { id: 'editor.foreground', defaults: { dark: '#dfe1e5', light: '#1f1f1f' }, description: 'Editor foreground' },
    { id: 'editorWidget.background', defaults: { dark: '#252629', light: '#ffffff' }, description: 'Editor widget background' },
    { id: 'input.background', defaults: { dark: '#1a1b1e', light: '#ffffff' }, description: 'Input background' },
    { id: 'button.background', defaults: { dark: '#7c5cbf', light: '#1a73e8' }, description: 'Button background' },
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
        this.themeService.register(KairoDarkTheme);
        this.themeService.setCurrentTheme(KairoDarkTheme.id);

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
            const wm: any = this.widgetManager;
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