import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { ThemeService } from '@theia/core/lib/browser/theming';
import { KairoDarkTheme } from './kairo-theme';

@injectable()
export class KairoThemeContribution implements FrontendApplicationContribution {
    @inject(ThemeService)
    protected readonly themeService!: ThemeService;

    onStart(): void {
        this.themeService.register(KairoDarkTheme);
        this.themeService.setCurrentTheme(KairoDarkTheme.id);
    }
}