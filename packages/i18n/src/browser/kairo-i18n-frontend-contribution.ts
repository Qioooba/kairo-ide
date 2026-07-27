import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { KairoI18nService } from './kairo-i18n-service';

/**
 * FrontendApplicationContribution that kick-starts the i18n service.
 *
 * initialize() is synchronous per Kairo's DI safety convention (see the
 * safeContribution helper in kairo-product-frontend-module). We start the
 * async language-pack load in onStart() so the service is immediately
 * available (with English fallback) and switches to the configured language
 * once the locale bundle resolves.
 */
@injectable()
export class KairoI18nFrontendContribution implements FrontendApplicationContribution {
  @inject(KairoI18nService)
  protected readonly i18nService!: KairoI18nService;

  initialize(): void {
    // Synchronous: English fallback is available immediately via the
    // @postConstruct on KairoI18nService. The configured language pack
    // loads asynchronously in onStart() below.
  }

  onStart(): void {
    this.i18nService.initialize().catch(err => {
      console.error('[kairo-i18n] Failed to initialize i18n service:', err);
    });
  }
}
